import { Hono } from 'hono'

import type { Env } from '../env'
import { appBaseUrl, consumeToken, issueToken } from '../lib/accountTokens'
import { recordSecurityEvent } from '../lib/audit'
import { accountEmail, passwordChangedEmail, sendEmail } from '../lib/email'
import { newId } from '../lib/ids'
import { hashPassword, verifyPassword } from '../lib/passwords'
import { loadPlatformSettings } from '../lib/platformSettings'
import {
  checkDurableLimit,
  clearDurable,
  durableCount,
  waitMessage,
  type LimitResult,
} from '../lib/rateLimit'
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

const MINUTE = 60_000
/**
 * Failed sign-ins before sign-in pauses for 15 minutes: per account from
 * one network (stops guessing), and a much higher cap per account from
 * everywhere (stops distributed guessing). Keying the low cap on the
 * network means a stranger can't lock someone else out of their account.
 */
const LOGIN_FAILS_PER_EMAIL_AND_IP = 10
const LOGIN_FAILS_PER_EMAIL = 100

function tooMany(
  c: { json: (b: unknown, s: 429, h: Record<string, string>) => Response },
  result: Extract<LimitResult, { ok: false }>,
  what: string,
) {
  return c.json(
    { error: `${what} ${waitMessage(result.retryAfterSec)}` },
    429,
    { 'Retry-After': String(result.retryAfterSec) },
  )
}

authRoutes.post('/register', async (c) => {
  const registerCap = c.env.ENVIRONMENT === 'production' ? 8 : 60
  const limit = await checkDurableLimit(
    c.env.DB,
    `register:${clientKey(c)}`,
    registerCap,
    15 * MINUTE,
  )
  if (!limit.ok) return tooMany(c, limit, 'Too many registration attempts.')

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

  if (
    !emailRaw ||
    !isEmail(emailRaw) ||
    !displayName ||
    password.length < 8 ||
    password.length > 200
  ) {
    return c.json(
      {
        error:
          'Provide a valid email, display name, and password (8–200 characters)',
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
  // Additive migration 0017 must be applied before enabling the flag.
  const insertUser = verificationRequired
    ? c.env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, display_name, email_verification_required_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(id, emailRaw, passwordHash, displayName, new Date().toISOString())
    : c.env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, display_name)
         VALUES (?, ?, ?, ?)`,
      ).bind(id, emailRaw, passwordHash, displayName)
  try {
    // Both rows or neither: no half-made accounts.
    await c.env.DB.batch([
      insertUser,
      c.env.DB.prepare(`INSERT INTO user_settings (user_id) VALUES (?)`).bind(
        id,
      ),
    ])
  } catch (error) {
    // Two sign-ups racing for the same email: the second gets the same
    // answer as if it had arrived later, never a 500 or a duplicate.
    if (/UNIQUE/i.test(String(error)))
      return c.json({ error: 'An account with that email already exists' }, 409)
    throw error
  }

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
  const limit = await checkDurableLimit(
    c.env.DB,
    `login:${clientKey(c)}`,
    loginCap,
    15 * MINUTE,
  )
  if (!limit.ok) return tooMany(c, limit, 'Too many sign-in attempts.')

  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const emailRaw = asString(body?.email, 254)?.toLowerCase()
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!emailRaw || !isEmail(emailRaw) || !password || password.length > 200) {
    return c.json({ error: 'Invalid login details' }, 400)
  }

  // Many wrong passwords for one account: pause sign-in for a while (the
  // same answer whether or not the account exists).
  const failKey = `login-fail:${emailRaw}`
  const failHereKey = `login-fail:${emailRaw}:${clientKey(c)}`
  if (
    (await durableCount(c.env.DB, failHereKey, 15 * MINUTE)) >=
      LOGIN_FAILS_PER_EMAIL_AND_IP ||
    (await durableCount(c.env.DB, failKey, 15 * MINUTE)) >=
      LOGIN_FAILS_PER_EMAIL
  ) {
    return c.json(
      {
        error:
          'Too many wrong passwords for this account. Try again in about 15 minutes, or reset your password.',
      },
      429,
      { 'Retry-After': '900' },
    )
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
    await checkDurableLimit(
      c.env.DB,
      failHereKey,
      LOGIN_FAILS_PER_EMAIL_AND_IP,
      15 * MINUTE,
    )
    await checkDurableLimit(
      c.env.DB,
      failKey,
      LOGIN_FAILS_PER_EMAIL,
      15 * MINUTE,
    )
    if (user) await recordSecurityEvent(c.env.DB, user.id, 'login_failed')
    return c.json({ error: 'Email or password is incorrect' }, 401)
  }

  // Only after the password checks out, so suspension is not an oracle.
  if (user.status !== 'active') {
    await recordSecurityEvent(c.env.DB, user.id, 'login_blocked_suspended')
    return c.json(
      {
        error:
          'This account is suspended. If you think that’s a mistake, write to support@pocketgoblin.org.',
        code: 'account_suspended',
      },
      403,
    )
  }

  // Previously gated users remain protected when new signups are ungated.
  // This fallback is only for pre-migration legacy accounts: deployment of
  // migration 0017 and activation of the flag are separate owner approvals.
  let pending: {
    email_verification_required_at: string | null
    email_verified_at: string | null
  } | null = null
  try {
    pending = await c.env.DB.prepare(
      'SELECT email_verification_required_at, email_verified_at FROM users WHERE id = ?',
    )
      .bind(user.id)
      .first<{
        email_verification_required_at: string | null
        email_verified_at: string | null
      }>()
  } catch (error) {
    const missingColumn =
      /no such column: email_verification_required_at/i.test(String(error))
    if (!missingColumn || c.env.EMAIL_VERIFICATION_REQUIRED === 'true') {
      return c.json(
        {
          error:
            'Email verification is temporarily unavailable. Please try again.',
        },
        503,
      )
    }
    // No gated user could have been created before migration 0017.
  }
  if (pending?.email_verification_required_at && !pending.email_verified_at) {
    return c.json(
      {
        error: 'Please confirm your email before signing in.',
        code: 'email_verification_required',
      },
      403,
    )
  }
  await clearDurable(c.env.DB, failHereKey)
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
  const ipLimit = await checkDurableLimit(
    c.env.DB,
    `forgot:${clientKey(c)}`,
    10,
    15 * MINUTE,
  )
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const email = asString(body?.email, 254)?.toLowerCase()
  if (!email || !isEmail(email)) {
    return c.json({ error: 'Enter the email you signed up with.' }, 400)
  }
  if (!ipLimit.ok) return tooMany(c, ipLimit, 'Too many requests.')
  const emailLimit = await checkDurableLimit(
    c.env.DB,
    `forgot-email:${email}`,
    3,
    60 * MINUTE,
  )
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
  const limit = await checkDurableLimit(
    c.env.DB,
    `reset:${clientKey(c)}`,
    20,
    15 * MINUTE,
  )
  if (!limit.ok) return tooMany(c, limit, 'Too many attempts.')
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
  const who = await c.env.DB.prepare(
    `SELECT email, display_name AS displayName FROM users WHERE id = ? AND status = 'active'`,
  )
    .bind(userId)
    .first<{ email: string; displayName: string }>()
  if (who) {
    // A fresh password means a fresh start for sign-in limits.
    await clearDurable(c.env.DB, `login-fail:${who.email}`)
  }
  if (who)
    await sendEmail(
      c.env,
      passwordChangedEmail({
        to: who.email,
        displayName: who.displayName,
        how: 'reset',
        forgotUrl: `${appBaseUrl(c.env, c.req.url)}/forgot-password`,
      }),
    )
  return c.json({ ok: true })
})

/** Confirm an email address from the link in the verification email. */
authRoutes.post('/verify-email', async (c) => {
  const limit = await checkDurableLimit(
    c.env.DB,
    `verify:${clientKey(c)}`,
    30,
    15 * MINUTE,
  )
  if (!limit.ok) return tooMany(c, limit, 'Too many attempts.')
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
  const limit = await checkDurableLimit(
    c.env.DB,
    `verify-public:${clientKey(c)}`,
    5,
    60 * MINUTE,
  )
  if (!limit.ok) return tooMany(c, limit, 'That’s a lot of emails.')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const email = asString(body?.email, 254)?.toLowerCase()
  if (!email || !isEmail(email)) {
    return c.json({ error: 'Enter a valid email address.' }, 400)
  }
  const emailLimit = await checkDurableLimit(
    c.env.DB,
    `verify-public-email:${email}`,
    3,
    60 * MINUTE,
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
