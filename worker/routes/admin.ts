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
    costExplanation: 'Provider charges cannot be inferred from request counts. No actual AI cost amount is available yet.',
  })
})

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
