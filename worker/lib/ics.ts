/**
 * iCalendar (RFC 5545) for phone and desktop calendars: appointments, task
 * due dates and reminders. Titles and places only — never notes or document
 * text — because calendar apps show these on lock screens and sync them to
 * third-party servers.
 */

export type IcsItem =
  | {
      kind: 'event'
      id: string
      title: string
      location: string
      startsAt: string
      endsAt: string
      allDay: boolean
      updatedAt: string
    }
  | {
      kind: 'task'
      id: string
      title: string
      dueDate: string
      priority: string
      updatedAt: string
    }
  | {
      kind: 'reminder'
      id: string
      title: string
      remindAt: string
      updatedAt: string
    }

const DOMAIN = 'pocketgoblin.org'

export function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** Lines longer than 75 octets continue on the next line after a space. */
export function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const out: string[] = []
  let current = ''
  let size = 0
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current)
      current = ''
      size = 0
    }
    current += ch
    size += n
  }
  out.push(current)
  return out.join('\r\n ')
}

const stamp = (iso: string) =>
  iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z?$/, 'Z')

const day = (iso: string) => iso.slice(0, 10).replace(/-/g, '')

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** The calendar date of an instant in a time zone (falls back to UTC). */
export function localDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}

export function isTimeZone(tz: unknown): tz is string {
  if (
    typeof tz !== 'string' ||
    tz.length > 64 ||
    !/^[A-Za-z0-9_+\-/]+$/.test(tz)
  )
    return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function buildCalendar(
  items: IcsItem[],
  options: { timeZone: string; name?: string; now?: Date },
): string {
  const now = stamp((options.now ?? new Date()).toISOString())
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pocket Goblin//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(options.name ?? 'Pocket Goblin')}`,
    `X-WR-TIMEZONE:${options.timeZone}`,
    // Ask subscribed calendars to check back every few hours.
    'REFRESH-INTERVAL;VALUE=DURATION:PT4H',
    'X-PUBLISHED-TTL:PT4H',
  ]
  for (const item of items) {
    lines.push('BEGIN:VEVENT', `UID:${item.kind}-${item.id}@${DOMAIN}`)
    lines.push(`DTSTAMP:${now}`, `LAST-MODIFIED:${stamp(item.updatedAt)}`)
    if (item.kind === 'event') {
      if (item.allDay) {
        const date = localDate(item.startsAt, options.timeZone)
        lines.push(
          `DTSTART;VALUE=DATE:${day(date)}`,
          `DTEND;VALUE=DATE:${day(nextDay(date))}`,
          'TRANSP:TRANSPARENT',
        )
      } else {
        lines.push(
          `DTSTART:${stamp(item.startsAt)}`,
          `DTEND:${stamp(item.endsAt)}`,
        )
      }
      lines.push(`SUMMARY:${escapeText(item.title)}`)
      if (item.location) lines.push(`LOCATION:${escapeText(item.location)}`)
    } else if (item.kind === 'task') {
      lines.push(
        `DTSTART;VALUE=DATE:${day(item.dueDate)}`,
        `DTEND;VALUE=DATE:${day(nextDay(item.dueDate))}`,
        'TRANSP:TRANSPARENT',
        `SUMMARY:${escapeText(`${item.priority === 'high' ? '❗ ' : ''}To do: ${item.title}`)}`,
      )
    } else {
      const end = new Date(
        Date.parse(item.remindAt) + 15 * 60_000,
      ).toISOString()
      lines.push(
        `DTSTART:${stamp(item.remindAt)}`,
        `DTEND:${stamp(end)}`,
        'TRANSP:TRANSPARENT',
        `SUMMARY:${escapeText(`🔔 ${item.title}`)}`,
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeText(item.title)}`,
        'TRIGGER:PT0M',
        'END:VALARM',
      )
    }
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return `${lines.map(fold).join('\r\n')}\r\n`
}

/** What goes in someone's calendar: recent past to two years ahead. */
export async function loadCalendarItems(
  db: D1Database,
  userId: string,
  now = new Date(),
): Promise<IcsItem[]> {
  const from = new Date(now.getTime() - 60 * 86_400_000).toISOString()
  const to = new Date(now.getTime() + 730 * 86_400_000).toISOString()
  const [events, tasks, reminders] = await Promise.all([
    db
      .prepare(
        `SELECT id, title, location, starts_at as startsAt, ends_at as endsAt,
                all_day as allDay, updated_at as updatedAt
         FROM events
         WHERE user_id = ? AND status = 'scheduled' AND starts_at >= ? AND starts_at <= ?
         ORDER BY starts_at LIMIT 1500`,
      )
      .bind(userId, from, to)
      .all(),
    db
      .prepare(
        `SELECT id, title, due_date as dueDate, priority, updated_at as updatedAt
         FROM tasks
         WHERE user_id = ? AND status = 'open' AND due_date IS NOT NULL
           AND due_date >= ? AND due_date <= ?
         ORDER BY due_date LIMIT 1000`,
      )
      .bind(userId, from.slice(0, 10), to.slice(0, 10))
      .all(),
    db
      .prepare(
        `SELECT id, title, COALESCE(snoozed_until, remind_at) as remindAt,
                updated_at as updatedAt
         FROM reminders
         WHERE user_id = ? AND status IN ('pending', 'snoozed')
           AND remind_at >= ? AND remind_at <= ?
         ORDER BY remind_at LIMIT 500`,
      )
      .bind(userId, from, to)
      .all(),
  ])
  type Row = Record<string, unknown>
  const rows = (r: D1Result<Row>) => r.results ?? []
  return [
    ...rows(events as D1Result<Row>).map((r): IcsItem => ({
      kind: 'event',
      id: String(r.id),
      title: String(r.title),
      location: String(r.location ?? ''),
      startsAt: String(r.startsAt),
      endsAt: String(r.endsAt),
      allDay: Boolean(r.allDay),
      updatedAt: String(r.updatedAt),
    })),
    ...rows(tasks as D1Result<Row>).map((r): IcsItem => ({
      kind: 'task',
      id: String(r.id),
      title: String(r.title),
      dueDate: String(r.dueDate).slice(0, 10),
      priority: String(r.priority),
      updatedAt: String(r.updatedAt),
    })),
    ...rows(reminders as D1Result<Row>).map((r): IcsItem => ({
      kind: 'reminder',
      id: String(r.id),
      title: String(r.title),
      remindAt: String(r.remindAt),
      updatedAt: String(r.updatedAt),
    })),
  ]
}
