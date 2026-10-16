/**
 * Account self-service for signed-in users: change password, download all
 * my data, delete my account, resend email verification.
 */
import { Hono } from 'hono'

import type { Env } from '../env'
import { loadAccess } from '../lib/access'
import { recordSecurityEvent } from '../lib/audit'
import { getObjectStore } from '../lib/storage'
import { hashPassword, verifyPassword } from '../lib/passwords'
import { checkRateLimit } from '../lib/rateLimit'
import { SESSION_COOKIE, type AuthUser, type SessionInfo } from '../lib/session'
import { sendVerificationEmail } from './auth'

type Vars = { user: AuthUser; session: SessionInfo }

export const accountRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

/**
 * Every table holding a user's data, and what an export includes from it.
 * `omit` lists columns that are secrets or internal pointers, never content.
 * A test checks that every table with a user_id column is listed here or in
 * NOT_EXPORTED, so new tables cannot be silently left out.
 */
export const EXPORTED_TABLES: Record<string, { omit?: string[] }> = {
  user_settings: {},
  categories: {},
  tasks: {},
  task_history: {},
  recurrence_rules: {},
  captures: {},
  capture_items: {},
  events: {},
  reminders: {},
  notes: {},
  shopping_lists: {},
  shopping_items: {},
  documents: { omit: ['storage_key'] },
  document_extractions: {},
  review_items: {},
  record_links: {},
  daily_plans: {},
  user_memory: {},
  assistant_messages: {},
  link_suggestions: {},
  nudge_log: {},
  rescue_plans: {},
  external_connections: {},
  external_records: {},
  user_entitlements: { omit: ['stripe_customer_id', 'stripe_subscription_id'] },
  security_events: {},
  ai_usage_daily: {},
  ai_request_limits: {},
  ai_events: {},
  goblin_actions: {},
  goblin_profiles: {},
  goblin_expressions: {},
  search_history: {},
  achievements: {},
  // The customer's message is theirs; the Owner's private triage notes are not.
  support_threads: { omit: ['internal_note', 'unread_for_owner'] },
  promotion_redemptions: {
    omit: ['stripe_subscription_id', 'stripe_checkout_session_id'],
  },
}

/** Secrets and machinery that are deliberately not exported. */
export const NOT_EXPORTED = new Set([
  'sessions',
  'oauth_tokens',
  'oauth_states',
  'webauthn_credentials',
  'webauthn_challenges',
  'account_tokens',
  'calendar_feeds',
  'user_roles',
  'processing_jobs',
  // Short-lived machinery: record ids for follow-ups, replay protection.
  'goblin_context',
  'goblin_requests',
])

accountRoutes.post('/password', async (c) => {
  const user = c.get('user')
  const limit = checkRateLimit(`password-change:${user.id}`, 5, 15 * 60_000)
  if (!limit.ok)
    return c.json({ error: 'Too many attempts. Wait a while.' }, 429)
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const current =
    typeof body?.currentPassword === 'string' ? body.currentPassword : ''
  const next = typeof body?.newPassword === 'string' ? body.newPassword : ''
  if (next.length < 8 || next.length > 200) {
    return c.json(
      { error: 'Choose a new password of at least 8 characters.' },
      400,
    )
  }
  const row = await c.env.DB.prepare(
    `SELECT password_hash as hash FROM users WHERE id = ?`,
  )
    .bind(user.id)
    .first<{ hash: string }>()
  if (!row || !(await verifyPassword(current, row.hash))) {
    await recordSecurityEvent(
      c.env.DB,
      user.id,
      'reauth_failed',
      'password change',
    )
    return c.json({ error: 'Your current password is incorrect.' }, 401)
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?`,
    ).bind(await hashPassword(next), new Date().toISOString(), user.id),
    // Stay signed in here; sign out everywhere else.
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`).bind(
      user.id,
      c.get('session').id,
    ),
  ])
  await recordSecurityEvent(c.env.DB, user.id, 'password_changed')
  return c.json({ ok: true })
})

accountRoutes.post('/verify-email/resend', async (c) => {
  const user = c.get('user')
  const limit = checkRateLimit(`verify-resend:${user.id}`, 3, 60 * 60_000)
  if (!limit.ok)
    return c.json({ error: 'Please wait before asking again.' }, 429)
  if (!c.env.EMAIL) {
    return c.json(
      { error: 'Email isn’t set up yet. Please try again later.' },
      503,
    )
  }
  await sendVerificationEmail(
    c.env,
    user.id,
    user.email,
    user.displayName,
    c.req.url,
  )
  return c.json({ ok: true })
})

accountRoutes.get('/export', async (c) => {
  const user = c.get('user')
  const limit = checkRateLimit(`export:${user.id}`, 5, 60 * 60_000)
  if (!limit.ok)
    return c.json({ error: 'Please wait before exporting again.' }, 429)

  const account = await c.env.DB.prepare(
    `SELECT id, email, display_name as displayName, created_at as createdAt,
            email_verified_at as emailVerifiedAt, status
     FROM users WHERE id = ?`,
  )
    .bind(user.id)
    .first()
  const data: Record<string, unknown[]> = {}
  for (const [table, rule] of Object.entries(EXPORTED_TABLES)) {
    const rows = await c.env.DB.prepare(
      `SELECT * FROM ${table} WHERE user_id = ?`,
    )
      .bind(user.id)
      .all<Record<string, unknown>>()
    data[table] = (rows.results ?? []).map((row) => {
      const copy = { ...row }
      for (const column of rule.omit ?? []) delete copy[column]
      return copy
    })
  }
  // Replies are linked by thread_id, not user_id. Export only replies to
  // threads owned by the requester; never reveal another customer's messages.
  const supportReplies = await c.env.DB.prepare(
    `
    SELECT r.* FROM support_replies r
    INNER JOIN support_threads t ON t.id = r.thread_id
    WHERE t.user_id = ? ORDER BY r.created_at ASC
  `,
  )
    .bind(user.id)
    .all<Record<string, unknown>>()
  data.support_replies = supportReplies.results ?? []
  await recordSecurityEvent(c.env.DB, user.id, 'data_exported')
  c.header(
    'Content-Disposition',
    'attachment; filename="pocket-goblin-export.json"',
  )
  c.header('Cache-Control', 'no-store')
  return c.json({
    exportedAt: new Date().toISOString(),
    format: 'pocket-goblin-export-v1',
    note: 'Kept document files can be downloaded from Documents. Passwords, sign-in sessions and security keys are never exported.',
    account,
    data,
  })
})

/**
 * Delete my account and everything in it. Needs the password and typing
 * DELETE. Stored files go first, then the account row (D1 foreign keys
 * cascade to every personal table). The Owner account cannot delete itself.
 */
accountRoutes.delete('/', async (c) => {
  const user = c.get('user')
  const limit = checkRateLimit(`delete-account:${user.id}`, 5, 15 * 60_000)
  if (!limit.ok)
    return c.json({ error: 'Too many attempts. Wait a while.' }, 429)
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (body?.confirm !== 'DELETE') {
    return c.json({ error: 'Type DELETE to confirm.' }, 400)
  }
  const access = await loadAccess(c.env.DB, user.id)
  if (access.isOwner) {
    return c.json(
      { error: 'The Owner account can’t be deleted from here.' },
      409,
    )
  }
  const row = await c.env.DB.prepare(
    `SELECT password_hash as hash FROM users WHERE id = ?`,
  )
    .bind(user.id)
    .first<{ hash: string }>()
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!row || !(await verifyPassword(password, row.hash))) {
    await recordSecurityEvent(
      c.env.DB,
      user.id,
      'reauth_failed',
      'account deletion',
    )
    return c.json({ error: 'Your password is incorrect.' }, 401)
  }
  // A subscription that will still renew or retry a payment must be
  // cancelled first, so nobody is billed for a deleted account. One already
  // set to end at period end can't charge again, so it doesn't block.
  const paying = await c.env.DB.prepare(
    `SELECT 1 FROM user_entitlements WHERE user_id = ? AND source = 'stripe'
       AND ended_at IS NULL AND cancel_at_period_end = 0
       AND status NOT IN ('canceled', 'incomplete_expired')`,
  )
    .bind(user.id)
    .first()
  if (paying) {
    return c.json(
      {
        error:
          'Please cancel your Premium subscription first (Settings → Plan).',
      },
      409,
    )
  }

  const docs = await c.env.DB.prepare(
    `SELECT storage_key as storageKey FROM documents WHERE user_id = ?`,
  )
    .bind(user.id)
    .all<{ storageKey: string }>()
  const store = getObjectStore(c.env)
  for (const doc of docs.results ?? []) {
    await store.delete(doc.storageKey)
  }
  await c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(user.id).run()
  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    { append: true },
  )
  return c.json({ ok: true, deleted: true })
})
