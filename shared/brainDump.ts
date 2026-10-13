import type { CaptureItemKind, Confidence } from './types'

export type ParsedCaptureSuggestion = {
  kind: CaptureItemKind
  title: string
  dueDate: string | null
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

function parseRelativeDate(text: string, now = new Date()): string | null {
  const lower = text.toLowerCase()

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

  const day = lower.match(
    /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/,
  )
  if (day?.[1]) {
    return toIsoDate(nextWeekday(now, WEEKDAYS[day[1]]!, false))
  }

  return null
}

function detectKind(text: string): CaptureItemKind {
  const lower = text.toLowerCase()
  if (/\b(buy|shopping|grocer|shoes|pick up)\b/.test(lower)) return 'shopping'
  if (/\b(appointment|meeting|at\s+\d{1,2})\b/.test(lower)) return 'appointment'
  if (/\b(remind|reminder|don't forget|dont forget)\b/.test(lower)) {
    return 'reminder'
  }
  if (/\b(follow[- ]?up|reply to|email from)\b/.test(lower)) return 'follow_up'
  if (/\b(note|remember that|just noting)\b/.test(lower)) return 'note'
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
  if (/\b(school|kid|child|family|son|daughter|partner)\b/.test(lower)) {
    return 'family'
  }
  if (/\b(work|boss|colleague|university|uni|study|assignment)\b/.test(lower)) {
    return 'work_study'
  }
  if (/\b(appointment|meeting)\b/.test(lower)) return 'appointments'
  if (/\b(buy|shopping|grocer|shoes)\b/.test(lower)) return 'shopping'
  if (/\b(home|house|landlord|plumber|clean)\b/.test(lower)) return 'home'
  return null
}

function cleanTitle(text: string): string {
  return text
    .replace(
      /^(i\s+need\s+to|i've\s+got|i\s+have\s+to|remember\s+(that\s+)?|remind\s+me\s+to|note\s*:?\s*)/i,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

function splitThoughts(raw: string): string[] {
  return raw
    .split(/(?:\n+|[.!?]\s+|;| and also | also )/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 2)
}

/**
 * Deterministic Sprint 1 interpreter — not AI.
 * Never invents dates unless the text contains a recognizable cue.
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
    const kind = detectKind(chunk)
    const categorySlug = detectCategory(chunk)
    const title = cleanTitle(chunk) || chunk
    const hasDateCue =
      /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+\w+)\b/i.test(
        chunk,
      )
    const uncertain = Boolean(hasDateCue && !dueDate) || title.length < 4
    let confidence: Confidence = 'medium'
    if (dueDate && categorySlug) confidence = 'high'
    if (uncertain || (!dueDate && !categorySlug)) confidence = 'low'

    return {
      kind,
      title,
      dueDate,
      categorySlug,
      confidence,
      uncertain,
    }
  })
}
