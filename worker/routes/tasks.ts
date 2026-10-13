import { Hono } from 'hono'

import type { TaskPriority, TaskStatus } from '../../shared/types'
import type { Env } from '../env'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'
import {
  getTaskForUser,
  listTasksForUser,
  resolveCategoryId,
} from '../lib/tasks'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const taskRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

taskRoutes.get('/', async (c) => {
  const user = c.get('user')
  const statusParam = c.req.query('status') ?? 'open'
  const status =
    statusParam === 'all' ||
    statusParam === 'open' ||
    statusParam === 'completed' ||
    statusParam === 'cancelled'
      ? statusParam
      : 'open'
  const tasks = await listTasksForUser(c.env.DB, user.id, { status })
  return c.json({ tasks })
})

taskRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const title = asString(body?.title, 200)
  if (!title) return c.json({ error: 'Title is required' }, 400)

  const notes = typeof body?.notes === 'string' ? body.notes.slice(0, 4000) : ''
  const priority = (asString(body?.priority, 20) ?? 'normal') as TaskPriority
  if (!['low', 'normal', 'high'].includes(priority)) {
    return c.json({ error: 'Invalid priority' }, 400)
  }
  const dueDate =
    typeof body?.dueDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)
      ? body.dueDate
      : null
  const capacityCost =
    typeof body?.capacityCost === 'number' &&
    body.capacityCost >= 1 &&
    body.capacityCost <= 5
      ? Math.round(body.capacityCost)
      : 1

  const categoryId = await resolveCategoryId(
    c.env.DB,
    user.id,
    typeof body?.categoryId === 'string' ? body.categoryId : null,
    typeof body?.categorySlug === 'string' ? body.categorySlug : null,
  )

  const id = newId('task')
  await c.env.DB.prepare(
    `INSERT INTO tasks
      (id, user_id, category_id, title, notes, priority, due_date, capacity_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      categoryId,
      title,
      notes,
      priority,
      dueDate,
      capacityCost,
    )
    .run()

  const task = await getTaskForUser(c.env.DB, user.id, id)
  return c.json({ task }, 201)
})

taskRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await getTaskForUser(c.env.DB, user.id, id)
  if (!existing) return c.json({ error: 'Task not found' }, 404)

  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null

  const title =
    body?.title !== undefined ? asString(body.title, 200) : existing.title
  if (!title) return c.json({ error: 'Title is required' }, 400)

  const notes =
    typeof body?.notes === 'string' ? body.notes.slice(0, 4000) : existing.notes
  const priority = (asString(body?.priority, 20) ??
    existing.priority) as TaskPriority
  if (!['low', 'normal', 'high'].includes(priority)) {
    return c.json({ error: 'Invalid priority' }, 400)
  }

  let dueDate = existing.dueDate
  if (body && 'dueDate' in body) {
    dueDate =
      typeof body.dueDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)
        ? body.dueDate
        : null
  }

  const capacityCost =
    typeof body?.capacityCost === 'number' &&
    body.capacityCost >= 1 &&
    body.capacityCost <= 5
      ? Math.round(body.capacityCost)
      : existing.capacityCost

  let categoryId = existing.categoryId
  if (body && ('categoryId' in body || 'categorySlug' in body)) {
    categoryId = await resolveCategoryId(
      c.env.DB,
      user.id,
      typeof body.categoryId === 'string' ? body.categoryId : null,
      typeof body.categorySlug === 'string' ? body.categorySlug : null,
    )
  }

  let status: TaskStatus = existing.status
  let completedAt = existing.completedAt
  if (typeof body?.status === 'string') {
    if (!['open', 'completed', 'cancelled'].includes(body.status)) {
      return c.json({ error: 'Invalid status' }, 400)
    }
    status = body.status as TaskStatus
    if (status === 'completed' && existing.status !== 'completed') {
      completedAt = new Date().toISOString()
    }
    if (status === 'open') completedAt = null
  }

  await c.env.DB.prepare(
    `UPDATE tasks SET
      title = ?, notes = ?, priority = ?, due_date = ?, capacity_cost = ?,
      category_id = ?, status = ?, completed_at = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      title,
      notes,
      priority,
      dueDate,
      capacityCost,
      categoryId,
      status,
      completedAt,
      id,
      user.id,
    )
    .run()

  const task = await getTaskForUser(c.env.DB, user.id, id)
  return c.json({ task })
})

taskRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await getTaskForUser(c.env.DB, user.id, id)
  if (!existing) return c.json({ error: 'Task not found' }, 404)

  await c.env.DB.prepare(`DELETE FROM tasks WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .run()
  return c.json({ ok: true })
})
