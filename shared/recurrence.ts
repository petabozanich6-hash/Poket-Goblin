import type { RecurrenceFrequency } from './types'

export type RecurrenceInput = {
  frequency: RecurrenceFrequency
  intervalValue?: number
  byWeekday?: number[] | null
  dayOfMonth?: number | null
  startsOn: string
  endsOn?: string | null
  count?: number
}

function parseDate(iso: string): Date {
  const d = new Date(`${iso}T12:00:00`)
  return d
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addMonthsClamped(
  date: Date,
  months: number,
  dayOfMonth: number,
): Date {
  const result = new Date(date)
  const targetMonth = result.getMonth() + months
  result.setDate(1)
  result.setMonth(targetMonth)
  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0,
  ).getDate()
  result.setDate(Math.min(dayOfMonth, lastDay))
  return result
}

/**
 * Generate upcoming occurrence dates (inclusive of start) without inventing
 * past history. Uses local-noon anchors to reduce DST edge surprises.
 */
export function generateOccurrences(
  input: RecurrenceInput,
  max = 12,
): string[] {
  const starts = parseDate(input.startsOn)
  const ends = input.endsOn ? parseDate(input.endsOn) : null
  const interval = Math.max(1, input.intervalValue ?? 1)
  const out: string[] = []
  let cursor = new Date(starts)
  const dayOfMonth = input.dayOfMonth ?? starts.getDate()

  while (out.length < max) {
    if (ends && cursor.getTime() > ends.getTime()) break
    out.push(toIso(cursor))

    switch (input.frequency) {
      case 'daily':
        cursor.setDate(cursor.getDate() + interval)
        break
      case 'weekly':
        cursor.setDate(cursor.getDate() + 7 * interval)
        break
      case 'fortnightly':
        cursor.setDate(cursor.getDate() + 14 * interval)
        break
      case 'monthly':
        cursor = addMonthsClamped(cursor, interval, dayOfMonth)
        break
      case 'yearly':
        cursor = addMonthsClamped(cursor, 12 * interval, dayOfMonth)
        break
      case 'custom':
        cursor.setDate(cursor.getDate() + interval)
        break
      default:
        cursor.setDate(cursor.getDate() + 7)
    }
  }

  return out
}

export function nextOccurrenceAfter(
  input: RecurrenceInput,
  afterIso: string,
): string | null {
  const after = parseDate(afterIso).getTime()
  for (const iso of generateOccurrences(input, 52)) {
    if (parseDate(iso).getTime() > after) return iso
  }
  return null
}
