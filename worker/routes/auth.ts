import { Hono } from 'hono'

import type { Env } from '../env'
import { newId } from '../lib/ids'
import { hashPassword, verifyPassword } from '../lib/passwords'
import { checkRateLimit } from '../lib/rateLimit'
import {
  clearSessionCookie,
  createSession,
  destroySession,
  setSessionCookie,
  type AuthUser,
} from '../lib/session'
import { asString, isEmail } from '../lib/validate'

type Vars = { user: AuthUser }

export const authRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

function clientKey(c: { req: { header: (n: string) => string | undefined } }) {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'local'
  )
}

authRoutes.post('/register', async (c) => {
  const registerCap = c.env.ENVIRONMENT === 'production' ? 8 : 60
  const limit = checkRateLimit(
    `register:${clientKey(c)}`,
    registerCap,
    15 * 60_000,
  )
  if (!limit.ok) {
    return c.json(
      { error: 'Too many registration attempts. Please try again shortly.' },
      429,
    )
  }

  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const emailRaw = asString(body?.email, 254)?.toLowerCase()
  const password = typeof body?.password === 'string' ? body.password : ''
  const displayName = asString(body?.displayName, 80)

  if (!emailRaw || !isEmail(emailRaw) || !displayName || password.length < 8) {
    return c.json(
      {
        error:
          'Provide a valid email, display name, and password (8+ characters)',
      },
      400,
    )
  }

  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE email = ?',
  )
    .bind(emailRaw)
    .first()
  if (existing) {
    return c.json({ error: 'An account with that email already exists' }, 409)
  }

  const id = newId('user')
  const passwordHash = await hashPassword(password)
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, display_name)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(id, emailRaw, passwordHash, displayName)
    .run()

  await c.env.DB.prepare(`INSERT INTO user_settings (user_id) VALUES (?)`)
    .bind(id)
    .run()

  const session = await createSession(c.env.DB, c.env, id)
  setSessionCookie(c, session.token, session.expiresAt)

  return c.json(
    {
      user: {
        id,
        email: emailRaw,
        displayName,
        createdAt: new Date().toISOString(),
      },
    },
    201,
  )
})

authRoutes.post('/login', async (c) => {
  const loginCap = c.env.ENVIRONMENT === 'production' ? 20 : 120
  const limit = checkRateLimit(`login:${clientKey(c)}`, loginCap, 15 * 60_000)
  if (!limit.ok) {
    return c.json(
      { error: 'Too many login attempts. Please try again shortly.' },
      429,
    )
  }

  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const emailRaw = asString(body?.email, 254)?.toLowerCase()
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!emailRaw || !isEmail(emailRaw) || !password) {
    return c.json({ error: 'Invalid login details' }, 400)
  }

  const user = await c.env.DB.prepare(
    `SELECT id, email, password_hash as passwordHash, display_name as displayName,
            created_at as createdAt
     FROM users WHERE email = ?`,
  )
    .bind(emailRaw)
    .first<{
      id: string
      email: string
      passwordHash: string
      displayName: string
      createdAt: string
    }>()

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    // Count failed attempts against a tighter per-email bucket too
    checkRateLimit(`login-fail:${emailRaw}`, 10, 15 * 60_000)
    return c.json({ error: 'Email or password is incorrect' }, 401)
  }

  const session = await createSession(c.env.DB, c.env, user.id)
  setSessionCookie(c, session.token, session.expiresAt)

  return c.json({
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
    },
  })
})

authRoutes.post('/logout', async (c) => {
  await destroySession(c.env.DB, c.env, c.req.header('Cookie'))
  clearSessionCookie(c)
  return c.json({ ok: true })
})
