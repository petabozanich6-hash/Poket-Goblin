import type { Env } from '../../env'

export class WorkersAiBlockedError extends Error {}

/**
 * Llama 3.1 8B "fast": the same model family as the original fp8 choice, but
 * a document read takes ~6 s instead of ~60 s (measured 2026-10-16) and costs
 * slightly fewer neurons. The fp8 variant never finished inside the timeout.
 */
export const WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast'
// These are Cloudflare-hosted models only. New models are opt-in and must be
// benchmarked before a production setting is changed. The existing model
// remains the default for both ordinary requests and document interpretation.
export const WORKERS_AI_TRIAL_MODELS = [
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/zai-org/glm-4.7-flash',
  '@cf/openai/gpt-oss-20b',
] as const
const ALLOWED_MODELS = [
  WORKERS_AI_MODEL,
  '@cf/meta/llama-3.1-8b-instruct-fp8',
  ...WORKERS_AI_TRIAL_MODELS,
] as const

export type AiPurpose = 'general' | 'document'

/** Invalid configured models fail closed rather than silently increasing bills. */
export function workersAiModel(
  env: Env,
  purpose: AiPurpose = 'general',
): (typeof ALLOWED_MODELS)[number] | null {
  const model =
    (purpose === 'document' ? env.AI_DOCUMENT_MODEL?.trim() : undefined) ||
    env.AI_MODEL?.trim() ||
    WORKERS_AI_MODEL
  return (ALLOWED_MODELS as readonly string[]).includes(model)
    ? (model as (typeof ALLOWED_MODELS)[number])
    : null
}

/** Model pages list these trials, but they are not yet in Cloudflare's JSON
 * Mode supported-model list. Ask for JSON via the prompt instead; validate
 * it strictly, or fall back to Pocket Goblin's existing rule engine. */
export function usesLegacyJsonMode(model: string): boolean {
  return !WORKERS_AI_TRIAL_MODELS.some((candidate) => candidate === model)
}

/** Accept only a whole JSON object, optionally surrounded by a JSON fence.
 * Do not extract arbitrary objects from reasoning/prose or copy their content
 * into logs. */
export function strictJsonObject(content: string): Record<string, unknown> {
  const trimmed = content.trim()
  const text = trimmed.startsWith('```')
    ? trimmed
        .replace(/^```(?:json)?\s*\n?/i, '')
        .replace(/\s*```$/, '')
        .trim()
    : trimmed
  const parsed: unknown = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Workers AI response is not a JSON object')
  }
  return parsed as Record<string, unknown>
}

function globalLimit(raw: string | undefined): number {
  if (raw === undefined) return 100
  const n = Number(raw)
  // Invalid configuration disables calls; zero is an emergency stop.
  return Number.isSafeInteger(n) && n >= 0 && n <= 10_000 ? n : 0
}

/** Each reservation is atomic across Worker instances. Failed later gates may
 * consume earlier reservations, intentionally favouring a lower bill. */
export async function reserveWorkersAi(
  env: Env,
  now = Date.now(),
): Promise<void> {
  const ctx = env.aiRequest
  if (!ctx || !Number.isSafeInteger(ctx.dailyLimit) || ctx.dailyLimit <= 0) {
    throw new Error('AI request policy missing or disabled')
  }
  const gates: [string, string | null, number, number][] = [
    [`user-minute:${ctx.userId}`, ctx.userId, Math.floor(now / 60_000), 5],
    [
      `user-day:${ctx.userId}`,
      ctx.userId,
      Math.floor(now / 86_400_000),
      ctx.dailyLimit,
    ],
    ['global-minute', null, Math.floor(now / 60_000), 20],
    [
      'global-day',
      null,
      Math.floor(now / 86_400_000),
      globalLimit(env.AI_DAILY_GLOBAL_LIMIT),
    ],
  ]
  // Reserve half the global daily budget for paying subscribers and Owner.
  // This uses the same atomic D1 gate as the other AI limits, so concurrent
  // Free requests cannot consume the Premium reserve.
  if (ctx.plan === 'free') {
    gates.splice(gates.length - 1, 0, [
      'global-free-day',
      null,
      Math.floor(now / 86_400_000),
      Math.floor(globalLimit(env.AI_DAILY_GLOBAL_LIMIT) / 2),
    ])
  }
  for (const [scope, userId, window, limit] of gates) {
    if (limit === 0) throw new Error('AI budget disabled')
    const result = await env.DB.prepare(
      `
      INSERT INTO ai_request_limits (scope, user_id, window_start, request_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(scope) DO UPDATE SET
        window_start = excluded.window_start,
        request_count = CASE WHEN window_start < excluded.window_start
          THEN 1 ELSE request_count + 1 END
      WHERE window_start < excluded.window_start
        OR (window_start = excluded.window_start AND request_count < ?)
    `,
    )
      .bind(scope, userId, window, limit)
      .run()
    if (result.meta.changes !== 1) throw new Error('AI request limit reached')
  }
}

/** No API key, external HTTP fallback, retries, or prompt/response logging. */
export async function callWorkersAi(
  env: Env,
  system: string,
  user: string,
  timeoutMs = 12_000,
  purpose: AiPurpose = 'general',
): Promise<unknown> {
  const model = workersAiModel(env, purpose)
  if (env.AI_PROVIDER?.toLowerCase() !== 'workers_ai' || !env.AI || !model) {
    throw new WorkersAiBlockedError('Workers AI not configured')
  }
  // Bound UTF-8 bytes, including the system prompt, not just JS characters.
  if (new TextEncoder().encode(system + user).length > 16_000) {
    throw new WorkersAiBlockedError('AI input too large')
  }
  try {
    await reserveWorkersAi(env)
  } catch {
    throw new WorkersAiBlockedError('Workers AI budget unavailable')
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      // The "-fast" variant is newer than the bundled type list.
      (
        env.AI.run as (
          model: string,
          inputs: Record<string, unknown>,
        ) => Promise<unknown>
      )(model, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        ...(usesLegacyJsonMode(model)
          ? { response_format: { type: 'json_object' } }
          : {}),
        stream: false,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Workers AI timed out')),
          timeoutMs,
        )
      }),
    ])
    // A timeout cannot cancel binding inference; retain the reservation.
    if (!result || typeof result !== 'object' || !('response' in result)) {
      throw new Error('Invalid Workers AI response')
    }
    const content = result.response
    if (typeof content === 'string') {
      if (content.length > 32_000) throw new Error('AI output too large')
      return strictJsonObject(content)
    }
    // JSON mode can return an already parsed object.
    if (content && typeof content === 'object' && !Array.isArray(content)) {
      if (JSON.stringify(content).length > 32_000)
        throw new Error('AI output too large')
      return content
    }
    throw new Error('Empty Workers AI response')
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Photos and scans: Llama 4 Scout writes out the text it sees, and nothing
 * else. That text then goes through the same reader and planner as a PDF,
 * so a photo of a letter gets the same dates, tasks and plans. Measured on
 * a phone-sized photo of a school letter (2026-10-16): word-perfect, ~15 s,
 * ~60–75 neurons.
 */
export const WORKERS_AI_VISION_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

const TRANSCRIBE_PROMPT =
  'Transcribe every piece of text in this image exactly as written, line by line, including dates, times and amounts. Output only the text, nothing else. If there is no readable text, output nothing.'

export async function transcribeImageWithWorkersAi(
  env: Env,
  image: Uint8Array,
  mime: string,
  timeoutMs = 30_000,
): Promise<string> {
  if (env.AI_PROVIDER?.toLowerCase() !== 'workers_ai' || !env.AI) {
    throw new WorkersAiBlockedError('Workers AI not configured')
  }
  if (
    image.byteLength > MAX_IMAGE_BYTES ||
    !/^image\/(jpeg|png|webp)$/.test(mime)
  ) {
    throw new WorkersAiBlockedError('Image not supported')
  }
  try {
    await reserveWorkersAi(env)
  } catch {
    throw new WorkersAiBlockedError('Workers AI budget unavailable')
  }
  let binary = ''
  for (let i = 0; i < image.length; i += 0x8000) {
    binary += String.fromCharCode(...image.subarray(i, i + 0x8000))
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      // Newer than the bundled type list, like the text model.
      (env.AI.run as (model: string, inputs: unknown) => Promise<unknown>)(
        WORKERS_AI_VISION_MODEL,
        {
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: TRANSCRIBE_PROMPT },
                {
                  type: 'image_url',
                  image_url: { url: `data:${mime};base64,${btoa(binary)}` },
                },
              ],
            },
          ],
          max_tokens: 2000,
          temperature: 0,
        },
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Workers AI timed out')),
          timeoutMs,
        )
      }),
    ])
    const response =
      result && typeof result === 'object' && 'response' in result
        ? (result as { response: unknown }).response
        : null
    if (typeof response !== 'string') throw new Error('Empty vision response')
    return response.slice(0, 20_000)
  } finally {
    clearTimeout(timer)
  }
}
