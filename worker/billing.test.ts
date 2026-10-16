import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { app } from './index'
import { reconcileSubscriptions } from './lib/billing/reconcile'
import { applySubscription, verifyStripeSignature } from './lib/billing/stripe'
import { createHarness, type Harness, type TestUser } from './testing/harness'

const STRIPE = {
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_PRICE_MONTHLY: 'price_month',
  STRIPE_PRICE_YEARLY: 'price_year',
}

let h: Harness
let alice: TestUser

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** A pretend Stripe: records requests, answers from `subscriptions`. */
const calls: { method: string; url: string; body: string }[] = []
const subscriptions = new Map<string, Json>()

function fakeStripe() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      const body = String(init.body ?? '')
      calls.push({ method, url, body })
      const path = new URL(url).pathname
      const json = (data: unknown, status = 200) =>
        new Response(JSON.stringify(data), { status })
      if (path.startsWith('/v1/prices/'))
        return json({
          unit_amount: path.endsWith('price_year') ? 6000 : 600,
          currency: 'aud',
          recurring: {
            interval: path.endsWith('price_year') ? 'year' : 'month',
          },
        })
      if (path === '/v1/checkout/sessions')
        return json({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' })
      if (path === '/v1/billing_portal/sessions')
        return json({ url: 'https://billing.stripe.com/p/session/test_1' })
      if (path === '/v1/subscriptions') {
        const customer = new URL(url).searchParams.get('customer')
        return json({
          data: [...subscriptions.values()].filter(
            (s) => s.customer === customer,
          ),
        })
      }
      if (path.startsWith('/v1/subscriptions/')) {
        const sub = subscriptions.get(path.split('/').pop()!)
        return sub ? json(sub) : json({ error: { message: 'No such' } }, 404)
      }
      return json({ error: { message: 'unexpected' } }, 400)
    }),
  )
}

async function sign(payload: string, secret = 'whsec_test', t = Date.now()) {
  const ts = Math.floor(t / 1000)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${ts}.${payload}`),
  )
  const hex = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `t=${ts},v1=${hex}`
}

async function deliver(event: Json, opts: { signature?: string } = {}) {
  const payload = JSON.stringify(event)
  return app.request(
    '/api/billing/webhook',
    {
      method: 'POST',
      body: payload,
      headers: {
        'Stripe-Signature': opts.signature ?? (await sign(payload)),
        'Content-Type': 'application/json',
      },
    },
    h.env,
  )
}

function sub(id: string, status: string, userId: string, extra: Json = {}) {
  const s = {
    id,
    customer: 'cus_1',
    status,
    currency: 'aud',
    cancel_at_period_end: false,
    metadata: { user_id: userId },
    items: {
      data: [
        {
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
          price: { recurring: { interval: 'month' } },
        },
      ],
    },
    ...extra,
  }
  subscriptions.set(id, s)
  return s
}

const plan = async (user: TestUser) =>
  (await (
    await h.request('/api/billing', { cookie: user.cookie })
  ).json()) as Json

beforeEach(async () => {
  calls.length = 0
  subscriptions.clear()
  fakeStripe()
  h = createHarness(STRIPE)
  alice = await h.register('alice@example.com')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the subscription area', () => {
  it('shows plans, prices and limits', async () => {
    const body = await plan(alice)
    expect(body).toMatchObject({
      plan: 'free',
      planLabel: 'Free',
      billingAvailable: true,
      testMode: true,
      prices: {
        month: { amount: 600, currency: 'aud', interval: 'month' },
        year: { amount: 6000, currency: 'aud', interval: 'year' },
      },
      subscription: null,
      canManage: false,
    })
    expect(body.limits.free.storageMb).toBe(10)
    expect(body.limits.premium.storageMb).toBe(1024)
  })

  it('says Premium isn’t on sale until Stripe is set up', async () => {
    const off = createHarness()
    const bob = await off.register('bob@example.com')
    const res = await off.request('/api/billing', { cookie: bob.cookie })
    expect(((await res.json()) as Json).billingAvailable).toBe(false)
    expect(
      (
        await off.request('/api/billing/checkout', {
          cookie: bob.cookie,
          body: {},
        })
      ).status,
    ).toBe(503)
  })

  it('refuses live keys unless live payments are switched on', async () => {
    const live = createHarness({ ...STRIPE, STRIPE_SECRET_KEY: 'sk_live_x' })
    const bob = await live.register('bob@example.com')
    const res = await live.request('/api/billing/checkout', {
      cookie: bob.cookie,
      body: {},
    })
    expect(res.status).toBe(503)
    expect(calls).toHaveLength(0)
  })
})

describe('checkout', () => {
  it('opens Stripe Checkout tied to this person', async () => {
    const res = await h.request('/api/billing/checkout', {
      cookie: alice.cookie,
      body: { interval: 'year' },
    })
    expect(res.status).toBe(200)
    expect(((await res.json()) as Json).url).toMatch(
      /^https:\/\/checkout\.stripe\.com/,
    )
    const call = calls.find((c) => c.url.endsWith('/v1/checkout/sessions'))!
    const params = new URLSearchParams(call.body)
    expect(params.get('mode')).toBe('subscription')
    expect(params.get('line_items[0][price]')).toBe('price_year')
    expect(params.get('client_reference_id')).toBe(alice.id)
    expect(params.get('subscription_data[metadata][user_id]')).toBe(alice.id)
    expect(params.get('customer_email')).toBe('alice@example.com')
    expect(params.get('success_url')).toMatch(
      /\/settings\/plan\?checkout=success$/,
    )
  })

  it('won’t sell Premium to someone who has it', async () => {
    sub('sub_1', 'active', alice.id)
    await deliver({
      id: 'evt_1',
      type: 'customer.subscription.created',
      livemode: false,
      data: { object: { id: 'sub_1' } },
    })
    const res = await h.request('/api/billing/checkout', {
      cookie: alice.cookie,
      body: {},
    })
    expect(res.status).toBe(409)
  })
})

describe('subscription identity safety', () => {
  it('does not replace an active subscription with a different old subscription', async () => {
    h.run(
      `INSERT INTO user_entitlements
        (id, user_id, entitlement, source, status, stripe_customer_id, stripe_subscription_id)
       VALUES ('current', ?, 'premium', 'stripe', 'active', 'cus_1', 'sub_new')`,
      alice.id,
    )
    const older = sub('sub_old', 'active', alice.id)
    await applySubscription(h.db, older)
    expect(
      h.query(
        "SELECT stripe_subscription_id AS subscription FROM user_entitlements WHERE id = 'current'",
      ),
    ).toEqual([{ subscription: 'sub_new' }])
  })
})

describe('replacement subscriptions', () => {
  const DAY = 86_400
  const nowS = () => Math.floor(Date.now() / 1000)
  const event = (id: string, type: string, subId: string) => ({
    id,
    type,
    livemode: false,
    data: {
      object: type.startsWith('invoice.')
        ? { subscription: subId }
        : type === 'checkout.session.completed'
          ? { subscription: subId, client_reference_id: alice.id }
          : { id: subId },
    },
  })
  const linked = () =>
    h.query(
      `SELECT stripe_subscription_id AS sub, status FROM user_entitlements
       WHERE user_id = ? AND ended_at IS NULL`,
      alice.id,
    )

  it('re-buying after cancelling at period end activates the new one, whatever the event order', async () => {
    // A: cancelled at period end, still paid for 10 more days.
    sub('sub_A', 'active', alice.id, {
      cancel_at_period_end: true,
      created: nowS() - 20 * DAY,
      items: {
        data: [
          {
            current_period_end: nowS() + 10 * DAY,
            price: { recurring: { interval: 'month' } },
          },
        ],
      },
    })
    await deliver(event('evt_a1', 'customer.subscription.updated', 'sub_A'))
    expect(linked()).toEqual([{ sub: 'sub_A', status: 'active' }])

    // B: bought again, renews.
    sub('sub_B', 'active', alice.id, { created: nowS() })
    await deliver(event('evt_b1', 'checkout.session.completed', 'sub_B'))
    expect(linked()).toEqual([{ sub: 'sub_B', status: 'active' }])

    // Late and repeated events for A can't take B away.
    await deliver(event('evt_a2', 'customer.subscription.updated', 'sub_A'))
    await deliver(event('evt_a2', 'customer.subscription.updated', 'sub_A'))
    subscriptions.set('sub_A', {
      ...subscriptions.get('sub_A')!,
      status: 'canceled',
    })
    await deliver(event('evt_a3', 'customer.subscription.deleted', 'sub_A'))
    expect(linked()).toEqual([{ sub: 'sub_B', status: 'active' }])
    expect((await plan(alice)).plan).toBe('premium')
  })

  it('new subscription events arriving before the old one ends still activate it', async () => {
    sub('sub_A', 'unpaid', alice.id, { created: nowS() - 60 * DAY })
    await deliver(event('evt_a1', 'customer.subscription.updated', 'sub_A'))
    expect((await plan(alice)).plan).toBe('free')
    sub('sub_B', 'active', alice.id, { created: nowS() })
    await deliver(event('evt_b1', 'customer.subscription.created', 'sub_B'))
    expect(linked()).toEqual([{ sub: 'sub_B', status: 'active' }])
    expect((await plan(alice)).plan).toBe('premium')
    // The old row is kept, closed, for the record.
    expect(
      h.query(
        `SELECT status FROM user_entitlements WHERE stripe_subscription_id = 'sub_A'`,
      ),
    ).toEqual([{ status: 'replaced' }])
  })

  it('a lapsed old subscription (missed renewal webhook) is replaced by a paid new one', async () => {
    h.run(
      `INSERT INTO user_entitlements
        (id, user_id, entitlement, source, status, stripe_customer_id,
         stripe_subscription_id, current_period_end)
       VALUES ('old', ?, 'premium', 'stripe', 'active', 'cus_1', 'sub_A', ?)`,
      alice.id,
      new Date(Date.now() - DAY * 1000).toISOString(),
    )
    sub('sub_A', 'canceled', alice.id)
    sub('sub_B', 'active', alice.id, { created: nowS() })
    await deliver(event('evt_b1', 'invoice.paid', 'sub_B'))
    expect(linked()).toEqual([{ sub: 'sub_B', status: 'active' }])
    expect(
      h.query(`SELECT status FROM user_entitlements WHERE id = 'old'`),
    ).toEqual([{ status: 'canceled' }])
  })

  it('never activates a replacement that is not paid', async () => {
    sub('sub_A', 'active', alice.id)
    await deliver(event('evt_a1', 'customer.subscription.updated', 'sub_A'))
    for (const status of [
      'incomplete',
      'incomplete_expired',
      'unpaid',
      'canceled',
    ]) {
      sub('sub_X', status, alice.id, { created: nowS() })
      await deliver(
        event(`evt_${status}`, 'customer.subscription.updated', 'sub_X'),
      )
      expect(linked()).toEqual([{ sub: 'sub_A', status: 'active' }])
    }
  })

  it('two renewing subscriptions: keeps following the first, never marks a billing one replaced', async () => {
    sub('sub_A', 'active', alice.id, { created: nowS() - DAY })
    await deliver(event('evt_a1', 'customer.subscription.updated', 'sub_A'))
    sub('sub_B', 'active', alice.id, { created: nowS() })
    await deliver(event('evt_b1', 'customer.subscription.updated', 'sub_B'))
    await deliver(event('evt_b2', 'invoice.paid', 'sub_B'))
    expect(linked()).toEqual([{ sub: 'sub_A', status: 'active' }])
    expect(
      h.query(
        `SELECT COUNT(*) AS n FROM user_entitlements WHERE status = 'replaced'`,
      ),
    ).toEqual([{ n: 0 }])
  })

  it('cancelling the followed one of two paid subscriptions adopts the other at once', async () => {
    sub('sub_A', 'active', alice.id, { created: nowS() - DAY })
    await deliver(event('evt_a1', 'customer.subscription.updated', 'sub_A'))
    sub('sub_B', 'active', alice.id, { created: nowS() })
    await deliver(event('evt_b1', 'customer.subscription.updated', 'sub_B'))
    subscriptions.set('sub_A', {
      ...subscriptions.get('sub_A')!,
      status: 'canceled',
    })
    await deliver(event('evt_a2', 'customer.subscription.deleted', 'sub_A'))
    expect(linked()).toEqual([{ sub: 'sub_B', status: 'active' }])
    expect((await plan(alice)).plan).toBe('premium')
  })

  it('a racing second swap is a no-op, not an error', async () => {
    sub('sub_A', 'active', alice.id, { cancel_at_period_end: true })
    await deliver(event('evt_a1', 'customer.subscription.updated', 'sub_A'))
    sub('sub_B', 'active', alice.id, { created: nowS() })
    const [r1, r2] = await Promise.all([
      deliver(event('evt_b1', 'customer.subscription.created', 'sub_B')),
      deliver(event('evt_b2', 'checkout.session.completed', 'sub_B')),
    ])
    expect([r1.status, r2.status]).toEqual([200, 200])
    expect(linked()).toEqual([{ sub: 'sub_B', status: 'active' }])
  })

  it('a renewal invoice refreshes the period end', async () => {
    sub('sub_A', 'active', alice.id)
    await deliver(event('evt_a1', 'customer.subscription.updated', 'sub_A'))
    const later = nowS() + 60 * DAY
    sub('sub_A', 'active', alice.id, {
      items: {
        data: [
          {
            current_period_end: later,
            price: { recurring: { interval: 'month' } },
          },
        ],
      },
    })
    await deliver(event('evt_inv', 'invoice.paid', 'sub_A'))
    expect(
      h.query(
        `SELECT current_period_end AS end FROM user_entitlements WHERE user_id = ?`,
        alice.id,
      ),
    ).toEqual([{ end: new Date(later * 1000).toISOString() }])
  })
})

describe('webhook', () => {
  it('turns a completed checkout into Premium, once', async () => {
    sub('sub_1', 'active', alice.id)
    const event = {
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      livemode: false,
      data: {
        object: { subscription: 'sub_1', client_reference_id: alice.id },
      },
    }
    expect((await deliver(event)).status).toBe(200)
    const body = await plan(alice)
    expect(body).toMatchObject({
      plan: 'premium',
      subscription: { status: 'active', interval: 'month' },
      canManage: true,
    })
    // A retried delivery is ignored.
    const again = await deliver(event)
    expect(((await again.json()) as Json).duplicate).toBe(true)
    expect(
      h.query(
        `SELECT COUNT(*) as n FROM user_entitlements WHERE user_id = ?`,
        alice.id,
      ),
    ).toEqual([{ n: 1 }])
  })

  it('rejects unsigned, stale or wrong-mode events', async () => {
    const event = {
      id: 'evt_x',
      type: 'customer.subscription.updated',
      livemode: false,
      data: { object: { id: 'sub_1' } },
    }
    expect((await deliver(event, { signature: 't=1,v1=abc' })).status).toBe(400)
    const payload = JSON.stringify(event)
    expect(
      (
        await deliver(event, {
          signature: await sign(payload, 'whsec_test', Date.now() - 3_600_000),
        })
      ).status,
    ).toBe(400)
    expect((await deliver({ ...event, livemode: true })).status).toBe(400)
    expect(h.query(`SELECT COUNT(*) as n FROM user_entitlements`)).toEqual([
      { n: 0 },
    ])
  })

  it('cancelling ends Premium; cancelling at period end keeps it until then', async () => {
    sub('sub_1', 'active', alice.id, { cancel_at_period_end: true })
    await deliver({
      id: 'evt_a',
      type: 'customer.subscription.updated',
      livemode: false,
      data: { object: { id: 'sub_1' } },
    })
    expect(await plan(alice)).toMatchObject({
      plan: 'premium',
      subscription: { cancelAtPeriodEnd: true },
    })
    sub('sub_1', 'canceled', alice.id)
    await deliver({
      id: 'evt_b',
      type: 'customer.subscription.deleted',
      livemode: false,
      data: { object: { id: 'sub_1' } },
    })
    expect(await plan(alice)).toMatchObject({
      plan: 'free',
      subscription: null,
    })
    // Re-sending the old "created" event can't bring it back.
    await deliver({
      id: 'evt_c',
      type: 'customer.subscription.created',
      livemode: false,
      data: { object: { id: 'sub_1' } },
    })
    expect((await plan(alice)).plan).toBe('free')
  })

  it('never overrides Premium given by the Owner, and never grants roles', async () => {
    h.query(
      `INSERT INTO user_entitlements (id, user_id, entitlement, source, status, granted_by)
       VALUES ('ent_admin', ?, 'premium', 'admin', 'active', 'owner')`,
      alice.id,
    )
    sub('sub_1', 'canceled', alice.id)
    await deliver({
      id: 'evt_d',
      type: 'customer.subscription.deleted',
      livemode: false,
      data: { object: { id: 'sub_1' } },
    })
    expect((await plan(alice)).plan).toBe('premium')
    expect(h.query(`SELECT COUNT(*) as n FROM user_roles`)).toEqual([{ n: 0 }])
  })

  it('asks Stripe to retry when it can’t read the subscription', async () => {
    const res = await deliver({
      id: 'evt_missing',
      type: 'customer.subscription.updated',
      livemode: false,
      data: { object: { id: 'sub_missing' } },
    })
    expect(res.status).toBe(500)
    expect(h.query(`SELECT COUNT(*) as n FROM stripe_events`)).toEqual([
      { n: 0 },
    ])
  })
})

describe('portal', () => {
  it('opens billing management for subscribers only', async () => {
    expect(
      (
        await h.request('/api/billing/portal', {
          cookie: alice.cookie,
          body: {},
        })
      ).status,
    ).toBe(404)
    sub('sub_1', 'active', alice.id)
    await deliver({
      id: 'evt_p',
      type: 'customer.subscription.created',
      livemode: false,
      data: { object: { id: 'sub_1' } },
    })
    const res = await h.request('/api/billing/portal', {
      cookie: alice.cookie,
      body: {},
    })
    expect(((await res.json()) as Json).url).toMatch(
      /^https:\/\/billing\.stripe\.com/,
    )
    const call = calls.find((c) => c.url.endsWith('/billing_portal/sessions'))!
    expect(new URLSearchParams(call.body).get('customer')).toBe('cus_1')
  })
})

describe('signature checks', () => {
  it('accepts only a fresh, matching signature', async () => {
    const header = await sign('{}')
    expect(await verifyStripeSignature('{}', header, 'whsec_test')).toBe(true)
    expect(await verifyStripeSignature('{"x":1}', header, 'whsec_test')).toBe(
      false,
    )
    expect(await verifyStripeSignature('{}', header, 'whsec_other')).toBe(false)
    expect(await verifyStripeSignature('{}', undefined, 'whsec_test')).toBe(
      false,
    )
  })
})

describe('hourly reconciliation', () => {
  it('recovers a renewal whose webhook never arrived, and ends a cancelled one', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString()
    h.run(
      `INSERT INTO user_entitlements
        (id, user_id, entitlement, source, status, stripe_customer_id,
         stripe_subscription_id, current_period_end)
       VALUES ('e1', ?, 'premium', 'stripe', 'active', 'cus_1', 'sub_R', ?)`,
      alice.id,
      past,
    )
    expect((await plan(alice)).plan).toBe('free')
    sub('sub_R', 'active', alice.id) // renewed in Stripe: 30 more days
    expect(await reconcileSubscriptions(h.env)).toEqual({
      checked: 1,
      failed: 0,
    })
    expect((await plan(alice)).plan).toBe('premium')

    sub('sub_R', 'canceled', alice.id, {
      items: {
        data: [{ current_period_end: Math.floor(Date.now() / 1000) - 60 }],
      },
    })
    h.run(
      `UPDATE user_entitlements SET current_period_end = ? WHERE id = 'e1'`,
      past,
    )
    await reconcileSubscriptions(h.env)
    expect((await plan(alice)).plan).toBe('free')
    expect(
      h.query(
        `SELECT ended_at IS NOT NULL AS ended FROM user_entitlements WHERE id = 'e1'`,
      ),
    ).toEqual([{ ended: 1 }])
  })

  it('does nothing when billing is off, and never fails the hourly job', async () => {
    const off = createHarness()
    expect(await reconcileSubscriptions(off.env)).toEqual({
      checked: 0,
      failed: 0,
    })
    h.run(
      `INSERT INTO user_entitlements
        (id, user_id, entitlement, source, status, stripe_customer_id, stripe_subscription_id)
       VALUES ('e2', ?, 'premium', 'stripe', 'past_due', 'cus_1', 'sub_missing')`,
      alice.id,
    )
    expect(await reconcileSubscriptions(h.env)).toEqual({
      checked: 0,
      failed: 1,
    })
  })
})

describe('no double subscriptions', () => {
  it('refuses a new checkout while an unpaid subscription is still open', async () => {
    h.run(
      `INSERT INTO user_entitlements
        (id, user_id, entitlement, source, status, stripe_customer_id, stripe_subscription_id)
       VALUES ('stuck', ?, 'premium', 'stripe', 'unpaid', 'cus_1', 'sub_stuck')`,
      alice.id,
    )
    expect((await plan(alice)).plan).toBe('free')
    const res = await h.request('/api/billing/checkout', {
      cookie: alice.cookie,
      body: { interval: 'month' },
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as Json).code).toBe('subscription_open')
    expect(calls.some((c) => c.url.includes('/checkout/sessions'))).toBe(false)
  })
})

describe('account deletion asks Stripe', () => {
  it('refuses while any subscription on the customer still renews', async () => {
    sub('sub_A', 'active', alice.id, { cancel_at_period_end: true })
    await deliver({
      id: 'evt_a',
      type: 'customer.subscription.updated',
      livemode: false,
      data: { object: { id: 'sub_A' } },
    })
    // A second, renewing subscription we never linked.
    sub('sub_hidden', 'active', alice.id)
    const res = await h.request('/api/account', {
      method: 'DELETE',
      cookie: alice.cookie,
      body: { confirm: 'DELETE', password: 'correct horse battery' },
    })
    expect(res.status).toBe(409)
    subscriptions.set('sub_hidden', {
      ...subscriptions.get('sub_hidden')!,
      status: 'canceled',
    })
    const ok = await h.request('/api/account', {
      method: 'DELETE',
      cookie: alice.cookie,
      body: { confirm: 'DELETE', password: 'correct horse battery' },
    })
    expect(ok.status).toBe(200)
  })
})
