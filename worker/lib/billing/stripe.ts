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
      'Stripe-Version': '2024-06-20',
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

/**
 * Make the person's Premium entitlement match the subscription. Returns the
 * user it applied to, or null when nobody matches.
 */
export async function applySubscription(
  db: D1Database,
  sub: StripeSubscription,
  hintUserId: string | null = null,
  now: Date = new Date(),
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
  const exists = await db
    .prepare(`SELECT 1 FROM users WHERE id = ?`)
    .bind(userId)
    .first()
  if (!exists) return null

  const item = sub.items?.data?.[0]
  const periodEnd = sub.current_period_end ?? item?.current_period_end ?? null
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
      `SELECT id, source, stripe_subscription_id as subId FROM user_entitlements
       WHERE user_id = ? AND entitlement = 'premium' AND ended_at IS NULL`,
    )
    .bind(userId)
    .first<{ id: string; source: string; subId: string | null }>()

  if (open && open.source !== 'stripe') {
    // Premium given by the Owner wins; billing never overwrites it.
    return userId
  }
  if (open && open.subId && open.subId !== sub.id && ENDED.has(sub.status)) {
    // An old subscription ending must not end a newer one.
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
       WHERE user_id = ? AND stripe_subscription_id = ? AND ended_at IS NOT NULL`,
    )
    .bind(userId, sub.id)
    .first()
  if (ended) return userId
  await db
    .prepare(
      `INSERT INTO user_entitlements
         (id, user_id, entitlement, source, status, billing_interval, currency,
          stripe_customer_id, stripe_subscription_id, current_period_end,
          cancel_at_period_end, granted_by, reason)
       VALUES (?, ?, 'premium', 'stripe', ?, ?, ?, ?, ?, ?, ?, 'stripe', 'Subscription')`,
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
    )
    .run()
  return userId
}
