import { beforeEach, describe, expect, it } from 'vitest'

import {
  createHarness,
  cookieFrom,
  type Harness,
  type TestUser,
} from './testing/harness'

let h: Harness
let owner: TestUser
let alice: TestUser

const ADMIN_GETS = [
  '/api/admin/overview',
  '/api/admin/customers',
  '/api/admin/settings',
  '/api/admin/subscriptions',
  '/api/admin/audit',
  '/api/admin/security/status',
  '/api/admin/security/sessions',
]

beforeEach(async () => {
  h = createHarness()
  owner = await h.register('owner@example.com')
  alice = await h.register('alice@example.com')
  h.makeOwner(owner.id)
})

// Test-only convenience: responses are asserted field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (res: Response) => (await res.json()) as Record<string, any>

describe('authentication and authorisation', () => {
  it('rejects unauthenticated requests to every admin route', async () => {
    for (const path of ADMIN_GETS) {
      expect((await h.request(path)).status).toBe(401)
    }
  })

  it('hides every admin route from ordinary customers, even with a forged step-up', async () => {
    h.elevate(alice)
    for (const path of ADMIN_GETS) {
      expect((await h.request(path, { cookie: alice.cookie })).status).toBe(404)
    }
    const put = await h.request('/api/admin/settings/features', {
      method: 'PUT',
      cookie: alice.cookie,
      admin: true,
      body: {
        value: {
          registrationsOpen: false,
          documentUploads: true,
          aiProvider: true,
        },
      },
    })
    expect(put.status).toBe(404)
    const suspend = await h.request(
      `/api/admin/customers/${owner.id}/suspend`,
      {
        cookie: alice.cookie,
        admin: true,
        body: { confirm: 'SUSPEND', reason: 'trying to take over' },
      },
    )
    expect(suspend.status).toBe(404)
  })

  it('has no endpoint that changes roles', async () => {
    h.elevate(owner)
    for (const [method, path] of [
      ['POST', `/api/admin/customers/${alice.id}/roles`],
      ['PATCH', `/api/admin/customers/${alice.id}`],
      ['PUT', `/api/admin/customers/${alice.id}/role`],
      ['POST', '/api/admin/roles'],
    ] as const) {
      const res = await h.request(path, {
        method,
        cookie: owner.cookie,
        admin: true,
        body: { role: 'owner' },
      })
      expect(res.status).toBe(404)
    }
  })

  it('ignores attempts to grant Owner through normal account settings', async () => {
    const res = await h.request('/api/me/settings', {
      method: 'PATCH',
      cookie: alice.cookie,
      body: {
        roles: ['owner'],
        isOwner: true,
        plan: 'owner_premium',
        role: 'owner',
      },
    })
    expect(res.status).toBe(200)
    const me = await json(await h.request('/api/me', { cookie: alice.cookie }))
    expect(me.access).toEqual({
      plan: 'free',
      planLabel: 'Free',
      isOwner: false,
    })
    expect(
      h.query('SELECT * FROM user_roles WHERE user_id = ?', alice.id),
    ).toEqual([])
  })

  it('never grants Owner to someone just because of their email', async () => {
    const lookalike = await h.register('petabozanich6@gmail.com')
    const me = await json(
      await h.request('/api/me', { cookie: lookalike.cookie }),
    )
    expect(me.access.isOwner).toBe(false)
    expect(
      (await h.request('/api/admin/overview', { cookie: lookalike.cookie }))
        .status,
    ).toBe(404)
  })

  it('requires a passkey step-up before showing administration data', async () => {
    const res = await h.request('/api/admin/overview', { cookie: owner.cookie })
    expect(res.status).toBe(401)
    expect((await json(res)).code).toBe('step_up_required')
    const status = await json(
      await h.request('/api/admin/security/status', { cookie: owner.cookie }),
    )
    expect(status).toMatchObject({ passkeyCount: 0, elevated: false })

    h.elevate(owner)
    expect(
      (await h.request('/api/admin/overview', { cookie: owner.cookie })).status,
    ).toBe(200)
  })

  it('treats an expired step-up as no step-up', async () => {
    h.elevate(owner, -1)
    expect(
      (await h.request('/api/admin/overview', { cookie: owner.cookie })).status,
    ).toBe(401)
  })

  it('rejects expired sessions', async () => {
    h.run(
      `UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?`,
      owner.id,
    )
    expect(
      (await h.request('/api/admin/security/status', { cookie: owner.cookie }))
        .status,
    ).toBe(401)
    expect((await h.request('/api/me', { cookie: owner.cookie })).status).toBe(
      401,
    )
  })

  it('ends a step-up on request', async () => {
    h.elevate(owner)
    const end = await h.request('/api/admin/security/step-up/end', {
      cookie: owner.cookie,
      admin: true,
      body: {},
    })
    expect(end.status).toBe(200)
    expect(
      (await h.request('/api/admin/overview', { cookie: owner.cookie })).status,
    ).toBe(401)
  })
})

describe('CSRF protection for administrative changes', () => {
  const change = (headers: Record<string, string>) =>
    h.request(`/api/admin/customers/${alice.id}/sessions/revoke`, {
      cookie: owner.cookie,
      headers: { 'Content-Type': 'application/json', ...headers },
      method: 'POST',
      body: { reason: 'security check' },
    })

  beforeEach(() => h.elevate(owner))

  it('blocks mutations without the admin header', async () => {
    expect((await change({ Origin: 'http://localhost:5173' })).status).toBe(403)
  })

  it('blocks mutations from another origin', async () => {
    const res = await change({
      Origin: 'https://evil.example',
      'X-Pocket-Goblin-Admin': '1',
    })
    expect(res.status).toBe(403)
  })

  it('blocks cross-site fetches', async () => {
    const res = await change({
      Origin: 'http://localhost:5173',
      'X-Pocket-Goblin-Admin': '1',
      'Sec-Fetch-Site': 'cross-site',
    })
    expect(res.status).toBe(403)
  })

  it('allows same-origin requests with the header', async () => {
    const res = await change({
      Origin: 'http://localhost:5173',
      'X-Pocket-Goblin-Admin': '1',
      'Sec-Fetch-Site': 'same-origin',
    })
    expect(res.status).toBe(200)
  })
})

describe('suspension', () => {
  beforeEach(() => h.elevate(owner))

  const suspend = (target: string, body: Record<string, unknown>) =>
    h.request(`/api/admin/customers/${target}/suspend`, {
      cookie: owner.cookie,
      admin: true,
      body,
    })

  it('needs typed confirmation and a reason', async () => {
    expect((await suspend(alice.id, { reason: 'Spam account' })).status).toBe(
      400,
    )
    expect((await suspend(alice.id, { confirm: 'SUSPEND' })).status).toBe(400)
    expect(
      (await suspend(alice.id, { confirm: 'SUSPEND', reason: 'x' })).status,
    ).toBe(400)
  })

  it('suspends, revokes sessions, blocks sign-in and is audited', async () => {
    const res = await suspend(alice.id, {
      confirm: 'SUSPEND',
      reason: 'Payment fraud report',
    })
    expect(res.status).toBe(200)
    expect((await json(res)).sessionsRevoked).toBe(1)

    // The old cookie no longer works and a fresh sign-in is refused.
    expect(
      (await h.request('/api/tasks', { cookie: alice.cookie })).status,
    ).toBe(401)
    const login = await h.login(alice.email)
    expect(login.status).toBe(403)
    expect((await json(login)).code).toBe('account_suspended')

    const audit = h.query(
      `SELECT action, actor_user_id, target_id, detail_json FROM admin_audit_log WHERE action = 'customer.suspend'`,
    )
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      actor_user_id: owner.id,
      target_id: alice.id,
    })
    expect(JSON.parse(String(audit[0]?.detail_json))).toMatchObject({
      reason: 'Payment fraud report',
    })
  })

  it('blocks a suspended user who still holds a session', async () => {
    h.run(`UPDATE users SET status = 'suspended' WHERE id = ?`, alice.id)
    const res = await h.request('/api/tasks', { cookie: alice.cookie })
    expect(res.status).toBe(403)
    expect((await json(res)).code).toBe('account_suspended')
  })

  it('refuses a wrong password before revealing suspension', async () => {
    h.run(`UPDATE users SET status = 'suspended' WHERE id = ?`, alice.id)
    expect((await h.login(alice.email, 'wrong password!')).status).toBe(401)
  })

  it('restores an account', async () => {
    await suspend(alice.id, {
      confirm: 'SUSPEND',
      reason: 'Payment fraud report',
    })
    const restore = await h.request(
      `/api/admin/customers/${alice.id}/restore`,
      {
        cookie: owner.cookie,
        admin: true,
        body: { reason: 'Resolved with the customer' },
      },
    )
    expect(restore.status).toBe(200)
    expect((await h.login(alice.email)).status).toBe(200)
  })

  it('cannot suspend an Owner', async () => {
    expect(
      (
        await suspend(owner.id, {
          confirm: 'SUSPEND',
          reason: 'Locking myself out',
        })
      ).status,
    ).toBe(409)
  })

  it('rejects malformed customer ids', async () => {
    for (const id of ["user_' OR 1=1 --", 'user_123', '../../tasks']) {
      const res = await suspend(encodeURIComponent(id), {
        confirm: 'SUSPEND',
        reason: 'Testing invalid ids',
      })
      expect(res.status).toBe(404)
    }
  })
})

describe('customer privacy', () => {
  const SECRET = 'GOBLIN-PRIVATE-CONTENT'

  beforeEach(async () => {
    h.elevate(owner)
    await h.request('/api/tasks', {
      cookie: alice.cookie,
      body: { title: `${SECRET} task` },
    })
    await h.request('/api/notes', {
      cookie: alice.cookie,
      body: { title: `${SECRET} note`, body: `${SECRET} body` },
    })
    await h.request('/api/captures', {
      cookie: alice.cookie,
      body: { text: `${SECRET} brain dump about the dentist tomorrow` },
    })
    const form = new FormData()
    form.append(
      'file',
      new File([`${SECRET} document text`], `${SECRET}.txt`, {
        type: 'text/plain',
      }),
    )
    const upload = await h.env.DB.prepare('SELECT 1').first()
    expect(upload).toBeTruthy()
    const { app } = await import('./index')
    const res = await app.request(
      '/api/documents',
      { method: 'POST', headers: { Cookie: alice.cookie }, body: form },
      h.env,
    )
    expect(res.status).toBe(201)
  })

  it('never returns customer content from any admin endpoint', async () => {
    const paths = [
      '/api/admin/overview',
      '/api/admin/customers',
      `/api/admin/customers?q=alice`,
      `/api/admin/customers/${alice.id}`,
      '/api/admin/subscriptions',
      '/api/admin/audit',
    ]
    for (const path of paths) {
      const res = await h.request(path, { cookie: owner.cookie })
      expect(res.status).toBe(200)
      expect(await res.text()).not.toContain(SECRET)
    }
  })

  it('returns only the permitted customer fields', async () => {
    const detail = await json(
      await h.request(`/api/admin/customers/${alice.id}`, {
        cookie: owner.cookie,
      }),
    )
    expect(Object.keys(detail.customer).sort()).toEqual(
      [
        'createdAt',
        'displayName',
        'documentCount',
        'email',
        'id',
        'isOwner',
        'lastSeenAt',
        'plan',
        'problems',
        'status',
        'storageBytes',
      ].sort(),
    )
    expect(detail.usage).toMatchObject({
      tasks: 1,
      notes: 1,
      documents: 1,
      captures: 1,
    })
    expect(
      Object.values(detail.usage).every((v) => typeof v === 'number'),
    ).toBe(true)
  })

  it('keeps customers out of each other’s data', async () => {
    const tasks = await json(
      await h.request('/api/tasks', { cookie: owner.cookie }),
    )
    expect(JSON.stringify(tasks)).not.toContain(SECRET)
  })
})

describe('Owner entitlements', () => {
  it('gives the Owner Premium without Stripe', async () => {
    const me = await json(await h.request('/api/me', { cookie: owner.cookie }))
    expect(me.access).toEqual({
      plan: 'owner_premium',
      planLabel: 'Owner Premium',
      isOwner: true,
    })
  })

  it('keeps Owner access when a Stripe subscription fails or ends', async () => {
    for (const status of ['past_due', 'canceled', 'expired']) {
      h.run(
        `DELETE FROM user_entitlements WHERE user_id = ? AND entitlement = 'premium'`,
        owner.id,
      )
      h.run(
        `INSERT INTO user_entitlements (id, user_id, entitlement, source, status, ended_at)
         VALUES (?, ?, 'premium', 'stripe', ?, ?)`,
        `stripe_${status}`,
        owner.id,
        status,
        status === 'past_due' ? null : '2026-01-01T00:00:00.000Z',
      )
      const me = await json(
        await h.request('/api/me', { cookie: owner.cookie }),
      )
      expect(me.access.plan).toBe('owner_premium')
      h.elevate(owner)
      expect(
        (await h.request('/api/admin/overview', { cookie: owner.cookie }))
          .status,
      ).toBe(200)
    }
  })

  it('never turns a paying customer into an administrator', async () => {
    h.run(
      `INSERT INTO user_entitlements (id, user_id, entitlement, source, status, billing_interval)
       VALUES ('stripe_alice', ?, 'premium', 'stripe', 'active', 'month')`,
      alice.id,
    )
    const me = await json(await h.request('/api/me', { cookie: alice.cookie }))
    expect(me.access).toEqual({
      plan: 'premium',
      planLabel: 'Premium',
      isOwner: false,
    })
    h.elevate(alice)
    expect(
      (await h.request('/api/admin/overview', { cookie: alice.cookie })).status,
    ).toBe(404)
  })

  it('still applies the AI daily limit to the Owner', async () => {
    const today = new Date().toISOString().slice(0, 10)
    h.run(
      `INSERT INTO ai_usage_daily (user_id, usage_date, request_count) VALUES (?, ?, 200)`,
      owner.id,
      today,
    )
    const res = await h.request('/api/intelligence/interpret', {
      cookie: owner.cookie,
      body: { text: 'Clean the garage' },
    })
    // Over the limit: the rule-based goblin answers instead, no model call.
    expect(res.status).toBe(200)
    const event = h.query(
      `SELECT feature, outcome FROM ai_events WHERE user_id = ?`,
      owner.id,
    )
    expect(event).toEqual([{ feature: 'interpret', outcome: 'limit_reached' }])

    // Rule-only helpers don't spend (or need) the AI allowance.
    const breakdown = await h.request('/api/intelligence/breakdown', {
      cookie: owner.cookie,
      body: { title: 'Clean the garage' },
    })
    expect(breakdown.status).toBe(200)
    expect(
      h.query(
        `SELECT request_count AS n FROM ai_usage_daily WHERE user_id = ?`,
        owner.id,
      ),
    ).toEqual([{ n: 200 }])
  })

  it('still applies the storage quota to the Owner', async () => {
    h.run(
      `INSERT INTO platform_settings (key, value_json) VALUES ('storageQuotas', ?)`,
      JSON.stringify({ freeMb: 500, premiumMb: 5120, ownerMb: 0 }),
    )
    const form = new FormData()
    form.append(
      'file',
      new File(['hello goblin'], 'note.txt', { type: 'text/plain' }),
    )
    form.append('mode', 'keep')
    const { app } = await import('./index')
    const res = await app.request(
      '/api/documents',
      { method: 'POST', headers: { Cookie: owner.cookie }, body: form },
      h.env,
    )
    expect(res.status).toBe(413)

    // "Just sort it" never counts towards kept storage.
    const sort = new FormData()
    sort.append(
      'file',
      new File(['hello goblin'], 'note.txt', { type: 'text/plain' }),
    )
    const sorted = await app.request(
      '/api/documents',
      { method: 'POST', headers: { Cookie: owner.cookie }, body: sort },
      h.env,
    )
    expect(sorted.status).toBe(201)
  })

  it('still validates files for the Owner', async () => {
    const form = new FormData()
    form.append(
      'file',
      new File([new Uint8Array([0, 1, 2, 3, 250, 251, 252])], 'x.bin', {
        type: 'application/x-msdownload',
      }),
    )
    const { app } = await import('./index')
    const res = await app.request(
      '/api/documents',
      { method: 'POST', headers: { Cookie: owner.cookie }, body: form },
      h.env,
    )
    expect(res.status).toBe(400)
  })
})

describe('platform settings', () => {
  beforeEach(() => h.elevate(owner))

  const put = (key: string, body: unknown) =>
    h.request(`/api/admin/settings/${key}`, {
      method: 'PUT',
      cookie: owner.cookie,
      admin: true,
      body,
    })

  it('rejects invalid and malicious values', async () => {
    const bad: [string, unknown][] = [
      ['nope', { value: {} }],
      ['aiLimits', { value: { free: -1, premium: 40, owner: 200 } }],
      ['aiLimits', { value: { free: 40, premium: 40, owner: 100_000 } }],
      ['aiLimits', { value: { free: '40', premium: 40, owner: 200 } }],
      [
        'aiLimits',
        { value: { free: 40, premium: 40, owner: 200, admin: true } },
      ],
      [
        'announcement',
        {
          value: { enabled: true, message: '<script>x</script>', tone: 'info' },
        },
      ],
      [
        'announcement',
        { value: { enabled: true, message: 'x'.repeat(281), tone: 'info' } },
      ],
      ['announcement', { value: { enabled: true, message: '', tone: 'info' } }],
      [
        'features',
        {
          value: {
            registrationsOpen: 'yes',
            documentUploads: true,
            aiProvider: true,
          },
        },
      ],
      [
        'storageQuotas',
        { value: { freeMb: 1.5, premiumMb: 5120, ownerMb: 20480 } },
      ],
      ['features', { value: ['AUTH_SECRET'] }],
    ]
    for (const [key, body] of bad) {
      const res = await put(key, body)
      expect([400, 404]).toContain(res.status)
    }
    expect(h.query('SELECT * FROM platform_settings')).toEqual([])
  })

  it('needs confirmation for high-cost changes and audits the change', async () => {
    const value = { free: 40, premium: 150, owner: 200 }
    const first = await put('aiLimits', { value })
    expect(first.status).toBe(409)
    expect((await json(first)).reasons).toHaveLength(1)

    const confirmed = await put('aiLimits', { value, confirmHighImpact: true })
    expect(confirmed.status).toBe(200)
    const audit = h.query(
      `SELECT detail_json FROM admin_audit_log WHERE action = 'settings.update'`,
    )
    expect(JSON.parse(String(audit[0]?.detail_json))).toMatchObject({
      to: value,
      highImpact: [expect.stringContaining('premium')],
    })
  })

  it('applies announcements, maintenance and registration pauses', async () => {
    expect(
      (
        await put('announcement', {
          value: { enabled: true, message: 'New features soon', tone: 'info' },
        })
      ).status,
    ).toBe(200)
    expect(
      (
        await put('features', {
          value: {
            registrationsOpen: false,
            documentUploads: true,
            aiProvider: true,
          },
          confirmHighImpact: true,
        })
      ).status,
    ).toBe(200)
    const status = await json(await h.request('/api/platform/status'))
    expect(status).toEqual({
      announcement: { message: 'New features soon', tone: 'info' },
      maintenance: null,
      registrationsOpen: false,
    })
    const reg = await h.request('/api/auth/register', {
      body: {
        email: 'new@example.com',
        password: 'long enough pw',
        displayName: 'New',
      },
    })
    expect(reg.status).toBe(403)
  })

  it('never exposes secrets', async () => {
    const res = await h.request('/api/admin/settings', { cookie: owner.cookie })
    const text = await res.text()
    expect(text).not.toContain(h.env.AUTH_SECRET!)
    expect(text).not.toMatch(/AUTH_SECRET|AI_API_KEY|STRIPE_SECRET/)
  })
})

describe('overview metrics', () => {
  it('reports real counts and marks unconfigured integrations', async () => {
    h.elevate(owner)
    const data = await json(
      await h.request('/api/admin/overview', { cookie: owner.cookie }),
    )
    expect(data.customers).toMatchObject({
      total: 2,
      new7d: 2,
      suspended: 0,
      byPlan: { free: 1, premium: 0, owner_premium: 1 },
    })
    expect(data.subscriptions.stripeConfigured).toBe(false)
    expect(data.subscriptions.recurringRevenue.available).toBe(false)
    expect(data.ai.costs.available).toBe(false)
    expect(data.health.deployments.available).toBe(false)
    expect(data.storage.documents).toBe(0)
  })
})

describe('own sessions', () => {
  it('signs out other sessions but keeps the current one', async () => {
    const second = cookieFrom(await h.login(owner.email))
    h.elevate(owner)
    const res = await h.request('/api/admin/security/sessions/revoke-others', {
      cookie: owner.cookie,
      admin: true,
      body: {},
    })
    expect((await json(res)).revoked).toBe(1)
    expect((await h.request('/api/me', { cookie: owner.cookie })).status).toBe(
      200,
    )
    expect((await h.request('/api/me', { cookie: second })).status).toBe(401)
  })
})

describe('Stripe first-invoice promotions', () => {
  it('does not publish a multi-cycle draft or expose publishing to regular users', async () => {
    h.elevate(owner)
    const draft = await h.request('/api/admin/deals', {
      cookie: owner.cookie,
      admin: true,
      body: {
        code: 'SAFEFIRST20',
        name: 'Safe test offer',
        kind: 'percent',
        amount: 20,
        billingCycles: 6,
        audience: 'new',
        verification: 'none',
        maxRedemptions: 1,
      },
    })
    expect(draft.status).toBe(201)
    const { id } = await json(draft)
    const path = `/api/admin/deals/${id}/publish-first-invoice`
    const forbidden = await h.request(path, {
      cookie: alice.cookie,
      admin: true,
      body: {},
    })
    expect(forbidden.status).toBe(404)
    const rejected = await h.request(path, {
      cookie: owner.cookie,
      admin: true,
      body: {},
    })
    expect(rejected.status).toBe(409)
    expect(
      h.query(
        'SELECT active, stripe_promotion_code_id FROM promotion_campaigns WHERE id = ?',
        id,
      ),
    ).toEqual([{ active: 0, stripe_promotion_code_id: null }])
  })
})

describe('free Premium giveaways', () => {
  const create = (name = 'A week of goblin mischief', maxRecipients = 1) =>
    h.request('/api/admin/deals/giveaways', {
      cookie: owner.cookie,
      admin: true,
      body: { name, durationDays: 7, maxRecipients },
    })

  it('requires owner permissions and an active passkey step-up', async () => {
    expect((await create()).status).toBe(401)
    h.elevate(alice)
    expect(
      (
        await h.request('/api/admin/deals/giveaways', {
          cookie: alice.cookie,
          admin: true,
          body: {
            name: 'Unauthorised gift',
            durationDays: 7,
            maxRecipients: 1,
          },
        })
      ).status,
    ).toBe(404)
  })

  it('awards Premium once without a Stripe subscription or recurring charge', async () => {
    h.elevate(owner)
    const made = await create()
    expect(made.status).toBe(201)
    const { id } = await json(made)
    const claim = () =>
      h.request(`/api/admin/deals/giveaways/${id}/grant`, {
        cookie: owner.cookie,
        admin: true,
        body: { email: 'alice@example.com' },
      })
    expect((await claim()).status).toBe(201)
    expect((await claim()).status).toBe(409)
    expect(
      h.query(
        'SELECT COUNT(*) AS n FROM premium_giveaway_grants WHERE campaign_id = ?',
        id,
      ),
    ).toEqual([{ n: 1 }])
    const entitlements = h.query(
      'SELECT source, stripe_customer_id, stripe_subscription_id, current_period_end FROM user_entitlements WHERE user_id = ?',
      alice.id,
    )
    expect(entitlements).toHaveLength(1)
    expect(entitlements[0]).toMatchObject({
      source: 'giveaway',
      stripe_customer_id: null,
      stripe_subscription_id: null,
    })
    const current = await json(
      await h.request('/api/me', { cookie: alice.cookie }),
    )
    expect(current.access.plan).toBe('premium')
  })

  it('closes an expired gift before giving a different campaign', async () => {
    h.elevate(owner)
    const first = await json(await create('Seven day gift', 1))
    const second = await json(await create('Another week', 1))
    const award = (id: string) =>
      h.request(`/api/admin/deals/giveaways/${id}/grant`, {
        cookie: owner.cookie,
        admin: true,
        body: { email: 'alice@example.com' },
      })
    expect((await award(first.id)).status).toBe(201)
    h.run(
      `UPDATE user_entitlements
       SET current_period_end = '2000-01-01T00:00:00.000Z'
       WHERE user_id = ? AND source = 'giveaway'`,
      alice.id,
    )
    expect((await award(second.id)).status).toBe(201)
    expect(
      h.query(
        `SELECT COUNT(*) AS n FROM user_entitlements
         WHERE user_id = ? AND ended_at IS NULL`,
        alice.id,
      ),
    ).toEqual([{ n: 1 }])
  })

  it('refuses the same giveaway again even after its Premium period expires', async () => {
    h.elevate(owner)
    const { id } = await json(await create())
    const award = () =>
      h.request(`/api/admin/deals/giveaways/${id}/grant`, {
        cookie: owner.cookie,
        admin: true,
        body: { email: 'alice@example.com' },
      })
    expect((await award()).status).toBe(201)
    h.run(
      `UPDATE user_entitlements
       SET current_period_end = '2000-01-01T00:00:00.000Z'
       WHERE user_id = ? AND source = 'giveaway'`,
      alice.id,
    )
    expect((await award()).status).toBe(409)
    expect(
      h.query(
        'SELECT COUNT(*) AS n FROM premium_giveaway_grants WHERE campaign_id = ?',
        id,
      ),
    ).toEqual([{ n: 1 }])
  })

  it('sends exactly one branded gift email only for a successful grant', async () => {
    const sent: Array<{ to: string; subject: string; text: string }> = []
    h.env.EMAIL = {
      send: async (message: unknown) => {
        const payload = message as {
          to: string
          subject: string
          text: string
        }
        sent.push({
          to: payload.to,
          subject: payload.subject,
          text: payload.text,
        })
      },
    } as unknown as typeof h.env.EMAIL
    h.elevate(owner)
    const { id } = await json(await create())
    const award = () =>
      h.request(`/api/admin/deals/giveaways/${id}/grant`, {
        cookie: owner.cookie,
        admin: true,
        body: { email: alice.email },
      })
    const initial = await award()
    expect(initial.status).toBe(201)
    expect((await json(initial)).emailSent).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.to).toBe(alice.email)
    expect(sent[0]?.subject).toContain('free Premium')
    expect(sent[0]?.text).toContain('No payment details are needed')
    expect((await award()).status).toBe(409)
    expect(sent).toHaveLength(1)
  })

  it('keeps a successfully awarded gift if email delivery fails', async () => {
    h.env.EMAIL = {
      send: async () => {
        throw new Error('simulated email provider outage')
      },
    } as unknown as typeof h.env.EMAIL
    h.elevate(owner)
    const { id } = await json(await create())
    const response = await h.request(`/api/admin/deals/giveaways/${id}/grant`, {
      cookie: owner.cookie,
      admin: true,
      body: { email: alice.email },
    })
    expect(response.status).toBe(201)
    expect((await json(response)).emailSent).toBe(false)
    const current = await json(
      await h.request('/api/me', { cookie: alice.cookie }),
    )
    expect(current.access.plan).toBe('premium')
  })

  it('enforces the recipient cap on the server', async () => {
    h.elevate(owner)
    const bob = await h.register('bob@example.com')
    const { id } = await json(await create())
    const grant = (email: string) =>
      h.request(`/api/admin/deals/giveaways/${id}/grant`, {
        cookie: owner.cookie,
        admin: true,
        body: { email },
      })
    expect((await grant('alice@example.com')).status).toBe(201)
    expect((await grant('bob@example.com')).status).toBe(409)
    expect(
      h.query(
        'SELECT * FROM premium_giveaway_grants WHERE user_id = ?',
        bob.id,
      ),
    ).toEqual([])
  })
})
