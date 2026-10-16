import type { DayAvailability } from '../../../shared/documents/pathwayScheduler'

export type SavedSessionForReplan = {
  id: string
  date: string
  deadlineDate: string | null
  minutes: number
  status: string
  taskStatus: string | null
  taskId: string | null
}

export type ReplanMove = { sessionId: string; date: string; minutes: number }
export type ReplanWarning = {
  sessionId: string
  reason: 'missing_deadline' | 'deadline_passed' | 'insufficient_capacity'
}

const validDate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const timestamp = Date.parse(date + 'T00:00:00Z')
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === date
  )
}

/**
 * Only missed, still-open study sessions are eligible. Never move completed
 * work, future work, or a source assessment deadline. No partial moves:
 * a session must fit on one available day or the user gets a warning.
 */
export function planMissedStudySessions(
  today: string,
  sessions: readonly SavedSessionForReplan[],
  availability: readonly DayAvailability[],
): {
  missedCount: number
  moves: ReplanMove[]
  warnings: ReplanWarning[]
} {
  if (!validDate(today)) throw new Error('Invalid current local date')
  const missed = sessions
    .filter(
      (session) =>
        session.status === 'planned' &&
        session.taskStatus === 'open' &&
        Boolean(session.taskId) &&
        validDate(session.date) &&
        session.date < today,
    )
    .sort(
      (a, b) =>
        (a.deadlineDate ?? '').localeCompare(b.deadlineDate ?? '') ||
        a.date.localeCompare(b.date) ||
        a.id.localeCompare(b.id),
    )
  const capacity = new Map<string, number>()
  for (const day of availability) {
    if (!validDate(day.date) || day.date < today) continue
    const available = Number.isFinite(day.availableMinutes)
      ? Math.max(0, Math.floor(day.availableMinutes))
      : 0
    const committed = Number.isFinite(day.committedMinutes ?? 0)
      ? Math.max(0, Math.floor(day.committedMinutes ?? 0))
      : available
    const free = day.blocked ? 0 : Math.max(0, available - committed)
    capacity.set(day.date, Math.min(capacity.get(day.date) ?? Infinity, free))
  }
  const days = [...capacity.keys()].sort()
  const moves: ReplanMove[] = []
  const warnings: ReplanWarning[] = []
  for (const session of missed) {
    const deadline = session.deadlineDate
    if (!deadline || !validDate(deadline)) {
      warnings.push({ sessionId: session.id, reason: 'missing_deadline' })
      continue
    }
    if (deadline < today) {
      warnings.push({ sessionId: session.id, reason: 'deadline_passed' })
      continue
    }
    const minutes = session.minutes
    const target = days.find(
      (date) =>
        date <= deadline &&
        Number.isInteger(minutes) &&
        minutes > 0 &&
        minutes <= 240 &&
        (capacity.get(date) ?? 0) >= minutes,
    )
    if (!target) {
      warnings.push({ sessionId: session.id, reason: 'insufficient_capacity' })
      continue
    }
    moves.push({ sessionId: session.id, date: target, minutes })
    capacity.set(target, (capacity.get(target) ?? 0) - minutes)
  }
  return { missedCount: missed.length, moves, warnings }
}
