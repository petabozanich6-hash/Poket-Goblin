import type { Env } from '../../env'

export class WorkersAiBlockedError extends Error {}

export const WORKERS_AI_MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8'
// Explicit allowlist: changing models requires reviewing cost and JSON support.
export function workersAiModel(env: Env): typeof WORKERS_AI_MODEL | null {
  const model = env.AI_MODEL?.trim() || WORKERS_AI_MODEL
  return model === WORKERS_AI_MODEL ? model : null
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
): Promise<unknown> {
  const model = workersAiModel(env)
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
      env.AI.run(model, {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        stream: false,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Workers AI timed out')),
          12_000,
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
      return JSON.parse(content) as unknown
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
