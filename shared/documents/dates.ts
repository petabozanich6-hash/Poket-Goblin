/**
 * Find dates in document text, worldwide.
 *
 * - "2026-10-28", "28 October 2026", "28th Oct", "October 28, 2026",
 *   "Tuesday 28 October" are unambiguous.
 * - Numeric "03/04/2026" is ambiguous (3 April or March 4). If one part is
 *   over 12 the order is certain; otherwise the reader's locale decides the
 *   guess and the date is flagged for confirmation.
 * - A missing year means the next occurrence on or after the reference date.
 * Never invents a date that is not written in the text.
 */

export type FoundDate = {
  iso: string
  /** The exact words in the document. */
  text: string
  index: number
  /** True when the user should confirm (ambiguous order, no year, …). */
  uncertain: boolean
  reason: string | null
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}
const MONTH_NAMES = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join('|')

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function valid(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

function fullYear(y: string): number {
  const n = Number(y)
  return y.length === 2 ? 2000 + n : n
}

/** Next occurrence of day/month on or after the reference date. */
function withoutYear(m: number, d: number, reference: Date): string | null {
  const y = reference.getUTCFullYear()
  const today = reference.toISOString().slice(0, 10)
  const thisYear = valid(y, m, d)
  if (thisYear && thisYear >= today) return thisYear
  return valid(y + 1, m, d)
}

export type DateOptions = {
  /** Today in the user's time zone (UTC date parts are used). */
  reference: Date
  /** True for locales that write month first (e.g. en-US). */
  monthFirst?: boolean
}

export function findDates(text: string, options: DateOptions): FoundDate[] {
  const found: FoundDate[] = []
  const taken: [number, number][] = []
  const overlaps = (start: number, end: number) =>
    taken.some(([s, e]) => start < e && end > s)
  const add = (
    match: RegExpExecArray,
    date: Omit<FoundDate, 'text' | 'index'> | null,
  ) => {
    if (!date) return
    const start = match.index
    const end = start + match[0].length
    if (overlaps(start, end)) return
    taken.push([start, end])
    found.push({ ...date, text: match[0].trim(), index: start })
  }

  // 2026-10-28
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    const iso = valid(Number(m[1]), Number(m[2]), Number(m[3]))
    add(m, iso ? { iso, uncertain: false, reason: null } : null)
  }

  // 28 October 2026 / 28th Oct / Tuesday, 28 October
  const dayFirst = new RegExp(
    `\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_NAMES})\\.?,?(?:\\s+(\\d{4}))?\\b`,
    'gi',
  )
  for (const m of text.matchAll(dayFirst)) {
    const month = MONTHS[m[2]!.toLowerCase()]!
    const day = Number(m[1])
    const iso = m[3]
      ? valid(Number(m[3]), month, day)
      : withoutYear(month, day, options.reference)
    add(
      m,
      iso
        ? { iso, uncertain: !m[3], reason: m[3] ? null : 'No year given' }
        : null,
    )
  }

  // October 28, 2026 / Oct 28th
  const monthFirst = new RegExp(
    `\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?\\b`,
    'gi',
  )
  for (const m of text.matchAll(monthFirst)) {
    const month = MONTHS[m[1]!.toLowerCase()]!
    const day = Number(m[2])
    const iso = m[3]
      ? valid(Number(m[3]), month, day)
      : withoutYear(month, day, options.reference)
    add(
      m,
      iso
        ? { iso, uncertain: !m[3], reason: m[3] ? null : 'No year given' }
        : null,
    )
  }

  // 28/10/2026, 10/28/26, 28.10.2026
  for (const m of text.matchAll(
    /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/g,
  )) {
    const a = Number(m[1])
    const b = Number(m[2])
    const y = fullYear(m[3]!)
    let iso: string | null
    let uncertain = false
    let reason: string | null = null
    if (a > 12) iso = valid(y, b, a)
    else if (b > 12) iso = valid(y, a, b)
    else if (a === b) iso = valid(y, a, b)
    else {
      iso = options.monthFirst ? valid(y, a, b) : valid(y, b, a)
      uncertain = true
      reason = `“${m[0]}” could be read two ways`
    }
    add(m, iso ? { iso, uncertain, reason } : null)
  }

  return found.sort((x, y) => x.index - y.index)
}

/** Words that mark a deadline or the date something happens. */
const CUES: { kind: 'due' | 'event'; pattern: RegExp }[] = [
  {
    kind: 'due',
    pattern:
      /\b(due(?:\s+date)?|pay(?:ment)?\s+(?:due|by)|pay\s+before|deadline|respond\s+by|reply\s+by|return\s+(?:by|before)|submit\s+(?:by|before)|must\s+be\s+(?:paid|received|returned)\s+by|expires?|renewal\s+date|by\s+no\s+later\s+than)\b/i,
  },
  {
    kind: 'event',
    pattern:
      /\b(appointment|you\s+are\s+booked|booked\s+(?:in\s+)?for|please\s+attend|scheduled\s+for|interview|consultation|on\s+the\s+day|date\s+of\s+(?:the\s+)?(?:visit|event|excursion|hearing))\b/i,
  },
]

/**
 * The date that follows a cue word most closely (within ~80 characters), or
 * null. Lets "Payment due: 28 October" win over the statement date.
 */
export function dateAfterCue(
  text: string,
  dates: FoundDate[],
  kind: 'due' | 'event',
): FoundDate | null {
  let best: { date: FoundDate; distance: number } | null = null
  for (const cue of CUES.filter((c) => c.kind === kind)) {
    const re = new RegExp(cue.pattern.source, 'gi')
    for (const m of text.matchAll(re)) {
      const end = m.index + m[0].length
      for (const date of dates) {
        const distance = date.index - end
        if (
          distance >= 0 &&
          distance <= 80 &&
          (!best || distance < best.distance)
        ) {
          best = { date, distance }
        }
      }
    }
  }
  return best?.date ?? null
}

/** HH:mm for the first clear time near an index ("10:30am", "2.15 pm", "14:00"). */
export function timeNear(text: string, index: number): string | null {
  const window = text.slice(Math.max(0, index - 40), index + 120)
  const m = window.match(
    /\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b|\b(\d{1,2}):(\d{2})\b/i,
  )
  if (!m) return null
  let hour: number
  let minute: number
  if (m[3]) {
    hour = Number(m[1]) % 12
    minute = Number(m[2] ?? '0')
    if (/^p/i.test(m[3])) hour += 12
  } else {
    hour = Number(m[4])
    minute = Number(m[5])
  }
  if (hour > 23 || minute > 59) return null
  return `${pad(hour)}:${pad(minute)}`
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
