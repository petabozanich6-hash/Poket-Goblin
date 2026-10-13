import { Hono } from 'hono'

import type { Env } from '../env'
import type { AuthUser } from '../lib/session'

type Vars = { user: AuthUser }

export const historyRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

historyRoutes.get('/tasks', async (c) => {
  const user = c.get('user')

  const history = await c.env.DB.prepare(
    `SELECT h.id, h.task_id as taskId, t.title as taskTitle,
            h.action, h.detail, h.created_at as createdAt
     FROM task_history h
     LEFT JOIN tasks t ON t.id = h.task_id
     WHERE h.user_id = ?
     ORDER BY h.created_at DESC
     LIMIT 100`,
  )
    .bind(user.id)
    .all()

  const completed = await c.env.DB.prepare(
    `SELECT id, title, completed_at as completedAt, updated_at as updatedAt, skipped
     FROM tasks
     WHERE user_id = ? AND (status = 'completed' OR skipped = 1)
     ORDER BY COALESCE(completed_at, updated_at) DESC
     LIMIT 50`,
  )
    .bind(user.id)
    .all()

  return c.json({
    entries: (history.results ?? []).map((row) => ({
      id: row.id,
      taskId: row.taskId,
      taskTitle: row.taskTitle ?? null,
      action: row.action,
      detail: row.detail,
      createdAt: row.createdAt,
    })),
    completedTasks: completed.results ?? [],
  })
})
