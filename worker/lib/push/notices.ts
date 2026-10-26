/**
 * What to tell someone, and when. Notices store only a kind and a record id
 * or day; the words are written when the person's own device asks for them.
 */
import { parseHm } from '../../../shared/magical/quietHours'
import { healthTablesReady, loadProfile, supplementsToday } from '../health'

export type NoticeKind = 'reminder' | 'morning' | 'evening' | 'message' | 'test'

export type PushPreferences = {
  timezone: string
  remindersEnabled: boolean
  messagesEnabled: boolean
  morningEnabled: boolean
  morningTime: string
  eveningEnabled: boolean
  eveningTime: string
}

export const DEFAULT_PREFERENCES: PushPreferences = {
  timezone: 'UTC',
  remindersEnabled: true,
  messagesEnabled: true,
  morningEnabled: true,
  morningTime: '08:00',
  eveningEnabled: false,
  eveningTime: '20:00',
}

const ready = new WeakSet<D1Database>()

/** False until migration 0026 is applied; push then stays switched off. */
export async function pushTablesReady(db: D1Database): Promise<boolean> {
  if (ready.has(db)) return true
  const row = await db
    .prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'push_notices'",
    )
    .first<{ ok: number }>()
  if (row) ready.add(db)
  return !!row
}

export function validTimezone(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 64) return null
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: value })
    return value
  } catch {
    return null
  }
}

export function validTime(value: unknown): string | null {
  return typeof value === 'string' && parseHm(value) !== null ? value : null
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** The person's local date and minutes since local midnight. */
export function localClock(
  timezone: string,
  now = new Date(),
): { day: string; minutes: number } {
  let fmt = formatters.get(timezone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: validTimezone(timezone) ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timezone, fmt)
  }
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  )
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  }
}

type PrefsRow = {
  timezone: string
  remindersEnabled: number
  messagesEnabled: number
  morningEnabled: number
  morningTime: string
  eveningEnabled: number
  eveningTime: string
}

export const PREFS_SELECT = `timezone, reminders_enabled AS remindersEnabled,
  messages_enabled AS messagesEnabled, morning_enabled AS morningEnabled,
  morning_time AS morningTime, evening_enabled AS eveningEnabled,
  evening_time AS eveningTime`

export function mapPrefs(row: PrefsRow | null): PushPreferences {
  if (!row) return { ...DEFAULT_PREFERENCES }
  return {
    timezone: row.timezone,
    remindersEnabled: !!row.remindersEnabled,
    messagesEnabled: !!row.messagesEnabled,
    morningEnabled: !!row.morningEnabled,
    morningTime: row.morningTime,
    eveningEnabled: !!row.eveningEnabled,
    eveningTime: row.eveningTime,
  }
}

export async function loadPrefs(
  db: D1Database,
  userId: string,
): Promise<PushPreferences> {
  const row = await db
    .prepare(`SELECT ${PREFS_SELECT} FROM push_preferences WHERE user_id = ?`)
    .bind(userId)
    .first<PrefsRow>()
  return mapPrefs(row)
}

const PREF_COLUMNS: Record<keyof PushPreferences, string> = {
  timezone: 'timezone',
  remindersEnabled: 'reminders_enabled',
  messagesEnabled: 'messages_enabled',
  morningEnabled: 'morning_enabled',
  morningTime: 'morning_time',
  eveningEnabled: 'evening_enabled',
  eveningTime: 'evening_time',
}

/** Only checked values reach here; booleans are stored as 0/1. */
export async function savePrefs(
  db: D1Database,
  userId: string,
  patch: Partial<PushPreferences>,
): Promise<PushPreferences> {
  await db
    .prepare('INSERT OR IGNORE INTO push_preferences (user_id) VALUES (?)')
    .bind(userId)
    .run()
  const keys = Object.keys(patch) as (keyof PushPreferences)[]
  if (keys.length) {
    await db
      .prepare(
        `UPDATE push_preferences SET ${keys.map((k) => `${PREF_COLUMNS[k]} = ?`).join(', ')},
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE user_id = ?`,
      )
      .bind(
        ...keys.map((k) => {
          const v = patch[k]
          return typeof v === 'boolean' ? (v ? 1 : 0) : v
        }),
        userId,
      )
      .run()
  }
  return loadPrefs(db, userId)
}

/** Queue a notice for the next delivery run (within a minute). Never throws:
 * a notification must not break the action that caused it. */
export async function enqueueNotice(
  db: D1Database,
  userId: string,
  kind: NoticeKind,
  ref: string,
): Promise<void> {
  try {
    if (!(await pushTablesReady(db))) return
    await db
      .prepare(
        `INSERT OR IGNORE INTO push_notices (user_id, kind, ref)
         SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM push_subscriptions WHERE user_id = ?)`,
      )
      .bind(userId, kind, ref, userId)
      .run()
  } catch (e) {
    console.error('push: could not queue a notice', e)
  }
}

export type ShownNotice = {
  tag: string
  title: string
  body: string
  url: string
  reminderId?: string
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

/** Counts only: lock screens are public, so no task or supplement names. */
async function dayCounts(db: D1Database, userId: string, day: string) {
  const tasks = await db
    .prepare(
      `SELECT SUM(CASE WHEN due_date = ? THEN 1 ELSE 0 END) AS today,
              SUM(CASE WHEN due_date < ? THEN 1 ELSE 0 END) AS overdue
       FROM tasks WHERE user_id = ? AND status = 'open' AND due_date IS NOT NULL`,
    )
    .bind(day, day, userId)
    .first<{ today: number | null; overdue: number | null }>()
  let supplements = 0
  if (
    (await healthTablesReady(db)) &&
    (await loadProfile(db, userId)) !== null
  ) {
    supplements = (await supplementsToday(db, userId, day)).filter(
      (s) => s.taken < s.dosesPerDay,
    ).length
  }
  return {
    today: Number(tasks?.today ?? 0),
    overdue: Number(tasks?.overdue ?? 0),
    supplements,
  }
}

/** The words for one notice, or null when it no longer applies. */
export async function describeNotice(
  db: D1Database,
  user: { id: string; displayName: string },
  notice: { seq: number; kind: NoticeKind; ref: string },
): Promise<ShownNotice | null> {
  const tag = `pg-${notice.kind}-${notice.seq}`
  switch (notice.kind) {
    case 'reminder': {
      const id = notice.ref.split('|')[0]
      const row = await db
        .prepare(
          `SELECT title FROM reminders
           WHERE id = ? AND user_id = ? AND status IN ('pending', 'snoozed')`,
        )
        .bind(id, user.id)
        .first<{ title: string }>()
      if (!row) return null
      return {
        tag,
        title: 'Reminder',
        body: row.title,
        url: '/den',
        reminderId: id,
      }
    }
    case 'morning':
    case 'evening': {
      const c = await dayCounts(db, user.id, notice.ref)
      const bits: string[] = []
      if (c.today) bits.push(`${plural(c.today, 'thing')} due today`)
      if (c.overdue) bits.push(`${c.overdue} waiting from before`)
      if (c.supplements)
        bits.push(`${plural(c.supplements, 'supplement')} still to take`)
      const name = user.displayName.split(' ')[0] || 'there'
      if (notice.kind === 'morning') {
        return {
          tag,
          title: `Morning, ${name}`,
          body: bits.length
            ? `${bits.join(', ')}. One small thing first?`
            : 'Nothing urgent today. Anything on your mind? Tell the Goblin.',
          url: '/den',
        }
      }
      return {
        tag,
        title: 'Evening check-in',
        body: bits.length
          ? `${bits.join(', ')}. Tick off what’s done, or move it to tomorrow.`
          : 'All clear today. Anything for tomorrow? Tell the Goblin.',
        url: '/den',
      }
    }
    case 'message':
      return {
        tag,
        title: 'Goblin HQ replied',
        body: 'Tap to read the reply.',
        url: '/support',
      }
    case 'test':
      return {
        tag,
        title: 'Notifications are on',
        body: 'This is how Pocket Goblin will nudge you.',
        url: '/settings',
      }
  }
}
