/**
 * The subscription area.
 *
 * - GET  /api/billing           plan, prices, limits and subscription state
 * - POST /api/billing/checkout  start Premium (Stripe Checkout)
 * - POST /api/billing/portal    change card, see invoices, cancel
 * - POST /api/billing/webhook   Stripe → entitlement (public, signed)
 */
import { Hono } from 'hono'

import type { Env } from '../env'
import { loadAccess, PLAN_LABELS } from '../lib/access'
import {
  adoptRemainingSubscription,
  applySubscription,
  listCustomerSubscriptions,
  billingConfig,
  stripe,
  StripeError,
  verifyStripeSignature,
  type BillingConfig,
  type Interval,
  type StripeSubscription,
} from '../lib/billing/stripe'
import { allowedOrigin } from '../lib/cors'
import {
  aiDailyLimitFor,
  loadPlatformSettings,
  storageQuotaBytesFor,
} from '../lib/platformSettings'
import { checkRateLimit } from '../lib/rateLimit'
import type { AuthUser } from '../lib/session'

type Vars = { user: AuthUser }
type Enabled = Extract<BillingConfig, { enabled: true }>

export const billingRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()
export const billingWebhookRoutes = new Hono<{ Bindings: Env }>()

type Price = { amount: number; currency: string; interval: Interval }
const priceCache = new Map<string, { at: number; price: Price | null }>()

async function loadPrice(config: Enabled, id: string): Promise<Price | null> {
  const hit = priceCache.get(id)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.price
  let price: Price | null = null
  try {
    const p = await stripe<{
      unit_amount: number | null
      currency: string
      recurring?: { interval?: string }
    }>(config, 'GET', `/prices/${encodeURIComponent(id)}`)
    if (p.unit_amount !== null && p.recurring?.interval)
      price = {
        amount: p.unit_amount,
        currency: p.currency,
        interval: p.recurring.interval as Interval,
      }
  } catch {
    price = null
  }
  priceCache.set(id, { at: Date.now(), price })
  return price
}

/** Where Stripe sends people back to: this site, never a guessed host. */
function siteOrigin(c: {
  req: { url: string; header: (n: string) => string | undefined }
  env: Env
}) {
  const origin = c.req.header('Origin')
  if (origin && allowedOrigin(origin, c.env.ENVIRONMENT) === origin)
    return origin
  return new URL(c.req.url).origin
}

async function stripeRow(db: D1Database, userId: string) {
  return db
    .prepare(
      `SELECT status, billing_interval as interval, currency,
              stripe_customer_id as customerId,
              current_period_end as currentPeriodEnd,
              cancel_at_period_end as cancelAtPeriodEnd, ended_at as endedAt
       FROM user_entitlements
       WHERE user_id = ? AND entitlement = 'premium' AND source = 'stripe'
       ORDER BY (ended_at IS NULL) DESC, created_at DESC LIMIT 1`,
    )
    .bind(userId)
    .first<{
      status: string
      interval: string | null
      currency: string | null
      customerId: string | null
      currentPeriodEnd: string | null
      cancelAtPeriodEnd: number
      endedAt: string | null
    }>()
}

billingRoutes.get('/', async (c) => {
  const user = c.get('user')
  const config = billingConfig(c.env)
  const [access, settings, row] = await Promise.all([
    loadAccess(c.env.DB, user.id),
    loadPlatformSettings(c.env.DB, c.env),
    stripeRow(c.env.DB, user.id),
  ])
  const prices: Partial<Record<Interval, Price>> = {}
  if (config.enabled) {
    for (const [interval, id] of Object.entries(config.prices) as [
      Interval,
      string,
    ][]) {
      const p = await loadPrice(config, id)
      if (p) prices[interval] = p
    }
  }
  const mb = (plan: 'free' | 'premium') =>
    Math.round(storageQuotaBytesFor(plan, settings) / (1024 * 1024))
  return c.json({
    plan: access.plan,
    planLabel: PLAN_LABELS[access.plan],
    billingAvailable: config.enabled && Object.keys(prices).length > 0,
    testMode: config.enabled ? !config.live : null,
    prices,
    limits: {
      free: {
        aiPerDay: aiDailyLimitFor('free', settings),
        storageMb: mb('free'),
      },
      premium: {
        aiPerDay: aiDailyLimitFor('premium', settings),
        storageMb: mb('premium'),
      },
    },
    subscription:
      row && !row.endedAt
        ? {
            status: row.status,
            interval: row.interval,
            currentPeriodEnd: row.currentPeriodEnd,
            cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
          }
        : null,
    canManage: Boolean(row?.customerId) && config.enabled,
  })
})

billingRoutes.post('/checkout', async (c) => {
  const user = c.get('user')
  const config = billingConfig(c.env)
  if (!config.enabled)
    return c.json({ error: 'Premium isn’t available to buy yet.' }, 503)
  const limit = checkRateLimit(`checkout:${user.id}`, 10, 60 * 60_000)
  if (!limit.ok) return c.json({ error: 'Too many tries. Wait a while.' }, 429)
  const body = (await c.req.json().catch(() => null)) as {
    interval?: unknown
  } | null
  const interval: Interval = body?.interval === 'year' ? 'year' : 'month'
  const price = config.prices[interval]
  if (!price) return c.json({ error: 'That option isn’t available.' }, 400)

  const access = await loadAccess(c.env.DB, user.id)
  if (access.plan !== 'free') {
    return c.json(
      { error: 'You already have Premium.', plan: access.plan },
      409,
    )
  }
  // A subscription that hasn't given up yet (e.g. a card retry, or
  // incomplete) would keep charging alongside a new one: fix that first.
  const stuck = await c.env.DB.prepare(
    `SELECT status FROM user_entitlements
     WHERE user_id = ? AND source = 'stripe' AND ended_at IS NULL
       AND cancel_at_period_end = 0
       AND status NOT IN ('canceled', 'incomplete_expired')`,
  )
    .bind(user.id)
    .first<{ status: string }>()
  if (stuck) {
    return c.json(
      {
        error:
          'Your previous subscription is still open (usually a payment that needs updating). Open “Manage billing” to update your card or cancel it, then come back.',
        code: 'subscription_open',
      },
      409,
    )
  }
  const previous = await stripeRow(c.env.DB, user.id)
  const origin = siteOrigin(c)
  try {
    const session = await stripe<{ url: string }>(
      config,
      'POST',
      '/checkout/sessions',
      {
        mode: 'subscription',
        line_items: [{ price, quantity: 1 }],
        success_url: `${origin}/settings/plan?checkout=success`,
        cancel_url: `${origin}/settings/plan?checkout=cancelled`,
        client_reference_id: user.id,
        ...(previous?.customerId
          ? { customer: previous.customerId }
          : { customer_email: user.email }),
        metadata: { user_id: user.id },
        subscription_data: { metadata: { user_id: user.id } },
        allow_promotion_codes: 'true',
      },
      // A double tap within the same minute reuses the same session.
      {
        idempotencyKey: `checkout:${user.id}:${interval}:${Math.floor(Date.now() / 60_000)}`,
      },
    )
    return c.json({ url: session.url })
  } catch (error) {
    console.error(
      'Stripe checkout failed',
      error instanceof StripeError ? error.status : 'network',
    )
    return c.json({ error: 'Couldn’t open checkout. Try again.' }, 502)
  }
})

billingRoutes.post('/portal', async (c) => {
  const user = c.get('user')
  const config = billingConfig(c.env)
  const row = await stripeRow(c.env.DB, user.id)
  if (!config.enabled || !row?.customerId)
    return c.json({ error: 'There’s no billing to manage yet.' }, 404)
  try {
    const session = await stripe<{ url: string }>(
      config,
      'POST',
      '/billing_portal/sessions',
      {
        customer: row.customerId,
        return_url: `${siteOrigin(c)}/settings/plan`,
      },
    )
    return c.json({ url: session.url })
  } catch (error) {
    console.error(
      'Stripe portal failed',
      error instanceof StripeError ? error.status : 'network',
    )
    return c.json({ error: 'Couldn’t open billing. Try again.' }, 502)
  }
})

const HANDLED = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  // Renewals and failed payments: re-read the subscription so a missed
  // subscription.updated can't leave a paying customer on Free.
  'invoice.paid',
  'invoice.payment_failed',
])

billingWebhookRoutes.post('/', async (c) => {
  const config = billingConfig(c.env)
  if (!config.enabled) return c.json({ error: 'Billing is off' }, 503)
  const payload = await c.req.text()
  if (payload.length > 512 * 1024) return c.json({ error: 'Too large' }, 413)
  if (
    !(await verifyStripeSignature(
      payload,
      c.req.header('Stripe-Signature'),
      config.webhookSecret,
    ))
  ) {
    return c.json({ error: 'Bad signature' }, 400)
  }
  const event = JSON.parse(payload) as {
    id: string
    type: string
    livemode?: boolean
    data: { object: Record<string, unknown> }
  }
  if (Boolean(event.livemode) !== config.live)
    return c.json({ error: 'Wrong mode' }, 400)
  if (!HANDLED.has(event.type)) return c.json({ received: true })

  const first = await c.env.DB.prepare(
    `INSERT OR IGNORE INTO stripe_events (id, type) VALUES (?, ?)`,
  )
    .bind(event.id, event.type)
    .run()
  if (!first.meta.changes) return c.json({ received: true, duplicate: true })

  try {
    const obj = event.data.object
    const subId =
      event.type === 'checkout.session.completed' ||
      event.type.startsWith('invoice.')
        ? typeof obj.subscription === 'string'
          ? obj.subscription
          : null
        : (obj.id as string)
    if (subId) {
      // Always read the latest state, so out-of-order events can't regress it.
      const sub = await stripe<StripeSubscription>(
        config,
        'GET',
        `/subscriptions/${encodeURIComponent(subId)}`,
      )
      const hint =
        event.type === 'checkout.session.completed'
          ? ((obj.client_reference_id as string | null) ?? null)
          : null
      const fetchSub = (id: string) =>
        stripe<StripeSubscription>(
          config,
          'GET',
          `/subscriptions/${encodeURIComponent(id)}`,
        )
      const userId = await applySubscription(
        c.env.DB,
        sub,
        hint,
        new Date(),
        fetchSub,
      )
      if (userId)
        await adoptRemainingSubscription(
          c.env.DB,
          userId,
          sub,
          listCustomerSubscriptions(config),
          new Date(),
          fetchSub,
        )
    }
  } catch (error) {
    // Let Stripe retry: forget that we saw it.
    await c.env.DB.prepare(`DELETE FROM stripe_events WHERE id = ?`)
      .bind(event.id)
      .run()
    console.error(
      'Stripe webhook failed',
      event.type,
      error instanceof StripeError ? error.status : 'error',
    )
    return c.json({ error: 'Try again' }, 500)
  }
  return c.json({ received: true })
})
