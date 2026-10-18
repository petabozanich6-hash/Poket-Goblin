import { describe, expect, it, vi } from 'vitest'

import { createHarness } from './testing/harness'
import { deliverDueReminders, inQuietHours, safePushEndpoint } from './lib/push'

const endpoint = 'https://fcm.googleapis.com/fcm/send/valid-long-opaque-device-endpoint-token-12345678'

const b64 = (buffer: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

async function credentials() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  )
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  const publicRaw = await crypto.subtle.exportKey('raw', pair.publicKey)
  return {
    VAPID_PUBLIC_KEY: b64(publicRaw),
    VAPID_PRIVATE_KEY: privateJwk.d,
    VAPID_SUBJECT: 'mailto:support@pocketgoblin.org',
  }
}

describe('Web Push safety and account isolation', () => {
  it('refuses unsafe push endpoints', () => {
    expect(safePushEndpoint('https://localhost:8443/private')).toBeNull()
    expect(safePushEndpoint('http://fcm.googleapis.com/fcm/send/long-token-aaaaaaaaa')).toBeNull()
    expect(safePushEndpoint('https://fcm.googleapis.com.evil.example/fcm/send/long-token')).toBeNull()
    expect(safePushEndpoint('https://127.0.0.1/xx-xxxxxxxxxxxxxxxxxxx')).toBeNull()
    expect(safePushEndpoint(endpoint)).toBe(endpoint)
  })

  it('requires sign in, is opt-in, and cannot opt another user out', async () => {
    const h = createHarness(await credentials())
    const first = await h.register('push-first@example.com')
    const other = await h.register('push-other@example.com')
    expect((await h.request('/api/push/status')).status).toBe(401)

    const initial = await h.request('/api/push/status', { cookie: first.cookie })
    expect((await initial.json() as { subscribed: boolean }).subscribed).toBe(false)

    const invalid = await h.request('/api/push/subscriptions', {
      cookie: first.cookie,
      body: { endpoint: 'https://localhost/private' },
    })
    expect(invalid.status).toBe(400)

    const subscribed = await h.request('/api/push/subscriptions', {
      cookie: first.cookie,
      body: { endpoint, timezone: 'Australia/Sydney' },
    })
    expect(subscribed.status).toBe(201)
    expect(h.query('SELECT user_id, session_id, timezone FROM push_subscriptions')).toHaveLength(1)
    expect((await (await h.request('/api/push/status', { cookie: first.cookie })).json() as { subscribed: boolean }).subscribed).toBe(true)
    expect((await (await h.request('/api/push/status', { cookie: other.cookie })).json() as { subscribed: boolean }).subscribed).toBe(false)

    const cannotRemove = await h.request('/api/push/subscriptions', {
      method: 'DELETE',
      cookie: other.cookie,
      body: { endpoint },
    })
    expect(cannotRemove.status).toBe(200)
    expect(h.query('SELECT * FROM push_subscriptions')).toHaveLength(1)

    await h.request('/api/push/subscriptions', {
      method: 'DELETE',
      cookie: first.cookie,
      body: { endpoint },
    })
    expect(h.query('SELECT * FROM push_subscriptions')).toHaveLength(0)
  })

  it('deletes subscriptions when the session is revoked', async () => {
    const h = createHarness(await credentials())
    const user = await h.register('push-delete@example.com')
    await h.request('/api/push/subscriptions', {
      cookie: user.cookie,
      body: { endpoint, timezone: 'UTC' },
    })
    h.run('DELETE FROM sessions WHERE user_id = ?', user.id)
    expect(h.query('SELECT * FROM push_subscriptions')).toEqual([])
  })

  it('sends due reminders only once, without personal details, including snoozes', async () => {
    const h = createHarness(await credentials())
    const user = await h.register('push-due@example.com')
    await h.request('/api/push/subscriptions', {
      cookie: user.cookie,
      body: { endpoint, timezone: 'UTC' },
    })
    const now = new Date()
    const due = new Date(now.getTime() - 60_000).toISOString()
    h.run(
      'INSERT INTO reminders(id, user_id, title, remind_at) VALUES (?, ?, ?, ?)',
      'rem_due_push', user.id, 'PRIVATE MEDICAL DETAIL', due,
    )
    const fetcher = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal('fetch', fetcher)
    try {
      expect(await deliverDueReminders(h.env, now)).toBe(1)
      expect(await deliverDueReminders(h.env, now)).toBe(0)
      expect(fetcher).toHaveBeenCalledTimes(1)
      const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe(endpoint)
      expect(options.body).toBeUndefined()
      expect(JSON.stringify(options)).not.toContain('PRIVATE MEDICAL DETAIL')
      expect((options.headers as Record<string, string>).Authorization).toContain('vapid t=')

      const snoozed = new Date(now.getTime() + 60_000).toISOString()
      h.run(
        "UPDATE reminders SET status = 'snoozed', snoozed_until = ? WHERE id = ?",
        snoozed, 'rem_due_push',
      )
      expect(await deliverDueReminders(h.env, new Date(now.getTime() + 120_000))).toBe(1)
      expect(fetcher).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('respects timezone-aware overnight quiet hours', () => {
    const prefs = { quietHoursEnabled: 1, quietHoursStart: '21:00', quietHoursEnd: '08:00' }
    expect(inQuietHours(new Date('2026-10-19T12:00:00Z'), 'Australia/Sydney', prefs)).toBe(true)
    expect(inQuietHours(new Date('2026-10-19T01:00:00Z'), 'Australia/Sydney', prefs)).toBe(false)
    expect(inQuietHours(new Date('2026-10-19T12:00:00Z'), 'UTC', prefs)).toBe(false)
    expect(inQuietHours(new Date('2026-10-19T12:00:00Z'), 'MadeUp/Timezone', prefs)).toBe(true)
  })

  it('does not send any notification when push credentials are missing', async () => {
    const h = createHarness()
    const user = await h.register('push-off@example.com')
    const res = await h.request('/api/push/status', { cookie: user.cookie })
    expect((await res.json() as { configured: boolean }).configured).toBe(false)
    expect((await h.request('/api/push/subscriptions', {
      cookie: user.cookie,
      body: { endpoint },
    })).status).toBe(503)
    expect(await deliverDueReminders(h.env)).toBe(0)
  })
})
