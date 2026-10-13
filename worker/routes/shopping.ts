import { Hono } from 'hono'

import type { Env } from '../env'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'
import { ensureDefaultShoppingList } from '../lib/shopping'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const shoppingRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

async function loadList(db: D1Database, userId: string, listId: string) {
  const list = await db
    .prepare(
      `SELECT id, name, is_default as isDefault, created_at as createdAt
       FROM shopping_lists WHERE id = ? AND user_id = ?`,
    )
    .bind(listId, userId)
    .first<{
      id: string
      name: string
      isDefault: number
      createdAt: string
    }>()
  if (!list) return null

  const items = await db
    .prepare(
      `SELECT id, list_id as listId, name, quantity, notes, checked, sort_order as sortOrder,
              created_at as createdAt, updated_at as updatedAt
       FROM shopping_items WHERE list_id = ? AND user_id = ?
       ORDER BY checked ASC, sort_order ASC, created_at ASC`,
    )
    .bind(listId, userId)
    .all()

  return {
    id: list.id,
    name: list.name,
    isDefault: Boolean(list.isDefault),
    createdAt: list.createdAt,
    items: (items.results ?? []).map((item) => ({
      id: item.id as string,
      listId: item.listId as string,
      name: item.name as string,
      quantity: (item.quantity as string) ?? '',
      notes: (item.notes as string) ?? '',
      checked: Boolean(item.checked),
      sortOrder: item.sortOrder as number,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    })),
  }
}

shoppingRoutes.get('/', async (c) => {
  const user = c.get('user')
  await ensureDefaultShoppingList(c.env.DB, user.id)
  const lists = await c.env.DB.prepare(
    `SELECT id FROM shopping_lists WHERE user_id = ? ORDER BY is_default DESC, name ASC`,
  )
    .bind(user.id)
    .all<{ id: string }>()

  const result = []
  for (const row of lists.results ?? []) {
    const list = await loadList(c.env.DB, user.id, row.id)
    if (list) result.push(list)
  }
  return c.json({ lists: result })
})

shoppingRoutes.post('/items', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const name = asString(body?.name, 200)
  if (!name) return c.json({ error: 'Item name is required' }, 400)

  const listId =
    typeof body?.listId === 'string'
      ? body.listId
      : await ensureDefaultShoppingList(c.env.DB, user.id)

  const owned = await c.env.DB.prepare(
    `SELECT id FROM shopping_lists WHERE id = ? AND user_id = ?`,
  )
    .bind(listId, user.id)
    .first()
  if (!owned) return c.json({ error: 'List not found' }, 404)

  const maxOrder = await c.env.DB.prepare(
    `SELECT COALESCE(MAX(sort_order), 0) as maxOrder FROM shopping_items WHERE list_id = ?`,
  )
    .bind(listId)
    .first<{ maxOrder: number }>()

  const id = newId('sitem')
  await c.env.DB.prepare(
    `INSERT INTO shopping_items
      (id, list_id, user_id, name, quantity, notes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      listId,
      user.id,
      name,
      typeof body?.quantity === 'string' ? body.quantity.slice(0, 40) : '',
      typeof body?.notes === 'string' ? body.notes.slice(0, 400) : '',
      (maxOrder?.maxOrder ?? 0) + 1,
    )
    .run()

  const list = await loadList(c.env.DB, user.id, listId)
  return c.json({ list, itemId: id }, 201)
})

shoppingRoutes.patch('/items/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare(
    `SELECT id, list_id as listId, name, quantity, notes, checked, sort_order as sortOrder
     FROM shopping_items WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first<{
      id: string
      listId: string
      name: string
      quantity: string
      notes: string
      checked: number
      sortOrder: number
    }>()
  if (!existing) return c.json({ error: 'Item not found' }, 404)

  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null

  await c.env.DB.prepare(
    `UPDATE shopping_items SET
      name = ?, quantity = ?, notes = ?, checked = ?, sort_order = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      typeof body?.name === 'string' ? body.name.slice(0, 200) : existing.name,
      typeof body?.quantity === 'string'
        ? body.quantity.slice(0, 40)
        : existing.quantity,
      typeof body?.notes === 'string'
        ? body.notes.slice(0, 400)
        : existing.notes,
      typeof body?.checked === 'boolean'
        ? body.checked
          ? 1
          : 0
        : existing.checked,
      typeof body?.sortOrder === 'number' ? body.sortOrder : existing.sortOrder,
      id,
      user.id,
    )
    .run()

  const list = await loadList(c.env.DB, user.id, existing.listId)
  return c.json({ list })
})

shoppingRoutes.delete('/items/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare(
    `SELECT list_id as listId FROM shopping_items WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first<{ listId: string }>()
  if (!existing) return c.json({ error: 'Item not found' }, 404)

  await c.env.DB.prepare(
    `DELETE FROM shopping_items WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .run()

  const list = await loadList(c.env.DB, user.id, existing.listId)
  return c.json({ list })
})
