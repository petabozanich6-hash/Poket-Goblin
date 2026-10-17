import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../env'
import { createHarness } from '../testing/harness'
import { inferenceSummary, makeInferenceSample, recordInferenceSample } from './aiTelemetry'
import { callWorkersAi, WORKERS_AI_MODEL } from './intelligence/workersAi'

const harnesses: ReturnType<typeof createHarness>[] = []
afterEach(() => {
  harnesses.splice(0).forEach((h) => (h.sqlite as { close(): void }).close())
})

function testEnv() {
  const run = vi.fn().mockResolvedValue({
    response: '{"suggestions":[]}',
    usage: { prompt_tokens: 125, completion_tokens: 42 },
  })
  const h = createHarness({
    AI_PROVIDER: 'workers_ai',
    AI: { run } as unknown as Ai,
  })
  harnesses.push(h)
  h.run(
    'INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)',
    'test_user', 'private@example.test', 'not-a-password', 'Private Tester',
  )
  const env: Env = { ...h.env, aiRequest: { userId: 'test_user', dailyLimit: 40 } }
  return { h, env, run }
}

describe('metadata-only AI inference baseline', () => {
  it('does not assign pricing from a different model variant', () => {
    const measured = makeInferenceSample({
      model: WORKERS_AI_MODEL,
      modality: 'text',
      status: 'completed',
      durationMs: 1234,
      raw: { usage: { prompt_tokens: 50, completion_tokens: 100 }, response: 'PRIVATE' },
      promptText: 'PRIVATE PROMPT',
    })
    expect(measured).toMatchObject({
      durationMs: 1234, inputTokens: 50, outputTokens: 100,
      tokenBasis: 'reported', estimatedGrossUsd: null,
    })
    const priced = makeInferenceSample({
      ...measured,
      model: '@cf/meta/llama-3.1-8b-instruct-fp8',
      raw: { usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 } },
    })
    expect(priced.estimatedGrossUsd).toBeCloseTo(0.439)
  })

  it('records measured calls without saving user data, prompts or responses', async () => {
    const { h, env } = testEnv()
    expect(await callWorkersAi(env, 'PRIVATE SYSTEM', 'PRIVATE PROMPT')).toEqual({
      suggestions: [],
    })
    const rows = h.query('SELECT * FROM ai_inference_metrics')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      model: WORKERS_AI_MODEL, modality: 'text', status: 'completed',
      input_tokens: 125, output_tokens: 42, token_basis: 'reported',
      estimated_gross_usd: null,
    })
    expect(Number(rows[0]?.duration_ms)).toBeGreaterThanOrEqual(0)
    const stored = JSON.stringify(rows)
    for (const sensitive of ['PRIVATE', 'test_user', 'private@example.test']) {
      expect(stored).not.toContain(sensitive)
    }
    const summary = await inferenceSummary(env.DB, new Date())
    expect(summary.available).toBe(true)
    if (!summary.available) throw new Error('Expected inference metrics')
    expect(summary.trackedCalls30d).toBe(1)
    expect(summary.unpricedCalls30d).toBe(1)
    expect(summary.models[0]?.calls).toBe(1)
  })

  it('records failed inference without breaking the original error', async () => {
    const { h, env, run } = testEnv()
    run.mockRejectedValueOnce(new Error('model unavailable'))
    await expect(callWorkersAi(env, 'system', 'text')).rejects.toThrow('model unavailable')
    expect(h.query('SELECT status FROM ai_inference_metrics')).toEqual([{ status: 'failed' }])
  })

  it('ignores a missing telemetry table and keeps returning the AI result', async () => {
    const { h, env } = testEnv()
    h.run('DROP TABLE ai_inference_metrics')
    await expect(callWorkersAi(env, 'system', 'text')).resolves.toEqual({
      suggestions: [],
    })
    const s = await inferenceSummary(env.DB, new Date())
    expect(s.available).toBe(false)
  })

  it('computes estimates only for published exact model IDs', async () => {
    const { env } = testEnv()
    await recordInferenceSample(env, makeInferenceSample({
      model: '@cf/meta/llama-3.1-8b-instruct-fp8',
      modality: 'text',
      status: 'completed',
      durationMs: 800,
      raw: { usage: { prompt_tokens: 1000, completion_tokens: 1000 } },
    }))
    const s = await inferenceSummary(env.DB, new Date())
    expect(s.available).toBe(true)
    if (!s.available) throw new Error('Expected inference metrics')
    expect(s.estimatedGrossUsd30d).toBeCloseTo(0.000439)
    expect(s.unpricedCalls30d).toBe(0)
  })
})
