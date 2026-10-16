import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EXPORTED_TABLES, NOT_EXPORTED } from './routes/account'
import {
  createHarness,
  cookieFrom,
  type Harness,
  type TestUser,
} from './testing/harness'

type Sent = { to: string; subject: string; text: string; html: string }

let h: Harness
let sent: Sent[]
let alice: TestUser

function lastToken(kind: 'reset-password' | 'verify-email'): string {
  const mail = [...sent]
    .reverse()
    .find((m) => m.text.includes(`/${kind}#token=`))
  const match = mail?.text.match(/#token=([A-Za-z0-9_-]+)/)
  if (!match?.[1]) throw new Error('no token email')
  return match[1]
}

beforeEach(async () => {
  sent = []
  h = createHarness({
    EMAIL: {
      send: vi.fn(async (m: Sent) => {
        sent.push(m)
        return { messageId: `m${sent.length}` }
      }),
    } as unknown as SendEmail,
  })
  alice = await h.register('alice@example.com', 'original password')
})

const json = async (res: Response) =>
  (await res.json()) as Record<string, unknown>

describe('password recovery', () => {
  it('answers identically whether or not the email has an account', async () => {
    const known = await h.request('/api/auth/password/forgot', {
      body: { email: 'alice@example.com' },
    })
    const unknown = await h.request('/api/auth/password/forgot', {
      body: { email: 'nobody@example.com' },
    })
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(await json(known)).toEqual(await json(unknown))
    expect(sent.filter((m) => m.subject.includes('Reset'))).toHaveLength(1)
    expect(sent.at(-1)?.to).toBe('alice@example.com')
  })

  it('stores only a hash of the token and puts it in the link fragment', async () => {
    await h.request('/api/auth/password/forgot', {
      body: { email: 'alice@example.com' },
    })
    const token = lastToken('reset-password')
    expect(sent.at(-1)?.text).toMatch(/\/reset-password#token=/)
    const rows = h.query(
      `SELECT token_hash, purpose FROM account_tokens WHERE purpose = 'password_reset'`,
    )
    expect(rows).toHaveLength(1)
    expect(String(rows[0]?.token_hash)).not.toContain(token)
  })

  it('resets the password once, signs out every session, and allows sign-in', async () => {
    const second = cookieFrom(
      await h.login('alice@example.com', 'original password'),
    )
    await h.request('/api/auth/password/forgot', {
      body: { email: 'alice@example.com' },
    })
    const token = lastToken('reset-password')

    const reset = await h.request('/api/auth/password/reset', {
      body: { token, password: 'brand new password' },
    })
    expect(reset.status).toBe(200)
    expect((await h.request('/api/me', { cookie: alice.cookie })).status).toBe(
      401,
    )
    expect((await h.request('/api/me', { cookie: second })).status).toBe(401)
    expect(
      (await h.login('alice@example.com', 'original password')).status,
    ).toBe(401)
    expect(
      (await h.login('alice@example.com', 'brand new password')).status,
    ).toBe(200)

    const again = await h.request('/api/auth/password/reset', {
      body: { token, password: 'attacker password' },
    })
    expect(again.status).toBe(400)
  })

  it('rejects expired, unknown, malformed and wrong-purpose tokens', async () => {
    await h.request('/api/auth/password/forgot', {
      body: { email: 'alice@example.com' },
    })
    const token = lastToken('reset-password')
    h.run(`UPDATE account_tokens SET expires_at = '2000-01-01T00:00:00.000Z'`)
    for (const t of [token, 'x'.repeat(43), "' OR 1=1 --", '']) {
      const res = await h.request('/api/auth/password/reset', {
        body: { token: t, password: 'brand new password' },
      })
      expect(res.status).toBe(400)
    }
    // A verification token cannot reset a password.
    await h.request('/api/account/verify-email/resend', {
      cookie: alice.cookie,
      body: {},
    })
    const verify = lastToken('verify-email')
    const res = await h.request('/api/auth/password/reset', {
      body: { token: verify, password: 'brand new password' },
    })
    expect(res.status).toBe(400)
  })

  it('cancels older links when a new one is requested', async () => {
    await h.request('/api/auth/password/forgot', {
      body: { email: 'alice@example.com' },
    })
    const first = lastToken('reset-password')
    h.run(`DELETE FROM security_events`)
    await h.request('/api/auth/password/forgot', {
      body: { email: 'alice@example.com' },
    })
    const res = await h.request('/api/auth/password/reset', {
      body: { token: first, password: 'brand new password' },
    })
    expect(res.status).toBe(400)
  })

  it('rate-limits requests per email address', async () => {
    for (let i = 0; i < 5; i += 1) {
      await h.request('/api/auth/password/forgot', {
        body: { email: 'alice@example.com' },
      })
    }
    expect(sent.filter((m) => m.subject.includes('Reset'))).toHaveLength(3)
  })

  it('does not email suspended accounts', async () => {
    h.run(`UPDATE users SET status = 'suspended' WHERE id = ?`, alice.id)
    const before = sent.length
    await h.request('/api/auth/password/forgot', {
      body: { email: 'alice@example.com' },
    })
    expect(sent.length).toBe(before)
  })

  it('still answers safely when email is not configured', async () => {
    const plain = createHarness()
    await plain.register('bob@example.com')
    const res = await plain.request('/api/auth/password/forgot', {
      body: { email: 'bob@example.com' },
    })
    expect(res.status).toBe(200)
  })
})

describe('email verification', () => {
  it('sends a link on registration and confirms the address', async () => {
    expect(sent[0]?.subject).toMatch(/Confirm your Pocket Goblin email/)
    const token = lastToken('verify-email')
    let me = await json(await h.request('/api/me', { cookie: alice.cookie }))
    expect(me.account).toMatchObject({ emailVerified: false })
    expect(
      (await h.request('/api/auth/verify-email', { body: { token } })).status,
    ).toBe(200)
    me = await json(await h.request('/api/me', { cookie: alice.cookie }))
    expect(me.account).toMatchObject({ emailVerified: true })
    expect(
      (await h.request('/api/auth/verify-email', { body: { token } })).status,
    ).toBe(400)
  })
})

describe('opt-in verified email registration gate', () => {
  it('refuses gated registration without writing if email is not configured', async () => {
    const plain = createHarness({ EMAIL_VERIFICATION_REQUIRED: 'true' })
    const res = await plain.request('/api/auth/register', {
      body: {
        email: 'pending@example.com',
        password: 'correct horse battery',
        displayName: 'Pending',
      },
    })
    expect(res.status).toBe(503)
    expect(
      plain.query(
        "SELECT email FROM users WHERE email = 'pending@example.com'",
      ),
    ).toHaveLength(0)
  })

  it('sends email but denies access until the proof link is used', async () => {
    h.env.EMAIL_VERIFICATION_REQUIRED = 'true'
    const res = await h.request('/api/auth/register', {
      body: {
        email: 'new-verification@example.com',
        password: 'correct horse battery',
        displayName: 'New User',
      },
    })
    expect(res.status).toBe(201)
    expect(res.headers.get('set-cookie')).toBeNull()
    const reply = await json(res)
    expect(reply).toMatchObject({ verificationRequired: true, emailSent: true })
    const unverifiedLogin = await h.login('new-verification@example.com')
    expect(unverifiedLogin.status).toBe(403)
    expect(await json(unverifiedLogin)).toMatchObject({
      code: 'email_verification_required',
    })
    expect((await h.request('/api/me')).status).toBe(401)
    // Stopping the rollout for other signups must not bypass this pending user.
    h.env.EMAIL_VERIFICATION_REQUIRED = 'false'
    expect((await h.login('new-verification@example.com')).status).toBe(403)
    h.env.EMAIL_VERIFICATION_REQUIRED = 'true'
    const verifyToken = lastToken('verify-email')
    const verified = await h.request('/api/auth/verify-email', {
      body: { token: verifyToken },
    })
    expect(verified.status).toBe(200)
    expect((await h.login('new-verification@example.com')).status).toBe(200)
    expect(
      (
        await h.request('/api/auth/verify-email', {
          body: { token: verifyToken },
        })
      ).status,
    ).toBe(400)
  })

  it('keeps legacy login working before migration, but fails closed if gate is enabled', async () => {
    const original = h.env.DB
    h.env.DB = {
      ...original,
      prepare(sql: string) {
        if (sql.includes('SELECT email_verification_required_at')) {
          throw new Error('D1_ERROR: no such column: email_verification_required_at')
        }
        return original.prepare(sql)
      },
    } as D1Database
    expect((await h.login('alice@example.com', 'original password')).status).toBe(200)
    h.env.EMAIL_VERIFICATION_REQUIRED = 'true'
    expect((await h.login('alice@example.com', 'original password')).status).toBe(503)
  })

  it('resends safely and preserves legacy accounts', async () => {
    h.env.EMAIL_VERIFICATION_REQUIRED = 'true'
    const legacy = await h.login('alice@example.com', 'original password')
    expect(legacy.status).toBe(200)
    await h.request('/api/auth/register', {
      body: {
        email: 'waiting@example.com',
        password: 'correct horse battery',
        displayName: 'Waiting',
      },
    })
    const before = sent.length
    const known = await h.request('/api/auth/verify-email/resend', {
      body: { email: 'waiting@example.com' },
    })
    const unknown = await h.request('/api/auth/verify-email/resend', {
      body: { email: 'nonexistent@example.com' },
    })
    expect(known.status).toBe(200)
    expect(unknown.status).toBe(200)
    expect(await json(known)).toEqual(await json(unknown))
    expect(sent.length).toBe(before + 1)
  })
})

describe('change password', () => {
  it('needs the current password and signs out other sessions', async () => {
    const other = cookieFrom(
      await h.login('alice@example.com', 'original password'),
    )
    const wrong = await h.request('/api/account/password', {
      cookie: alice.cookie,
      body: { currentPassword: 'guess', newPassword: 'another password' },
    })
    expect(wrong.status).toBe(401)
    const ok = await h.request('/api/account/password', {
      cookie: alice.cookie,
      body: {
        currentPassword: 'original password',
        newPassword: 'another password',
      },
    })
    expect(ok.status).toBe(200)
    expect((await h.request('/api/me', { cookie: alice.cookie })).status).toBe(
      200,
    )
    expect((await h.request('/api/me', { cookie: other })).status).toBe(401)
    expect(
      (await h.login('alice@example.com', 'another password')).status,
    ).toBe(200)
  })
})

describe('data export', () => {
  it('covers every table with user data and never includes secrets', async () => {
    const tables = h
      .query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((r) => String(r.name))
      .filter((name) =>
        h
          .query(`SELECT name FROM pragma_table_info(?)`, name)
          .some((c) => c.name === 'user_id'),
      )
    for (const table of tables) {
      expect(table in EXPORTED_TABLES || NOT_EXPORTED.has(table), table).toBe(
        true,
      )
    }

    await h.request('/api/tasks', {
      cookie: alice.cookie,
      body: { title: 'Water the plants' },
    })
    const res = await h.request('/api/account/export', { cookie: alice.cookie })
    expect(res.headers.get('content-disposition')).toContain('attachment')
    const text = await res.text()
    expect(text).toContain('Water the plants')
    expect(text).not.toMatch(/password_hash|pbkdf2\$|token_hash/)
  })

  it('exports support threads while omitting internal notes', async () => {
    h.run(
      `INSERT INTO support_threads (id, user_id, category, subject, message, internal_note)
       VALUES ('thread_a', ?, 'feedback', 'Topic', 'Customer message', 'INTERNAL_ONLY')`,
      alice.id,
    )
    const response = await h.request('/api/account/export', {
      cookie: alice.cookie,
    })
    expect(response.status).toBe(200)
    const exported = await response.text()
    expect(exported).toContain('Customer message')
    expect(exported).not.toContain('INTERNAL_ONLY')
  })

  it('exports only the caller’s own data', async () => {
    const bob = await h.register('bob@example.com')
    await h.request('/api/tasks', {
      cookie: bob.cookie,
      body: { title: 'Bob private task' },
    })
    const text = await (
      await h.request('/api/account/export', { cookie: alice.cookie })
    ).text()
    expect(text).not.toContain('Bob private task')
  })
})

describe('account deletion', () => {
  it('needs DELETE typed and the password', async () => {
    const res1 = await h.request('/api/account', {
      method: 'DELETE',
      cookie: alice.cookie,
      body: { password: 'original password' },
    })
    expect(res1.status).toBe(400)
    const res2 = await h.request('/api/account', {
      method: 'DELETE',
      cookie: alice.cookie,
      body: { confirm: 'DELETE', password: 'wrong' },
    })
    expect(res2.status).toBe(401)
  })

  it('removes the account and every row of its data, and nobody else’s', async () => {
    const bob = await h.register('bob@example.com')
    await h.request('/api/tasks', {
      cookie: alice.cookie,
      body: { title: 'Alice task' },
    })
    await h.request('/api/notes', {
      cookie: alice.cookie,
      body: { title: 'Alice note' },
    })
    await h.request('/api/tasks', {
      cookie: bob.cookie,
      body: { title: 'Bob task' },
    })

    const res = await h.request('/api/account', {
      method: 'DELETE',
      cookie: alice.cookie,
      body: { confirm: 'DELETE', password: 'original password' },
    })
    expect(res.status).toBe(200)

    const tables = h
      .query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .map((r) => String(r.name))
      .filter((name) =>
        h
          .query(`SELECT name FROM pragma_table_info(?)`, name)
          .some((c) => c.name === 'user_id'),
      )
    for (const table of tables) {
      expect(
        h.query(
          `SELECT COUNT(*) as n FROM ${table} WHERE user_id = ?`,
          alice.id,
        ),
        table,
      ).toEqual([{ n: 0 }])
    }
    expect(h.query(`SELECT id FROM users`)).toEqual([{ id: bob.id }])
    expect(h.query(`SELECT title FROM tasks`)).toEqual([{ title: 'Bob task' }])
    expect(
      (await h.login('alice@example.com', 'original password')).status,
    ).toBe(401)
  })

  it('refuses for the Owner and for active subscribers', async () => {
    h.makeOwner(alice.id)
    const owner = await h.request('/api/account', {
      method: 'DELETE',
      cookie: alice.cookie,
      body: { confirm: 'DELETE', password: 'original password' },
    })
    expect(owner.status).toBe(409)

    const bob = await h.register('bob@example.com')
    h.run(
      `INSERT INTO user_entitlements (id, user_id, entitlement, source, status) VALUES ('e1', ?, 'premium', 'stripe', 'active')`,
      bob.id,
    )
    const paying = await h.request('/api/account', {
      method: 'DELETE',
      cookie: bob.cookie,
      body: { confirm: 'DELETE', password: 'correct horse battery' },
    })
    expect(paying.status).toBe(409)
  })
})
