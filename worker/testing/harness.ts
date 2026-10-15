/**
 * Integration-test harness: the real Hono app over a real SQLite database
 * with every migration applied (test/sqliteD1.mjs).
 */
import { createTestD1, type TestD1 } from '../../test/sqliteD1.mjs'
import type { Env } from '../env'
import app from '../index'
import { clearRateLimits } from '../lib/rateLimit'

export const ORIGIN = 'http://localhost:5173'

export type Harness = TestD1 & {
  env: Env
  request: (
    path: string,
    init?: {
      method?: string
      cookie?: string
      body?: unknown
      headers?: Record<string, string>
      admin?: boolean
    },
  ) => Promise<Response>
  register: (email: string, password?: string) => Promise<TestUser>
  login: (email: string, password?: string) => Promise<Response>
  makeOwner: (userId: string) => void
  elevate: (cookieOwner: TestUser, minutes?: number) => void
}

export type TestUser = { id: string; email: string; cookie: string }

export function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? ''
  const match = raw.match(/pg_session=([^;]*)/)
  if (!match?.[1]) throw new Error(`No session cookie (status ${res.status})`)
  return `pg_session=${match[1]}`
}

export function createHarness(overrides: Partial<Env> = {}): Harness {
  clearRateLimits()
  const d1 = createTestD1()
  const env: Env = {
    DB: d1.db,
    ENVIRONMENT: 'development',
    AUTH_SECRET: 'test-secret-'.padEnd(48, 'x'),
    ...overrides,
  }

  const request: Harness['request'] = (path, init = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) }
    if (init.cookie) headers.Cookie = init.cookie
    if (init.body !== undefined) headers['Content-Type'] = 'application/json'
    if (init.admin) {
      headers.Origin = ORIGIN
      headers['X-Pocket-Goblin-Admin'] = '1'
      headers['Sec-Fetch-Site'] = 'same-origin'
    }
    return Promise.resolve(
      app.request(
        path,
        {
          method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
          headers,
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        },
        env,
      ),
    )
  }

  const harness: Harness = {
    ...d1,
    env,
    request,
    async register(email, password = 'correct horse battery') {
      const res = await request('/api/auth/register', {
        body: { email, password, displayName: email.split('@')[0] },
      })
      if (res.status !== 201) {
        throw new Error(`register failed: ${res.status} ${await res.text()}`)
      }
      const body = (await res.json()) as { user: { id: string } }
      return { id: body.user.id, email, cookie: cookieFrom(res) }
    },
    login(email, password = 'correct horse battery') {
      return request('/api/auth/login', { body: { email, password } })
    },
    makeOwner(userId) {
      // What the approval-gated promotion workflow does in production.
      d1.run(
        `INSERT INTO user_roles (id, user_id, role, granted_by, reason)
         VALUES (?, ?, 'owner', 'test', 'test')`,
        `role_${userId}`,
        userId,
      )
      d1.run(
        `INSERT INTO user_entitlements (id, user_id, entitlement, source, status, granted_by)
         VALUES (?, ?, 'owner_premium', 'admin', 'active', 'test')`,
        `ent_${userId}`,
        userId,
      )
    },
    elevate(user, minutes = 15) {
      d1.run(
        `UPDATE sessions SET elevated_until = ? WHERE user_id = ?`,
        new Date(Date.now() + minutes * 60_000).toISOString(),
        user.id,
      )
    },
  }
  return harness
}
