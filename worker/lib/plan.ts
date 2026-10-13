import { scoreTaskWithReasons } from '../../shared/magical/prioritize'
import {
  CAPACITY_LIMITS,
  type CapacityMode,
  type DailyPlan,
  type Task,
} from '../../shared/types'
import { newId } from './ids'
import { listTasksForUser, mapTask } from './tasks'

function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}

function scoreTask(
  task: Task,
  today: string,
  capacityMode: CapacityMode,
  busyDay: boolean,
): number {
  return scoreTaskWithReasons(task, today, capacityMode, busyDay).score
}

async function countAppointmentsToday(
  db: D1Database,
  userId: string,
  planDate: string,
): Promise<number> {
  const start = `${planDate}T00:00:00.000Z`
  const end = `${planDate}T23:59:59.999Z`
  const row = await db
    .prepare(
      `SELECT COUNT(*) as count FROM events
       WHERE user_id = ? AND status = 'scheduled'
         AND starts_at >= ? AND starts_at <= ?`,
    )
    .bind(userId, start, end)
    .first<{ count: number }>()
  return row?.count ?? 0
}

export async function buildDailyPlan(
  db: D1Database,
  userId: string,
  capacityMode: CapacityMode,
  planDate = todayIso(),
): Promise<DailyPlan> {
  let limit = CAPACITY_LIMITS[capacityMode]
  const appointmentCount = await countAppointmentsToday(db, userId, planDate)
  const busyDay = appointmentCount >= 2
  if (busyDay) {
    limit = Math.max(1, limit - 1)
  }
  if (capacityMode === 'goblin') {
    // Keep goblin mode especially gentle
    limit = Math.min(limit, CAPACITY_LIMITS.goblin)
  }

  const openTasks = await listTasksForUser(db, userId, {
    status: 'open',
    limit: 200,
  })
  const ranked = [...openTasks].sort(
    (a, b) =>
      scoreTask(b, planDate, capacityMode, busyDay) -
      scoreTask(a, planDate, capacityMode, busyDay),
  )

  const selected: Task[] = []
  let cost = 0
  const maxCost =
    capacityMode === 'goblin'
      ? limit
      : capacityMode === 'steady'
        ? limit + 1
        : limit + 2

  for (const task of ranked) {
    if (selected.length >= limit) break
    // Skip heavy tasks on goblin / busy days unless overdue today
    if (
      (capacityMode === 'goblin' || busyDay) &&
      task.capacityCost >= 4 &&
      !(task.dueDate && task.dueDate <= planDate)
    ) {
      continue
    }
    if (cost + task.capacityCost > maxCost && selected.length > 0) continue
    selected.push(task)
    cost += task.capacityCost
  }

  const existing = await db
    .prepare(`SELECT id FROM daily_plans WHERE user_id = ? AND plan_date = ?`)
    .bind(userId, planDate)
    .first<{ id: string }>()

  const planId = existing?.id ?? newId('plan')
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO daily_plans (id, user_id, plan_date, capacity_mode)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(planId, userId, planDate, capacityMode)
      .run()
  } else {
    await db
      .prepare(`UPDATE daily_plans SET capacity_mode = ? WHERE id = ?`)
      .bind(capacityMode, planId)
      .run()
    await db
      .prepare(`DELETE FROM daily_plan_tasks WHERE plan_id = ?`)
      .bind(planId)
      .run()
  }

  for (let i = 0; i < selected.length; i += 1) {
    await db
      .prepare(
        `INSERT INTO daily_plan_tasks (plan_id, task_id, sort_order)
         VALUES (?, ?, ?)`,
      )
      .bind(planId, selected[i]!.id, i)
      .run()
  }

  return {
    id: planId,
    planDate,
    capacityMode,
    taskIds: selected.map((t) => t.id),
    tasks: selected,
    suggestedCapacity: limit,
  }
}

export async function getDailyPlan(
  db: D1Database,
  userId: string,
  planDate = todayIso(),
): Promise<DailyPlan | null> {
  const plan = await db
    .prepare(
      `SELECT id, plan_date as planDate, capacity_mode as capacityMode
       FROM daily_plans WHERE user_id = ? AND plan_date = ?`,
    )
    .bind(userId, planDate)
    .first<{ id: string; planDate: string; capacityMode: CapacityMode }>()

  if (!plan) return null

  const rows = await db
    .prepare(
      `SELECT t.id,
              t.category_id as categoryId,
              c.slug as categorySlug,
              c.name as categoryName,
              t.title,
              t.notes,
              t.status,
              t.priority,
              t.due_date as dueDate,
              t.capacity_cost as capacityCost,
              t.parent_id as parentId,
              t.completed_at as completedAt,
              t.recurrence_rule_id as recurrenceRuleId,
              t.series_id as seriesId,
              t.occurrence_date as occurrenceDate,
              t.skipped as skipped,
              t.created_at as createdAt,
              t.updated_at as updatedAt
       FROM daily_plan_tasks dpt
       JOIN tasks t ON t.id = dpt.task_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE dpt.plan_id = ? AND t.user_id = ?
       ORDER BY dpt.sort_order ASC`,
    )
    .bind(plan.id, userId)
    .all()

  const tasks = (rows.results ?? []).map((row) =>
    mapTask(row as Parameters<typeof mapTask>[0]),
  )

  return {
    id: plan.id,
    planDate: plan.planDate,
    capacityMode: plan.capacityMode,
    taskIds: tasks.map((t) => t.id),
    tasks,
    suggestedCapacity: CAPACITY_LIMITS[plan.capacityMode],
  }
}
