import { Hono } from 'hono'

import type { Env } from '../env'
import { appBaseUrl, consumeToken, issueToken } from '../lib/accountTokens'
import { recordSecurityEvent } from '../lib/audit'
import { accountEmail, sendEmail } from '../lib/email'
import { newId } from '../lib/ids'
import { hashPassword, verifyPassword } from '../lib/passwords'
import { loadPlatformSettings } from '../lib/platformSettings'
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

  const platform = await loadPlatformSettings(c.env.DB, c.env)
  if (!platform.features.registrationsOpen) {
    return c.json(
      {
        error: 'New registrations are paused for now. Please try again later.',
      },
      403,
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

  // Rollout is explicit: never start gating registrations unless sending is configured.
  const verificationRequired = c.env.EMAIL_VERIFICATION_REQUIRED === 'true'
  if (verificationRequired && !c.env.EMAIL) {
    return c.json(
      {
        error:
          'Registration is temporarily unavailable. Please try again later.',
      },
      503,
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
  if (verificationRequired) {
    // Additive migration 0016 must be applied before enabling the flag.
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name, email_verification_required_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, emailRaw, passwordHash, displayName, new Date().toISOString())
      .run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(id, emailRaw, passwordHash, displayName)
      .run()
  }

  await c.env.DB.prepare(`INSERT INTO user_settings (user_id) VALUES (?)`)
    .bind(id)
    .run()

  if (verificationRequired) {
    // Unverified accounts have NO usable session. Email service errors are
    // recoverable via public, rate-limited resend rather than granting access.
    const sent = await sendVerificationEmail(
      c.env,
      id,
      emailRaw,
      displayName,
      c.req.url,
    )
    return c.json(
      { verificationRequired: true, emailSent: sent, email: emailRaw },
      201,
    )
  }
  const session = await createSession(c.env.DB, c.env, id)
  setSessionCookie(c, session.token, session.expiresAt)
  await sendVerificationEmail(c.env, id, emailRaw, displayName, c.req.url)

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
            created_at as createdAt, status
     FROM users WHERE email = ?`,
  )
    .bind(emailRaw)
    .first<{
      id: string
      email: string
      passwordHash: string
      displayName: string
      createdAt: string
      status: string
    }>()

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    // Count failed attempts against a tighter per-email bucket too
    checkRateLimit(`login-fail:${emailRaw}`, 10, 15 * 60_000)
    if (user) await recordSecurityEvent(c.env.DB, user.id, 'login_failed')
    return c.json({ error: 'Email or password is incorrect' }, 401)
  }

  // Only after the password checks out, so suspension is not an oracle.
  if (user.status !== 'active') {
    await recordSecurityEvent(c.env.DB, user.id, 'login_blocked_suspended')
    return c.json(
      { error: 'This account is suspended.', code: 'account_suspended' },
      403,
    )
  }

  // A previously gated user stays protected even when gating new signups is off.
  const pending = await c.env.DB.prepare(
    'SELECT email_verification_required_at, email_verified_at FROM users WHERE id = ?',
  )
    .bind(user.id)
    .first<{
      email_verification_required_at: string | null
      email_verified_at: string | null
    }>()
  if (pending?.email_verification_required_at && !pending.email_verified_at) {
    return c.json(
      {
        error: 'Please confirm your email before signing in.',
        code: 'email_verification_required',
      },
      403,
    )
  }
  const session = await createSession(c.env.DB, c.env, user.id)
  setSessionCookie(c, session.token, session.expiresAt)
  await recordSecurityEvent(c.env.DB, user.id, 'login_success')

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

// ------------------------------------------------------------ account email

export async function sendVerificationEmail(
  env: Env,
  userId: string,
  email: string,
  displayName: string,
  requestUrl: string,
) {
  if (!env.EMAIL) return false
  const token = await issueToken(env, userId, 'email_verify')
  const result = await sendEmail(
    env,
    accountEmail({
      to: email,
      subject: 'Confirm your Pocket Goblin email',
      greeting: `Hi ${displayName},`,
      lines: [
        'Please confirm this is your email address, so the goblin can help you get back in if you ever forget your password.',
      ],
      // Fragment, not query string: the token never reaches server logs.
      action: {
        label: 'Confirm my email',
        url: `${appBaseUrl(env, requestUrl)}/verify-email#token=${token}`,
      },
      footer:
        'If you didn’t create a Pocket Goblin account, you can ignore this email.',
    }),
  )
  return result.sent
}

const GENERIC_RESET_REPLY = {
  ok: true,
  message:
    'If an account uses that email, a reset link is on its way. It works for 30 minutes.',
}

/**
 * Forgotten password. Always answers the same way, whether or not the email
 * has an account (no enumeration). Rate-limited per IP and per address.
 */
authRoutes.post('/password/forgot', async (c) => {
  const ipLimit = checkRateLimit(`forgot:${clientKey(c)}`, 10, 15 * 60_000)
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const email = asString(body?.email, 254)?.toLowerCase()
  if (!email || !isEmail(email)) {
    return c.json({ error: 'Enter the email you signed up with.' }, 400)
  }
  const emailLimit = checkRateLimit(`forgot-email:${email}`, 3, 60 * 60_000)
  if (!ipLimit.ok) {
    return c.json(
      { error: 'Too many requests. Please try again shortly.' },
      429,
    )
  }
  if (!emailLimit.ok) return c.json(GENERIC_RESET_REPLY)

  const user = await c.env.DB.prepare(
    `SELECT id, email, display_name as displayName, status FROM users WHERE email = ?`,
  )
    .bind(email)
    .first<{ id: string; email: string; displayName: string; status: string }>()
  if (user && user.status === 'active') {
    const token = await issueToken(c.env, user.id, 'password_reset')
    const result = await sendEmail(
      c.env,
      accountEmail({
        to: user.email,
        subject: 'Reset your Pocket Goblin password',
        greeting: `Hi ${user.displayName},`,
        lines: [
          'Someone (hopefully you) asked to reset your Pocket Goblin password.',
          'The link works once and expires in 30 minutes.',
        ],
        action: {
          label: 'Choose a new password',
          url: `${appBaseUrl(c.env, c.req.url)}/reset-password#token=${token}`,
        },
        footer:
          'If you didn’t ask for this, ignore this email — your password stays the same.',
      }),
    )
    await recordSecurityEvent(
      c.env.DB,
      user.id,
      'password_reset_requested',
      result.sent ? 'email sent' : `email not sent (${result.reason})`,
    )
  }
  return c.json(GENERIC_RESET_REPLY)
})

/** Set a new password with a single-use reset token; signs out everywhere. */
authRoutes.post('/password/reset', async (c) => {
  const limit = checkRateLimit(`reset:${clientKey(c)}`, 20, 15 * 60_000)
  if (!limit.ok) {
    return c.json(
      { error: 'Too many attempts. Please try again shortly.' },
      429,
    )
  }
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const token = typeof body?.token === 'string' ? body.token : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (password.length < 8 || password.length > 200) {
    return c.json({ error: 'Choose a password of at least 8 characters.' }, 400)
  }
  const userId = await consumeToken(c.env, token, 'password_reset')
  if (!userId) {
    return c.json(
      {
        error:
          'That reset link has expired or was already used. Ask for a new one.',
      },
      400,
    )
  }
  const hash = await hashPassword(password)
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET password_hash = ?, password_changed_at = ?,
         email_verified_at = COALESCE(email_verified_at, ?)
       WHERE id = ? AND status = 'active'`,
    ).bind(hash, new Date().toISOString(), new Date().toISOString(), userId),
    // Every existing session ends: whoever had the old password is out.
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    c.env.DB.prepare(
      `DELETE FROM account_tokens WHERE user_id = ? AND purpose = 'password_reset'`,
    ).bind(userId),
  ])
  await recordSecurityEvent(c.env.DB, userId, 'password_reset')
  return c.json({ ok: true })
})

/** Confirm an email address from the link in the verification email. */
authRoutes.post('/verify-email', async (c) => {
  const limit = checkRateLimit(`verify:${clientKey(c)}`, 30, 15 * 60_000)
  if (!limit.ok) {
    return c.json(
      { error: 'Too many attempts. Please try again shortly.' },
      429,
    )
  }
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const token = typeof body?.token === 'string' ? body.token : ''
  const userId = await consumeToken(c.env, token, 'email_verify')
  if (!userId) {
    return c.json({ error: 'That link has expired or was already used.' }, 400)
  }
  await c.env.DB.prepare(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?`,
  )
    .bind(new Date().toISOString(), userId)
    .run()
  await recordSecurityEvent(c.env.DB, userId, 'email_verified')
  return c.json({ ok: true })
})

// A pending user cannot sign in, so resending must work without a session.
// Always use an indistinguishable reply for unknown/verified addresses.
authRoutes.post('/verify-email/resend', async (c) => {
  const limit = checkRateLimit(`verify-public:${clientKey(c)}`, 5, 60 * 60_000)
  if (!limit.ok)
    return c.json({ error: 'Please wait a while before trying again.' }, 429)
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const email = asString(body?.email, 254)?.toLowerCase()
  if (!email || !isEmail(email)) {
    return c.json({ error: 'Enter a valid email address.' }, 400)
  }
  const emailLimit = checkRateLimit(
    `verify-public-email:${email}`,
    3,
    60 * 60_000,
  )
  const reply = {
    ok: true,
    message: 'If this address needs confirmation, a new link is on its way.',
  }
  if (!emailLimit.ok) return c.json(reply)
  if (!c.env.EMAIL) {
    return c.json(
      { error: 'Email is unavailable. Please try again later.' },
      503,
    )
  }
  const row = await c.env.DB.prepare(
    'SELECT id, display_name, email_verified_at FROM users WHERE email = ? AND status = ?',
  )
    .bind(email, 'active')
    .first<{
      id: string
      display_name: string
      email_verified_at: string | null
    }>()
  if (row && !row.email_verified_at) {
    await sendVerificationEmail(
      c.env,
      row.id,
      email,
      row.display_name,
      c.req.url,
    )
  }
  return c.json(reply)
})
