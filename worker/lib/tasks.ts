import type { Task, TaskPriority, TaskStatus } from '../../shared/types'

type TaskRow = {
  id: string
  categoryId: string | null
  categorySlug: string | null
  categoryName: string | null
  title: string
  notes: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  capacityCost: number
  parentId: string | null
  completedAt: string | null
  recurrenceRuleId: string | null
  seriesId: string | null
  occurrenceDate: string | null
  skipped: number | null
  createdAt: string
  updatedAt: string
}

const TASK_SELECT = `
  SELECT t.id,
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
  FROM tasks t
  LEFT JOIN categories c ON c.id = t.category_id
`

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    categoryId: row.categoryId,
    categorySlug: row.categorySlug,
    categoryName: row.categoryName,
    title: row.title,
    notes: row.notes,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    capacityCost: row.capacityCost,
    parentId: row.parentId,
    completedAt: row.completedAt,
    recurrenceRuleId: row.recurrenceRuleId,
    seriesId: row.seriesId,
    occurrenceDate: row.occurrenceDate,
    skipped: Boolean(row.skipped),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function getTaskForUser(
  db: D1Database,
  userId: string,
  taskId: string,
): Promise<Task | null> {
  const row = await db
    .prepare(`${TASK_SELECT} WHERE t.id = ? AND t.user_id = ?`)
    .bind(taskId, userId)
    .first<TaskRow>()
  return row ? mapTask(row) : null
}

export async function listTasksForUser(
  db: D1Database,
  userId: string,
  opts: { status?: TaskStatus | 'all'; limit?: number } = {},
): Promise<Task[]> {
  const status = opts.status ?? 'open'
  const limit = opts.limit ?? 100
  let sql = `${TASK_SELECT} WHERE t.user_id = ? AND COALESCE(t.skipped, 0) = 0`
  const binds: (string | number)[] = [userId]
  if (status !== 'all') {
    sql += ' AND t.status = ?'
    binds.push(status)
  }
  sql += ` ORDER BY
    CASE t.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
    CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END,
    t.due_date ASC,
    t.created_at DESC
    LIMIT ?`
  binds.push(limit)
  const result = await db
    .prepare(sql)
    .bind(...binds)
    .all<TaskRow>()
  return (result.results ?? []).map(mapTask)
}

export async function resolveCategoryId(
  db: D1Database,
  userId: string,
  categoryId?: string | null,
  categorySlug?: string | null,
): Promise<string | null> {
  if (categoryId) {
    const row = await db
      .prepare(
        `SELECT id FROM categories
         WHERE id = ? AND (user_id IS NULL OR user_id = ?)`,
      )
      .bind(categoryId, userId)
      .first<{ id: string }>()
    return row?.id ?? null
  }
  if (categorySlug) {
    const custom = await db
      .prepare(
        `SELECT id FROM categories WHERE slug = ? AND user_id = ? LIMIT 1`,
      )
      .bind(categorySlug, userId)
      .first<{ id: string }>()
    if (custom) return custom.id
    const builtin = await db
      .prepare(
        `SELECT id FROM categories WHERE slug = ? AND user_id IS NULL LIMIT 1`,
      )
      .bind(categorySlug)
      .first<{ id: string }>()
    return builtin?.id ?? null
  }
  return null
}
