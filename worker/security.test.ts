import { describe, expect, it } from 'vitest'

import type { Env } from './env'
import { app } from './index'
import { createHarness } from './testing/harness'

/**
 * In-process requests against the Hono app with a scripted D1 stand-in.
 * The fake records every statement so tests can assert nothing was written.
 */
const ME = 'user_me'
const MY_TASK = 'task_mine'
const THEIR_TASK = 'task_theirs'

type Statement = { sql: string; args: unknown[] }

function fakeDb(executed: Statement[]): D1Database {
  const prepare = (sql: string) => {
    let args: unknown[] = []
    const stmt = {
      bind(...values: unknown[]) {
        args = values
        return stmt
      },
      async first() {
        executed.push({ sql, args })
        if (sql.includes('FROM sessions s')) {
          return {
            status: 'active',
            sessionId: 'sess_me',
            lastSeenAt: new Date().toISOString(),
            elevatedUntil: null,
            id: ME,
            email: 'me@example.com',
            displayName: 'Me',
            createdAt: '2026-01-01T00:00:00Z',
            expiresAt: '2999-01-01T00:00:00Z',
          }
        }
        if (
          /FROM (tasks|events|reminders) WHERE id = \? AND user_id = \?/.test(
            sql,
          )
        ) {
          return args[0] === MY_TASK && args[1] === ME ? { id: MY_TASK } : null
        }
        if (
          sql.includes('FROM documents') &&
          sql.includes('WHERE id = ? AND user_id = ?')
        ) {
          return { id: args[0], displayName: 'bill.pdf' }
        }
        return null
      },
      async all() {
        executed.push({ sql, args })
        return { results: [] }
      },
      async run() {
        executed.push({ sql, args })
        return { meta: { changes: 1 } }
      },
    }
    return stmt
  }
  return { prepare } as unknown as D1Database
}

function env(overrides: Partial<Env> = {}, executed: Statement[] = []): Env {
  return {
    DB: fakeDb(executed),
    ENVIRONMENT: 'production',
    AUTH_SECRET: 'x'.repeat(48),
    ...overrides,
  }
}

const authed = (body: unknown, method = 'POST') => ({
  method,
  headers: {
    'Content-Type': 'application/json',
    Cookie: 'pg_session=token',
  },
  body: JSON.stringify(body),
})

const writes = (executed: Statement[]) =>
  executed.filter((s) => /^\s*(INSERT|UPDATE|DELETE)/i.test(s.sql))

describe('OAuth callback', () => {
  it('never reflects the error parameter into HTML', async () => {
    const payload = '<img src=x onerror=alert(1)>'
    const res = await app.request(
      `/api/connections/oauth/callback?error=${encodeURIComponent(payload)}`,
      {},
      env(),
    )
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).not.toContain('<img')
    expect(html).not.toContain('onerror')
  })
})

describe('CORS', () => {
  it('does not echo arbitrary origins', async () => {
    const res = await app.request(
      '/api/health',
      { headers: { Origin: 'https://evil.example' } },
      env(),
    )
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('allows the production origin in production only', async () => {
    const prod = await app.request(
      '/api/health',
      { headers: { Origin: 'https://pocketgoblin.org' } },
      env(),
    )
    expect(prod.headers.get('access-control-allow-origin')).toBe(
      'https://pocketgoblin.org',
    )
    const dev = await app.request(
      '/api/health',
      { headers: { Origin: 'http://localhost:5173' } },
      env({ ENVIRONMENT: 'development' }),
    )
    expect(dev.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5173',
    )
  })
})

describe('security headers', () => {
  it('sets a deny-all CSP and frame protection on API responses', async () => {
    const res = await app.request('/api/health', {}, env())
    expect(res.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    )
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('strict-transport-security')).toBeNull()
  })
})

describe('AUTH_SECRET guard', () => {
  it('refuses auth in production without a secret', async () => {
    const res = await app.request(
      '/api/auth/login',
      authed({ email: 'a@example.com', password: 'password1' }),
      env({ AUTH_SECRET: undefined }),
    )
    expect(res.status).toBe(503)
  })

  it('refuses a short secret in production', async () => {
    const res = await app.request(
      '/api/tasks',
      { headers: { Cookie: 'pg_session=token' } },
      env({ AUTH_SECRET: 'short' }),
    )
    expect(res.status).toBe(503)
  })

  it('keeps health available and allows the dev fallback locally', async () => {
    const health = await app.request(
      '/api/health',
      {},
      env({ AUTH_SECRET: undefined }),
    )
    expect(health.status).toBe(200)
    const dev = await app.request(
      '/api/categories',
      { headers: { Cookie: 'pg_session=token' } },
      env({ ENVIRONMENT: 'development', AUTH_SECRET: undefined }),
    )
    expect(dev.status).not.toBe(503)
  })
})

describe('cross-account links', () => {
  it('rejects linking a document to another account’s task', async () => {
    const executed: Statement[] = []
    const res = await app.request(
      '/api/documents/doc_1',
      authed({ linkedTaskId: THEIR_TASK }, 'PATCH'),
      env({}, executed),
    )
    expect(res.status).toBe(404)
    expect(writes(executed)).toEqual([])
  })

  it('rejects a document link to an event or reminder the user does not own', async () => {
    for (const body of [
      { linkedEventId: 'evt_x' },
      { linkedReminderId: 'rem_x' },
    ]) {
      const executed: Statement[] = []
      const res = await app.request(
        '/api/documents/doc_1',
        authed(body, 'PATCH'),
        env({}, executed),
      )
      expect(res.status).toBe(404)
      expect(writes(executed)).toEqual([])
    }
  })

  it('still links a document to the user’s own task', async () => {
    const executed: Statement[] = []
    await app.request(
      '/api/documents/doc_1',
      authed({ linkedTaskId: MY_TASK }, 'PATCH'),
      env({}, executed),
    )
    const sql = writes(executed).map((s) => s.sql)
    expect(sql.some((s) => s.includes('UPDATE documents'))).toBe(true)
    expect(
      sql.some((s) => s.includes('INSERT OR IGNORE INTO record_links')),
    ).toBe(true)
  })

  it('rejects notes linked to another account’s task', async () => {
    const executed: Statement[] = []
    const res = await app.request(
      '/api/notes',
      authed({ title: 'Note', linkedTaskId: THEIR_TASK }),
      env({}, executed),
    )
    expect(res.status).toBe(404)
    expect(writes(executed)).toEqual([])
  })

  it('rejects events linked to another account’s task', async () => {
    const executed: Statement[] = []
    const res = await app.request(
      '/api/events',
      authed({
        title: 'Dentist',
        date: '2026-10-20',
        allDay: true,
        linkedTaskId: THEIR_TASK,
      }),
      env({}, executed),
    )
    expect(res.status).toBe(404)
    expect(writes(executed)).toEqual([])
  })

  it('rejects reminders for another account’s task and unknown types', async () => {
    const executed: Statement[] = []
    const foreign = await app.request(
      '/api/reminders',
      authed({
        title: 'Follow up',
        remindAt: '2026-10-20T09:00:00Z',
        entityType: 'task',
        entityId: THEIR_TASK,
      }),
      env({}, executed),
    )
    expect(foreign.status).toBe(404)
    const unknown = await app.request(
      '/api/reminders',
      authed({
        title: 'Follow up',
        remindAt: '2026-10-20T09:00:00Z',
        entityType: 'whatever',
      }),
      env({}, executed),
    )
    expect(unknown.status).toBe(400)
    expect(writes(executed)).toEqual([])
  })
})

describe('cross-site request forgery guard', () => {
  it('refuses state changes from another site, allows same-site and server calls', async () => {
    const h = createHarness()
    await h.register('csrf@example.com')
    const attempt = (headers: Record<string, string>) =>
      h.request('/api/auth/login', {
        body: { email: 'csrf@example.com', password: 'correct horse battery' },
        headers,
      })
    expect(
      (
        await attempt({
          Origin: 'https://evil.example',
          'Sec-Fetch-Site': 'cross-site',
        })
      ).status,
    ).toBe(403)
    expect((await attempt({ Origin: 'https://evil.example' })).status).toBe(403)
    expect((await attempt({ 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403)
    expect(
      (
        await attempt({
          Origin: 'http://localhost:5173',
          'Sec-Fetch-Site': 'same-origin',
        })
      ).status,
    ).toBe(200)
    // No browser headers at all (curl, Stripe): left to the route's own checks.
    expect((await attempt({})).status).toBe(200)
  })
})

describe('durable sign-in limits', () => {
  it('pauses guessing from one network, without letting strangers lock the owner out', async () => {
    const h = createHarness()
    await h.register('target@example.com')
    const attempt = (password: string, ip: string) =>
      h.request('/api/auth/login', {
        body: { email: 'target@example.com', password },
        headers: { 'CF-Connecting-IP': ip },
      })
    for (let i = 0; i < 10; i++)
      expect((await attempt(`wrong-${i}-password`, '203.0.113.9')).status).toBe(
        401,
      )
    // The guesser's network is paused, even with the right password…
    const paused = await attempt('correct horse battery', '203.0.113.9')
    expect(paused.status).toBe(429)
    expect(paused.headers.get('Retry-After')).toBe('900')
    // …but the real owner, elsewhere, still gets in.
    expect(
      (await attempt('correct horse battery', '198.51.100.7')).status,
    ).toBe(200)
    // Unknown accounts get the same treatment (no enumeration).
    for (let i = 0; i < 10; i++)
      await h.request('/api/auth/login', {
        body: { email: 'nobody@example.com', password: `wrong-${i}-password` },
      })
    expect(
      (
        await h.request('/api/auth/login', {
          body: { email: 'nobody@example.com', password: 'whatever-password' },
        })
      ).status,
    ).toBe(429)
    // Counters are stored hashed, never as email addresses or IPs.
    expect(
      JSON.stringify(h.query('SELECT * FROM auth_rate_limits')),
    ).not.toMatch(/example\.com|203\.0/)
  })

  it('caps distributed guessing per account', async () => {
    const h = createHarness()
    await h.register('target@example.com')
    for (let i = 0; i < 100; i++)
      await h.request('/api/auth/login', {
        body: { email: 'target@example.com', password: `wrong-${i}-password` },
        headers: { 'CF-Connecting-IP': `10.0.${Math.floor(i / 5)}.${i % 5}` },
      })
    const res = await h.request('/api/auth/login', {
      body: { email: 'target@example.com', password: 'correct horse battery' },
      headers: { 'CF-Connecting-IP': '198.51.100.7' },
    })
    expect(res.status).toBe(429)
  })

  it('same-origin requests on any host pass the cross-site guard', async () => {
    const h = createHarness()
    await h.register('host@example.com')
    const res = await app.request(
      'https://pocket-goblin.example.workers.dev/api/auth/login',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://pocket-goblin.example.workers.dev',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: JSON.stringify({
          email: 'host@example.com',
          password: 'correct horse battery',
        }),
      },
      h.env,
    )
    expect(res.status).toBe(200)
  })

  it('a racing duplicate sign-up gets a 409, never a 500 or a half account', async () => {
    const h = createHarness()
    const body = {
      email: 'race@example.com',
      password: 'correct horse battery',
      displayName: 'Race',
    }
    const [a, b] = await Promise.all([
      h.request('/api/auth/register', { body }),
      h.request('/api/auth/register', { body }),
    ])
    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(h.query('SELECT COUNT(*) AS n FROM users')).toEqual([{ n: 1 }])
    expect(h.query('SELECT COUNT(*) AS n FROM user_settings')).toEqual([
      { n: 1 },
    ])
  })
})
