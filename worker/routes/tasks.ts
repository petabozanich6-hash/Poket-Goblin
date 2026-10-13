import { Hono } from 'hono'

import { generateOccurrences } from '../../shared/recurrence'
import type {
  RecurrenceFrequency,
  TaskPriority,
  TaskStatus,
} from '../../shared/types'
import type { Env } from '../env'
import { recordTaskHistory } from '../lib/history'
import { newId } from '../lib/ids'
import { maybeAwardAchievements } from '../lib/magical'
import type { AuthUser } from '../lib/session'
import { loadSettings } from '../lib/settings'
import {
  getTaskForUser,
  listTasksForUser,
  resolveCategoryId,
} from '../lib/tasks'
import { asString } from '../lib/validate'

const RECURRENCE: RecurrenceFrequency[] = [
  'daily',
  'weekly',
  'fortnightly',
  'monthly',
  'yearly',
]

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

  const recurrenceRaw = asString(body?.recurrenceFrequency, 20)
  const recurrenceFrequency =
    recurrenceRaw && RECURRENCE.includes(recurrenceRaw as RecurrenceFrequency)
      ? (recurrenceRaw as RecurrenceFrequency)
      : null

  if (recurrenceFrequency) {
    const startsOn = dueDate ?? new Date().toISOString().slice(0, 10)
    const recurrenceRuleId = newId('rrule')
    const seriesId = newId('series')
    await c.env.DB.prepare(
      `INSERT INTO recurrence_rules
        (id, user_id, frequency, interval_value, starts_on)
       VALUES (?, ?, ?, 1, ?)`,
    )
      .bind(recurrenceRuleId, user.id, recurrenceFrequency, startsOn)
      .run()

    let firstId: string | null = null
    const occurrences = generateOccurrences(
      { frequency: recurrenceFrequency, startsOn },
      4,
    )
    for (const occurrence of occurrences) {
      const id = newId('task')
      if (!firstId) firstId = id
      await c.env.DB.prepare(
        `INSERT INTO tasks
          (id, user_id, category_id, title, notes, priority, due_date,
           capacity_cost, recurrence_rule_id, series_id, occurrence_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          user.id,
          categoryId,
          title,
          notes || `Recurring (${recurrenceFrequency})`,
          priority,
          occurrence,
          capacityCost,
          recurrenceRuleId,
          seriesId,
          occurrence,
        )
        .run()
      await recordTaskHistory(
        c.env.DB,
        user.id,
        id,
        'created',
        `Recurring occurrence ${occurrence}`,
      )
    }
    const task = firstId
      ? await getTaskForUser(c.env.DB, user.id, firstId)
      : null
    return c.json({ task }, 201)
  }

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
  await recordTaskHistory(c.env.DB, user.id, id, 'created', 'Manual create')

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

  if (status !== existing.status) {
    await recordTaskHistory(
      c.env.DB,
      user.id,
      id,
      status === 'completed'
        ? 'completed'
        : status === 'open'
          ? 'reopened'
          : 'cancelled',
      `Status ${existing.status} → ${status}`,
    )
  } else {
    await recordTaskHistory(c.env.DB, user.id, id, 'updated', 'Task edited')
  }

  let achievements: Awaited<ReturnType<typeof maybeAwardAchievements>> = []
  if (status === 'completed' && existing.status !== 'completed') {
    await c.env.DB.prepare(
      `UPDATE user_settings
       SET completed_quest_count = completed_quest_count + 1,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE user_id = ?`,
    )
      .bind(user.id)
      .run()
    const settings = await loadSettings(c.env.DB, user.id)
    achievements = await maybeAwardAchievements(
      c.env.DB,
      user.id,
      settings.gamificationEnabled,
      settings.completedQuestCount,
    )
  }

  const task = await getTaskForUser(c.env.DB, user.id, id)
  return c.json({ task, achievements })
})

taskRoutes.post('/:id/skip', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await getTaskForUser(c.env.DB, user.id, id)
  if (!existing) return c.json({ error: 'Task not found' }, 404)

  await c.env.DB.prepare(
    `UPDATE tasks SET skipped = 1, status = 'cancelled',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .run()
  await recordTaskHistory(
    c.env.DB,
    user.id,
    id,
    'skipped',
    'Occurrence skipped',
  )
  return c.json({ ok: true })
})

taskRoutes.post('/:id/pause-series', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await getTaskForUser(c.env.DB, user.id, id)
  if (!existing?.recurrenceRuleId) {
    return c.json({ error: 'Not a recurring task' }, 400)
  }
  const result = await c.env.DB.prepare(
    `UPDATE recurrence_rules SET paused = 1
     WHERE id = ? AND user_id = ?`,
  )
    .bind(existing.recurrenceRuleId, user.id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Series not found' }, 404)
  await recordTaskHistory(
    c.env.DB,
    user.id,
    id,
    'paused',
    'Recurring series paused',
  )
  return c.json({ ok: true })
})

taskRoutes.post('/:id/stop-series', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await getTaskForUser(c.env.DB, user.id, id)
  if (!existing?.recurrenceRuleId) {
    return c.json({ error: 'Not a recurring task' }, 400)
  }
  const today = new Date().toISOString().slice(0, 10)
  await c.env.DB.prepare(
    `UPDATE recurrence_rules SET paused = 1, ends_on = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(today, existing.recurrenceRuleId, user.id)
    .run()
  await c.env.DB.prepare(
    `UPDATE tasks SET status = 'cancelled',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE user_id = ? AND recurrence_rule_id = ? AND status = 'open'
       AND (occurrence_date IS NULL OR occurrence_date > ?)`,
  )
    .bind(user.id, existing.recurrenceRuleId, today)
    .run()
  await recordTaskHistory(
    c.env.DB,
    user.id,
    id,
    'stopped',
    'Recurring series stopped',
  )
  return c.json({ ok: true })
})

taskRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await getTaskForUser(c.env.DB, user.id, id)
  if (!existing) return c.json({ error: 'Task not found' }, 404)

  await recordTaskHistory(c.env.DB, user.id, id, 'deleted', existing.title)
  await c.env.DB.prepare(`DELETE FROM tasks WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .run()
  return c.json({ ok: true })
})
