import { Hono } from 'hono'

import type { Env } from '../env'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'
import { resolveCategoryId } from '../lib/tasks'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const noteRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

const SELECT = `
  SELECT n.id, n.title, n.body, n.category_id as categoryId,
         c.slug as categorySlug, c.name as categoryName,
         n.pinned, n.linked_task_id as linkedTaskId,
         n.linked_event_id as linkedEventId,
         n.created_at as createdAt, n.updated_at as updatedAt
  FROM notes n
  LEFT JOIN categories c ON c.id = n.category_id
`

function mapNote(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    title: row.title as string,
    body: (row.body as string) ?? '',
    categoryId: (row.categoryId as string) ?? null,
    categorySlug: (row.categorySlug as string) ?? null,
    categoryName: (row.categoryName as string) ?? null,
    pinned: Boolean(row.pinned),
    linkedTaskId: (row.linkedTaskId as string) ?? null,
    linkedEventId: (row.linkedEventId as string) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  }
}

noteRoutes.get('/', async (c) => {
  const user = c.get('user')
  const q = c.req.query('q')?.trim()
  let sql = `${SELECT} WHERE n.user_id = ?`
  const binds: string[] = [user.id]
  if (q) {
    sql += ' AND (n.title LIKE ? OR n.body LIKE ?)'
    binds.push(`%${q}%`, `%${q}%`)
  }
  sql += ' ORDER BY n.pinned DESC, n.updated_at DESC LIMIT 100'
  const rows = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all()
  return c.json({ notes: (rows.results ?? []).map((r) => mapNote(r)) })
})

noteRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const title = asString(body?.title, 200)
  if (!title) return c.json({ error: 'Title is required' }, 400)
  const categoryId = await resolveCategoryId(
    c.env.DB,
    user.id,
    typeof body?.categoryId === 'string' ? body.categoryId : null,
    typeof body?.categorySlug === 'string' ? body.categorySlug : null,
  )
  const id = newId('note')
  await c.env.DB.prepare(
    `INSERT INTO notes (id, user_id, title, body, category_id, pinned, linked_task_id, linked_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      title,
      typeof body?.body === 'string' ? body.body.slice(0, 20000) : '',
      categoryId,
      body?.pinned ? 1 : 0,
      typeof body?.linkedTaskId === 'string' ? body.linkedTaskId : null,
      typeof body?.linkedEventId === 'string' ? body.linkedEventId : null,
    )
    .run()
  const row = await c.env.DB.prepare(
    `${SELECT} WHERE n.id = ? AND n.user_id = ?`,
  )
    .bind(id, user.id)
    .first()
  return c.json({ note: mapNote(row!) }, 201)
})

noteRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare(
    `${SELECT} WHERE n.id = ? AND n.user_id = ?`,
  )
    .bind(id, user.id)
    .first()
  if (!existing) return c.json({ error: 'Note not found' }, 404)

  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const title =
    body?.title !== undefined
      ? asString(body.title, 200)
      : (existing.title as string)
  if (!title) return c.json({ error: 'Title is required' }, 400)

  let categoryId: string | null =
    typeof existing.categoryId === 'string' ? existing.categoryId : null
  if (body && ('categoryId' in body || 'categorySlug' in body)) {
    categoryId = await resolveCategoryId(
      c.env.DB,
      user.id,
      typeof body.categoryId === 'string' ? body.categoryId : null,
      typeof body.categorySlug === 'string' ? body.categorySlug : null,
    )
  }

  await c.env.DB.prepare(
    `UPDATE notes SET title = ?, body = ?, category_id = ?, pinned = ?,
      linked_task_id = ?, linked_event_id = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      title,
      typeof body?.body === 'string'
        ? body.body.slice(0, 20000)
        : (existing.body as string),
      categoryId,
      typeof body?.pinned === 'boolean'
        ? body.pinned
          ? 1
          : 0
        : existing.pinned
          ? 1
          : 0,
      typeof body?.linkedTaskId === 'string'
        ? body.linkedTaskId
        : ((existing.linkedTaskId as string) ?? null),
      typeof body?.linkedEventId === 'string'
        ? body.linkedEventId
        : ((existing.linkedEventId as string) ?? null),
      id,
      user.id,
    )
    .run()

  const row = await c.env.DB.prepare(
    `${SELECT} WHERE n.id = ? AND n.user_id = ?`,
  )
    .bind(id, user.id)
    .first()
  return c.json({ note: mapNote(row!) })
})

noteRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    `DELETE FROM notes WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Note not found' }, 404)
  return c.json({ ok: true })
})
