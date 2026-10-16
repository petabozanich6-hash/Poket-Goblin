/**
 * Deterministic recommended-pathway scheduler.
 * This function does not read documents or write tasks: callers must supply
 * reviewed goals, availability and existing commitments.
 */
export type PathwayStep = {
  id: string
  goalId: string
  title: string
  minutes: number
  deadline: string
  dependsOn?: string[]
  /** Higher numbers should be scheduled first when deadlines tie. */
  priority?: number
}
export type DayAvailability = {
  date: string
  availableMinutes: number
  committedMinutes?: number
  blocked?: boolean
}
export type ScheduledSession = {
  stepId: string
  goalId: string
  title: string
  date: string
  minutes: number
  sequence: number
}
export type PathwayWarning = {
  stepId: string
  remainingMinutes: number
  reason:
    | 'insufficient_capacity'
    | 'invalid_deadline'
    | 'missing_dependency'
    | 'cyclic_dependency'
}
export type PathwayResult = {
  sessions: ScheduledSession[]
  warnings: PathwayWarning[]
  unscheduledMinutes: number
}

/**
 * A task's deadline is an immutable upper boundary, not a proposed work day.
 * Schedules only steps not already completed; callers retain completed sessions
 * and user overrides themselves and pass their occupied minutes as commitments.
 * Multi-session steps are allocated in small pieces so work can be spread out.
 * No hours are created if available capacity is insufficient.
 */
export function recommendPathway(
  steps: PathwayStep[],
  availability: DayAvailability[],
  options: { sessionMinutes?: number; completedStepIds?: readonly string[] } = {},
): PathwayResult {
  const sessionSize = Math.max(
    15,
    Math.min(240, Math.floor(options.sessionMinutes ?? 60)),
  )
  const completed = new Set(options.completedStepIds ?? [])
  const remaining = steps.filter((step) => !completed.has(step.id))
  const byId = new Map(steps.map((step) => [step.id, step]))
  const days = [...availability]
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))
    .sort((a, b) => a.date.localeCompare(b.date))
  const capacity = new Map<string, number>()
  for (const day of days) {
    // Duplicate availability rows must not manufacture extra time.
    const free = day.blocked
      ? 0
      : Math.max(
          0,
          Math.floor(day.availableMinutes) -
            Math.max(0, Math.floor(day.committedMinutes ?? 0)),
        )
    capacity.set(day.date, Math.min(capacity.get(day.date) ?? Infinity, free))
  }
  const warnings: PathwayWarning[] = []
  const sessions: ScheduledSession[] = []
  const state = new Map<string, 'visiting' | 'done' | 'failed'>()
  const lastDay = new Map<string, string>()
  function schedule(step: PathwayStep): boolean {
    const current = state.get(step.id)
    if (current === 'done') return true
    if (current === 'failed') return false
    if (current === 'visiting') {
      warnings.push({
        stepId: step.id,
        remainingMinutes: Math.max(0, step.minutes),
        reason: 'cyclic_dependency',
      })
      state.set(step.id, 'failed')
      return false
    }
    state.set(step.id, 'visiting')
    let dependenciesOk = true
    let earliest = days[0]?.date ?? ''
    for (const dependencyId of step.dependsOn ?? []) {
      if (completed.has(dependencyId)) continue
      const dependency = byId.get(dependencyId)
      if (!dependency || !schedule(dependency)) {
        dependenciesOk = false
        warnings.push({
          stepId: step.id,
          remainingMinutes: Math.max(0, step.minutes),
          reason: 'missing_dependency',
        })
        break
      }
      const ending = lastDay.get(dependencyId)
      if (ending && ending > earliest) earliest = ending
    }
    if (!dependenciesOk) {
      state.set(step.id, 'failed')
      return false
    }
    const deadlineTimestamp = Date.parse(step.deadline + 'T00:00:00Z')
    const validDate =
      /^\d{4}-\d{2}-\d{2}$/.test(step.deadline) &&
      Number.isFinite(deadlineTimestamp) &&
      new Date(deadlineTimestamp).toISOString().slice(0, 10) === step.deadline
    if (!validDate) {
      warnings.push({
        stepId: step.id,
        remainingMinutes: Math.max(0, step.minutes),
        reason: 'invalid_deadline',
      })
      state.set(step.id, 'failed')
      return false
    }
    let left = Math.max(0, Math.ceil(step.minutes))
    let sequence = 0
    for (const day of days) {
      if (left <= 0) break
      if (day.date < earliest || day.date > step.deadline) continue
      let free = capacity.get(day.date) ?? 0
      while (free > 0 && left > 0) {
        const minutes = Math.min(free, left, sessionSize)
        sequence += 1
        sessions.push({
          stepId: step.id,
          goalId: step.goalId,
          title: step.title,
          date: day.date,
          minutes,
          sequence,
        })
        left -= minutes
        free -= minutes
        lastDay.set(step.id, day.date)
      }
      capacity.set(day.date, free)
    }
    if (left > 0)
      warnings.push({
        stepId: step.id,
        remainingMinutes: left,
        reason: 'insufficient_capacity',
      })
    state.set(step.id, left === 0 ? 'done' : 'failed')
    return left === 0
  }
  remaining.sort(
    (a, b) =>
      a.deadline.localeCompare(b.deadline) ||
      (b.priority ?? 0) - (a.priority ?? 0) ||
      a.id.localeCompare(b.id),
  )
  for (const step of remaining) schedule(step)
  sessions.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.goalId.localeCompare(b.goalId) ||
      a.stepId.localeCompare(b.stepId) ||
      a.sequence - b.sequence,
  )
  return {
    sessions,
    warnings,
    unscheduledMinutes: remaining.reduce((total, step) => {
      const scheduled = sessions
        .filter((session) => session.stepId === step.id)
        .reduce((minutes, session) => minutes + session.minutes, 0)
      return total + Math.max(0, Math.ceil(step.minutes) - scheduled)
    }, 0),
  }
}
