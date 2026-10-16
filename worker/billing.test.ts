import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { app } from './index'
import { verifyStripeSignature } from './lib/billing/stripe'
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
