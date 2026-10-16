import type { DayAvailability } from '../../../shared/documents/pathwayScheduler'

export type SavedSessionForReplan = {
  id: string
  goalId?: string | null
  stepOrder?: number | null
  sequence?: number
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

const shiftDay = (day: string, amount: number): string => {
  const time = Date.parse(day + 'T00:00:00Z')
  return new Date(time + amount * 86400000).toISOString().slice(0, 10)
}
const nextDay = (day: string) => shiftDay(day, 1)
const previousDay = (day: string) => shiftDay(day, -1)

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
    .sort((a, b) => {
      // Keep prerequisite steps in their source order within an assessment.
      if (
        a.goalId &&
        a.goalId === b.goalId &&
        a.stepOrder != null &&
        b.stepOrder != null
      ) {
        const stepDifference = a.stepOrder - b.stepOrder
        if (stepDifference) return stepDifference
        const sequenceDifference = (a.sequence ?? 1) - (b.sequence ?? 1)
        if (sequenceDifference) return sequenceDifference
      }
      return (
        (a.deadlineDate ?? '').localeCompare(b.deadlineDate ?? '') ||
        a.date.localeCompare(b.date) ||
        a.id.localeCompare(b.id)
      )
    })
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
    const sameAssessment = sessions.filter(
      (other) =>
        session.goalId &&
        other.goalId === session.goalId &&
        other.id !== session.id &&
        other.status === 'planned' &&
        other.taskStatus === 'open' &&
        other.stepOrder != null &&
        session.stepOrder != null,
    )
    // A date alone cannot establish an order within the same calendar day,
    // so separate dependent steps by a full day.
    const prerequisites = sameAssessment.filter(
      (other) =>
        other.stepOrder! < session.stepOrder! ||
        (other.stepOrder === session.stepOrder &&
          (other.sequence ?? 1) < (session.sequence ?? 1)),
    )
    const successors = sameAssessment.filter(
      (other) =>
        other.stepOrder! > session.stepOrder! ||
        (other.stepOrder === session.stepOrder &&
          (other.sequence ?? 1) > (session.sequence ?? 1)),
    )
    const earliest = prerequisites.reduce((boundary, item) => {
      const planned = moves.find((move) => move.sessionId === item.id)
      const date = planned?.date ?? item.date
      if (date < today && !planned) return boundary
      // Sessions of the same step can share a date in sequence.
      const after = item.stepOrder === session.stepOrder ? date : nextDay(date)
      return after > boundary ? after : boundary
    }, today)
    const latest = successors.reduce((boundary, item) => {
      // Other missed steps will be replanned after the current prerequisite.
      if (item.date < today) return boundary
      const before =
        item.stepOrder === session.stepOrder ? item.date : previousDay(item.date)
      return before < boundary ? before : boundary
    }, deadline)
    const target = days.find(
      (date) =>
        date >= earliest &&
        date <= latest &&
        Number.isInteger(minutes) &&
        minutes > 0 &&
        minutes <= 240 &&
        (capacity.get(date) ?? 0) >= minutes,
    )
    if (!target) {
      warnings.push({
        sessionId: session.id,
        reason:
          earliest > latest ||
          (days.some((date) => date >= today && date <= deadline &&
            (capacity.get(date) ?? 0) >= minutes) &&
            (earliest > today || latest < deadline))
            ? 'dependency_order'
            : 'insufficient_capacity',
      })
      continue
    }
    moves.push({ sessionId: session.id, date: target, minutes })
    capacity.set(target, (capacity.get(target) ?? 0) - minutes)
  }
  return { missedCount: missed.length, moves, warnings }
}
