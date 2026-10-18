import { beforeEach, describe, expect, it } from 'vitest'

import { createHarness, cookieFrom, type Harness, type TestUser } from './testing/harness'

let h: Harness
let alice: TestUser

beforeEach(async () => {
  h = createHarness()
  alice = await h.register('alice-tour@example.com')
})

const readSettings = async (cookie: string) => {
  const response = await h.request('/api/me', { cookie })
  expect(response.status).toBe(200)
  return ((await response.json()) as { settings: { tourSeen: boolean } }).settings
}

describe('one-time guided tour', () => {
  it('offers the tour to existing and new accounts by default', async () => {
    expect((await readSettings(alice.cookie)).tourSeen).toBe(false)
    const bob = await h.register('bob-tour@example.com')
    expect((await readSettings(bob.cookie)).tourSeen).toBe(false)
  })

  it('requires authentication and a strict confirmation payload', async () => {
    expect((await h.request('/api/me/tour', {
      method: 'PATCH', body: { seen: true },
    })).status).toBe(401)
    for (const seen of [false, null, 'true', 1]) {
      expect((await h.request('/api/me/tour', {
        method: 'PATCH', cookie: alice.cookie, body: { seen },
      })).status).toBe(400)
    }
    expect((await readSettings(alice.cookie)).tourSeen).toBe(false)
  })

  it('records completion once, only for the signed-in user, across sign-ins', async () => {
    const bob = await h.register('bob-tour@example.com')
    const marked = await h.request('/api/me/tour', {
      method: 'PATCH', cookie: alice.cookie, body: { seen: true },
    })
    expect(marked.status).toBe(200)
    expect((await readSettings(alice.cookie)).tourSeen).toBe(true)
    expect((await readSettings(bob.cookie)).tourSeen).toBe(false)

    // Replaying or saving another preference never resets the flag.
    expect((await h.request('/api/me/tour', {
      method: 'PATCH', cookie: alice.cookie, body: { seen: true },
    })).status).toBe(200)
    expect((await h.request('/api/me/settings', {
      method: 'PATCH', cookie: alice.cookie, body: { theme: 'dark' },
    })).status).toBe(200)
    expect((await readSettings(alice.cookie)).tourSeen).toBe(true)

    const freshSession = cookieFrom(await h.login('alice-tour@example.com'))
    expect((await readSettings(freshSession)).tourSeen).toBe(true)
  })
})
