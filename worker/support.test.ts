import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness, type TestUser } from './testing/harness'
import { convertUsdToAud } from './lib/finance'

let h: Harness
let owner: TestUser
let customer: TestUser
let other: TestUser

beforeEach(async () => {
  h = createHarness()
  owner = await h.register('owner-support@example.com')
  customer = await h.register('customer-support@example.com')
  other = await h.register('other-support@example.com')
  h.makeOwner(owner.id)
})

async function json(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>
}

async function report() {
  const response = await h.request('/api/support', {
    cookie: customer.cookie,
    body: {
      category: 'problem',
      subject: 'Broken reminder',
      message: 'My reminders keep disappearing',
    },
  })
  expect(response.status).toBe(201)
  return String((await json(response)).id)
}

describe('Private feedback and Owner HQ', () => {
  it('does not allow unauthenticated messages', async () => {
    expect((await h.request('/api/support')).status).toBe(401)
    expect(
      (await h.request('/api/support', { body: { category: 'problem' } }))
        .status,
    ).toBe(401)
  })

  it('checks submission lengths and categories', async () => {
    const response = await h.request('/api/support', {
      cookie: customer.cookie,
      body: { category: 'invalid', subject: 'Oops', message: 'Too short' },
    })
    expect(response.status).toBe(400)
  })

  it('isolates customers and requires a passkey for HQ', async () => {
    const id = await report()
    expect(
      (await h.request('/api/support', { cookie: other.cookie })).status,
    ).toBe(200)
    const list = await json(
      await h.request('/api/support', { cookie: other.cookie }),
    )
    expect(list.reports).toEqual([])
    expect(
      (
        await h.request(`/api/support/${id}/read`, {
          cookie: other.cookie,
          method: 'POST',
          body: {},
        })
      ).status,
    ).toBe(404)
    expect(
      (
        await h.request(`/api/support/${id}/reply`, {
          cookie: other.cookie,
          body: { message: 'Nope' },
        })
      ).status,
    ).toBe(404)
    expect(
      (await h.request('/api/admin/support', { cookie: customer.cookie }))
        .status,
    ).toBe(404)
    expect(
      (await h.request('/api/admin/support', { cookie: owner.cookie })).status,
    ).toBe(401)
  })

  it('delivers an audited Owner reply and keeps internal notes private', async () => {
    const id = await report()
    h.elevate(owner)
    const thread = await h.request(`/api/admin/support/${id}`, {
      cookie: owner.cookie,
    })
    expect(thread.status).toBe(200)
    const saved = await h.request(`/api/admin/support/${id}/manage`, {
      cookie: owner.cookie,
      admin: true,
      body: { status: 'in_progress', internalNote: 'Review logs privately' },
    })
    expect(saved.status).toBe(200)
    const reply = await h.request(`/api/admin/support/${id}/reply`, {
      cookie: owner.cookie,
      admin: true,
      body: {
        message: 'The tech gremlins are investigating!',
        status: 'in_progress',
      },
    })
    expect(reply.status).toBe(200)
    const unread = await json(
      await h.request('/api/support/unread', { cookie: customer.cookie }),
    )
    expect(unread.unread).toBe(1)
    const list = await json(
      await h.request('/api/support', { cookie: customer.cookie }),
    )
    const reports = list.reports as Array<Record<string, unknown>>
    expect(reports).toHaveLength(1)
    expect(JSON.stringify(reports)).not.toContain('Review logs privately')
    expect(JSON.stringify(reports)).toContain('tech gremlins')
    const read = await h.request(`/api/support/${id}/read`, {
      cookie: customer.cookie,
      body: {},
    })
    expect(read.status).toBe(200)
    expect(
      (
        await json(
          await h.request('/api/support/unread', { cookie: customer.cookie }),
        )
      ).unread,
    ).toBe(0)
    const audits = h.query(
      'SELECT action FROM admin_audit_log WHERE target_id = ?',
      id,
    )
    expect(audits.map((v) => v.action)).toContain('support.reply')
  })
})

describe('AUD reporting', () => {
  it('converts a real USD amount using a dated FX rate, not request counts', () => {
    const quote = {
      base: 'USD' as const,
      quote: 'AUD' as const,
      rate: 1.52,
      date: '2026-10-15',
      source: 'Frankfurter' as const,
    }
    expect(convertUsdToAud(10, quote)).toBe(15.2)
    expect(convertUsdToAud(-2, quote)).toBeNull()
    expect(convertUsdToAud(Number.NaN, quote)).toBeNull()
  })
})
