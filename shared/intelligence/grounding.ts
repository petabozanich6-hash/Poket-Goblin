import { parseRelativeDate, parseTime } from '../brainDump'
import type { RecurrenceFrequency } from '../types'
import type { GoblinSuggestion } from './types'

/**
 * Grounding: every date, time and repeat on a suggestion must be traceable to
 * words the user actually wrote. Anything the model "filled in" is removed and
 * the suggestion is flagged for review instead.
 */

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

const VAGUE_HORIZON =
  /\b(next (week|month|year)|this (week|weekend|month)|soon|sometime|eventually|later this (week|month|year)|end of (the )?(week|month|year))\b/i

const STOP_WORDS = new Set(['a', 'an', 'the', 'my', 'our', 'to', 'some'])

/** Comparable form of a title for duplicate detection. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word && !STOP_WORDS.has(word))
    .join(' ')
}

/**
 * The user's wall-clock "now" as a Date whose UTC fields read as local time.
 * `offsetMinutes` is the browser's `getTimezoneOffset()` (Sydney AEDT = -660).
 * The Worker runs in UTC, so the brain-dump parsers can use it directly.
 */
export function userLocalNow(offsetMinutes: number, now = new Date()): Date {
  const offset =
    Number.isFinite(offsetMinutes) && Math.abs(offsetMinutes) <= 14 * 60
      ? offsetMinutes
      : 0
  return new Date(now.getTime() - offset * 60_000)
}

function squash(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

function contentWords(text: string): string[] {
  return normalizeTitle(text)
    .split(' ')
    .filter((word) => word.length > 2)
}

/**
 * The part of the user's text a suggestion came from. Prefer the model's
 * `sourceReference` when it is a real quote; otherwise the clause with the
 * best word overlap with the title. Returns null when nothing matches — a
 * suggestion without a source may not carry a date.
 */
export function findSourceFragment(
  rawText: string,
  suggestion: Pick<GoblinSuggestion, 'title' | 'sourceReference'>,
): string | null {
  const raw = squash(rawText)
  const clauses = rawText
    .split(/[\n.!?;,]+|\s+and\s+/i)
    .filter((clause) => clause.trim().length > 0)
  const ref = squash(suggestion.sourceReference ?? '')
  // A "quote" of the whole multi-thought dump is no evidence for one item —
  // a date in one thought must not leak onto its neighbours.
  const quotesEverything = ref === raw && clauses.length > 1
  if (ref.length >= 3 && raw.includes(ref) && !quotesEverything) return ref

  const titleWords = contentWords(suggestion.title)
  if (titleWords.length === 0) return null
  let best: { clause: string; score: number } | null = null
  for (const clause of clauses) {
    const words = new Set(contentWords(clause))
    if (words.size === 0) continue
    const hits = titleWords.filter((word) => words.has(word)).length
    const score = hits / titleWords.length
    if (!best || score > best.score) best = { clause: squash(clause), score }
  }
  return best && best.score >= 0.5 ? best.clause : null
}

function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false
  const d = new Date(`${iso}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) /
      86_400_000,
  )
}

/** Does the fragment explicitly name this calendar day (e.g. "14 March", "14/3")? */
function fragmentNamesDate(
  fragment: string,
  iso: string,
  today: string,
): boolean {
  const [year, month, day] = iso.split('-').map(Number) as [
    number,
    number,
    number,
  ]
  const dayPattern = new RegExp(`\\b0?${day}(st|nd|rd|th)?\\b`)

  const monthNamed = Object.entries(MONTHS).some(
    ([name, value]) =>
      value === month && new RegExp(`\\b${name}\\b`).test(fragment),
  )
  const numeric = [...fragment.matchAll(/\b(\d{1,2})[/.-](\d{1,2})\b/g)].some(
    // Australian order: day/month
    (m) => Number(m[1]) === day && Number(m[2]) === month,
  )
  if (!(numeric || (monthNamed && dayPattern.test(fragment)))) return false

  // A stated year must match; an unstated one must be the next occurrence.
  const statedYear = fragment.match(/\b(20\d{2})\b/)
  if (statedYear) return Number(statedYear[1]) === year
  const ahead = daysBetween(today, iso)
  return ahead >= -1 && ahead <= 366
}

/**
 * Keep the model's date only when the fragment supports it.
 * Relative cues ("Friday", "tomorrow") are recalculated deterministically.
 */
export function groundDueDate(
  fragment: string | null,
  proposed: string | null,
  localNow: Date,
): { dueDate: string | null; dropped: boolean } {
  if (!fragment) return { dueDate: null, dropped: proposed !== null }
  if (VAGUE_HORIZON.test(fragment)) {
    return { dueDate: null, dropped: proposed !== null }
  }
  const relative = parseRelativeDate(fragment, localNow)
  if (relative) return { dueDate: relative, dropped: false }
  if (!proposed || !isRealDate(proposed)) {
    return { dueDate: null, dropped: proposed !== null }
  }
  const today = localNow.toISOString().slice(0, 10)
  return fragmentNamesDate(fragment, proposed, today)
    ? { dueDate: proposed, dropped: false }
    : { dueDate: null, dropped: true }
}

/** Every clock time the fragment actually mentions, as HH:mm. */
function mentionedTimes(fragment: string): Set<string> {
  const times = new Set<string>()
  const pad = (h: number, m: number) =>
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  if (/\b(noon|midday)\b/.test(fragment)) times.add('12:00')
  if (/\bmidnight\b/.test(fragment)) times.add('00:00')
  for (const m of fragment.matchAll(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/g,
  )) {
    let hour = Number(m[1])
    const minute = m[2] ? Number(m[2]) : 0
    const pm = m[3]!.startsWith('p')
    if (pm && hour < 12) hour += 12
    if (!pm && hour === 12) hour = 0
    if (hour <= 23 && minute <= 59) times.add(pad(hour, minute))
  }
  for (const m of fragment.matchAll(/\b(?:at\s+)?(\d{1,2}):(\d{2})\b/g)) {
    const hour = Number(m[1])
    const minute = Number(m[2])
    if (hour <= 23 && minute <= 59) {
      times.add(pad(hour, minute))
      if (hour < 12) times.add(pad(hour + 12, minute))
    }
  }
  for (const m of fragment.matchAll(/\bat\s+(\d{1,2})\b(?!\s*[:\d])/g)) {
    const hour = Number(m[1])
    if (hour <= 12) {
      times.add(pad(hour % 12, 0))
      times.add(pad((hour % 12) + 12, 0))
    }
  }
  return times
}

export function groundStartTime(
  fragment: string | null,
  proposed: string | null,
): { startTime: string | null; dropped: boolean } {
  if (!fragment) return { startTime: null, dropped: proposed !== null }
  if (proposed && mentionedTimes(fragment).has(proposed)) {
    return { startTime: proposed, dropped: false }
  }
  const parsed = parseTime(fragment)
  if (parsed) return { startTime: parsed, dropped: false }
  return { startTime: null, dropped: proposed !== null }
}

const RECURRENCE_CUES: Record<
  Exclude<RecurrenceFrequency, 'custom'>,
  RegExp
> = {
  daily: /\b(every\s*day|daily|each day|every (morning|night|evening))\b/,
  weekly:
    /\b(weekly|every week|each week|every (mon|tue|wed|thu|fri|sat|sun)\w*)\b/,
  fortnightly: /\b(fortnight(ly)?|every (2|two|other) weeks?)\b/,
  monthly: /\b(monthly|every month|each month)\b/,
  yearly: /\b(yearly|annual(ly)?|every year|each year)\b/,
}

export function groundRecurrence(
  fragment: string | null,
  proposed: string | null,
): RecurrenceFrequency | null {
  if (!fragment || !proposed) return null
  const cue = RECURRENCE_CUES[proposed as keyof typeof RECURRENCE_CUES]
  return cue && cue.test(fragment) ? (proposed as RecurrenceFrequency) : null
}

function pushUnique(list: string[], value: string) {
  if (!list.includes(value)) list.push(value)
}

/**
 * Ground model suggestions against the user's own words, then merge exact
 * duplicates inside the same dump. Pure — safe to unit test.
 */
export function groundSuggestions(
  suggestions: GoblinSuggestion[],
  rawText: string,
  localNow: Date,
): { suggestions: GoblinSuggestion[]; warnings: string[] } {
  const warnings: string[] = []
  let droppedDates = 0
  const byKey = new Map<string, GoblinSuggestion>()

  for (const original of suggestions) {
    const s: GoblinSuggestion = {
      ...original,
      missingInformation: [...original.missingInformation],
    }
    const fragment = findSourceFragment(rawText, s)
    // Only a verified quote is kept; an unverifiable one proves nothing.
    s.sourceReference = fragment ?? ''

    const due = groundDueDate(fragment, s.dueDate, localNow)
    const time = groundStartTime(fragment, s.startTime)
    s.dueDate = due.dueDate
    s.startTime = time.startTime
    s.recurrenceFrequency = groundRecurrence(fragment, s.recurrenceFrequency)

    if (due.dropped || time.dropped) {
      droppedDates += 1
      s.uncertain = true
      pushUnique(s.missingInformation, 'Exact date needs confirmation')
    }
    if ((s.type === 'appointment' || s.type === 'reminder') && !s.dueDate) {
      s.uncertain = true
      pushUnique(
        s.missingInformation,
        s.type === 'appointment' ? 'Appointment date' : 'Reminder date',
      )
    }
    if (s.uncertain) s.confidence = 'low'

    const key = `${s.type}:${normalizeTitle(s.title)}`
    const existing = byKey.get(key)
    if (existing) {
      // Same thought listed twice — keep one, never lose a grounded date.
      existing.dueDate = existing.dueDate ?? s.dueDate
      existing.startTime = existing.startTime ?? s.startTime
      for (const info of s.missingInformation) {
        pushUnique(existing.missingInformation, info)
      }
      continue
    }
    byKey.set(key, s)
  }

  const merged = suggestions.length - byKey.size
  if (droppedDates > 0) {
    warnings.push(
      `Removed ${droppedDates} date${droppedDates === 1 ? '' : 's'} that ${droppedDates === 1 ? "wasn't" : "weren't"} in what you wrote — confirm before accepting.`,
    )
  }
  if (merged > 0) {
    warnings.push(
      `Merged ${merged} repeated suggestion${merged === 1 ? '' : 's'}.`,
    )
  }

  // Unique, stable ids for the review list
  const out = [...byKey.values()].map((s, index) => ({
    ...s,
    id: `sug_${index}_${normalizeTitle(s.title).replace(/\s+/g, '_').slice(0, 24)}`,
  }))
  return { suggestions: out, warnings }
}

/**
 * Safety net for multi-thought dumps: any thought the rule engine found that
 * the model skipped is added back (flagged for review), so nothing the user
 * wrote silently disappears.
 */
export function addMissedThoughts(
  aiSuggestions: GoblinSuggestion[],
  ruleSuggestions: GoblinSuggestion[],
): { suggestions: GoblinSuggestion[]; added: number } {
  const covered = aiSuggestions.map(
    (s) => new Set(contentWords(`${s.title} ${s.sourceReference}`)),
  )
  const additions: GoblinSuggestion[] = []
  for (const rule of ruleSuggestions) {
    // The rule engine's generic follow-up offer is not a user thought.
    if (rule.type === 'follow_up') continue
    const words = contentWords(rule.title)
    if (words.length === 0) continue
    const isCovered = covered.some(
      (set) =>
        words.filter((word) => set.has(word)).length / words.length >= 0.5,
    )
    if (isCovered) continue
    additions.push({
      ...rule,
      uncertain: true,
      confidence: 'low',
      missingInformation: [
        ...rule.missingInformation,
        'The AI skipped this part — check it',
      ],
    })
  }
  return {
    suggestions: [...aiSuggestions, ...additions],
    added: additions.length,
  }
}
