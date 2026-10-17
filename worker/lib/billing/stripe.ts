/**
 * Stripe over plain fetch (no SDK): Checkout, the Customer Portal, webhook
 * signatures and turning a subscription into a Premium entitlement.
 *
 * Safety rails:
 * - Prices are never created here. The Owner makes one product with a
 *   monthly and/or yearly price in Stripe and sets their ids.
 * - Live keys (sk_live_…) are refused unless STRIPE_LIVE_ENABLED = "true",
 *   so real charges can't start by accident.
 * - The webhook only ever writes the `premium` entitlement, never roles.
 */
import type { Env } from '../../env'
import { newId } from '../ids'

export type Interval = 'month' | 'year'

export type BillingConfig =
  | {
      enabled: true
      secretKey: string
      webhookSecret: string
      prices: Partial<Record<Interval, string>>
      live: boolean
    }
  | { enabled: false; reason: string }

export function billingConfig(env: Env): BillingConfig {
  const secretKey = env.STRIPE_SECRET_KEY?.trim() ?? ''
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() ?? ''
  const prices: Partial<Record<Interval, string>> = {}
  if (env.STRIPE_PRICE_MONTHLY?.trim())
    prices.month = env.STRIPE_PRICE_MONTHLY.trim()
  if (env.STRIPE_PRICE_YEARLY?.trim())
    prices.year = env.STRIPE_PRICE_YEARLY.trim()
  if (!secretKey) return { enabled: false, reason: 'No Stripe key yet' }
  if (!webhookSecret) return { enabled: false, reason: 'No webhook secret yet' }
  if (!prices.month && !prices.year)
    return { enabled: false, reason: 'No prices set yet' }
  const live =
    secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_')
  if (live && env.STRIPE_LIVE_ENABLED !== 'true')
    return { enabled: false, reason: 'Live payments are not switched on' }
  return { enabled: true, secretKey, webhookSecret, prices, live }
}

/** Stripe's form encoding, with nested keys: a[b][0][c]=d. */
export function formEncode(
  params: Record<string, unknown>,
  prefix = '',
): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (typeof value === 'object') {
      const nested = Array.isArray(value)
        ? Object.fromEntries(value.map((v, i) => [String(i), v]))
        : (value as Record<string, unknown>)
      const inner = formEncode(nested, name)
      if (inner) parts.push(inner)
    } else {
      parts.push(
        `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`,
      )
    }
  }
  return parts.join('&')
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export type FetchLike = typeof fetch

export async function stripe<T>(
  config: Extract<BillingConfig, { enabled: true }>,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  params: Record<string, unknown> = {},
  options: { idempotencyKey?: string; fetchImpl?: FetchLike } = {},
): Promise<T> {
  const body = formEncode(params)
  const url =
    method === 'GET' && body
      ? `https://api.stripe.com/v1${path}?${body}`
      : `https://api.stripe.com/v1${path}`
  const res = await (options.fetchImpl ?? fetch)(url, {
    method,
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Stripe-Version': '2025-03-31.basil',
      ...(options.idempotencyKey
        ? { 'Idempotency-Key': options.idempotencyKey }
        : {}),
    },
    body: method === 'GET' ? undefined : body,
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: { message?: string }
  }
  if (!res.ok) {
    // Stripe's message never contains the key; keep it short for logs.
    throw new StripeError(
      (data.error?.message ?? 'Stripe request failed').slice(0, 200),
      res.status,
    )
  }
  return data as T
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Stripe-Signature: t=<seconds>,v1=<hex hmac of "t.payload">. */
export async function verifyStripeSignature(
  payload: string,
  header: string | undefined,
  secret: string,
  now: Date = new Date(),
  toleranceSeconds = 300,
): Promise<boolean> {
  if (!header) return false
  const parts = header.split(',').map((p) => p.trim().split('='))
  const t = parts.find(([k]) => k === 't')?.[1]
  const signatures = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '')
  if (!t || !/^\d+$/.test(t) || signatures.length === 0) return false
  if (Math.abs(now.getTime() / 1000 - Number(t)) > toleranceSeconds)
    return false
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = hex(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${t}.${payload}`),
    ),
  )
  return signatures.some((s) => safeEqual(s, expected))
}

export type StripeSubscription = {
  id: string
  customer: string
  status: string
  created?: number
  currency?: string
  cancel_at_period_end?: boolean
  current_period_end?: number
  metadata?: Record<string, string>
  items?: {
    data?: {
      current_period_end?: number
      price?: { recurring?: { interval?: string } }
    }[]
  }
}

const ENDED = new Set(['canceled', 'incomplete_expired'])
/** Stripe states that give Premium (matches resolvePlan in access.ts). */
const GRANTING = new Set(['active', 'trialing', 'past_due'])
/** ended_at status used when a subscription was superseded, not cancelled. */
const REPLACED = 'replaced'

function periodEndOf(sub: StripeSubscription): number | null {
  return (
    sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null
  )
}

/** Does this subscription give Premium right now? */
export function grantsAccess(sub: StripeSubscription, now: Date): boolean {
  const end = periodEndOf(sub)
  return (
    GRANTING.has(sub.status) && (end === null || end * 1000 > now.getTime())
  )
}

/**
 * May `incoming` take over from `current`? Only when `current` no longer
 * gives access, or is already set to end while `incoming` renews. Two
 * renewing subscriptions are never swapped: the one already followed stays,
 * so a still-billing subscription is never marked as replaced.
 */
function mayReplace(
  incoming: StripeSubscription,
  current: StripeSubscription,
  now: Date,
): boolean {
  if (!grantsAccess(current, now)) return true
  return Boolean(current.cancel_at_period_end) && !incoming.cancel_at_period_end
}

export type FetchSubscription = (
  id: string,
) => Promise<StripeSubscription | null>

/**
 * Make the person's Premium entitlement match the subscription. Returns the
 * user it applied to, or null when nobody matches.
 */
export async function applySubscription(
  db: D1Database,
  sub: StripeSubscription,
  hintUserId: string | null = null,
  now: Date = new Date(),
  /** Reads another subscription's live state from Stripe (for replacements). */
  fetchSubscription?: FetchSubscription,
): Promise<string | null> {
  const metaUser = sub.metadata?.user_id ?? null
  let userId = metaUser ?? hintUserId
  if (!userId) {
    const known = await db
      .prepare(
        `SELECT user_id as userId FROM user_entitlements
         WHERE stripe_subscription_id = ? OR stripe_customer_id = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(sub.id, sub.customer)
      .first<{ userId: string }>()
    userId = known?.userId ?? null
  }
  if (!userId) return null
  // A Stripe customer or subscription already linked to another account
  // must never be assigned using metadata or a checkout hint.
  const linked = await db
    .prepare(
      `SELECT user_id AS userId FROM user_entitlements
       WHERE source = 'stripe'
         AND (stripe_customer_id = ? OR stripe_subscription_id = ?)
       LIMIT 1`,
    )
    .bind(sub.customer, sub.id)
    .first<{ userId: string }>()
  if (linked && linked.userId !== userId) {
    console.error('Stripe account ownership conflict')
    return null
  }
  const exists = await db
    .prepare(`SELECT 1 FROM users WHERE id = ?`)
    .bind(userId)
    .first()
  if (!exists) return null

  const item = sub.items?.data?.[0]
  const periodEnd = periodEndOf(sub)
  const fields = {
    status: sub.status,
    interval: item?.price?.recurring?.interval ?? null,
    currency: sub.currency ?? null,
    periodEnd: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end ? 1 : 0,
    endedAt: ENDED.has(sub.status) ? now.toISOString() : null,
  }

  const open = await db
    .prepare(
      `SELECT id, source, stripe_subscription_id as subId, status,
              current_period_end as periodEnd, cancel_at_period_end as cancelAtPeriodEnd,
              created_at as createdAt
       FROM user_entitlements
       WHERE user_id = ? AND entitlement = 'premium' AND ended_at IS NULL`,
    )
    .bind(userId)
    .first<{
      id: string
      source: string
      subId: string | null
      status: string
      periodEnd: string | null
      cancelAtPeriodEnd: number
      createdAt: string
    }>()

  if (open && open.source !== 'stripe') {
    // Premium given by the Owner wins; billing never overwrites it.
    return userId
  }
  if (open && open.subId && open.subId !== sub.id) {
    // Another subscription is linked. A stale event for an old subscription
    // must never overwrite it, but a legitimate replacement (bought again
    // after cancelling, or after the old one stopped paying) must activate.
    if (!grantsAccess(sub, now)) return userId
    const reopened = await db
      .prepare(
        `SELECT status FROM user_entitlements
         WHERE user_id = ? AND stripe_subscription_id = ? AND ended_at IS NOT NULL
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .bind(userId, sub.id)
      .first<{ status: string }>()
    // Cancelled subscriptions never come back; superseded ones may, below.
    if (reopened && reopened.status !== REPLACED) return userId
    // Judge the linked subscription by its live Stripe state when we can,
    // falling back to what we last stored.
    const live = fetchSubscription
      ? await fetchSubscription(open.subId).catch(() => null)
      : null
    const current: StripeSubscription = live ?? {
      id: open.subId,
      customer: sub.customer,
      status: open.status,
      cancel_at_period_end: Boolean(open.cancelAtPeriodEnd),
      current_period_end: open.periodEnd
        ? Math.floor(new Date(open.periodEnd).getTime() / 1000)
        : undefined,
      created: Math.floor(new Date(open.createdAt).getTime() / 1000),
    }
    if (!mayReplace(sub, current, now)) {
      if (grantsAccess(current, now) && !current.cancel_at_period_end)
        console.warn(
          'Two Premium subscriptions give access for one user; following',
          open.subId,
          'and ignoring',
          sub.id,
        )
      return userId
    }
    // Swap atomically: close the old row, open one for the replacement.
    await db.batch([
      db
        .prepare(
          `UPDATE user_entitlements SET status = ?, ended_at = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND ended_at IS NULL`,
        )
        .bind(
          ENDED.has(current.status) ? current.status : REPLACED,
          now.toISOString(),
          open.id,
        ),
      insertEntitlement(db, userId, sub, fields, true),
    ])
    return userId
  }
  if (open) {
    await db
      .prepare(
        `UPDATE user_entitlements SET status = ?, billing_interval = ?, currency = ?,
           stripe_customer_id = ?, stripe_subscription_id = ?,
           current_period_end = ?, cancel_at_period_end = ?, ended_at = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
      )
      .bind(
        fields.status,
        fields.interval,
        fields.currency,
        sub.customer,
        sub.id,
        fields.periodEnd,
        fields.cancelAtPeriodEnd,
        fields.endedAt,
        open.id,
      )
      .run()
    return userId
  }
  if (fields.endedAt) return userId
  // Re-sending an already-ended subscription must not reopen it.
  const ended = await db
    .prepare(
      `SELECT 1 FROM user_entitlements
       WHERE user_id = ? AND stripe_subscription_id = ? AND ended_at IS NOT NULL
         AND status != ?`,
    )
    .bind(userId, sub.id, REPLACED)
    .first()
  if (ended) return userId
  await insertEntitlement(db, userId, sub, fields, true).run()
  return userId
}

export type ListSubscriptions = (
  customer: string,
) => Promise<StripeSubscription[]>

/** Every subscription Stripe has for this customer (most recent first). */
export function listCustomerSubscriptions(
  config: Extract<BillingConfig, { enabled: true }>,
): ListSubscriptions {
  return async (customer) => {
    const res = await stripe<{ data?: StripeSubscription[] }>(
      config,
      'GET',
      '/subscriptions',
      { customer, status: 'all', limit: 20 },
    )
    return res.data ?? []
  }
}

/**
 * After the linked subscription stops giving access, follow another of the
 * customer's subscriptions that still does (someone who paid twice, then
 * cancelled the one we followed). Without this they'd be Free until that
 * other subscription's next renewal.
 */
export async function adoptRemainingSubscription(
  db: D1Database,
  userId: string,
  ended: StripeSubscription,
  list: ListSubscriptions,
  now: Date = new Date(),
  fetchSubscription?: FetchSubscription,
): Promise<boolean> {
  if (grantsAccess(ended, now)) return false
  const open = await db
    .prepare(
      `SELECT 1 FROM user_entitlements
       WHERE user_id = ? AND entitlement = 'premium' AND ended_at IS NULL`,
    )
    .bind(userId)
    .first()
  if (open) return false
  for (const other of await list(ended.customer)) {
    if (other.id === ended.id || !grantsAccess(other, now)) continue
    if ((other.metadata?.user_id ?? userId) !== userId) continue
    await applySubscription(db, other, userId, now, fetchSubscription)
    return true
  }
  return false
}

type EntitlementFields = {
  status: string
  interval: string | null
  currency: string | null
  periodEnd: string | null
  cancelAtPeriodEnd: number
}

/**
 * Open a Premium row for this subscription — but only if no other open row
 * exists by then, so two webhooks racing through a swap can't trip the
 * one-open-row index (the loser becomes a no-op instead of an error).
 */
function insertEntitlement(
  db: D1Database,
  userId: string,
  sub: StripeSubscription,
  fields: EntitlementFields,
  onlyIfNoneOpen = false,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO user_entitlements
         (id, user_id, entitlement, source, status, billing_interval, currency,
          stripe_customer_id, stripe_subscription_id, current_period_end,
          cancel_at_period_end, granted_by, reason)
       SELECT ?1, ?2, 'premium', 'stripe', ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'stripe', 'Subscription'
       WHERE ?10 = 0 OR NOT EXISTS (
         SELECT 1 FROM user_entitlements
         WHERE user_id = ?2 AND entitlement = 'premium' AND ended_at IS NULL
       )`,
    )
    .bind(
      newId('ent'),
      userId,
      fields.status,
      fields.interval,
      fields.currency,
      sub.customer,
      sub.id,
      fields.periodEnd,
      fields.cancelAtPeriodEnd,
      onlyIfNoneOpen ? 1 : 0,
    )
}
