/**
 * The deadline planner: for any document (a course outline, a tax letter, a
 * grant guideline, a work brief, a visa checklist), find every deadline,
 * notice what's urgent, and plan the steps back from each date so the person
 * never has to work out "when do I start?".
 *
 * Deterministic and grounded: every date comes from the text (or, for
 * "within 14 days", from today plus the number written), and nothing is
 * added without the person's OK.
 */
import type { DocumentSuggestion } from './understand'
import { addDays, findDates, timeNear, type FoundDate } from './dates'

export type DeadlineKind =
  'work' | 'exam' | 'payment' | 'form' | 'event' | 'deadline'

export type Deadline = {
  label: string
  iso: string
  time: string | null
  kind: DeadlineKind
  /** Percentage of a grade, when written ("30%"). */
  weight: number | null
  urgent: boolean
  overdue: boolean
  uncertain: boolean
  reason: string | null
  excerpt: string
  /** Where the date was written in the text. */
  index: number
}

export type DeadlinePlan = {
  deadlines: Deadline[]
  suggestions: DocumentSuggestion[]
  summary: string
  warnings: string[]
}

const MAX_DEADLINES = 24
const MAX_SUGGESTIONS = 80

const CUE =
  /\b(due|deadline|submit|submission|lodge(?:ment)?|hand(?:ed)?\s+in|return(?:ed)?\s+(?:by|before)|closes?|closing\s+date|no\s+later\s+than|before|by|exam(?:ination)?s?|tests?|quiz(?:zes)?|assessments?|assignments?|essays?|reports?|presentations?|projects?|proposals?|portfolios?|thesis|applications?|apply|renew(?:al)?|expir(?:es|y|ation)|pay(?:ment)?|invoice|reply|respond|rsvp|enrol(?:ment)?|register|registration|meeting|hearing|interview|orientation|census\s+date|milestone|review)\b/i

/** Dates that only say when the paper was written or printed. */
const NOT_A_DEADLINE =
  /\b(date\s+of\s+(?:issue|this\s+letter)|issued?|printed|dated|published|statement\s+date|invoice\s+date|letter\s+date|last\s+updated|version|©|copyright|born|date\s+of\s+birth|dob)\b/i

/** Browser print headers/footers and "Date: …" lines say when it was printed. */
const PRINT_LINE =
  /^(?:\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}|(?:date|printed|issued|dated|generated|created|downloaded|last\s+(?:updated|modified))\b)/i

/** Things worth a calendar entry even when only the week is written. */
const WEEK_ONLY_CUE =
  /\b(assessment\s*\d+[^\n]{0,40}?\b(?:due|exam|test|quiz)|exam(?:ination)?\b(?!\s+(?:preparation|prep|period|discussion|revision|timetable|information|info|support|paper|will|is|unit))|census\s+(?:day|date)|due\b)/i

const URGENT =
  /\b(urgent(?:ly)?|immediately|as\s+soon\s+as\s+possible|asap|straight\s+away|right\s+away|without\s+delay|final\s+(?:notice|reminder|demand)|overdue|time[-\s]sensitive|act\s+now|high\s+priority)\b/i

/** "If you need urgent support…": information, not something to do. */
const URGENT_NOT_TASK =
  /\b(if\s+you|in\s+case|for\s+urgent|urgent\s+(?:support|help|care|assistance|enquir(?:y|ies)|quer(?:y|ies)|matters?)|crisis|emergenc(?:y|ies))\b/i

const WEEKDAY =
  /\b(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b,?/gi

function lineAround(
  text: string,
  index: number,
): { line: string; start: number } {
  const start = text.lastIndexOf('\n', index - 1) + 1
  const endAt = text.indexOf('\n', index)
  const end = endAt < 0 ? text.length : endAt
  const full = text.slice(start, end)
  // The sentence holding the date: "Lodge your tax return by 30 October."
  const rel = index - start
  const head = full.slice(0, rel)
  const boundary = [...head.matchAll(/[.!?]\s+(?=[A-Z0-9“"'(])/g)].pop()
  const sStart = boundary ? boundary.index + boundary[0].length : 0
  const tail = full.slice(rel).search(/[.!?](?:\s+[A-Z“"'(]|\s*$)/)
  const sEnd = tail >= 0 ? rel + tail + 1 : full.length
  const raw = full.slice(sStart, sEnd)
  const lead = raw.length - raw.trimStart().length
  return { line: raw.trim(), start: start + sStart + lead }
}

const IMPERATIVE =
  /^(lodge|pay|submit|send|return|apply|complete|renew|book|reply|respond|register|enrol|sign|fill|call|phone|email|finish|write|prepare|hand|upload|attend|collect|update|provide|request|contact|bring|organise|organize|arrange|confirm|cancel|check)\b/i

/** Plain to-do wording: drop greetings, "please", "you must", urgency words. */
function cleanPhrase(s: string): string {
  return s
    .replace(/^(?:(?:hi|hello|dear)\s+[^,]{1,40},\s*)/i, '')
    .replace(new RegExp(URGENT.source, 'gi'), ' ')
    .replace(
      /^\W*(?:reminder|important|notice|note|action\s+required)\b\W*/i,
      '',
    )
    .replace(
      /^\s*(?:please\s+|kindly\s+|you\s+(?:must|need\s+to|will\s+need\s+to|should|are\s+required\s+to)\s+|we\s+need\s+you\s+to\s+)+/i,
      '',
    )
    .replace(/\bplease\s+/gi, '')
    .replace(
      /\s+(?:to\s+avoid|otherwise|in\s+order\s+to|so\s+that|so\s+we\s+can|or\s+(?:you|we|else|a\s+(?:late|penalty))|failure\s+to|if\s+you\s+(?:do\s+not|don’t|don't))\b.*$/i,
      '',
    )
    .replace(
      /(?:\s+(?:back|in|off|of|and|or|the|a|an|to|for|with|is|are|was|were|will\s+be|must\s+be|should\s+be|has|have))+\s*$/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
}

function shorten(s: string, max = 60): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/** "Essay 1 (30%) — due Friday 14 March 2026 at 5pm" → "Essay 1". */
function labelFrom(line: string, dates: FoundDate[]): string {
  let s = line
  for (const d of dates) s = s.split(d.text).join(' ')
  s = s
    .replace(/(?:\p{Extended_Pictographic}|[\u2190-\u2BFF]|\uFE0F)/gu, ' ')
    // Pieces of a date split over lines ("02 November" / "2026").
    .replace(
      /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/gi,
      ' ',
    )
    .replace(
      /\b(?:january|february|march|april|june|july|august|september|october|november|december)\b/gi,
      ' ',
    )
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .replace(/\(?\s*click\s+(?:link|here)\s*\)?/gi, ' ')
    .replace(WEEKDAY, ' ')
    .replace(/\b\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)/gi, ' ')
    .replace(/\b\d{1,2}:\d{2}\b/g, ' ')
    .replace(/\(?\b\d{1,3}\s?%\)?/g, ' ')
    .replace(/\bweek\s+\d{1,2}\b/gi, ' ')
    .replace(
      /\b(?:is\s+|are\s+)?(?:due(?:\s+date)?|deadline|submission\s+date|closing\s+date|closes?|no\s+later\s+than|must\s+be\s+(?:submitted|returned|paid|received|lodged)|to\s+be\s+(?:submitted|returned|paid)|on\s+or\s+before|before|by|on|at|from|until|midnight|noon|aest|aedt|gmt|utc|bst|est|pst)\b/gi,
      ' ',
    )
    .replace(/[•▪●·*|–—:;,()[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-.]+|[\s\-.!?]+$/g, '')
  s = cleanPhrase(s.replace(/\s+exam(?:ination)?\s+period\b/i, '')).replace(
    /[\s\-.!?]+$/g,
    '',
  )
  // A week number left at the start of a schedule row ("13 Assessment…").
  s = s.replace(/^\d{1,2}\s+(?=\D)/, '')
  if (
    /^(?:the|a|an|and|or|of|for|date|dates?|due|please|your|our|\d+|week\s+commencing.*|week)?$/i.test(
      s,
    )
  )
    return ''
  return cap(shorten(s))
}

function kindOf(text: string): DeadlineKind {
  if (
    /\b(exam(?:ination)?s?|tests?|quiz(?:zes)?|viva|mid-?semester|in-?class\s+assessment)\b/i.test(
      text,
    )
  )
    return 'exam'
  if (
    /\b(pay(?:ment)?|invoice|fees?|premium|fine|bill|balance|instal?lment)\b/i.test(
      text,
    )
  )
    return 'payment'
  if (
    /\b(meeting|hearing|interview|orientation|ceremony|graduation|appointment|excursion|induction|workshop|class|lecture|seminar|conference|court|tutorial|session|drop-?in|briefing|webinar|meet\s*&\s*greet|zoom|period|shutdown|holiday|break|recess|census)\b/i.test(
      text,
    ) &&
    !/\b(due|submit|submission)\b/i.test(text)
  )
    return 'event'
  if (
    /\b(assessments?|essays?|reports?|assignments?|projects?|proposals?|portfolios?|thesis|dissertation|presentations?|reflections?|reviews?|case\s+stud(?:y|ies)|journal|draft|tax\s+return|return|lodge(?:ment)?|grant|submission|plan|budget|research)\b/i.test(
      text,
    )
  )
    return 'work'
  if (
    /\b(forms?|applications?|apply|renew(?:al)?|licen[cs]e|passport|visa|registration|register|enrol(?:ment)?|sign|signature|documents?|rsvp|reply|respond)\b/i.test(
      text,
    )
  )
    return 'form'
  return 'deadline'
}

const daysBetween = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  )

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'long', timeZone: 'UTC' })}`
}

export type PlanOptions = { reference: Date; monthFirst?: boolean }

export function findDeadlines(text: string, options: PlanOptions): Deadline[] {
  const today = options.reference.toISOString().slice(0, 10)
  // Dates in print headers/footers ("Date: Friday, 16 October…") never count.
  const dates = findDates(text, options).filter(
    (d) => !PRINT_LINE.test(lineAround(text, d.index).line),
  )
  const out: Deadline[] = []
  const seen = new Set<string>()
  // A study schedule lists the date each week starts; those aren't deadlines.
  const weekSchedule = /\bweek\s+(?:commencing|beginning|starting)\b/i.test(
    text,
  )
  const isWeekRow = (line: string, d: FoundDate) => {
    if (!weekSchedule) return false
    if (new RegExp(`^\\s*\\d{1,2}\\s+${d.text.split(/\s+/)[0]}`).test(line))
      return true
    // The week number on its own line just above ("5" / "16 November").
    const at = lineAround(text, d.index).start
    const lineStart = text.lastIndexOf('\n', at - 1) + 1
    const prev = text.slice(
      text.lastIndexOf('\n', lineStart - 2) + 1,
      lineStart,
    )
    return (
      /^\s*\d{1,2}\s*$/.test(prev) && line.startsWith(d.text.split(/\s+/)[0]!)
    )
  }

  for (const date of dates) {
    const { line, start } = lineAround(text, date.index)
    const before = text.slice(Math.max(0, date.index - 60), date.index)
    if (
      NOT_A_DEADLINE.test(before.split('\n').pop() ?? '') ||
      NOT_A_DEADLINE.test(line.slice(0, 40))
    )
      continue
    // Schedules (three or more dated lines) count even without cue words.
    if (
      !CUE.test(line) &&
      dates.length < 3 &&
      // A table whose header ("Due date") sits just above.
      !CUE.test(text.slice(Math.max(0, start - 300), start))
    )
      continue
    if (daysBetween(today, date.iso) < -7) continue

    if (PRINT_LINE.test(line) || isWeekRow(line, date)) continue

    const lineDates = dates.filter(
      (d) => d.index >= start && d.index < start + line.length,
    )
    let label = labelFrom(line, lineDates)
    // "1 19 October 2026" under "Week Commencing": a week starting, not a deadline.
    const bareWeekRow =
      !label && /^\s*\d{1,2}\s/.test(line.replace(date.text, ' '))
    let labelLine = line
    if (label.length < 3 && !bareWeekRow) {
      // A table cell on its own line: the label is usually the line above.
      const prevEnd = start - 1
      const prevStart = text.lastIndexOf('\n', prevEnd - 1) + 1
      const prev = text.slice(prevStart, Math.max(prevStart, prevEnd)).trim()
      if (prev && prev.length < 120 && findDates(prev, options).length === 0) {
        label = labelFrom(prev, [])
        labelLine = `${prev} ${line}`
      }
    }
    // No real label (a week start, a page date): not something to do.
    if (label.length < 3) continue
    const key = `${label.toLowerCase()}|${date.iso}`
    if (seen.has(key)) continue
    seen.add(key)
    const time = timeNear(text, date.index)
    let kind = kindOf(`${label} ${labelLine}`)
    // Something at a set time is an appointment to turn up to, unless it's
    // a deadline ("due 5pm") or an exam.
    if (
      time &&
      (kind === 'work' || kind === 'deadline' || kind === 'form') &&
      !/\b(due|submit|submission|deadline|close|closes|by)\b/i.test(labelLine)
    )
      kind = 'event'
    // A period written as a range ("21 December – 4 January") is one entry.
    if (
      kind === 'event' &&
      out.some((o) => o.label.toLowerCase() === label.toLowerCase())
    )
      continue

    // Urgency belongs to this deadline's own words, or to the sentence or
    // heading just before it ("URGENT: Your tax return is overdue.").
    const lineStart = text.lastIndexOf('\n', start - 1) + 1
    const sameLineBefore = text.slice(lineStart, start)
    const prevLine = text
      .slice(
        text.lastIndexOf('\n', lineStart - 2) + 1,
        Math.max(0, lineStart - 1),
      )
      .trim()
    const context =
      sameLineBefore.trim() ||
      (prevLine && findDates(prevLine, options).length === 0 ? prevLine : '')
    const weight = Number(line.match(/\b(\d{1,3})\s?%/)?.[1] ?? NaN)
    const days = daysBetween(today, date.iso)
    out.push({
      label,
      iso: date.iso,
      time,
      kind,
      weight: Number.isFinite(weight) && weight <= 100 ? weight : null,
      urgent:
        URGENT.test(line) ||
        URGENT.test(context) ||
        (days >= 0 && days <= 2 && kind !== 'event'),
      overdue: days < 0,
      uncertain: date.uncertain,
      reason: date.reason,
      excerpt: line.replace(/\s+/g, ' ').slice(0, 160),
      index: date.index,
    })
    if (out.length >= MAX_DEADLINES) break
  }

  // Important items given only by week ("Assessment 2 Exam" in the row for
  // the week of 25 January): use that week's date and ask to check it.
  for (const m of text.matchAll(new RegExp(WEEK_ONLY_CUE.source, 'gi'))) {
    if (out.length >= MAX_DEADLINES) break
    const { line, start } = lineAround(text, m.index)
    if (PRINT_LINE.test(line)) continue
    const label = labelFrom(line, [])
    if (label.length < 3) continue
    // Already found with a real date (on this line or the next).
    const near = dates.find(
      (d) => d.index >= start && d.index < start + line.length + 160,
    )
    if (near && out.some((o) => Math.abs(o.index - near.index) < 5)) continue
    if (out.some((o) => o.label.toLowerCase() === label.toLowerCase())) continue
    if (!weekSchedule) continue
    const week = [...dates]
      .reverse()
      .find(
        (d) =>
          d.index < start &&
          start - d.index < 400 &&
          isWeekRow(lineAround(text, d.index).line, d),
      )
    if (!week || daysBetween(today, week.iso) < -7) continue
    out.push({
      label,
      iso: week.iso,
      time: null,
      kind: kindOf(`${label} ${line}`),
      weight: null,
      urgent: false,
      overdue: daysBetween(today, week.iso) < 0,
      uncertain: true,
      reason: `only the week (${week.text.replace(/\s+/g, ' ')}) is written — check the exact date`,
      excerpt: line.replace(/\s+/g, ' ').slice(0, 160),
      index: m.index,
    })
  }

  // "within 14 days" — counted from today, and flagged to check.
  for (const m of text.matchAll(
    /\bwithin\s+(\d{1,3}|seven|fourteen|twenty[-\s]one|thirty|28)\s+(?:calendar\s+|business\s+|working\s+)?days\b/gi,
  )) {
    if (out.length >= MAX_DEADLINES) break
    const words: Record<string, number> = {
      seven: 7,
      fourteen: 14,
      'twenty-one': 21,
      'twenty one': 21,
      thirty: 30,
    }
    const n = Number(m[1]) || words[m[1]!.toLowerCase()] || 0
    if (!n) continue
    const { line } = lineAround(text, m.index)
    const iso = addDays(today, n)
    const label =
      labelFrom(
        line
          .replace(m[0], ' ')
          .replace(/\s+of\s+(?:this|the)\s+(?:notice|letter|date)\b/i, ' '),
        [],
      ) || 'Respond'
    out.push({
      label,
      iso,
      time: null,
      kind: kindOf(line),
      weight: null,
      urgent: URGENT.test(line) || n <= 7,
      overdue: false,
      uncertain: true,
      reason: `“${m[0]}” — check when the ${n} days started`,
      excerpt: line.replace(/\s+/g, ' ').slice(0, 160),
      index: m.index,
    })
  }

  return out.sort((a, b) => a.iso.localeCompare(b.iso))
}

type Step = { daysBefore: number; title: string }

function stepsFor(d: Deadline): { steps: Step[]; lead: number } {
  const x = d.label
  if (
    IMPERATIVE.test(x) &&
    (d.kind === 'work' || d.kind === 'form' || d.kind === 'deadline')
  ) {
    const big = d.kind === 'work'
    return big
      ? {
          lead: 14,
          steps: [
            { daysBefore: 14, title: `${x}: list what’s needed` },
            { daysBefore: 7, title: `${x}: gather what you need` },
            { daysBefore: 2, title: `${x}: do it and check it` },
            { daysBefore: 0, title: x },
          ],
        }
      : {
          lead: 5,
          steps: [
            { daysBefore: 5, title: `${x}: get started` },
            { daysBefore: 0, title: x },
          ],
        }
  }
  const big =
    (d.weight ?? 0) >= 25 ||
    /\b(assessment|essay|report|project|thesis|dissertation|portfolio|proposal|tax\s+return|grant|application|research)\b/i.test(
      x,
    )
  switch (d.kind) {
    case 'work':
      return big
        ? {
            lead: 21,
            steps: [
              {
                daysBefore: 21,
                title: `Start ${x}: read what’s needed and list the parts`,
              },
              { daysBefore: 14, title: `${x}: gather what you need` },
              { daysBefore: 7, title: `${x}: do the main part (first draft)` },
              { daysBefore: 2, title: `${x}: check it over and finish` },
              { daysBefore: 0, title: `Submit ${x}` },
            ],
          }
        : {
            lead: 7,
            steps: [
              { daysBefore: 7, title: `Start ${x}` },
              { daysBefore: 2, title: `Finish ${x}` },
              { daysBefore: 0, title: `Submit ${x}` },
            ],
          }
    case 'exam':
      return {
        lead: 14,
        steps: [
          { daysBefore: 14, title: `${x}: make a list of what to revise` },
          { daysBefore: 9, title: `Revise for ${x} (session 1)` },
          { daysBefore: 5, title: `Revise for ${x} (session 2)` },
          { daysBefore: 2, title: `${x}: practice questions` },
        ],
      }
    case 'payment':
      return {
        lead: 3,
        steps: [{ daysBefore: 0, title: /^pay\b/i.test(x) ? x : `Pay ${x}` }],
      }
    case 'form':
      return {
        lead: 7,
        steps: [
          { daysBefore: 7, title: `${x}: gather what you need` },
          { daysBefore: 2, title: `${x}: fill in and send` },
        ],
      }
    case 'event':
      return /\b(meeting|hearing|interview|court|presentation)\b/i.test(x)
        ? { lead: 1, steps: [{ daysBefore: 1, title: `Prepare for ${x}` }] }
        : { lead: 0, steps: [] }
    default:
      return {
        lead: 5,
        steps: [
          { daysBefore: 5, title: `Start ${x}` },
          { daysBefore: 0, title: `Finish ${x}` },
        ],
      }
  }
}

function suggestion(
  s: Pick<DocumentSuggestion, 'type' | 'title' | 'dueDate'> &
    Partial<DocumentSuggestion>,
  d: Deadline,
  categorySlug: string | null,
): DocumentSuggestion {
  return {
    kind: 'suggestion',
    details: '',
    confidence: d.uncertain ? 'medium' : 'high',
    uncertain: d.uncertain,
    missingInformation: d.uncertain
      ? [d.reason ? `Check the date: ${d.reason}` : 'Check the date']
      : [],
    sourceExcerpt: d.excerpt,
    categorySlug,
    group: d.label,
    ...s,
  }
}

/**
 * A course outline that lists assessments but no dates: say what's coming,
 * and that the schedule (with dates) is what to feed in next.
 */
function assessmentOverview(text: string): string | null {
  const found = new Map<string, string>()
  for (const m of text.matchAll(/\bassessment\s+(\d{1,2})\b/gi)) {
    const n = m[1]!
    if (found.has(n)) continue
    const after = text.slice(m.index, m.index + 160)
    const weight = after.match(/\b(\d{1,3})\s?%/)
    if (!weight) continue
    const desc = after
      .slice(after.indexOf(weight[0]) + weight[0].length)
      .replace(/^\s*(?:yes|no)\b/i, '')
      .split('\n')[0]!
      .replace(/\s+(?:comprising|including|with|of|which|that)\b.*$/i, '')
      .trim()
      .toLowerCase()
    found.set(
      n,
      `Assessment ${n} (${weight[1]}%${desc ? `, ${shorten(desc, 40)}` : ''})`,
    )
    if (found.size >= 6) break
  }
  if (found.size === 0) return null
  const list = [...found.values()]
  const joined =
    list.length === 1
      ? list[0]
      : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
  return `This outlines ${list.length === 1 ? 'one assessment' : `${list.length} assessments`}: ${joined}. It doesn’t give due dates — feed me the study schedule or assessment page and I’ll plan them.`
}

export type WeekTopic = { week: number; iso: string; topic: string }

/** Lines that are sessions, deadlines or breaks, not a week's study topic. */
const NOT_A_TOPIC =
  /\b(session|tutorial|drop-?in|briefing|meet\s*&|census|due|exam(?:ination)?\b(?!\s+(?:prep|preparation|revision))|period|shutdown|holiday|break|recess|printed|https?:)|\||\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)\b/i

/**
 * "Week Commencing" schedules: the week number, the date it starts and what
 * to study that week ("Module 1: Approaching loss, grief and mourning").
 */
export function findWeeklyTopics(
  text: string,
  options: PlanOptions,
): WeekTopic[] {
  if (!/\bweek\s+(?:commencing|beginning|starting)\b/i.test(text)) return []
  const rows: {
    week: number
    date: FoundDate
    end: number
    lineStart: number
  }[] = []
  for (const d of findDates(text, options)) {
    const lineStart = text.lastIndexOf('\n', d.index - 1) + 1
    const before = text.slice(lineStart, d.index)
    let week: number | null = null
    let rowStart = lineStart
    const same = before.match(/^\s*(\d{1,2})\s+$/)
    if (same) week = Number(same[1])
    else if (!before.trim()) {
      // The week number in its own cell, on the line above.
      const prevStart = text.lastIndexOf('\n', lineStart - 2) + 1
      const prev = text
        .slice(prevStart, Math.max(prevStart, lineStart - 1))
        .trim()
      if (/^\d{1,2}$/.test(prev)) {
        week = Number(prev)
        rowStart = prevStart
      }
    }
    if (week === null || week < 1 || week > 60) continue
    rows.push({
      week,
      date: d,
      end: d.index + d.text.length,
      lineStart: rowStart,
    })
  }
  const topics: WeekTopic[] = []
  rows.forEach((row, i) => {
    const stop = rows[i + 1]?.lineStart ?? text.length
    const lines = text
      .slice(row.end, Math.max(row.end, stop))
      .split('\n')
      .map((l) =>
        l
          .replace(
            /(?:\p{Extended_Pictographic}|[\u2190-\u2BFF]|\uFE0F)/gu,
            ' ',
          )
          .replace(/\s+/g, ' ')
          .trim(),
      )
    for (let k = 0; k < lines.length; k += 1) {
      const line = lines[k]!
      if (line.length < 4 || NOT_A_TOPIC.test(line)) continue
      if (findDates(line, options).length) continue
      let topic = line
      // A topic wrapped onto the next line ("…grief and" / "mourning").
      const next = lines[k + 1]
      if (next && /^[a-z]/.test(next) && !NOT_A_TOPIC.test(next))
        topic = `${topic} ${next}`
      topics.push({
        week: row.week,
        iso: row.date.iso,
        topic: shorten(
          topic.replace(/\s+:/g, ':').replace(/[\s:;,-]+$/, ''),
          90,
        ),
      })
      break
    }
  })
  return topics
}

/** Steps back from each deadline, plus the deadline itself in the calendar. */
export function planDeadlines(
  text: string,
  options: PlanOptions & { categorySlug?: string | null },
): DeadlinePlan | null {
  const today = options.reference.toISOString().slice(0, 10)
  const deadlines = findDeadlines(text, options)
  const category = options.categorySlug ?? null
  const suggestions: DocumentSuggestion[] = []
  const warnings: string[] = []

  for (const d of deadlines) {
    const days = daysBetween(today, d.iso)
    const when = `${formatDay(d.iso)}${d.time ? ` at ${d.time}` : ''}`
    if (d.overdue) {
      suggestions.push(
        suggestion(
          {
            type: 'task',
            title: `Overdue: ${d.label} (was due ${formatDay(d.iso)})`,
            details: 'This date has passed. If it’s already done, skip this.',
            dueDate: today,
            priority: 'high',
            urgent: true,
            uncertain: true,
            missingInformation: ['Check whether this is already done'],
          },
          d,
          category,
        ),
      )
      continue
    }

    // The deadline itself goes in the calendar.
    suggestions.push(
      suggestion(
        {
          type: 'appointment',
          title:
            d.kind === 'event' || d.kind === 'exam'
              ? d.label
              : `Due: ${d.label}`,
          details: d.weight ? `Worth ${d.weight}%` : '',
          dueDate: d.iso,
          startTime: d.time,
        },
        d,
        category,
      ),
    )

    const { steps, lead } = stepsFor(d)
    if (d.urgent && days <= 2 && d.kind !== 'event') {
      suggestions.push(
        suggestion(
          {
            type: 'task',
            title:
              d.kind === 'payment'
                ? `Pay ${d.label.replace(/^pay\s+/i, '')} straight away`
                : IMPERATIVE.test(d.label)
                  ? `${d.label} straight away`
                  : `Do ${d.label} straight away`,
            details: `Due ${when}. This one is urgent — do it first.`,
            dueDate: today,
            priority: 'high',
            urgent: true,
          },
          d,
          category,
        ),
      )
      continue
    }
    // Squeeze the steps into the time that's left, never before today.
    const room = Math.max(0, Math.min(lead, days))
    const usedDates = new Set<string>()
    steps.forEach((step, i) => {
      const before =
        lead === 0 ? 0 : Math.round((step.daysBefore / lead) * room)
      let due = addDays(d.iso, -before)
      if (due < today) due = today
      // One step per day per deadline: nudge collisions later, up to the due date.
      while (usedDates.has(due) && due < d.iso) due = addDays(due, 1)
      usedDates.add(due)
      const first = i === 0
      const urgentStart = first && d.urgent
      suggestions.push(
        suggestion(
          {
            type: 'task',
            title: urgentStart ? `Urgent: ${step.title}` : step.title,
            details: `Step ${i + 1} of ${steps.length} · ${d.kind === 'exam' ? 'exam' : 'due'} ${when}`,
            dueDate: urgentStart ? today : due,
            priority: urgentStart || days <= 7 ? 'high' : 'normal',
            urgent: urgentStart,
            step: `${i + 1}/${steps.length}`,
          },
          d,
          category,
        ),
      )
    })
    if (d.kind === 'payment') {
      const nudge = addDays(d.iso, -3)
      suggestions.push(
        suggestion(
          {
            type: 'reminder',
            title: `${d.label} due ${formatDay(d.iso)}`,
            dueDate: nudge >= today ? nudge : d.iso,
            startTime: '09:00',
          },
          d,
          category,
        ),
      )
    }
  }

  if (/\bweek\s+\d{1,2}\b/i.test(text) && CUE.test(text)) {
    warnings.push(
      'Some dates are written as “Week 5” and I can’t turn those into dates yet. Tell the Goblin the real date (for example “Essay due 14 March”) and I’ll plan it.',
    )
  }

  // Things marked urgent that have no date at all.
  for (const m of text.matchAll(new RegExp(URGENT.source, 'gi'))) {
    if (suggestions.filter((s) => s.urgent).length >= 3) break
    // Already covered by a dated deadline nearby.
    if (deadlines.some((d) => Math.abs(d.index - m.index) < 250)) continue
    const { line } = lineAround(text, m.index)
    const sentence = line.replace(/\s+/g, ' ').slice(0, 160)
    if (suggestions.some((s) => s.sourceExcerpt === sentence)) continue
    if (URGENT_NOT_TASK.test(sentence)) continue
    const what = cap(cleanPhrase(sentence.replace(/[.!]+$/, '')))
    if (what.length < 8) continue
    suggestions.push({
      kind: 'suggestion',
      type: 'task',
      title: `Urgent: ${shorten(what, 70)}`,
      details: 'The document says this is urgent, so I’ve put it on today.',
      dueDate: today,
      confidence: 'medium',
      uncertain: false,
      missingInformation: [],
      sourceExcerpt: sentence,
      categorySlug: category,
      priority: 'high',
      urgent: true,
      group: 'Urgent',
    })
  }

  if (
    deadlines.length === 0 &&
    !suggestions.length &&
    findWeeklyTopics(text, options).length === 0
  ) {
    const overview = assessmentOverview(text)
    return overview
      ? { deadlines: [], suggestions: [], summary: overview, warnings }
      : null
  }

  // A week-by-week schedule: each week's topic becomes that week's study.
  const weeks = findWeeklyTopics(text, options).filter(
    (w) => addDays(w.iso, 6) >= today,
  )
  for (const w of weeks) {
    suggestions.push({
      kind: 'suggestion',
      type: 'task',
      title: `Week ${w.week}: ${w.topic}`,
      details: `Study for the week starting ${formatDay(w.iso)}.`,
      dueDate: addDays(w.iso, 6),
      confidence: 'high',
      uncertain: false,
      missingInformation: [],
      sourceExcerpt: w.topic,
      categorySlug: category,
      group: 'Week by week',
    })
  }

  const urgentCount = suggestions.filter(
    (s) => s.urgent && !s.title.startsWith('Overdue:'),
  ).length
  const next = deadlines.find((d) => !d.overdue)
  const parts: string[] = []
  if (deadlines.length === 1 && next) {
    parts.push(`I found one date: ${next.label} on ${formatDay(next.iso)}.`)
  } else if (deadlines.length > 1) {
    parts.push(
      `I found ${deadlines.length} dates${next ? ` — the next is ${next.label} on ${formatDay(next.iso)}` : ''}.`,
    )
  }
  const overdue = deadlines.filter((d) => d.overdue).length
  if (next)
    parts.push(
      'I’ve planned the steps back from each date and put the due dates in your calendar.',
    )
  if (weeks.length)
    parts.push(
      `I’ve also made a week-by-week study plan (${weeks.length} week${weeks.length === 1 ? '' : 's'}).`,
    )
  if (overdue)
    parts.push(
      overdue === 1
        ? 'One date has already passed — check whether it’s done.'
        : `${overdue} dates have already passed — check whether they’re done.`,
    )
  if (urgentCount)
    parts.push(
      urgentCount === 1
        ? '1 thing is urgent, so it’s on today.'
        : `${urgentCount} things are urgent, so they’re on today.`,
    )
  return {
    deadlines,
    suggestions: suggestions.slice(0, MAX_SUGGESTIONS),
    summary: parts.join(' '),
    warnings,
  }
}
