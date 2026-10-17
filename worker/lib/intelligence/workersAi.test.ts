import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'
import { app } from '../../index'
import { createHarness } from '../../testing/harness'
import { callDocumentAi } from '../documents/aiDocument'
import { interpretIntelligence, resolveProvider } from './provider'
import { loadAiPolicy } from './usage'
import { callWorkersAi, reserveWorkersAi, strictJsonObject, workersAiModel, WORKERS_AI_MODEL, WORKERS_AI_TRIAL_MODELS } from './workersAi'

const fixtures: ReturnType<typeof createHarness>[] = []
afterEach(() => {
  vi.useRealTimers()
  fixtures.splice(0).forEach((h) => (h.sqlite as { close(): void }).close())
})
function setup() {
  const run = vi.fn().mockResolvedValue({
    response: JSON.stringify({
      summary: 'One thing to review.',
      suggestions: [
        {
          type: 'task',
          title: 'Call mum',
          sourceReference: 'Call mum',
          dueDate: '2099-01-01',
        },
      ],
    }),
  })
  const h = createHarness({
    AI_PROVIDER: 'workers_ai',
    AI: { run } as unknown as Ai,
  })
  fixtures.push(h)
  for (const id of ['alice', 'bob'])
    h.run(
      'INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)',
      id,
      `${id}@example.test`,
      'unused',
      id,
    )
  const env: Env = { ...h.env, aiRequest: { userId: 'alice', dailyLimit: 40 } }
  return { h, env, run }
}

describe('Workers AI provider', () => {
  it('requires explicit selection, binding and an allowed model', () => {
    const { env } = setup()
    expect(resolveProvider(env)).toMatchObject({
      kind: 'workers_ai',
      model: WORKERS_AI_MODEL,
    })
    for (const overrides of [
      { AI_PROVIDER: 'none' },
      { AI: undefined },
      { AI_MODEL: 'expensive-model' },
    ]) {
      expect(resolveProvider({ ...env, ...overrides }).configured).toBe(false)
    }
  })
  it('uses the binding without credentials and preserves grounded review suggestions', async () => {
    const { env, run } = setup()
    const result = await interpretIntelligence(env, 'Call mum')
    expect(result).toMatchObject({ mode: 'ai', provider: 'workers_ai' })
    expect(result.suggestions[0]?.dueDate).toBeNull()
    expect(run).toHaveBeenCalledExactlyOnceWith(
      WORKERS_AI_MODEL,
      expect.objectContaining({
        max_tokens: 1024,
        stream: false,
        response_format: { type: 'json_object' },
      }),
    )
  })
  it('supports both JSON strings and parsed JSON mode responses', async () => {
    const { env, run } = setup()
    run.mockResolvedValue({ response: { summary: 'ok', suggestions: [] } })
    expect(await callWorkersAi(env, 'JSON', 'text')).toEqual({
      summary: 'ok',
      suggestions: [],
    })
  })
  it('fails closed without request context, schema, or valid budget', async () => {
    const { env, h, run } = setup()
    await expect(
      callWorkersAi({ ...env, aiRequest: undefined }, 's', 'u'),
    ).rejects.toThrow()
    for (const value of ['0', '-1', 'NaN', '1.5', '10001']) {
      await expect(
        callWorkersAi({ ...env, AI_DAILY_GLOBAL_LIMIT: value }, 's', 'u'),
      ).rejects.toThrow()
    }
    h.run('DROP TABLE ai_request_limits')
    await expect(callWorkersAi(env, 's', 'u')).rejects.toThrow()
    expect(run).not.toHaveBeenCalled()
  })
  it('rejects oversized UTF-8 prompts before inference', async () => {
    const { env, run } = setup()
    await expect(callWorkersAi(env, 's', '💜'.repeat(4000))).rejects.toThrow(
      /large/,
    )
    expect(run).not.toHaveBeenCalled()
  })
  it.each([null, { response: '' }, { response: 'not JSON' }, { response: [] }])(
    'falls back on malformed output %j',
    async (output) => {
      const { env, run } = setup()
      run.mockResolvedValue(output)
      const result = await interpretIntelligence(env, 'Call mum')
      expect(result.mode).toBe('ai_unavailable')
      expect(result.provider).toBe('workers_ai+rules_fallback')
      expect(result.suggestions.length).toBeGreaterThan(0)
      expect(run).toHaveBeenCalledTimes(1)
    },
  )
  it('times out without retrying or refunding the potentially billable call', async () => {
    const { env, run, h } = setup()
    vi.useFakeTimers()
    run.mockImplementation(() => new Promise(() => {}))
    const pending = interpretIntelligence(env, 'Call mum')
    await vi.advanceTimersByTimeAsync(12_001)
    expect((await pending).mode).toBe('ai_unavailable')
    expect(run).toHaveBeenCalledTimes(1)
    expect(
      h.query(
        "SELECT request_count FROM ai_request_limits WHERE scope = 'global-day'",
      ),
    ).toEqual([{ request_count: 1 }])
  })
  it('uses the same capped transport for document text but never sends images', async () => {
    const { env, run } = setup()
    await callDocumentAi(env, { text: 'Pay the bill' }, '2026-10-15')
    expect(run.mock.calls[0]?.[1].messages[1].content).toContain('<document>')
    await expect(
      callDocumentAi(
        env,
        { image: new Uint8Array([1]), mime: 'image/png' },
        '2026-10-15',
      ),
    ).rejects.toThrow(/images/)
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('loads authenticated user context and respects the Owner kill switch', async () => {
    const { env, h, run } = setup()
    expect((await loadAiPolicy(h.db, env, 'bob')).env.aiRequest?.userId).toBe(
      'bob',
    )
    h.run(
      "INSERT INTO platform_settings (key, value_json, updated_by) VALUES ('features', ?, 'alice')",
      JSON.stringify({
        registrationsOpen: true,
        documentUploads: true,
        aiProvider: false,
      }),
    )
    const policy = await loadAiPolicy(h.db, env, 'alice')
    await interpretIntelligence(policy.env, 'Call mum')
    expect(run).not.toHaveBeenCalled()
  })
})

describe('optional lower-cost Workers AI model trials', () => {
  it('keeps the existing model as default and routes documents independently', async () => {
    const { env, run, h } = setup()
    expect(workersAiModel(env)).toBe(WORKERS_AI_MODEL)
    expect(workersAiModel(env, 'document')).toBe(WORKERS_AI_MODEL)

    const documentEnv: Env = {
      ...env,
      AI_DOCUMENT_MODEL: '@cf/google/gemma-4-26b-a4b-it',
    }
    run.mockResolvedValueOnce({
      response: '```json\\n{"documentType":"general","summary":"A study guide.","suggestions":[]}\\n```',
    })
    const raw = await callDocumentAi(documentEnv, { text: 'Reading guide.' }, '2026-10-17')
    expect(raw).toMatchObject({ documentType: 'general', summary: 'A study guide.' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]).toBe('@cf/google/gemma-4-26b-a4b-it')
    expect(run.mock.calls[0]?.[1].response_format).toBeUndefined()
    expect(workersAiModel(documentEnv)).toBe(WORKERS_AI_MODEL)
    expect(h.query("SELECT request_count FROM ai_request_limits WHERE scope = 'global-day'"))
      .toEqual([{ request_count: 1 }])
  })

  it.each(WORKERS_AI_TRIAL_MODELS)(
    'allows %s only when explicitly selected and omits undocumented JSON mode',
    async (candidate) => {
      const { env, run } = setup()
      run.mockResolvedValueOnce({ response: '{"suggestions":[],"summary":"OK"}' })
      await callWorkersAi({ ...env, AI_MODEL: candidate }, 'Return JSON only.', 'A thought')
      expect(run).toHaveBeenCalledExactlyOnceWith(
        candidate,
        expect.objectContaining({ max_tokens: 1024, stream: false }),
      )
      expect(run.mock.calls[0]?.[1].response_format).toBeUndefined()
    },
  )

  it('rejects invalid or unusable document models without an inference call', async () => {
    const { env, run } = setup()
    const bad = { ...env, AI_DOCUMENT_MODEL: '@cf/nonexistent-model' }
    await expect(callDocumentAi(bad, { text: 'Hello' }, '2026-10-17'))
      .rejects.toThrow(/not configured/)
    expect(run).not.toHaveBeenCalled()
  })

  it('rejects prose-wrapped and invalid JSON rather than guessing what was meant', () => {
    expect(strictJsonObject(' {"a":1} ')).toEqual({ a: 1 })
    expect(strictJsonObject('```json\\n{"a":1}\\n```')).toEqual({ a: 1 })
    for (const invalid of [
      'thinking... {"a":1}',
      '{"a":1} explanation',
      '[{"a":1}]',
      '{"a":1} {"b":2}',
    ]) {
      expect(() => strictJsonObject(invalid)).toThrow()
    }
  })
})

describe('Premium AI reserve', () => {
  it('keeps half the global budget available when Free requests are exhausted', async () => {
    const { env } = setup()
    const now = Date.UTC(2026, 9, 16)
    const free: Env = {
      ...env,
      AI_DAILY_GLOBAL_LIMIT: '4',
      aiRequest: { userId: 'alice', dailyLimit: 40, plan: 'free' },
    }
    await reserveWorkersAi(free, now)
    await reserveWorkersAi(free, now)
    await expect(reserveWorkersAi(free, now)).rejects.toThrow()
    const premium: Env = {
      ...env,
      AI_DAILY_GLOBAL_LIMIT: '4',
      aiRequest: { userId: 'bob', dailyLimit: 40, plan: 'premium' },
    }
    await reserveWorkersAi(premium, now)
  })
})

describe('distributed cost and rate controls', () => {
  const now = Date.UTC(2026, 9, 15)
  it('never exceeds per-user daily allowance under concurrent reservations', async () => {
    const { env } = setup()
    env.aiRequest!.dailyLimit = 2
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserveWorkersAi(env, now)),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
  })
  it('shares the global budget across users and resets at UTC midnight', async () => {
    const { env } = setup()
    env.AI_DAILY_GLOBAL_LIMIT = '1'
    await reserveWorkersAi(env, now)
    const bob = { ...env, aiRequest: { userId: 'bob', dailyLimit: 40 } }
    await expect(reserveWorkersAi(bob, now)).rejects.toThrow(/limit/)
    await expect(
      reserveWorkersAi(bob, now + 86_400_000),
    ).resolves.toBeUndefined()
  })
  it('isolates user quotas and resets fixed minute windows', async () => {
    const { env } = setup()
    for (let i = 0; i < 5; i++) await reserveWorkersAi(env, now)
    await expect(reserveWorkersAi(env, now)).rejects.toThrow(/limit/)
    await expect(
      reserveWorkersAi(
        { ...env, aiRequest: { userId: 'bob', dailyLimit: 40 } },
        now,
      ),
    ).resolves.toBeUndefined()
    await expect(reserveWorkersAi(env, now + 60_000)).resolves.toBeUndefined()
  })
  it('enforces global reservations under concurrency across users', async () => {
    const { env } = setup()
    env.AI_DAILY_GLOBAL_LIMIT = '3'
    const requests = ['alice', 'bob'].flatMap((userId) =>
      Array.from({ length: 4 }, () =>
        reserveWorkersAi(
          { ...env, aiRequest: { userId, dailyLimit: 40 } },
          now,
        ),
      ),
    )
    const results = await Promise.allSettled(requests)
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3)
  })
  it('does not let delayed requests roll a counter back to an older window', async () => {
    const { env } = setup()
    await reserveWorkersAi(env, now + 60_000)
    await expect(reserveWorkersAi(env, now)).rejects.toThrow(/limit/)
  })
})

describe('Workers AI authenticated routes', () => {
  it('rejects anonymous callers and shares budget across interpretation and uploads', async () => {
    const { h, run } = setup()
    h.env.AI_DAILY_GLOBAL_LIMIT = '2'
    const anonymous = await h.request('/api/intelligence/interpret', {
      body: { text: 'Call mum' },
    })
    expect(anonymous.status).toBe(401)
    expect(run).not.toHaveBeenCalled()
    const user = await h.register('route@example.test')
    const response = await h.request('/api/intelligence/interpret', {
      cookie: user.cookie,
      body: { text: 'Call mum' },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      result: { mode: 'ai', provider: 'workers_ai' },
    })
    const form = new FormData()
    form.append(
      'file',
      new File(['Pay the electricity bill by 28 October 2030'], 'bill.txt', {
        type: 'text/plain',
      }),
    )
    const upload = await app.request(
      '/api/documents',
      { method: 'POST', headers: { Cookie: user.cookie }, body: form },
      h.env,
    )
    expect(upload.status).toBe(201)
    expect(run).toHaveBeenCalledTimes(1)
    expect(
      h.query(
        'SELECT request_count FROM ai_usage_daily WHERE user_id = ?',
        user.id,
      ),
    ).toEqual([{ request_count: 1 }])
    expect(
      h.query('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?', user.id),
    ).toEqual([{ n: 0 }])
  })
  it('labels document AI correctly and leaves actions for review', async () => {
    const { h, run } = setup()
    run.mockResolvedValue({
      response: JSON.stringify({
        documentType: 'bill',
        summary: 'A bill to check.',
        suggestions: [
          { type: 'task', title: 'Pay bill', sourceReference: 'Pay bill' },
        ],
      }),
    })
    const user = await h.register('document@example.test')
    const form = new FormData()
    form.append(
      'file',
      new File(['Pay bill'], 'bill.txt', { type: 'text/plain' }),
    )
    const upload = await app.request(
      '/api/documents',
      { method: 'POST', headers: { Cookie: user.cookie }, body: form },
      h.env,
    )
    expect(upload.status).toBe(201)
    expect(
      h.query(
        "SELECT provider, outcome FROM ai_events WHERE user_id = ? AND feature = 'document'",
        user.id,
      ),
    ).toEqual([{ provider: 'workers_ai', outcome: 'ai' }])
    expect(
      h.query('SELECT COUNT(*) AS n FROM tasks WHERE user_id = ?', user.id),
    ).toEqual([{ n: 0 }])
    expect(run).toHaveBeenCalledTimes(1)
  })
})
