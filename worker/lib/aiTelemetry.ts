/** Privacy-safe per-call Workers AI measurement. No user identifiers or content. */
import type { Env } from '../env'

export type InferenceModality = 'text' | 'vision'
type Basis = 'reported' | 'approximate' | 'unknown'
export type InferenceSample = {
  model: string
  modality: InferenceModality
  status: 'completed' | 'failed'
  durationMs: number
  inputTokens: number | null
  outputTokens: number | null
  tokenBasis: Basis
  estimatedGrossUsd: number | null
}

// Only use a rate where Cloudflare publishes pricing for the EXACT model ID.
// The production -instruct-fast model is not priced as -instruct-fp8 here.
export const PUBLISHED_RATES_USD_PER_MILLION: Record<
  string,
  { input: number; output: number }
> = {
  '@cf/meta/llama-3.1-8b-instruct-fp8': { input: 0.152, output: 0.287 },
}
export const PRICING_SOURCE =
  'https://developers.cloudflare.com/workers-ai/platform/pricing/'

function token(v: unknown): number | null {
  return typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= 0 &&
    v <= 20_000_000
    ? Math.round(v)
    : null
}

export function makeInferenceSample(input: {
  model: string
  modality: InferenceModality
  status: 'completed' | 'failed'
  durationMs: number
  raw: unknown
  promptText?: string
}): InferenceSample {
  const raw = input.raw as {
    usage?: Record<string, unknown>
    response?: unknown
    result?: { usage?: Record<string, unknown> }
  } | null
  const usage = raw?.usage ?? raw?.result?.usage
  const reportedIn = token(usage?.prompt_tokens ?? usage?.input_tokens)
  const reportedOut = token(usage?.completion_tokens ?? usage?.output_tokens)
  const response = raw?.response
  let inputTokens = reportedIn
  let outputTokens = reportedOut
  if (input.modality === 'text') {
    if (inputTokens === null && input.promptText !== undefined) {
      inputTokens = Math.ceil(input.promptText.length / 4)
    }
    if (outputTokens === null && response !== undefined && response !== null) {
      const chars =
        typeof response === 'string'
          ? response.length
          : JSON.stringify(response).length
      outputTokens = Math.ceil(chars / 4)
    }
  }
  const tokenBasis: Basis =
    reportedIn !== null && reportedOut !== null
      ? 'reported'
      : inputTokens !== null && outputTokens !== null
        ? 'approximate'
        : 'unknown'
  const rate = PUBLISHED_RATES_USD_PER_MILLION[input.model]
  const estimatedGrossUsd =
    input.status === 'completed' &&
    rate &&
    inputTokens !== null &&
    outputTokens !== null
      ? (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000
      : null
  return {
    model: input.model.slice(0, 120),
    modality: input.modality,
    status: input.status,
    durationMs: Math.min(600_000, Math.max(0, Math.round(input.durationMs))),
    inputTokens,
    outputTokens,
    tokenBasis,
    estimatedGrossUsd,
  }
}

/** Missing migrations/failed logging must never interrupt the customer's AI call. */
export async function recordInferenceSample(
  env: Env,
  sample: InferenceSample,
): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO ai_inference_metrics
        (id, model, modality, status, duration_ms, input_tokens, output_tokens, token_basis, estimated_gross_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        sample.model,
        sample.modality,
        sample.status,
        sample.durationMs,
        sample.inputTokens,
        sample.outputTokens,
        sample.tokenBasis,
        sample.estimatedGrossUsd,
      )
      .run()
  } catch {
    // Missing table before approval-gated migration, or telemetry storage failure.
    // Do not log AI inputs, outputs, user identifiers or database error strings.
  }
}

export type InferenceSummary = {
  available: true
  trackedSince: string | null
  trackedCalls30d: number
  estimatedGrossUsd30d: number
  unpricedCalls30d: number
  note: string
  models: Array<{
    model: string
    modality: InferenceModality
    calls: number
    failures: number
    avgMs: number
    reportedTokens: number
    approximateTokens: number
    unknownTokens: number
    estimatedGrossUsd: number
    unpricedCalls: number
  }>
}

export async function inferenceSummary(
  db: D1Database,
  now: Date,
): Promise<InferenceSummary | { available: false; reason: string }> {
  try {
    const since = new Date(now.getTime() - 30 * 86_400_000).toISOString()
    const earliest = await db
      .prepare('SELECT MIN(created_at) AS first FROM ai_inference_metrics')
      .first<{ first: string | null }>()
    const rows = await db
      .prepare(
        `SELECT model, modality, COUNT(*) AS calls,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failures,
         ROUND(AVG(duration_ms)) AS avg_ms,
         SUM(CASE WHEN token_basis = 'reported' THEN 1 ELSE 0 END) AS reported,
         SUM(CASE WHEN token_basis = 'approximate' THEN 1 ELSE 0 END) AS approximate,
         SUM(CASE WHEN token_basis = 'unknown' THEN 1 ELSE 0 END) AS unknown_count,
         COALESCE(SUM(estimated_gross_usd), 0) AS estimate,
         SUM(CASE WHEN status = 'completed' AND estimated_gross_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
       FROM ai_inference_metrics
       WHERE created_at >= ?
       GROUP BY model, modality
       ORDER BY calls DESC`,
      )
      .bind(since)
      .all<Record<string, string | number>>()
    const models = (rows.results ?? []).map((r) => ({
      model: String(r.model),
      modality: r.modality as InferenceModality,
      calls: Number(r.calls),
      failures: Number(r.failures),
      avgMs: Number(r.avg_ms),
      reportedTokens: Number(r.reported),
      approximateTokens: Number(r.approximate),
      unknownTokens: Number(r.unknown_count),
      estimatedGrossUsd: Number(r.estimate),
      unpricedCalls: Number(r.unpriced),
    }))
    return {
      available: true,
      trackedSince: earliest?.first ?? null,
      trackedCalls30d: models.reduce((n, r) => n + r.calls, 0),
      estimatedGrossUsd30d: models.reduce((n, r) => n + r.estimatedGrossUsd, 0),
      unpricedCalls30d: models.reduce((n, r) => n + r.unpricedCalls, 0),
      models,
      note: 'Gross estimates for priced models only, before free neurons, tax and adjustments. Unpriced models are excluded. Cloudflare billing is authoritative; this is not the invoice.',
    }
  } catch {
    return {
      available: false,
      reason:
        'Inference metrics unavailable until the approved D1 migration has run.',
    }
  }
}
