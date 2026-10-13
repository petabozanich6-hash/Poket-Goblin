import { Hono } from 'hono'

import { interpretBrainDump } from '../../shared/brainDump'
import type { Env } from '../env'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'
import { getTaskForUser, resolveCategoryId } from '../lib/tasks'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const captureRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

async function loadCapture(db: D1Database, userId: string, captureId: string) {
  const capture = await db
    .prepare(
      `SELECT id, raw_text as rawText, status, created_at as createdAt
       FROM captures WHERE id = ? AND user_id = ?`,
    )
    .bind(captureId, userId)
    .first<{
      id: string
      rawText: string
      status: 'pending' | 'reviewed' | 'dismissed'
      createdAt: string
    }>()
  if (!capture) return null

  const items = await db
    .prepare(
      `SELECT id, kind, title, due_date as dueDate, category_slug as categorySlug,
              confidence, uncertain, status, created_task_id as createdTaskId
       FROM capture_items WHERE capture_id = ? AND user_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(captureId, userId)
    .all<{
      id: string
      kind: string
      title: string
      dueDate: string | null
      categorySlug: string | null
      confidence: string
      uncertain: number
      status: string
      createdTaskId: string | null
    }>()

  return {
    ...capture,
    items: (items.results ?? []).map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      dueDate: item.dueDate,
      categorySlug: item.categorySlug,
      confidence: item.confidence,
      uncertain: Boolean(item.uncertain),
      status: item.status,
      createdTaskId: item.createdTaskId,
    })),
  }
}

captureRoutes.get('/', async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT id FROM captures WHERE user_id = ?
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(user.id)
    .all<{ id: string }>()

  const captures = []
  for (const row of rows.results ?? []) {
    const capture = await loadCapture(c.env.DB, user.id, row.id)
    if (capture) captures.push(capture)
  }
  return c.json({ captures })
})

captureRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const rawText = asString(body?.text, 4000)
  if (!rawText) return c.json({ error: 'Capture text is required' }, 400)

  const suggestions = interpretBrainDump(rawText)
  if (suggestions.length === 0) {
    return c.json({ error: 'Could not find anything actionable yet' }, 400)
  }

  const captureId = newId('cap')
  await c.env.DB.prepare(
    `INSERT INTO captures (id, user_id, raw_text) VALUES (?, ?, ?)`,
  )
    .bind(captureId, user.id, rawText)
    .run()

  for (const suggestion of suggestions) {
    await c.env.DB.prepare(
      `INSERT INTO capture_items
        (id, capture_id, user_id, kind, title, due_date, category_slug, confidence, uncertain)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId('citem'),
        captureId,
        user.id,
        suggestion.kind,
        suggestion.title,
        suggestion.dueDate,
        suggestion.categorySlug,
        suggestion.confidence,
        suggestion.uncertain ? 1 : 0,
      )
      .run()
  }

  const capture = await loadCapture(c.env.DB, user.id, captureId)
  return c.json({ capture }, 201)
})

captureRoutes.post('/:captureId/items/:itemId/accept', async (c) => {
  const user = c.get('user')
  const captureId = c.req.param('captureId')
  const itemId = c.req.param('itemId')

  const item = await c.env.DB.prepare(
    `SELECT id, kind, title, due_date as dueDate, category_slug as categorySlug, status
     FROM capture_items
     WHERE id = ? AND capture_id = ? AND user_id = ?`,
  )
    .bind(itemId, captureId, user.id)
    .first<{
      id: string
      kind: string
      title: string
      dueDate: string | null
      categorySlug: string | null
      status: string
    }>()

  if (!item) return c.json({ error: 'Suggestion not found' }, 404)
  if (item.status === 'accepted') {
    return c.json({ error: 'Already accepted' }, 409)
  }

  const categoryId = await resolveCategoryId(
    c.env.DB,
    user.id,
    null,
    item.categorySlug,
  )
  const taskId = newId('task')
  const priority = item.kind === 'appointment' ? 'high' : 'normal'

  await c.env.DB.prepare(
    `INSERT INTO tasks
      (id, user_id, category_id, title, notes, priority, due_date, capacity_cost)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      taskId,
      user.id,
      categoryId,
      item.title,
      `From brain dump (${item.kind})`,
      priority,
      item.dueDate,
      1,
    )
    .run()

  await c.env.DB.prepare(
    `UPDATE capture_items
     SET status = 'accepted', created_task_id = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(taskId, itemId, user.id)
    .run()

  const remaining = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM capture_items
     WHERE capture_id = ? AND status = 'suggested'`,
  )
    .bind(captureId)
    .first<{ count: number }>()

  if ((remaining?.count ?? 0) === 0) {
    await c.env.DB.prepare(
      `UPDATE captures SET status = 'reviewed' WHERE id = ? AND user_id = ?`,
    )
      .bind(captureId, user.id)
      .run()
  }

  const task = await getTaskForUser(c.env.DB, user.id, taskId)
  const capture = await loadCapture(c.env.DB, user.id, captureId)
  return c.json({ task, capture })
})

captureRoutes.post('/:captureId/items/:itemId/reject', async (c) => {
  const user = c.get('user')
  const captureId = c.req.param('captureId')
  const itemId = c.req.param('itemId')

  const result = await c.env.DB.prepare(
    `UPDATE capture_items SET status = 'rejected'
     WHERE id = ? AND capture_id = ? AND user_id = ? AND status = 'suggested'`,
  )
    .bind(itemId, captureId, user.id)
    .run()

  if (!result.meta.changes) {
    return c.json({ error: 'Suggestion not found' }, 404)
  }

  const remaining = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM capture_items
     WHERE capture_id = ? AND status = 'suggested'`,
  )
    .bind(captureId)
    .first<{ count: number }>()

  if ((remaining?.count ?? 0) === 0) {
    await c.env.DB.prepare(
      `UPDATE captures SET status = 'reviewed' WHERE id = ? AND user_id = ?`,
    )
      .bind(captureId, user.id)
      .run()
  }

  const capture = await loadCapture(c.env.DB, user.id, captureId)
  return c.json({ capture })
})
