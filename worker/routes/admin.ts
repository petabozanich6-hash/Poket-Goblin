/**
 * Goblin HQ — Owner-only administration API (/api/admin/*).
 *
 * Layers, in order, on every request:
 *  1. Session (index.ts): signed in, not suspended.
 *  2. Role: permissions are re-read from D1 on every request. Anyone without
 *     `admin.access` gets 404, as if the area did not exist.
 *  3. CSRF: mutations need an allow-listed Origin, a same-origin fetch and the
 *     X-Pocket-Goblin-Admin header (which forces a CORS preflight).
 *  4. Rate limits per user.
 *  5. Passkey step-up (15 min) for everything except the step-up itself.
 *  6. Per-route permission checks, input validation and an audit record for
 *     every change.
 *
 * There is deliberately no endpoint that grants or changes roles.
 */
import { Hono, type Context, type Next } from 'hono'
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

import type { Env } from '../env'
import {
  loadAccess,
  permissionsFor,
  PLANS,
  type Access,
  type Permission,
  type Plan,
} from '../lib/access'
import {
  customerMetrics,
  aiMetrics,
  healthMetrics,
  storageMetrics,
  subscriptionMetrics,
} from '../lib/adminMetrics'
import {
  getCustomerDetail,
  getCustomerSummary,
  searchCustomers,
} from '../lib/adminCustomers'
import { recordSecurityEvent, writeAudit } from '../lib/audit'
import { allowedOrigin } from '../lib/cors'
import {
  authenticationOptions,
  isElevated,
  listCredentials,
  registrationOptions,
  STEP_UP_MINUTES,
  verifyAuthentication,
  verifyRegistration,
  type RelyingParty,
} from '../lib/passkeys'
import { verifyPassword } from '../lib/passwords'
import {
  defaultSettings,
  highImpactReasons,
  isSettingKey,
  LIMITS,
  loadPlatformSettings,
  saveSetting,
  SETTING_KEYS,
  validateSetting,
} from '../lib/platformSettings'
import { checkRateLimit } from '../lib/rateLimit'
import { usdAudQuote } from '../lib/finance'
import { newId } from '../lib/ids'
import { billingConfig, stripe, StripeError } from '../lib/billing/stripe'
import { accountEmail, sendEmail } from '../lib/email'
import {
  revokeAllSessions,
  type AuthUser,
  type SessionInfo,
} from '../lib/session'

type Vars = { user: AuthUser; session: SessionInfo; access: Access }
type AdminContext = Context<{ Bindings: Env; Variables: Vars }>

export const ADMIN_HEADER = 'X-Pocket-Goblin-Admin'
const USER_ID = /^user_[0-9a-f]{32}$/

export const adminRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

// ------------------------------------------------------------ 1. Owner role

adminRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const access = await loadAccess(c.env.DB, user.id)
  if (!permissionsFor(access.roles).has('admin.access')) {
    return c.json({ error: 'Not found' }, 404)
  }
  c.set('access', access)
  c.header('Cache-Control', 'no-store')
  return next()
})

// ------------------------------------------------------------------ 2. CSRF

function isMutation(method: string) {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method)
}

adminRoutes.use('*', async (c, next) => {
  if (!isMutation(c.req.method)) return next()
  const origin = c.req.header('Origin') ?? ''
  const fetchSite = c.req.header('Sec-Fetch-Site')
  if (
    !allowedOrigin(origin, c.env.ENVIRONMENT) ||
    c.req.header(ADMIN_HEADER) !== '1' ||
    (fetchSite !== undefined && fetchSite !== 'same-origin')
  ) {
    return c.json({ error: 'Request blocked' }, 403)
  }
  return next()
})

// ------------------------------------------------------------ 3. Rate limits

adminRoutes.use('*', async (c, next) => {
  const user = c.get('user')
  const write = isMutation(c.req.method)
  const limit = checkRateLimit(
    `admin:${write ? 'w' : 'r'}:${user.id}`,
    write ? 30 : 300,
    5 * 60_000,
  )
  if (!limit.ok) {
    c.header('Retry-After', String(limit.retryAfterSec))
    return c.json({ error: 'Too many requests. Slow down a moment.' }, 429)
  }
  return next()
})

// --------------------------------------------------- helpers for the routes

function relyingParty(c: AdminContext): RelyingParty | null {
  const origin = c.req.header('Origin') ?? ''
  if (!allowedOrigin(origin, c.env.ENVIRONMENT)) return null
  return { origin, rpID: new URL(origin).hostname }
}

function actor(c: AdminContext) {
  const user = c.get('user')
  return { actorUserId: user.id, actorLabel: `owner:${user.id}` }
}

async function readJson(c: AdminContext): Promise<Record<string, unknown>> {
  const body = (await c.req.json().catch(() => null)) as unknown
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

function reasonFrom(body: Record<string, unknown>): string | null {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  return reason.length >= 5 && reason.length <= 500 ? reason : null
}

function requirePermission(permission: Permission) {
  return async (c: AdminContext, next: Next) => {
    if (!permissionsFor(c.get('access').roles).has(permission)) {
      return c.json({ error: 'Not permitted' }, 403)
    }
    return next()
  }
}

async function requireStepUp(c: AdminContext, next: Next) {
  if (!isElevated(c.get('session').elevatedUntil)) {
    return c.json(
      {
        error: 'Confirm it’s you with your passkey.',
        code: 'step_up_required',
      },
      401,
    )
  }
  return next()
}

// --------------------------------------------- security: status and step-up

adminRoutes.get('/security/status', async (c) => {
  const user = c.get('user')
  const passkeys = await listCredentials(c.env.DB, user.id)
  const elevatedUntil = c.get('session').elevatedUntil
  return c.json({
    passkeyCount: passkeys.length,
    elevated: isElevated(elevatedUntil),
    elevatedUntil: isElevated(elevatedUntil) ? elevatedUntil : null,
    stepUpMinutes: STEP_UP_MINUTES,
  })
})

adminRoutes.post('/security/passkeys/register/options', async (c) => {
  const user = c.get('user')
  const session = c.get('session')
  const rp = relyingParty(c)
  if (!rp) return c.json({ error: 'Request blocked' }, 403)

  const existing = await listCredentials(c.env.DB, user.id)
  if (existing.length === 0) {
    // First passkey: prove the password again, so a hijacked session alone
    // cannot attach an attacker's authenticator.
    const limit = checkRateLimit(`reauth:${user.id}`, 5, 15 * 60_000)
    if (!limit.ok)
      return c.json({ error: 'Too many attempts. Wait a while.' }, 429)
    const body = await readJson(c)
    const password = typeof body.password === 'string' ? body.password : ''
    const row = await c.env.DB.prepare(
      `SELECT password_hash as hash FROM users WHERE id = ?`,
    )
      .bind(user.id)
      .first<{ hash: string }>()
    if (!row || !password || !(await verifyPassword(password, row.hash))) {
      await recordSecurityEvent(
        c.env.DB,
        user.id,
        'reauth_failed',
        'passkey enrolment',
      )
      return c.json({ error: 'Password is incorrect.' }, 401)
    }
  } else if (!isElevated(session.elevatedUntil)) {
    return c.json(
      {
        error: 'Confirm it’s you with an existing passkey first.',
        code: 'step_up_required',
      },
      401,
    )
  }
  const options = await registrationOptions(c.env.DB, rp, user, session.id)
  return c.json({ options })
})

adminRoutes.post('/security/passkeys/register/verify', async (c) => {
  const user = c.get('user')
  const rp = relyingParty(c)
  if (!rp) return c.json({ error: 'Request blocked' }, 403)
  const body = await readJson(c)
  if (typeof body.response !== 'object' || body.response === null) {
    return c.json({ error: 'Passkey response is required' }, 400)
  }
  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 60)
      : 'Passkey'
  const result = await verifyRegistration(
    c.env.DB,
    rp,
    user.id,
    c.get('session').id,
    body.response as RegistrationResponseJSON,
    label,
  )
  if (!result.ok) return c.json({ error: result.error }, 400)
  await recordSecurityEvent(c.env.DB, user.id, 'passkey_registered', label)
  await writeAudit(c.env.DB, {
    ...actor(c),
    action: 'passkey.register',
    targetType: 'user',
    targetId: user.id,
    detail: { label },
  })
  return c.json({ ok: true }, 201)
})

adminRoutes.post('/security/step-up/options', async (c) => {
  const user = c.get('user')
  const rp = relyingParty(c)
  if (!rp) return c.json({ error: 'Request blocked' }, 403)
  const options = await authenticationOptions(
    c.env.DB,
    rp,
    user.id,
    c.get('session').id,
  )
  if (!options) {
    return c.json(
      { error: 'Add a passkey first.', code: 'passkey_required' },
      409,
    )
  }
  return c.json({ options })
})

adminRoutes.post('/security/step-up/verify', async (c) => {
  const user = c.get('user')
  const rp = relyingParty(c)
  if (!rp) return c.json({ error: 'Request blocked' }, 403)
  const limit = checkRateLimit(`stepup:${user.id}`, 10, 15 * 60_000)
  if (!limit.ok)
    return c.json({ error: 'Too many attempts. Wait a while.' }, 429)
  const body = await readJson(c)
  if (typeof body.response !== 'object' || body.response === null) {
    return c.json({ error: 'Passkey response is required' }, 400)
  }
  const result = await verifyAuthentication(
    c.env.DB,
    rp,
    user.id,
    c.get('session').id,
    body.response as AuthenticationResponseJSON,
  )
  if (!result.ok) {
    await recordSecurityEvent(c.env.DB, user.id, 'step_up_failed')
    return c.json({ error: result.error }, 401)
  }
  await recordSecurityEvent(c.env.DB, user.id, 'step_up_success')
  return c.json({ elevatedUntil: result.elevatedUntil })
})

adminRoutes.post('/security/step-up/end', async (c) => {
  const user = c.get('user')
  await c.env.DB.prepare(
    `UPDATE sessions SET elevated_until = NULL WHERE id = ? AND user_id = ?`,
  )
    .bind(c.get('session').id, user.id)
    .run()
  return c.json({ ok: true })
})

// ------------------------------------- 5. everything below needs a step-up

adminRoutes.use('*', async (c, next) => {
  const path = c.req.path
  if (
    path === '/api/admin/security/status' ||
    path.startsWith('/api/admin/security/passkeys/register/') ||
    path.startsWith('/api/admin/security/step-up/')
  ) {
    return next()
  }
  return requireStepUp(c, next)
})

// ------------------------------------------------- security: own account

adminRoutes.get('/security/passkeys', async (c) => {
  const passkeys = await listCredentials(c.env.DB, c.get('user').id)
  return c.json({
    passkeys: passkeys.map((p) => ({
      id: p.id,
      label: p.label,
      createdAt: p.createdAt,
      lastUsedAt: p.lastUsedAt,
    })),
  })
})

adminRoutes.delete('/security/passkeys/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const passkeys = await listCredentials(c.env.DB, user.id)
  if (!passkeys.some((p) => p.id === id)) {
    return c.json({ error: 'Passkey not found' }, 404)
  }
  if (passkeys.length < 2) {
    return c.json(
      { error: 'Add another passkey before removing your last one.' },
      409,
    )
  }
  await c.env.DB.prepare(
    `DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .run()
  await recordSecurityEvent(c.env.DB, user.id, 'passkey_removed')
  await writeAudit(c.env.DB, {
    ...actor(c),
    action: 'passkey.remove',
    targetType: 'user',
    targetId: user.id,
  })
  return c.json({ ok: true })
})

adminRoutes.get('/security/sessions', async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT id, created_at as createdAt, last_seen_at as lastSeenAt,
            expires_at as expiresAt
     FROM sessions WHERE user_id = ? AND expires_at > ?
     ORDER BY COALESCE(last_seen_at, created_at) DESC`,
  )
    .bind(user.id, new Date().toISOString())
    .all<{
      id: string
      createdAt: string
      lastSeenAt: string | null
      expiresAt: string
    }>()
  const current = c.get('session').id
  return c.json({
    sessions: (rows.results ?? []).map((s) => ({
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      current: s.id === current,
    })),
  })
})

adminRoutes.post('/security/sessions/revoke-others', async (c) => {
  const user = c.get('user')
  const result = await c.env.DB.prepare(
    `DELETE FROM sessions WHERE user_id = ? AND id != ?`,
  )
    .bind(user.id, c.get('session').id)
    .run()
  const revoked = result.meta.changes ?? 0
  await recordSecurityEvent(
    c.env.DB,
    user.id,
    'sessions_revoked',
    `${revoked} other session(s)`,
  )
  await writeAudit(c.env.DB, {
    ...actor(c),
    action: 'sessions.revoke_others',
    targetType: 'user',
    targetId: user.id,
    detail: { revoked },
  })
  return c.json({ revoked })
})

// --------------------------------------------------------------- overview

adminRoutes.get('/overview', requirePermission('metrics.read'), async (c) => {
  const now = new Date()
  const settings = await loadPlatformSettings(c.env.DB, c.env)
  const [customers, subscriptions, ai, storage, health] = await Promise.all([
    customerMetrics(c.env.DB, now),
    subscriptionMetrics(c.env.DB, c.env),
    aiMetrics(c.env.DB, c.env, settings, now),
    storageMetrics(c.env.DB, settings),
    healthMetrics(c.env.DB, c.env, settings, now),
  ])
  return c.json({
    generatedAt: now.toISOString(),
    customers,
    subscriptions,
    ai,
    storage,
    health,
  })
})

// Owner-only, passkey-gated exchange-rate reference. No financial account
// details or user content are sent to the rate provider.
adminRoutes.get('/finance/fx', requirePermission('metrics.read'), async (c) => {
  const quote = await usdAudQuote()
  return c.json({
    quote,
    conversionAvailable: Boolean(quote),
    // D1 currently records AI request counts, not billable token/neuron usage.
    costCollectionStatus: 'not_configured',
    costExplanation:
      'Provider charges cannot be inferred from request counts. No actual AI cost amount is available yet.',
  })
})

// -------------------------------------------- private customer feedback
adminRoutes.get(
  '/support/unread-count',
  requirePermission('support.read'),
  async (c) => {
    const row = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM support_threads WHERE unread_for_owner = 1',
    ).first<{ n: number }>()
    return c.json({ unread: Number(row?.n ?? 0) })
  },
)

adminRoutes.get('/support', requirePermission('support.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.category, t.subject, t.status, t.unread_for_owner AS unreadForOwner,
            t.created_at AS createdAt, t.updated_at AS updatedAt,
            u.email, u.display_name AS displayName
     FROM support_threads t JOIN users u ON u.id = t.user_id
     ORDER BY t.updated_at DESC LIMIT 100`,
  ).all()
  return c.json({ reports: rows.results ?? [] })
})

adminRoutes.get(
  '/support/:id',
  requirePermission('support.read'),
  async (c) => {
    const report = await c.env.DB.prepare(
      `SELECT t.id, t.category, t.subject, t.message, t.status,
            t.internal_note AS internalNote, t.unread_for_owner AS unreadForOwner,
            t.created_at AS createdAt, t.updated_at AS updatedAt,
            u.email, u.display_name AS displayName
     FROM support_threads t JOIN users u ON u.id = t.user_id WHERE t.id = ?`,
    )
      .bind(c.req.param('id'))
      .first()
    if (!report) return c.json({ error: 'Not found' }, 404)
    const replies = await c.env.DB.prepare(
      'SELECT id, author, body, created_at AS createdAt FROM support_replies WHERE thread_id = ? ORDER BY created_at ASC',
    )
      .bind(c.req.param('id'))
      .all()
    // Reading a message clears the Owner's unread marker.
    await c.env.DB.prepare(
      'UPDATE support_threads SET unread_for_owner = 0 WHERE id = ?',
    )
      .bind(c.req.param('id'))
      .run()
    return c.json({ report, replies: replies.results ?? [] })
  },
)

adminRoutes.post(
  '/support/:id/reply',
  requirePermission('support.write'),
  async (c) => {
    const body = await readJson(c)
    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const status = body.status === undefined ? null : String(body.status)
    if (
      message.length < 2 ||
      message.length > 4000 ||
      (status !== null &&
        !['received', 'in_progress', 'resolved'].includes(status))
    ) {
      return c.json({ error: 'Invalid reply or status' }, 400)
    }
    const report = await c.env.DB.prepare(
      'SELECT id FROM support_threads WHERE id = ?',
    )
      .bind(c.req.param('id'))
      .first()
    if (!report) return c.json({ error: 'Not found' }, 404)
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO support_replies (id, thread_id, author, body) VALUES (?, ?, ?, ?)',
      ).bind(newId('sr'), c.req.param('id'), 'owner', message),
      c.env.DB.prepare(
        `UPDATE support_threads SET unread_for_user = 1, unread_for_owner = 0,
       status = COALESCE(?, status), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ?`,
      ).bind(status, c.req.param('id')),
    ])
    await writeAudit(c.env.DB, {
      ...actor(c),
      action: 'support.reply',
      targetType: 'support_thread',
      targetId: c.req.param('id'),
      detail: { statusChanged: status !== null },
    })
    return c.json({ ok: true })
  },
)

adminRoutes.post(
  '/support/:id/manage',
  requirePermission('support.write'),
  async (c) => {
    const body = await readJson(c)
    const status = String(body.status ?? '')
    const note =
      typeof body.internalNote === 'string' ? body.internalNote.trim() : ''
    if (
      !['received', 'in_progress', 'resolved'].includes(status) ||
      note.length > 1000
    ) {
      return c.json({ error: 'Invalid status or internal note' }, 400)
    }
    const result = await c.env.DB.prepare(
      `UPDATE support_threads SET status = ?, internal_note = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    )
      .bind(status, note, c.req.param('id'))
      .run()
    if (!result.meta.changes) return c.json({ error: 'Not found' }, 404)
    await writeAudit(c.env.DB, {
      ...actor(c),
      action: 'support.manage',
      targetType: 'support_thread',
      targetId: c.req.param('id'),
      detail: { status },
    })
    return c.json({ ok: true })
  },
)

// -------------------------------------------------------------- customers

adminRoutes.get(
  '/customers',
  requirePermission('customers.read'),
  async (c) => {
    const q = (c.req.query('q') ?? '').trim()
    if (q.length > 254) return c.json({ error: 'Search is too long' }, 400)
    const status = c.req.query('status')
    if (status && status !== 'active' && status !== 'suspended') {
      return c.json({ error: 'Invalid status' }, 400)
    }
    const plan = c.req.query('plan')
    if (plan && !(PLANS as readonly string[]).includes(plan)) {
      return c.json({ error: 'Invalid plan' }, 400)
    }
    const page = Number(c.req.query('page') ?? '1')
    if (!Number.isInteger(page) || page < 1 || page > 10_000) {
      return c.json({ error: 'Invalid page' }, 400)
    }
    const limit = 25
    const result = await searchCustomers(c.env.DB, {
      q: q || undefined,
      status: (status as 'active' | 'suspended' | undefined) || undefined,
      plan: (plan as Plan | undefined) || undefined,
      problemsOnly: c.req.query('problems') === '1',
      limit,
      offset: (page - 1) * limit,
    })
    return c.json({ ...result, page })
  },
)

adminRoutes.get(
  '/customers/:id',
  requirePermission('customers.read'),
  async (c) => {
    const id = c.req.param('id') ?? ''
    if (!USER_ID.test(id)) return c.json({ error: 'Customer not found' }, 404)
    const detail = await getCustomerDetail(c.env.DB, id)
    if (!detail) return c.json({ error: 'Customer not found' }, 404)
    return c.json(detail)
  },
)

async function loadTarget(c: AdminContext) {
  const id = c.req.param('id') ?? ''
  if (!USER_ID.test(id)) return null
  return getCustomerSummary(c.env.DB, id)
}

adminRoutes.post(
  '/customers/:id/suspend',
  requirePermission('customers.suspend'),
  async (c) => {
    const target = await loadTarget(c)
    if (!target) return c.json({ error: 'Customer not found' }, 404)
    if (target.id === c.get('user').id || target.isOwner) {
      return c.json({ error: 'Owner accounts cannot be suspended here.' }, 409)
    }
    const body = await readJson(c)
    if (body.confirm !== 'SUSPEND') {
      return c.json({ error: 'Type SUSPEND to confirm.' }, 400)
    }
    const reason = reasonFrom(body)
    if (!reason) {
      return c.json({ error: 'Give a reason (5–500 characters).' }, 400)
    }
    if (target.status === 'suspended') {
      return c.json({ error: 'This account is already suspended.' }, 409)
    }
    await c.env.DB.prepare(
      `UPDATE users SET status = 'suspended', suspended_at = ?, suspended_reason = ?
       WHERE id = ? AND status = 'active'`,
    )
      .bind(new Date().toISOString(), reason, target.id)
      .run()
    const revoked = await revokeAllSessions(c.env.DB, target.id)
    await recordSecurityEvent(c.env.DB, target.id, 'account_suspended')
    await writeAudit(c.env.DB, {
      ...actor(c),
      action: 'customer.suspend',
      targetType: 'user',
      targetId: target.id,
      detail: { reason, sessionsRevoked: revoked },
    })
    return c.json({ ok: true, sessionsRevoked: revoked })
  },
)

adminRoutes.post(
  '/customers/:id/restore',
  requirePermission('customers.suspend'),
  async (c) => {
    const target = await loadTarget(c)
    if (!target) return c.json({ error: 'Customer not found' }, 404)
    if (target.status !== 'suspended') {
      return c.json({ error: 'This account is not suspended.' }, 409)
    }
    const reason = reasonFrom(await readJson(c))
    if (!reason) {
      return c.json({ error: 'Give a reason (5–500 characters).' }, 400)
    }
    await c.env.DB.prepare(
      `UPDATE users SET status = 'active', suspended_at = NULL, suspended_reason = NULL
       WHERE id = ? AND status = 'suspended'`,
    )
      .bind(target.id)
      .run()
    await recordSecurityEvent(c.env.DB, target.id, 'account_restored')
    await writeAudit(c.env.DB, {
      ...actor(c),
      action: 'customer.restore',
      targetType: 'user',
      targetId: target.id,
      detail: { reason },
    })
    return c.json({ ok: true })
  },
)

adminRoutes.post(
  '/customers/:id/sessions/revoke',
  requirePermission('customers.sessions.revoke'),
  async (c) => {
    const target = await loadTarget(c)
    if (!target) return c.json({ error: 'Customer not found' }, 404)
    if (target.id === c.get('user').id) {
      return c.json(
        { error: 'Use “Sign out other sessions” for your own account.' },
        409,
      )
    }
    const reason = reasonFrom(await readJson(c))
    if (!reason) {
      return c.json({ error: 'Give a reason (5–500 characters).' }, 400)
    }
    const revoked = await revokeAllSessions(c.env.DB, target.id)
    await recordSecurityEvent(
      c.env.DB,
      target.id,
      'sessions_revoked',
      'by administrator',
    )
    await writeAudit(c.env.DB, {
      ...actor(c),
      action: 'customer.sessions_revoke',
      targetType: 'user',
      targetId: target.id,
      detail: { reason, revoked },
    })
    return c.json({ revoked })
  },
)

// ---------------------------------------------------------- subscriptions

adminRoutes.get(
  '/subscriptions',
  requirePermission('subscriptions.read'),
  async (c) => {
    const metrics = await subscriptionMetrics(c.env.DB, c.env)
    const rows = await c.env.DB.prepare(
      `SELECT e.user_id as userId, u.email, e.entitlement, e.source, e.status,
              e.billing_interval as billingInterval, e.currency,
              e.current_period_end as currentPeriodEnd,
              e.cancel_at_period_end as cancelAtPeriodEnd, e.updated_at as updatedAt
       FROM user_entitlements e JOIN users u ON u.id = e.user_id
       WHERE e.ended_at IS NULL
       ORDER BY e.updated_at DESC LIMIT 100`,
    ).all()
    return c.json({ metrics, entitlements: rows.results ?? [] })
  },
)

// --------------------------------------------------------------- settings

adminRoutes.get('/settings', requirePermission('settings.read'), async (c) => {
  const settings = await loadPlatformSettings(c.env.DB, c.env)
  const updated = await c.env.DB.prepare(
    `SELECT key, updated_at as updatedAt FROM platform_settings`,
  ).all<{ key: string; updatedAt: string }>()
  return c.json({
    settings,
    defaults: defaultSettings(c.env),
    limits: LIMITS,
    keys: SETTING_KEYS,
    updatedAt: Object.fromEntries(
      (updated.results ?? []).map((r) => [r.key, r.updatedAt]),
    ),
  })
})

adminRoutes.put(
  '/settings/:key',
  requirePermission('settings.write'),
  async (c) => {
    const key = c.req.param('key') ?? ''
    if (!isSettingKey(key)) return c.json({ error: 'Unknown setting' }, 404)
    const body = await readJson(c)
    const checked = validateSetting(key, body.value)
    if (!checked.ok) return c.json({ error: checked.error }, 400)

    const current = await loadPlatformSettings(c.env.DB, c.env)
    const reasons = highImpactReasons(key, current[key], checked.value)
    if (reasons.length > 0 && body.confirmHighImpact !== true) {
      return c.json(
        {
          error: 'This change needs confirmation.',
          code: 'confirmation_required',
          reasons,
        },
        409,
      )
    }
    await saveSetting(c.env.DB, key, checked.value, c.get('user').id)
    await writeAudit(c.env.DB, {
      ...actor(c),
      action: 'settings.update',
      targetType: 'setting',
      targetId: key,
      detail: { from: current[key], to: checked.value, highImpact: reasons },
    })
    return c.json({ key, value: checked.value })
  },
)

// ------------------------------------------------------------------ audit

adminRoutes.get('/audit', requirePermission('audit.read'), async (c) => {
  const page = Number(c.req.query('page') ?? '1')
  if (!Number.isInteger(page) || page < 1 || page > 10_000) {
    return c.json({ error: 'Invalid page' }, 400)
  }
  const limit = 50
  const rows = await c.env.DB.prepare(
    `SELECT id, actor_label as actor, action, target_type as targetType,
            target_id as targetId, detail_json as detail, created_at as createdAt
     FROM admin_audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(limit + 1, (page - 1) * limit)
    .all<{ detail: string } & Record<string, unknown>>()
  const list = (rows.results ?? []).map((r) => {
    let detail: unknown = {}
    try {
      detail = JSON.parse(r.detail)
    } catch {
      detail = {}
    }
    return { ...r, detail }
  })
  return c.json({
    entries: list.slice(0, limit),
    hasMore: list.length > limit,
    page,
  })
})

// -------------------------------------------------- Goblin Deals & Mischief
// Campaign management is deliberately separate from checkout redemption.
// All writes inherit owner, CSRF, rate-limit and passkey step-up protections.
const dealCode = /^[A-Z0-9][A-Z0-9_-]{2,31}$/
const dateString = (v: unknown) =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}T/.test(v) &&
  !Number.isNaN(Date.parse(v))
    ? new Date(v).toISOString()
    : null

adminRoutes.get(
  '/deals',
  requirePermission('subscriptions.read'),
  async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT p.*, 
       COUNT(r.id) AS redemptions,
       COALESCE(SUM(CASE WHEN r.status IN ('reserved','confirmed') THEN r.commitment_cents ELSE 0 END),0) AS committed_cents,
       COALESCE(SUM(r.discounts_realised_cents),0) AS realised_cents,
       COALESCE(SUM(r.revenue_paid_cents),0) AS revenue_cents
     FROM promotion_campaigns p LEFT JOIN promotion_redemptions r ON r.campaign_id=p.id
     GROUP BY p.id ORDER BY p.created_at DESC`,
    ).all()
    return c.json({
      campaigns: rows.results ?? [],
      currency: 'AUD',
      checkoutIntegrated: false,
    })
  },
)

// Read-only campaign claim history. Financial and status details are scoped
// to passkey-elevated Owner HQ; customers cannot fetch another user's claims.
adminRoutes.get(
  '/deals/:id/redemptions',
  requirePermission('subscriptions.read'),
  async (c) => {
    const campaignId = c.req.param('id')
    const campaign = await c.env.DB.prepare(
      'SELECT id FROM promotion_campaigns WHERE id = ?',
    )
      .bind(campaignId)
      .first()
    if (!campaign) return c.json({ error: 'Campaign not found' }, 404)
    const rows = await c.env.DB.prepare(
      `SELECT r.id, u.email, r.status,
              r.created_at AS createdAt, r.confirmed_at AS confirmedAt,
              r.commitment_cents AS committedCents,
              r.discounts_realised_cents AS discountsRealisedCents,
              r.revenue_paid_cents AS revenuePaidCents
       FROM promotion_redemptions r
       JOIN users u ON u.id = r.user_id
       WHERE r.campaign_id = ?
       ORDER BY r.created_at DESC LIMIT 250`,
    )
      .bind(campaignId)
      .all()
    return c.json({ redemptions: rows.results ?? [] })
  },
)

adminRoutes.post('/deals', requirePermission('settings.write'), async (c) => {
  const body = await readJson(c)
  const code =
    typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const kind = body.kind
  const amount = body.amount
  const cycles = body.billingCycles
  const audience = body.audience
  const verification = body.verification
  const max =
    body.maxRedemptions == null || body.maxRedemptions === ''
      ? null
      : body.maxRedemptions
  const activationWindow =
    body.activationWindowDays == null || body.activationWindowDays === ''
      ? null
      : body.activationWindowDays
  const budget =
    body.budgetCents == null || body.budgetCents === ''
      ? null
      : body.budgetCents
  const start =
    body.startAt == null || body.startAt === ''
      ? null
      : dateString(body.startAt)
  const end =
    body.expiresAt == null || body.expiresAt === ''
      ? null
      : dateString(body.expiresAt)
  if (
    !dealCode.test(code) ||
    name.length < 3 ||
    name.length > 100 ||
    !['percent', 'fixed'].includes(String(kind)) ||
    !Number.isInteger(amount) ||
    Number(amount) <= 0 ||
    (kind === 'percent' && Number(amount) > 100) ||
    !Number.isInteger(cycles) ||
    Number(cycles) < 1 ||
    Number(cycles) > 36 ||
    !['new', 'existing', 'all'].includes(String(audience)) ||
    !['none', 'manual'].includes(String(verification)) ||
    (max !== null && (!Number.isInteger(max) || Number(max) < 1)) ||
    (activationWindow !== null &&
      (!Number.isInteger(activationWindow) ||
        Number(activationWindow) < 1 ||
        Number(activationWindow) > 365)) ||
    (budget !== null && (!Number.isInteger(budget) || Number(budget) < 1)) ||
    (body.startAt && !start) ||
    (body.expiresAt && !end) ||
    (start && end && start >= end)
  )
    return c.json({ error: 'Invalid campaign details' }, 400)
  const id = newId('promo')
  try {
    await c.env.DB.prepare(
      `INSERT INTO promotion_campaigns
      (id,code,name,kind,amount,billing_cycles,audience,verification,verification_note,
       max_redemptions,budget_cents,start_at,expires_at,activation_window_days,active)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
    )
      .bind(
        id,
        code,
        name,
        kind,
        amount,
        cycles,
        audience,
        verification,
        verification === 'manual' ? 'Requires manual verification' : '',
        max,
        budget,
        start,
        end,
        activationWindow,
      )
      .run()
  } catch {
    return c.json(
      { error: 'Campaign code already exists or database is unavailable' },
      409,
    )
  }
  await writeAudit(c.env.DB, {
    ...actor(c),
    action: 'deals.create',
    targetType: 'promotion',
    targetId: id,
    detail: { code },
  })
  return c.json({ id, code, active: false }, 201)
})

// Owner-controlled first-invoice codes only. Multicycle / founder offers remain
// inactive until interval-safe redemption and accounting are implemented.
adminRoutes.post(
  '/deals/:id/publish-first-invoice',
  requirePermission('settings.write'),
  async (c) => {
    const id = c.req.param('id')
    const row = await c.env.DB.prepare(
      'SELECT * FROM promotion_campaigns WHERE id = ?',
    )
      .bind(id)
      .first<Record<string, unknown>>()
    if (!row) return c.json({ error: 'Campaign not found' }, 404)
    if (
      row.kind !== 'percent' ||
      Number(row.billing_cycles) !== 1 ||
      row.audience !== 'new' ||
      row.verification !== 'none' ||
      Number(row.max_redemptions) !== 1 ||
      row.budget_cents !== null ||
      row.start_at !== null ||
      row.activation_window_days !== null ||
      row.stripe_promotion_code_id
    )
      return c.json(
        {
          error:
            'Only an unpublished, one-redemption, new-customer percentage offer for the first invoice is supported. Other drafts remain locked.',
        },
        409,
      )
    if (row.expires_at && Date.parse(String(row.expires_at)) <= Date.now())
      return c.json({ error: 'This draft is already expired.' }, 409)
    const config = billingConfig(c.env)
    if (!config.enabled)
      return c.json({ error: 'Stripe is not configured.' }, 503)
    // Never create a live Stripe code before the remote D1 migration exists.
    try {
      await c.env.DB.prepare(
        'SELECT stripe_promotion_code_id FROM promotion_campaigns WHERE id = ?',
      )
        .bind(id)
        .first()
    } catch {
      return c.json(
        { error: 'Apply the Stripe promotion database migration first.' },
        503,
      )
    }
    if (!/^[A-Z0-9]+$/.test(String(row.code)))
      return c.json(
        {
          error:
            'Stripe promotion codes must contain only letters and numbers.',
        },
        409,
      )
    const couponId = 'pg_' + id
    try {
      await stripe(
        config,
        'POST',
        '/coupons',
        {
          id: couponId,
          name: String(row.name),
          duration: 'once',
          percent_off: Number(row.amount),
          metadata: { campaign_id: id },
        },
        { idempotencyKey: 'pg-coupon-' + id },
      )
      const promo = await stripe<{ id: string }>(
        config,
        'POST',
        '/promotion_codes',
        {
          coupon: couponId,
          code: String(row.code),
          max_redemptions: 1,
          restrictions: { first_time_transaction: true },
          ...(row.expires_at
            ? {
                expires_at: Math.floor(
                  Date.parse(String(row.expires_at)) / 1000,
                ),
              }
            : {}),
          metadata: { campaign_id: id },
        },
        { idempotencyKey: 'pg-code-' + id },
      )
      await c.env.DB.prepare(
        `UPDATE promotion_campaigns
         SET stripe_coupon_id = ?, stripe_promotion_code_id = ?, active = 1,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = ? AND stripe_promotion_code_id IS NULL`,
      )
        .bind(couponId, promo.id, id)
        .run()
      await writeAudit(c.env.DB, {
        ...actor(c),
        action: 'deals.publish_first_invoice',
        targetType: 'promotion',
        targetId: id,
        detail: { stripeCodeId: promo.id },
      })
      return c.json({ ok: true, stripePromotionCodeId: promo.id })
    } catch (error) {
      console.error(
        'Promotion publish failed',
        error instanceof StripeError ? error.status : 'network',
      )
      return c.json(
        { error: 'Stripe refused the code. Check Stripe Workbench logs.' },
        502,
      )
    }
  },
)

adminRoutes.patch(
  '/deals/:id',
  requirePermission('settings.write'),
  async (c) => {
    const id = c.req.param('id')
    const body = await readJson(c)
    const row = await c.env.DB.prepare(
      'SELECT * FROM promotion_campaigns WHERE id=?',
    )
      .bind(id)
      .first<Record<string, unknown>>()
    if (!row) return c.json({ error: 'Campaign not found' }, 404)
    const count = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM promotion_redemptions WHERE campaign_id=?',
    )
      .bind(id)
      .first<{ n: number }>()
    // Never change financial terms after a campaign has issued redemptions.
    const locked = Number(count?.n ?? 0) > 0
    const fields: Record<string, unknown> = {}
    if ('active' in body) {
      if (typeof body.active !== 'boolean')
        return c.json({ error: 'Invalid active flag' }, 400)
      // Checkout is not integrated: refuse enabling until redemption is safe.
      if (body.active === true)
        return c.json(
          {
            error:
              'Campaign activation is locked until Stripe checkout integration and redemption safeguards are completed.',
          },
          409,
        )
      if (row.stripe_promotion_code_id) {
        const config = billingConfig(c.env)
        if (!config.enabled)
          return c.json(
            { error: 'Stripe unavailable; cannot safely pause code.' },
            503,
          )
        try {
          await stripe(
            config,
            'POST',
            '/promotion_codes/' + String(row.stripe_promotion_code_id),
            { active: false },
          )
        } catch {
          return c.json({ error: 'Stripe could not deactivate code.' }, 502)
        }
      }
      fields.active = 0
    }
    if ('name' in body) {
      if (
        typeof body.name !== 'string' ||
        body.name.trim().length < 3 ||
        body.name.length > 100
      )
        return c.json({ error: 'Invalid name' }, 400)
      fields.name = body.name.trim()
    }
    if ('maxRedemptions' in body) {
      if (
        body.maxRedemptions !== null &&
        (!Number.isInteger(body.maxRedemptions) ||
          Number(body.maxRedemptions) < 1)
      )
        return c.json({ error: 'Invalid redemption limit' }, 400)
      if (locked || row.stripe_promotion_code_id)
        return c.json(
          { error: 'Published or redeemed campaigns cannot change terms' },
          409,
        )
      fields.max_redemptions = body.maxRedemptions
    }
    if ('budgetCents' in body) {
      if (
        body.budgetCents !== null &&
        (!Number.isInteger(body.budgetCents) || Number(body.budgetCents) < 1)
      )
        return c.json({ error: 'Invalid budget' }, 400)
      if (locked)
        return c.json(
          { error: 'Campaign with redemptions cannot change terms' },
          409,
        )
      fields.budget_cents = body.budgetCents
    }
    if ('expiresAt' in body) {
      const end = body.expiresAt === null ? null : dateString(body.expiresAt)
      if (body.expiresAt !== null && !end)
        return c.json({ error: 'Invalid expiry date' }, 400)
      fields.expires_at = end
    }
    if (Object.keys(fields).length === 0)
      return c.json({ error: 'Nothing to update' }, 400)
    const entries = Object.entries(fields)
    await c.env.DB.prepare(
      `UPDATE promotion_campaigns SET ${entries.map(([k]) => k + '=?').join(',')},updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
    )
      .bind(...entries.map(([, v]) => v), id)
      .run()
    await writeAudit(c.env.DB, {
      ...actor(c),
      action: 'deals.update',
      targetType: 'promotion',
      targetId: id,
      detail: { fields: Object.keys(fields) },
    })
    return c.json({ ok: true })
  },
)

// ---------------------------------------------------- owner-issued giveaways
// These grants never talk to Stripe and never begin an automatic renewal.
// Only a passkey-elevated owner can create or issue them.
adminRoutes.get(
  '/deals/giveaways',
  requirePermission('subscriptions.read'),
  async (c) => {
    const rows = await c.env.DB.prepare(
      `SELECT g.id, g.name, g.duration_days AS durationDays,
              g.max_recipients AS maxRecipients, g.created_at AS createdAt,
              COUNT(r.id) AS recipients
       FROM premium_giveaway_campaigns g
       LEFT JOIN premium_giveaway_grants r ON r.campaign_id = g.id
       GROUP BY g.id ORDER BY g.created_at DESC`,
    ).all()
    return c.json({ giveaways: rows.results ?? [] })
  },
)

adminRoutes.get(
  '/deals/giveaways/:id/grants',
  requirePermission('subscriptions.read'),
  async (c) => {
    const id = c.req.param('id')
    const campaign = await c.env.DB.prepare(
      'SELECT id FROM premium_giveaway_campaigns WHERE id = ?',
    )
      .bind(id)
      .first()
    if (!campaign) return c.json({ error: 'Giveaway not found' }, 404)
    const rows = await c.env.DB.prepare(
      `SELECT g.id, u.email, g.issued_at AS issuedAt,
              e.current_period_end AS expiresAt, e.status,
              e.ended_at AS endedAt
       FROM premium_giveaway_grants g
       JOIN users u ON u.id = g.user_id
       JOIN user_entitlements e ON e.id = g.entitlement_id
       WHERE g.campaign_id = ?
       ORDER BY g.issued_at DESC LIMIT 250`,
    )
      .bind(id)
      .all()
    return c.json({ grants: rows.results ?? [] })
  },
)

adminRoutes.post(
  '/deals/giveaways',
  requirePermission('settings.write'),
  async (c) => {
    const body = await readJson(c)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const days = body.durationDays
    const max = body.maxRecipients
    if (
      name.length < 3 ||
      name.length > 100 ||
      !Number.isInteger(days) ||
      Number(days) < 1 ||
      Number(days) > 365 ||
      !Number.isInteger(max) ||
      Number(max) < 1 ||
      Number(max) > 10000
    )
      return c.json({ error: 'Invalid giveaway details' }, 400)
    const id = newId('gift')
    const owner = c.get('user')
    await c.env.DB.prepare(
      `INSERT INTO premium_giveaway_campaigns
       (id,name,duration_days,max_recipients,created_by)
       VALUES (?,?,?,?,?)`,
    )
      .bind(id, name, days, max, owner.id)
      .run()
    await writeAudit(c.env.DB, {
      ...actor(c),
      action: 'giveaway.create',
      targetType: 'premium_giveaway',
      targetId: id,
      detail: { durationDays: days, maxRecipients: max },
    })
    return c.json({ id }, 201)
  },
)

adminRoutes.post(
  '/deals/giveaways/:id/grant',
  requirePermission('settings.write'),
  async (c) => {
    const body = await readJson(c)
    const email =
      typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      return c.json({ error: 'Enter an existing customer email.' }, 400)
    const owner = c.get('user')
    const recipient = await c.env.DB.prepare(
      "SELECT id, display_name AS displayName FROM users WHERE email = ? AND status = 'active'",
    )
      .bind(email)
      .first<{ id: string; displayName: string }>()
    if (!recipient) return c.json({ error: 'Active account not found' }, 404)
    if (recipient.id === owner.id)
      return c.json({ error: 'Owner giveaways must go to customers.' }, 409)
    const giveawayId = c.req.param('id')
    const campaign = await c.env.DB.prepare(
      'SELECT duration_days AS days FROM premium_giveaway_campaigns WHERE id = ?',
    )
      .bind(giveawayId)
      .first<{ days: number }>()
    if (!campaign) return c.json({ error: 'Giveaway not found' }, 404)
    const ends = new Date(Date.now() + campaign.days * 86_400_000).toISOString()
    const entitlementId = newId('ent')
    const grantId = newId('giftuse')
    // D1 batch is transactional. The entitlement INSERT checks capacity and
    // account eligibility within SQL, not from a stale read in the browser.
    const results = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE user_entitlements
         SET status = 'expired',
             ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE user_id = ? AND source = 'giveaway'
           AND ended_at IS NULL
           AND current_period_end <= strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      ).bind(recipient.id),
      c.env.DB.prepare(
        `INSERT INTO user_entitlements
         (id,user_id,entitlement,source,status,current_period_end,granted_by,reason)
         SELECT ?, ?, 'premium', 'giveaway', 'active', ?, ?, ?
         FROM premium_giveaway_campaigns g
         WHERE g.id = ?
           AND (SELECT COUNT(*) FROM premium_giveaway_grants
                WHERE campaign_id = g.id) < g.max_recipients
           AND NOT EXISTS (SELECT 1 FROM premium_giveaway_grants
                           WHERE campaign_id = g.id AND user_id = ?)
           AND NOT EXISTS (SELECT 1 FROM user_entitlements
                           WHERE user_id = ? AND entitlement = 'premium'
                             AND ended_at IS NULL)`,
      ).bind(
        entitlementId,
        recipient.id,
        ends,
        owner.id,
        'Free Premium giveaway',
        giveawayId,
        recipient.id,
        recipient.id,
      ),
      c.env.DB.prepare(
        `INSERT INTO premium_giveaway_grants
         (id,campaign_id,user_id,entitlement_id,issued_by)
         SELECT ?,?,?,?,?
         WHERE EXISTS (SELECT 1 FROM user_entitlements WHERE id = ?)`,
      ).bind(
        grantId,
        giveawayId,
        recipient.id,
        entitlementId,
        owner.id,
        entitlementId,
      ),
    ])
    if (!results[1]?.meta.changes)
      return c.json(
        {
          error:
            'Already claimed, campaign full, or customer already has a Premium entitlement.',
        },
        409,
      )
    await writeAudit(c.env.DB, {
      ...actor(c),
      action: 'giveaway.grant',
      targetType: 'user',
      targetId: recipient.id,
      detail: { campaignId: giveawayId, durationDays: campaign.days },
    })
    // The entitlement is committed before email delivery; failed email must
    // never revoke the grant or cause a second redemption.
    const mail = await sendEmail(
      c.env,
      accountEmail({
        to: email,
        subject: '🎁 The goblins have a gift for you — free Premium!',
        greeting: 'A little mischief for you, ' + recipient.displayName + '!',
        lines: [
          'The Pocket Goblin gremlins awarded you ' +
            campaign.days +
            ' days of Premium access, completely free.',
          'Your access is ready now and lasts until ' +
            ends.slice(0, 10) +
            ' (UTC).',
          'No payment details are needed. This gift will not start a subscription or renew automatically.',
          'Sign in to Pocket Goblin to enjoy your gift!',
        ],
        action: {
          label: 'Open Pocket Goblin',
          url: 'https://pocketgoblin.org/',
        },
        footer: 'Questions? Contact our support team.',
      }),
    )
    return c.json({ ok: true, expiresAt: ends, emailSent: mail.sent }, 201)
  },
)
