import type { CaptureItemKind, Confidence, RecurrenceFrequency } from './types'

export type ParsedCaptureSuggestion = {
  kind: CaptureItemKind
  title: string
  dueDate: string | null
  startTime: string | null
  recurrenceFrequency: RecurrenceFrequency | null
  categorySlug: string | null
  confidence: Confidence
  uncertain: boolean
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function nextWeekday(from: Date, weekday: number, nextWeek = false): Date {
  const result = new Date(from)
  result.setHours(12, 0, 0, 0)
  const current = result.getDay()
  let delta = (weekday - current + 7) % 7
  if (delta === 0 || nextWeek) delta += 7
  result.setDate(result.getDate() + delta)
  return result
}

export function parseRelativeDate(
  text: string,
  now = new Date(),
): string | null {
  const lower = text.toLowerCase()

  // Vague horizons — never invent an exact calendar day
  if (
    /\b(next month|soon|sometime|eventually|later this year|end of (the )?month)\b/.test(
      lower,
    )
  ) {
    return null
  }

  if (/\btoday\b/.test(lower)) return toIsoDate(now)

  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    return toIsoDate(d)
  }

  const nextDay = lower.match(
    /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  )
  if (nextDay?.[1]) {
    return toIsoDate(nextWeekday(now, WEEKDAYS[nextDay[1]]!, true))
  }

  const byDay = lower.match(
    /\bby\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  )
  if (byDay?.[1]) {
    return toIsoDate(nextWeekday(now, WEEKDAYS[byDay[1]]!, false))
  }

  const day = lower.match(
    /\bon\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  )
  if (day?.[1]) {
    return toIsoDate(nextWeekday(now, WEEKDAYS[day[1]]!, false))
  }

  const bareDay = lower.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  )
  if (bareDay?.[1] && !/\bevery\b/.test(lower)) {
    return toIsoDate(nextWeekday(now, WEEKDAYS[bareDay[1]]!, false))
  }

  return null
}

export function parseTime(text: string): string | null {
  const lower = text.toLowerCase()
  const match = lower.match(
    /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b|\b(\d{1,2}):(\d{2})\b/,
  )
  if (!match) return null

  if (match[4] && match[5]) {
    return `${match[4].padStart(2, '0')}:${match[5]}`
  }

  let hour = Number(match[1])
  const minute = match[2] ? Number(match[2]) : 0
  const meridiem = match[3]
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (!meridiem && hour <= 7) hour += 12
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function parseRecurrence(text: string): RecurrenceFrequency | null {
  const lower = text.toLowerCase()
  if (/\bevery\s+day\b|\bdaily\b/.test(lower)) return 'daily'
  if (
    /\bevery\s+fortnight\b|\bfortnightly\b|\bevery\s+2\s+weeks\b/.test(lower)
  ) {
    return 'fortnightly'
  }
  if (/\bevery\s+month\b|\bmonthly\b/.test(lower)) return 'monthly'
  if (/\bevery\s+year\b|\byearly\b|\bannually\b/.test(lower)) return 'yearly'
  if (
    /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(
      lower,
    ) ||
    /\bweekly\b/.test(lower)
  ) {
    return 'weekly'
  }
  return null
}

function detectKind(
  text: string,
  hasTime: boolean,
  recurrence: RecurrenceFrequency | null,
): CaptureItemKind {
  const lower = text.toLowerCase()
  if (
    /\b(add .+ to (the )?shopping|shopping list|buy |need toothpaste|need milk|washing powder|dog food|bread)\b/.test(
      lower,
    ) ||
    (/\b(milk|bread|toothpaste|eggs|apples)\b/.test(lower) &&
      /\b(buy|need|get|pick up)\b/.test(lower))
  ) {
    return 'shopping'
  }
  if (
    /\b(wifi password|password is|note that|just noting|written on)\b/.test(
      lower,
    ) ||
    /\bremember (that )?the\b/.test(lower)
  ) {
    return 'note'
  }
  if (
    /\bremind me\b|\breminder\b|\bdon't forget\b|\bdont forget\b/.test(lower)
  ) {
    return 'reminder'
  }
  if (hasTime || /\b(appointment|meeting|dentist|doctor)\b/.test(lower)) {
    if (hasTime || /\b(appointment|meeting)\b/.test(lower)) {
      return 'appointment'
    }
  }
  if (/\b(follow[- ]?up|reply to|email from)\b/.test(lower)) return 'follow_up'
  if (recurrence) return 'task'
  if (/\b(note|remember that)\b/.test(lower)) return 'note'
  return 'task'
}

function detectCategory(text: string): string | null {
  const lower = text.toLowerCase()
  if (/\b(dentist|doctor|medical|health|gp|hospital)\b/.test(lower)) {
    return 'health'
  }
  if (/\b(bill|electric|rent|money|pay|invoice|bank)\b/.test(lower)) {
    return 'money'
  }
  if (
    /\b(mum|mom|dad|school|kid|child|family|son|daughter|partner)\b/.test(lower)
  ) {
    return 'family'
  }
  if (
    /\b(work|boss|colleague|university|uni|study|assignment|meeting)\b/.test(
      lower,
    )
  ) {
    return 'work_study'
  }
  if (/\b(appointment|dentist)\b/.test(lower)) return 'appointments'
  if (/\b(buy|shopping|grocer|toothpaste|milk|bread)\b/.test(lower)) {
    return 'shopping'
  }
  if (/\b(home|house|bins|bedsheets|landlord|plumber|clean)\b/.test(lower)) {
    return 'home'
  }
  return null
}

function cleanTitle(text: string): string {
  return text
    .replace(
      /^(i\s+need\s+to|i've\s+got|i\s+have\s+to|remember\s+(that\s+)?|remind\s+me\s+to|add\s+|note\s*:?\s*|book\s+)/i,
      (match) => (match.toLowerCase().startsWith('book') ? 'Book ' : ''),
    )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

function expandShoppingBundle(fragment: string): string[] {
  const match = fragment.match(
    /^(?:i\s+)?(?:need\s+to\s+)?(?:get|buy|pick\s+up)\s+(.+)$/i,
  )
  if (!match?.[1]) return [fragment]
  const items = match[1]
    .split(/\s*,\s*|\s+and\s+/i)
    .map((p) => p.trim())
    .filter(Boolean)
  if (items.length <= 1) return [fragment]
  return items.map((item) => `buy ${item}`)
}

function splitThoughts(raw: string): string[] {
  const lower = raw.toLowerCase()

  // "Add milk and bread to the shopping list"
  const shoppingList = lower.match(
    /^(?:add\s+)?(.+?)\s+to\s+(?:the\s+)?shopping(?:\s+list)?\.?$/,
  )
  if (shoppingList?.[1]) {
    return shoppingList[1]
      .split(/\s*,\s*|\s+and\s+/i)
      .map((part) => `buy ${part.trim()}`)
      .filter((part) => part.length > 4)
  }

  // "Need toothpaste, washing powder and dog food."
  if (
    /\b(need|buy|get)\b/.test(lower) &&
    (lower.includes(',') || /\sand\s/.test(lower)) &&
    !/\b(book|meeting|appointment|remind|pay|bill|expire)\b/.test(lower)
  ) {
    const stripped = raw
      .replace(/^(i\s+)?(need|buy|get)\s+/i, '')
      .replace(/\.$/, '')
    const parts = stripped.split(/\s*,\s*|\s+and\s+/i).map((p) => p.trim())
    if (parts.length > 1) {
      return parts.map((p) => `buy ${p}`)
    }
  }

  // Multi-action dump with commas / and:
  // "pay the bill by Thursday, book the dentist, get milk and bread, and remember…"
  if (
    (raw.includes(',') || /\sand\s/i.test(raw)) &&
    !/\bevery\b/i.test(raw) &&
    /\b(pay|book|get|buy|remind|remember|need to)\b/i.test(raw)
  ) {
    const normalized = raw
      .replace(/\.$/, '')
      .replace(/^i\s+need\s+to\s+/i, '')
      .replace(/,\s+and\s+/gi, ', ')
      .replace(/\s+and\s+(?=(remember|remind|book|pay|get|buy)\b)/gi, ', ')
    const clauses = normalized
      .split(/\s*,\s*/)
      .map((part) => part.trim())
      .filter((part) => part.length > 2)
    if (clauses.length > 1) {
      return clauses.flatMap((clause) => expandShoppingBundle(clause))
    }
  }

  // "Book the dentist and buy toothpaste."
  if (/\band\b/i.test(raw) && !/\bevery\b/i.test(raw)) {
    const andParts = raw.split(/\s+and\s+/i).map((p) => p.trim())
    if (andParts.length === 2 && andParts[0] && andParts[1]) {
      return andParts.flatMap((part) => expandShoppingBundle(part))
    }
  }

  return raw
    .split(/(?:\n+|[.!?]\s+|;| and also | also )/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 2)
}

/**
 * Deterministic interpreter — not AI.
 * Never invents dates without recognizable cues.
 */
export function interpretBrainDump(
  rawText: string,
  now = new Date(),
): ParsedCaptureSuggestion[] {
  const text = rawText.trim()
  if (!text) return []

  const parts = splitThoughts(text)
  const chunks = parts.length > 0 ? parts : [text]

  return chunks.map((chunk) => {
    const dueDate = parseRelativeDate(chunk, now)
    const startTime = parseTime(chunk)
    const recurrenceFrequency = parseRecurrence(chunk)
    const kind = detectKind(chunk, Boolean(startTime), recurrenceFrequency)
    const categorySlug = detectCategory(chunk)
    let title = cleanTitle(chunk) || chunk

    if (kind === 'shopping') {
      title = title
        .replace(/^buy\s+/i, '')
        .replace(/\s+to\s+(the\s+)?shopping.*/i, '')
        .trim()
      title = title.replace(/^./, (c) => c.toUpperCase())
    }

    if (kind === 'appointment' && startTime) {
      title = title.replace(/\bat\s+\d{1,2}(?::\d{2})?\s*(am|pm)?/i, '').trim()
    }

    const hasDateCue =
      /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+\w+|every\s+\w+)\b/i.test(
        chunk,
      )
    const hasTimeCue = /\bat\s+\d{1,2}|\b\d{1,2}:\d{2}\b/i.test(chunk)
    const uncertain =
      (hasDateCue && !dueDate && !recurrenceFrequency) ||
      (hasTimeCue && !startTime) ||
      (kind === 'appointment' && !dueDate) ||
      title.length < 2

    let confidence: Confidence = 'medium'
    if ((dueDate || recurrenceFrequency) && (categorySlug || startTime)) {
      confidence = 'high'
    }
    if (uncertain || (!dueDate && !categorySlug && !recurrenceFrequency)) {
      confidence = 'low'
    }
    if (kind === 'shopping' && title.length > 1) confidence = 'high'

    return {
      kind,
      title,
      dueDate,
      startTime,
      recurrenceFrequency,
      categorySlug,
      confidence,
      uncertain,
    }
  })
}
