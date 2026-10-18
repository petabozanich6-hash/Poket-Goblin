import type { Env } from '../env'

/**
 * RFC 8292 VAPID + payload-free RFC 8030 Web Push.
 * Push services only see an opaque device endpoint and a generic wakeup;
 * they never see the customer's task titles, message bodies, or account data.
 * A service worker MUST display a user-visible notification on every push.
 */
type Channel = 'reminders' | 'messages'
type Device = { endpoint: string; timezone: string }
type ClockSettings = {
  quietHoursEnabled: number
  quietHoursStart: string
  quietHoursEnd: string
}

const ALLOWED_HOSTS = new Set([
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'push.services.mozilla.com',
])

export function safePushEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 2048 || raw.length < 40) return null
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    const apple = host === 'push.apple.com' || host.endsWith('.push.apple.com')
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !(ALLOWED_HOSTS.has(host) || apple)
    ) return null
    return url.href
  } catch {
    return null
  }
}

function decodeB64url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

function encodeB64url(bytes: Uint8Array): string {
  let result = ''
  for (const byte of bytes) result += String.fromCharCode(byte)
  return btoa(result).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function validVapid(env: Env): boolean {
  try {
    const publicKey = decodeB64url(env.VAPID_PUBLIC_KEY ?? '')
    const privateKey = decodeB64url(env.VAPID_PRIVATE_KEY ?? '')
    const subject = env.VAPID_SUBJECT ?? ''
    return publicKey.length === 65 && publicKey[0] === 4 &&
      privateKey.length === 32 &&
      (subject.startsWith('mailto:') || subject.startsWith('https://'))
  } catch { return false }
}

export function pushConfigured(env: Env): boolean {
  return validVapid(env)
}

async function vapidToken(env: Env, audience: string): Promise<string> {
  const publicKey = decodeB64url(env.VAPID_PUBLIC_KEY!)
  const x = encodeB64url(publicKey.slice(1, 33))
  const y = encodeB64url(publicKey.slice(33, 65))
  const key = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x, y, d: env.VAPID_PRIVATE_KEY!, ext: false,
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = encodeB64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const payload = encodeB64url(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: env.VAPID_SUBJECT,
  })))
  const input = header + '.' + payload
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input))
  return input + '.' + encodeB64url(new Uint8Array(signature))
}

export function inQuietHours(now: Date, zone: string, settings: ClockSettings): boolean {
  if (!settings.quietHoursEnabled) return false
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now)
    const h = Number(parts.find((p) => p.type === 'hour')?.value)
    const m = Number(parts.find((p) => p.type === 'minute')?.value)
    const current = h * 60 + m
    const [sh, sm] = settings.quietHoursStart.split(':').map(Number)
    const [eh, em] = settings.quietHoursEnd.split(':').map(Number)
    const start = sh * 60 + sm
    const end = eh * 60 + em
    if (start === end) return false
    return start < end ? current >= start && current < end : current >= start || current < end
  } catch { return true } // Unknown timezone: fail quietly instead of waking anyone.
}

async function sendEmptyPush(env: Env, endpoint: string): Promise<'sent' | 'gone' | 'failed'> {
  const safe = safePushEndpoint(endpoint)
  if (!safe || !pushConfigured(env)) return 'failed'
  try {
    const origin = new URL(safe).origin
    const jwt = await vapidToken(env, origin)
    const response = await fetch(safe, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
        TTL: '3600',
        Urgency: 'normal',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (response.status === 404 || response.status === 410) return 'gone'
    return response.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

async function devices(db: D1Database, userId: string, channel: Channel, now: string): Promise<Device[]> {
  const column = channel === 'reminders' ? 'reminders_enabled' : 'messages_enabled'
  const result = await db.prepare(
    `SELECT p.endpoint, p.timezone FROM push_subscriptions p
      JOIN sessions s ON s.id = p.session_id AND s.user_id = p.user_id
      JOIN users u ON u.id = p.user_id AND u.status = 'active'
      WHERE p.user_id = ? AND p.${column} = 1 AND s.expires_at > ?
      ORDER BY p.updated_at DESC LIMIT 5`
  ).bind(userId, now).all<Device>()
  return result.results ?? []
}

async function deliver(env: Env, userId: string, channel: Channel, clock: Date): Promise<boolean> {
  const targets = await devices(env.DB, userId, channel, clock.toISOString())
  if (!targets.length) return false
  const settings = await env.DB.prepare(
    'SELECT quiet_hours_enabled as quietHoursEnabled, quiet_hours_start as quietHoursStart, quiet_hours_end as quietHoursEnd FROM user_settings WHERE user_id = ?'
  ).bind(userId).first<ClockSettings>()
  let success = false
  for (const device of targets) {
    if (settings && inQuietHours(clock, device.timezone, settings)) continue
    const result = await sendEmptyPush(env, device.endpoint)
    if (result === 'sent') success = true
    if (result === 'gone') {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
        .bind(device.endpoint, userId).run()
    }
  }
  return success
}

/** User-visible generic notification; used after a confirmed HQ reply. */
export async function pushForUser(env: Env, userId: string, channel: Channel): Promise<void> {
  if (!pushConfigured(env)) return
  await deliver(env, userId, channel, new Date())
}

/** Called by a 5-minute Cron Trigger, not by a browser polling loop. */
export async function deliverDueReminders(env: Env, now = new Date()): Promise<number> {
  if (!pushConfigured(env)) return 0
  const stamp = now.toISOString()
  const recent = new Date(now.getTime() - 24 * 3600_000).toISOString()
  const due = await env.DB.prepare(
    `SELECT r.id, r.user_id AS userId,
            CASE WHEN r.status = 'snoozed' THEN r.snoozed_until ELSE r.remind_at END AS dueAt
     FROM reminders r WHERE r.status IN ('pending', 'snoozed')
       AND (CASE WHEN r.status = 'snoozed' THEN r.snoozed_until ELSE r.remind_at END) BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM push_reminder_deliveries d
           WHERE d.reminder_id = r.id AND d.due_at =
             (CASE WHEN r.status = 'snoozed' THEN r.snoozed_until ELSE r.remind_at END))
       AND EXISTS (SELECT 1 FROM push_subscriptions p JOIN sessions s ON s.id = p.session_id
         WHERE p.user_id = r.user_id AND p.reminders_enabled = 1 AND s.expires_at > ?)
     ORDER BY dueAt ASC LIMIT 60`
  ).bind(recent, stamp, stamp).all<{ id: string; userId: string; dueAt: string }>()
  let count = 0
  for (const reminder of due.results ?? []) {
    const sent = await deliver(env, reminder.userId, 'reminders', now)
    if (sent) {
      await env.DB.prepare(
        'INSERT OR IGNORE INTO push_reminder_deliveries (reminder_id, due_at) VALUES (?, ?)'
      ).bind(reminder.id, reminder.dueAt).run()
      count += 1
    }
  }
  return count
}
