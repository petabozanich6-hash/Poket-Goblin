/**
 * The once-a-minute delivery run: find what's due, then wake each of the
 * person's devices with an empty push. Kept small for the Worker's limits:
 * a handful of queries and at most MAX_SENDS pushes per run; anything left
 * over goes out the next minute.
 */
import type { Env } from '../../env'
import { isInQuietHours, parseHm } from '../../../shared/magical/quietHours'
import { loadSettings } from '../settings'
import { localClock, pushTablesReady, type NoticeKind } from './notices'
import { loadVapid, sendEmptyPush } from './vapid'

/** The Cron Trigger in wrangler.toml that runs delivery every minute. */
export const PUSH_CRON = '* * * * *'

const MAX_SENDS = 40
/** A reminder or check-in missed by more than this is stale, not news. */
const STALE_MS = 60 * 60_000
/** Check-ins go out within this many minutes after the chosen time. */
const CHECKIN_WINDOW_MIN = 30
/** On a first run, don't announce reminders that were due long ago. */
const REMINDER_LOOKBACK_MS = 15 * 60_000
/** A reply held over quiet hours still goes out, but not days later. */
const MESSAGE_MAX_AGE_MS = 24 * 3_600_000

export type PushTickResult = {
  skipped?: 'not_ready' | 'not_configured'
  queued: number
  sent: number
  gone: number
  failed: number
}

export async function runPushTick(
  env: Env,
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<PushTickResult> {
  const result: PushTickResult = { queued: 0, sent: 0, gone: 0, failed: 0 }
  const db = env.DB
  if (!(await pushTablesReady(db))) return { ...result, skipped: 'not_ready' }
  const vapid = await loadVapid(env)
  if (!vapid) return { ...result, skipped: 'not_configured' }
  const nowIso = now.toISOString()

  // 1. Reminders that just came due (or a snooze that just ran out).
  const reminders = await db
    .prepare(
      `INSERT OR IGNORE INTO push_notices (user_id, kind, ref)
       SELECT user_id, 'reminder', id || '|' || due FROM (
         SELECT r.id, r.user_id,
                CASE WHEN r.status = 'snoozed' THEN r.snoozed_until ELSE r.remind_at END AS due
         FROM reminders r
         JOIN push_preferences p ON p.user_id = r.user_id AND p.reminders_enabled = 1
         WHERE r.status IN ('pending', 'snoozed')
           AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = r.user_id)
       ) WHERE due IS NOT NULL AND due <= ? AND due > ?`,
    )
    .bind(nowIso, new Date(now.getTime() - REMINDER_LOOKBACK_MS).toISOString())
    .run()
  result.queued += reminders.meta.changes ?? 0

  // 2. Morning and evening check-ins, at each person's own local time.
  const { results: people } = await db
    .prepare(
      `SELECT user_id AS userId, timezone, morning_enabled AS morningEnabled,
              morning_time AS morningTime, evening_enabled AS eveningEnabled,
              evening_time AS eveningTime
       FROM push_preferences p
       WHERE (morning_enabled = 1 OR evening_enabled = 1)
         AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = p.user_id)`,
    )
    .all<{
      userId: string
      timezone: string
      morningEnabled: number
      morningTime: string
      eveningEnabled: number
      eveningTime: string
    }>()
  const checkins: D1PreparedStatement[] = []
  for (const p of people ?? []) {
    const clock = localClock(p.timezone, now)
    const due = (time: string) => {
      const at = parseHm(time)
      return (
        at !== null &&
        clock.minutes >= at &&
        clock.minutes < at + CHECKIN_WINDOW_MIN
      )
    }
    for (const kind of ['morning', 'evening'] as const) {
      const on = kind === 'morning' ? p.morningEnabled : p.eveningEnabled
      const time = kind === 'morning' ? p.morningTime : p.eveningTime
      if (on && due(time)) {
        checkins.push(
          db
            .prepare(
              'INSERT OR IGNORE INTO push_notices (user_id, kind, ref) VALUES (?, ?, ?)',
            )
            .bind(p.userId, kind, clock.day),
        )
      }
    }
  }
  if (checkins.length) {
    for (const r of await db.batch(checkins))
      result.queued += r.meta.changes ?? 0
  }

  // 3. Wake devices for everything not yet announced.
  const { results: pending } = await db
    .prepare(
      `SELECT n.seq, n.user_id AS userId, n.kind, n.created_at AS createdAt,
              p.timezone, p.messages_enabled AS messagesEnabled
       FROM push_notices n
       LEFT JOIN push_preferences p ON p.user_id = n.user_id
       WHERE n.pushed_at IS NULL
       ORDER BY n.seq LIMIT 200`,
    )
    .all<{
      seq: number
      userId: string
      kind: NoticeKind
      createdAt: string
      timezone: string | null
      messagesEnabled: number | null
    }>()

  const skip: number[] = []
  const byUser = new Map<string, { seqs: number[]; urgent: boolean }>()
  for (const n of pending ?? []) {
    const age = now.getTime() - new Date(n.createdAt).getTime()
    if (n.kind === 'message') {
      if (n.messagesEnabled === 0 || age > MESSAGE_MAX_AGE_MS) {
        skip.push(n.seq)
        continue
      }
      // A reply can wait until morning; a reminder the person set cannot.
      const settings = await loadSettings(db, n.userId)
      const clock = localClock(n.timezone ?? 'UTC', now)
      if (
        isInQuietHours(
          clock.minutes,
          settings.quietHoursStart,
          settings.quietHoursEnd,
          settings.quietHoursEnabled,
        )
      )
        continue
    } else if (age > STALE_MS) {
      skip.push(n.seq)
      continue
    }
    const entry = byUser.get(n.userId) ?? { seqs: [], urgent: false }
    entry.seqs.push(n.seq)
    if (n.kind === 'reminder') entry.urgent = true
    byUser.set(n.userId, entry)
  }

  const devices = new Map<string, string[]>()
  if (byUser.size) {
    const users = [...byUser.keys()]
    const { results } = await db
      .prepare(
        `SELECT s.user_id AS userId, s.endpoint FROM push_subscriptions s
         JOIN sessions se ON se.id = s.session_id
         WHERE se.expires_at > ? AND s.user_id IN (${users.map(() => '?').join(',')})`,
      )
      .bind(nowIso, ...users)
      .all<{ userId: string; endpoint: string }>()
    for (const r of results ?? [])
      devices.set(r.userId, [...(devices.get(r.userId) ?? []), r.endpoint])
  }

  // Claim before sending, so a device that asks straight away sees them.
  const sends: { endpoint: string; urgent: boolean }[] = []
  const claimed: number[] = []
  for (const [userId, entry] of byUser) {
    const endpoints = devices.get(userId) ?? []
    if (sends.length + endpoints.length > MAX_SENDS && sends.length) break
    claimed.push(...entry.seqs)
    for (const endpoint of endpoints)
      sends.push({ endpoint, urgent: entry.urgent })
  }
  const mark = [...skip, ...claimed]
  if (mark.length) {
    await db
      .prepare(
        `UPDATE push_notices SET pushed_at = ? WHERE seq IN (${mark.map(() => '?').join(',')})`,
      )
      .bind(nowIso, ...mark)
      .run()
  }

  // 4. Sessions that ran out: one last wake, which shows "sign back in",
  // then forget the device. (Signing out deletes it straight away.)
  const room = Math.max(0, MAX_SENDS - sends.length)
  const expired = room
    ? ((
        await db
          .prepare(
            `SELECT s.endpoint FROM push_subscriptions s
             JOIN sessions se ON se.id = s.session_id
             WHERE se.expires_at <= ? LIMIT ?`,
          )
          .bind(nowIso, room)
          .all<{ endpoint: string }>()
      ).results ?? [])
    : []

  const gone: string[] = []
  const outcomes = await Promise.all([
    ...sends.map((s) =>
      sendEmptyPush(
        vapid,
        s.endpoint,
        s.urgent ? 'high' : 'normal',
        fetchImpl,
      ).then((r) => ({ endpoint: s.endpoint, r })),
    ),
    ...expired.map((e) =>
      sendEmptyPush(vapid, e.endpoint, 'normal', fetchImpl).then(() => ({
        endpoint: e.endpoint,
        r: 'gone' as const,
      })),
    ),
  ])
  for (const { endpoint, r } of outcomes) {
    if (r === 'gone') gone.push(endpoint)
    else if (r === 'sent') result.sent++
    else result.failed++
  }
  if (gone.length) {
    await db
      .prepare(
        `DELETE FROM push_subscriptions WHERE endpoint IN (${gone.map(() => '?').join(',')})`,
      )
      .bind(...gone)
      .run()
    result.gone = gone.length
  }
  return result
}

/** Hourly: notices are only needed until each device has fetched them. */
export async function sweepPushNotices(env: Env, now = new Date()) {
  if (!(await pushTablesReady(env.DB))) return
  await env.DB.prepare('DELETE FROM push_notices WHERE created_at < ?')
    .bind(new Date(now.getTime() - 3 * 86_400_000).toISOString())
    .run()
}
