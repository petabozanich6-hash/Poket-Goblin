import type { CapacityMode, CalendarEvent, Task } from '../types'
import { CAPACITY_LIMITS } from '../types'
import { scoreTaskWithReasons } from './prioritize'

export type RescueSuggestion = {
  mode: 'rules'
  summary: string
  keep: Array<{ task: Task; reason: string }>
  defer: Array<{ task: Task; reason: string }>
  remainingAppointments: CalendarEvent[]
  note: string
}

export type RescueInput = {
  now: Date
  todayLocal: string
  capacityMode: CapacityMode
  openTasks: Task[]
  remainingAppointments: CalendarEvent[]
  planTaskIds: string[]
}

export function buildRescuePlan(input: RescueInput): RescueSuggestion {
  const hour = input.now.getHours()
  const late = hour >= 15
  const busy = input.remainingAppointments.length >= 1
  let keepLimit = CAPACITY_LIMITS[input.capacityMode]
  if (late) keepLimit = Math.max(1, Math.min(keepLimit, 2))
  if (busy) keepLimit = Math.max(1, keepLimit - 1)
  if (input.capacityMode === 'goblin') keepLimit = Math.min(keepLimit, 2)

  const ranked = [...input.openTasks]
    .map((task) => ({
      task,
      meta: scoreTaskWithReasons(
        task,
        input.todayLocal,
        input.capacityMode,
        busy || late,
      ),
    }))
    .sort((a, b) => b.meta.score - a.meta.score)

  const keep: RescueSuggestion['keep'] = []
  const defer: RescueSuggestion['defer'] = []

  for (const row of ranked) {
    const overdueOrToday =
      row.task.dueDate && row.task.dueDate <= input.todayLocal
    if (
      keep.length < keepLimit &&
      (overdueOrToday || keep.length === 0 || row.meta.score >= 40)
    ) {
      if (keep.length < keepLimit) {
        keep.push({
          task: row.task,
          reason: row.meta.reasons[0] ?? 'Worth keeping in focus.',
        })
        continue
      }
    }
    if (keep.length < keepLimit && input.planTaskIds.includes(row.task.id)) {
      keep.push({
        task: row.task,
        reason: 'Already on today’s plan.',
      })
      continue
    }
    if (keep.length < keepLimit && row.meta.score >= 35) {
      keep.push({
        task: row.task,
        reason: row.meta.reasons[0] ?? 'High signal.',
      })
      continue
    }
    defer.push({
      task: row.task,
      reason: 'Can wait without changing its due date.',
    })
  }

  // Ensure we didn't over-keep
  while (keep.length > keepLimit) {
    const moved = keep.pop()!
    defer.unshift({
      task: moved.task,
      reason: 'Parked to keep today’s load realistic.',
    })
  }

  const timePhrase =
    hour < 12
      ? 'Still morning'
      : hour < 15
        ? 'Midday check-in'
        : hour < 18
          ? `It’s already ${hour > 12 ? hour - 12 : hour}pm`
          : 'Evening now'

  const summary =
    keep.length === 0
      ? `${timePhrase}. Nothing must be forced — appointments stay as they are.`
      : keep.length === 1
        ? `${timePhrase}. Let’s focus on the one thing that matters most and leave the rest for another day.`
        : `${timePhrase}. Let’s focus on the ${keep.length} things that matter most and leave the rest for another day.`

  return {
    mode: 'rules',
    summary,
    keep,
    defer: defer.slice(0, 12),
    remainingAppointments: input.remainingAppointments,
    note: 'Appointments are never moved. Due dates stay put — this only reshapes today’s focus list.',
  }
}
