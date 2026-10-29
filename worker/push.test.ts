import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestD1 } from '../test/sqliteD1.mjs'
import * as workerModule from './index'
import { runPushTick } from './lib/push/deliver'
import { base64UrlDecode, isPushEndpoint } from './lib/push/vapid'
import { createHarness, type Harness, type TestUser } from './testing/harness'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

const FCM = 'https://fcm.googleapis.com/fcm/send/device-one'
const APPLE = 'https://web.push.apple.com/device-two'

let keys: { VAPID_PUBLIC_KEY: string; VAPID_PRIVATE_KEY: string }
let verifyKey: webcrypto.CryptoKey
let h: Harness
let me: TestUser

async function makeKeys() {
  const pair = await webcrypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const raw = await webcrypto.subtle.exportKey('raw', pair.publicKey)
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey)
  verifyKey = pair.publicKey
  return {
    VAPID_PUBLIC_KEY: Buffer.from(raw).toString('base64url'),
    VAPID_PRIVATE_KEY: jwk.d!,
  }
}

/** A stand-in push service: records each wake, answers with `status`. */
function pushService(status = 201) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string> })
    return new Response(null, { status })
  }) as unknown as typeof fetch
  return { calls, fetchImpl }
}

const api = (
  path: string,
  init: { method?: string; body?: unknown; user?: TestUser } = {},
) =>
  h.request(`/api/push${path}`, {
    method: init.method,
    body: init.body,
    cookie: (init.user ?? me).cookie,
  })

const subscribe = (endpoint = FCM, timezone = 'Australia/Sydney', user = me) =>
  api('/subscriptions', { body: { endpoint, timezone }, user })

const notices = async (endpoint = FCM, user = me) =>
  (
    (await (
      await api(`/notices?endpoint=${encodeURIComponent(endpoint)}`, { user })
    ).json()) as Json
  ).notices

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  // 10:00 in Sydney on Friday 16 October.
  vi.setSystemTime(new Date('2026-10-15T23:00:00Z'))
  keys = await makeKeys()
  h = createHarness(keys)
  me = await h.register('push@example.com')
})
afterEach(() => vi.useRealTimers())

describe('turning notifications on', () => {
  it('is unavailable (not an error) before migration 0026', async () => {
    const early = createHarness({ ...keys, DB: createTestD1({ upTo: 25 }).db })
    const user = await early.register('early-push@example.com')
    const r = await early.request('/api/push', { cookie: user.cookie })
    expect(await r.json()).toEqual({ available: false, configured: false })
    expect(
      (
        await early.request('/api/push/subscriptions', {
          cookie: user.cookie,
          body: { endpoint: FCM },
        })
      ).status,
    ).toBe(503)
    expect((await runPushTick(early.env)).skipped).toBe('not_ready')
  })

  it('stays off until the VAPID keys are set', async () => {
    const bare = createHarness()
    const user = await bare.register('bare@example.com')
    const r = (await (
      await bare.request('/api/push', { cookie: user.cookie })
    ).json()) as Json
    expect(r).toMatchObject({
      available: true,
      configured: false,
      publicKey: null,
    })
    expect(
      (
        await bare.request('/api/push/subscriptions', {
          cookie: user.cookie,
          body: { endpoint: FCM },
        })
      ).status,
    ).toBe(503)
    expect((await runPushTick(bare.env)).skipped).toBe('not_configured')
  })

  it('only accepts real browser push services', async () => {
    for (const bad of [
      'http://fcm.googleapis.com/x',
      'https://169.254.169.254/latest',
      'https://evil.example.com/fcm.googleapis.com',
      'https://fcm.googleapis.com.evil.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user:pw@fcm.googleapis.com/x',
    ]) {
      expect(isPushEndpoint(bad), bad).toBe(false)
      expect((await subscribe(bad)).status).toBe(400)
    }
    expect(isPushEndpoint(APPLE)).toBe(true)
    expect(
      isPushEndpoint('https://wns2-sy3p.notify.windows.com/w/?token=abc'),
    ).toBe(true)
    expect((await subscribe()).status).toBe(201)
    const status = (await (await api('')).json()) as Json
    expect(status).toMatchObject({
      configured: true,
      publicKey: keys.VAPID_PUBLIC_KEY,
      devices: 1,
      preferences: {
        timezone: 'Australia/Sydney',
        remindersEnabled: true,
        morningEnabled: true,
        morningTime: '08:00',
        eveningEnabled: false,
      },
    })
  })

  it('checks preference values', async () => {
    await subscribe()
    expect(
      (
        await api('/preferences', {
          method: 'PATCH',
          body: { morningTime: '25:00' },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await api('/preferences', {
          method: 'PATCH',
          body: { timezone: 'Mars/Base' },
        })
      ).status,
    ).toBe(400)
    expect(
      (
        await api('/preferences', {
          method: 'PATCH',
          body: { eveningEnabled: 'yes' },
        })
      ).status,
    ).toBe(400)
    const r = (await (
      await api('/preferences', {
        method: 'PATCH',
        body: { eveningEnabled: true, eveningTime: '19:30' },
      })
    ).json()) as Json
    expect(r.preferences).toMatchObject({
      eveningEnabled: true,
      eveningTime: '19:30',
    })
  })
})

describe('delivering', () => {
  it('wakes the device for a due reminder with a valid VAPID signature and no text', async () => {
    await subscribe()
    await h.request('/api/reminders', {
      cookie: me.cookie,
      body: {
        title: 'Call the pharmacy',
        remindAt: '2026-10-15T23:00:00.000Z',
      },
    })
    const service = pushService()
    const r = await runPushTick(h.env, new Date(), service.fetchImpl)
    expect(r).toMatchObject({ queued: 1, sent: 1 })
    expect(service.calls).toHaveLength(1)
    const { url, headers } = service.calls[0]!
    expect(url).toBe(FCM)
    expect(headers['Content-Length']).toBe('0')
    expect(headers.Urgency).toBe('high')

    // RFC 8292: vapid t=<jwt>, k=<public key>, signed by our private key.
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(headers.Authorization!)
    expect(match?.[2]).toBe(keys.VAPID_PUBLIC_KEY)
    const [head, claims, sig] = match![1]!.split('.')
    expect(
      await webcrypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        verifyKey,
        base64UrlDecode(sig!),
        new TextEncoder().encode(`${head}.${claims}`),
      ),
    ).toBe(true)
    const payload = JSON.parse(Buffer.from(claims!, 'base64url').toString())
    expect(payload.aud).toBe('https://fcm.googleapis.com')
    expect(payload.sub).toBe('mailto:support@pocketgoblin.org')

    // The words come from us, once per device.
    const shown = await notices()
    expect(shown).toEqual([
      expect.objectContaining({
        title: 'Reminder',
        body: 'Call the pharmacy',
        url: '/den',
      }),
    ])
    expect(shown[0].reminderId).toMatch(/^rem/)
    expect(await notices()).toEqual([])

    // Not announced twice.
    expect(
      await runPushTick(h.env, new Date(), service.fetchImpl),
    ).toMatchObject({
      queued: 0,
      sent: 0,
    })
  })

  it('does not announce reminders the person turned off, or ones due long ago', async () => {
    await subscribe()
    await h.request('/api/reminders', {
      cookie: me.cookie,
      body: { title: 'Long ago', remindAt: '2026-10-15T20:00:00.000Z' },
    })
    await api('/preferences', {
      method: 'PATCH',
      body: { remindersEnabled: false },
    })
    await h.request('/api/reminders', {
      cookie: me.cookie,
      body: { title: 'Now', remindAt: '2026-10-15T23:00:00.000Z' },
    })
    const service = pushService()
    expect((await runPushTick(h.env, new Date(), service.fetchImpl)).sent).toBe(
      0,
    )
  })

  it('sends the morning check-in at local time with counts, not names', async () => {
    await subscribe()
    await h.request('/api/tasks', {
      cookie: me.cookie,
      body: { title: 'Secret surgery paperwork', dueDate: '2026-10-17' },
    })
    const service = pushService()
    // 07:59 Sydney: not yet.
    vi.setSystemTime(new Date('2026-10-16T20:59:00Z'))
    expect((await runPushTick(h.env, new Date(), service.fetchImpl)).sent).toBe(
      0,
    )
    // 08:01 Sydney on Saturday 17 October.
    vi.setSystemTime(new Date('2026-10-16T21:01:00Z'))
    expect((await runPushTick(h.env, new Date(), service.fetchImpl)).sent).toBe(
      1,
    )
    expect(service.calls[0]!.headers.Urgency).toBe('normal')
    const [morning] = await notices()
    expect(morning.title).toBe('Morning, push')
    expect(morning.body).toContain('1 thing due today')
    expect(JSON.stringify(morning)).not.toContain('Secret')
    // Once a day.
    vi.setSystemTime(new Date('2026-10-16T21:10:00Z'))
    expect((await runPushTick(h.env, new Date(), service.fetchImpl)).sent).toBe(
      0,
    )
  })

  it('wakes every device, and each device shows each notice once', async () => {
    await subscribe(FCM)
    await subscribe(APPLE)
    await h.request('/api/reminders', {
      cookie: me.cookie,
      body: { title: 'Bins out', remindAt: '2026-10-15T23:00:00.000Z' },
    })
    const service = pushService()
    expect((await runPushTick(h.env, new Date(), service.fetchImpl)).sent).toBe(
      2,
    )
    expect(await notices(FCM)).toHaveLength(1)
    expect(await notices(APPLE)).toHaveLength(1)
    expect(await notices(APPLE)).toHaveLength(0)
  })

  it('forgets a device the push service says is gone', async () => {
    await subscribe()
    await h.request('/api/reminders', {
      cookie: me.cookie,
      body: { title: 'Bins out', remindAt: '2026-10-15T23:00:00.000Z' },
    })
    const service = pushService(410)
    expect((await runPushTick(h.env, new Date(), service.fetchImpl)).gone).toBe(
      1,
    )
    expect(((await (await api('')).json()) as Json).devices).toBe(0)
  })

  it('stops when the person signs out, and nudges once when a session runs out', async () => {
    await subscribe()
    await h.request('/api/auth/logout', { cookie: me.cookie, body: {} })
    const again = await h.login('push@example.com')
    const cookie = again.headers
      .get('set-cookie')!
      .match(/pg_session=[^;]*/)![0]
    me = { ...me, cookie }
    expect(((await (await api('')).json()) as Json).devices).toBe(0)

    await subscribe()
    await h.env.DB.prepare(
      'UPDATE sessions SET expires_at = ? WHERE user_id = ?',
    )
      .bind('2026-10-01T00:00:00.000Z', me.id)
      .run()
    const service = pushService()
    const r = await runPushTick(h.env, new Date(), service.fetchImpl)
    expect(service.calls).toHaveLength(1)
    expect(r.gone).toBe(1)
    const left = await h.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM push_subscriptions',
    ).first<{ n: number }>()
    expect(left?.n).toBe(0)
  })

  it('tells someone Goblin HQ replied, but waits out their quiet hours', async () => {
    const owner = await h.register('owner-push@example.com')
    h.makeOwner(owner.id)
    h.elevate(owner)
    await subscribe()
    await h.request('/api/me/settings', {
      cookie: me.cookie,
      method: 'PATCH',
      body: {
        quietHoursEnabled: true,
        quietHoursStart: '09:00',
        quietHoursEnd: '12:00',
      },
    })
    const thread = (await (
      await h.request('/api/support', {
        cookie: me.cookie,
        body: {
          category: 'problem',
          subject: 'Help',
          message: 'Something broke',
        },
      })
    ).json()) as Json
    const id = thread.thread?.id ?? thread.id
    expect(
      (
        await h.request(`/api/admin/support/${id}/reply`, {
          cookie: owner.cookie,
          admin: true,
          body: { message: 'Fixed it for you!' },
        })
      ).status,
    ).toBe(200)
    const service = pushService()
    // 10:00 Sydney is inside 09:00–12:00 quiet hours.
    expect((await runPushTick(h.env, new Date(), service.fetchImpl)).sent).toBe(
      0,
    )
    vi.setSystemTime(new Date('2026-10-16T01:05:00Z'))
    expect((await runPushTick(h.env, new Date(), service.fetchImpl)).sent).toBe(
      1,
    )
    const [shown] = await notices()
    expect(shown).toMatchObject({ title: 'Goblin HQ replied', url: '/support' })
    expect(JSON.stringify(shown)).not.toContain('Fixed it')
  })

  it('keeps preferences in the export but never device endpoints', async () => {
    await subscribe()
    const exported = (await (
      await h.request('/api/account/export', { cookie: me.cookie })
    ).json()) as Json
    const text = JSON.stringify(exported)
    expect(text).toContain('Australia/Sydney')
    expect(text).not.toContain('fcm.googleapis.com')
  })
})

describe('the Worker entry point', () => {
  it('exports only handlers (the runtime refuses to start otherwise)', () => {
    for (const [name, value] of Object.entries(workerModule)) {
      const handler =
        typeof value === 'function' ||
        (typeof value === 'object' && value !== null && 'fetch' in value)
      expect(handler, name).toBe(true)
    }
  })
})
