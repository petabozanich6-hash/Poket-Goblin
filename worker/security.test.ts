import { describe, expect, it } from 'vitest'

import type { Env } from './env'
import app from './index'

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
