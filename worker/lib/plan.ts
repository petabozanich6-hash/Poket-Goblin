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

function scoreTask(task: Task, today: string): number {
  let score = 0
  if (task.priority === 'high') score += 30
  if (task.priority === 'normal') score += 15
  if (task.dueDate) {
    if (task.dueDate <= today) score += 40
    else {
      const days =
        (new Date(task.dueDate).getTime() - new Date(today).getTime()) /
        86_400_000
      if (days <= 2) score += 20
      else if (days <= 7) score += 10
    }
  }
  score += Math.max(0, 6 - task.capacityCost)
  return score
}

export async function buildDailyPlan(
  db: D1Database,
  userId: string,
  capacityMode: CapacityMode,
  planDate = todayIso(),
): Promise<DailyPlan> {
  const limit = CAPACITY_LIMITS[capacityMode]
  const openTasks = await listTasksForUser(db, userId, {
    status: 'open',
    limit: 200,
  })
  const ranked = [...openTasks].sort(
    (a, b) => scoreTask(b, planDate) - scoreTask(a, planDate),
  )

  const selected: Task[] = []
  let cost = 0
  for (const task of ranked) {
    if (selected.length >= limit) break
    if (cost + task.capacityCost > limit + 1 && selected.length > 0) continue
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
