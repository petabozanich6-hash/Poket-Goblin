import type { CapacityMode, PlanningApproach } from '../../../shared/types'
import { addDays } from '../../../shared/documents/dates'

export type Workload = {
  dailyLoad: Record<string, number>
  capacityMode: CapacityMode
  planningApproach: PlanningApproach
}

/**
 * Only existing, still-open tasks and booked events are counted. Calendar
 * events are stored in UTC; convert to the user's current local offset for
 * weekday placement without moving the actual event.
 */
export async function loadStudyWorkload(
  db: D1Database,
  userId: string,
  today: string,
  timezoneOffsetMinutes: number,
): Promise<Workload> {
  const end = addDays(today, 118)
  const [settings, tasks, events] = await Promise.all([
    db
      .prepare(
        `SELECT capacity_mode as capacityMode, planning_approach as planningApproach
         FROM user_settings WHERE user_id = ?`,
      )
      .bind(userId)
      .first<{ capacityMode: CapacityMode; planningApproach: PlanningApproach }>(),
    db
      .prepare(
        `SELECT due_date as day FROM tasks
         WHERE user_id = ? AND status = 'open'
           AND due_date BETWEEN ? AND ? LIMIT 1000`,
      )
      .bind(userId, today, end)
      .all<{ day: string }>(),
    db
      .prepare(
        `SELECT starts_at as startsAt FROM events
         WHERE user_id = ? AND status = 'scheduled'
           AND starts_at >= ? AND starts_at <= ? LIMIT 1000`,
      )
      .bind(
        userId,
        `${addDays(today, -1)}T00:00:00Z`,
        `${addDays(end, 1)}T23:59:59Z`,
      )
      .all<{ startsAt: string }>(),
  ])
  const dailyLoad: Record<string, number> = {}
  const count = (day: string) => {
    if (day >= today && day <= end)
      dailyLoad[day] = (dailyLoad[day] ?? 0) + 1
  }
  for (const task of tasks.results ?? []) count(task.day)
  for (const event of events.results ?? []) {
    const time = Date.parse(event.startsAt)
    if (!Number.isFinite(time)) continue
    count(
      new Date(time - timezoneOffsetMinutes * 60_000)
        .toISOString()
        .slice(0, 10),
    )
  }
  return {
    dailyLoad,
    capacityMode: settings?.capacityMode ?? 'steady',
    planningApproach: settings?.planningApproach ?? 'balanced',
  }
}
