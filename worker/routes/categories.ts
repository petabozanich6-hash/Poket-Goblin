import { Hono } from 'hono'

import type { Env } from '../env'
import type { AuthUser } from '../lib/session'

type Vars = { user: AuthUser }

export const categoryRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

categoryRoutes.get('/', async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT id, slug, name, sort_order as sortOrder, is_builtin as isBuiltin
     FROM categories
     WHERE user_id IS NULL OR user_id = ?
     ORDER BY sort_order ASC, name ASC`,
  )
    .bind(user.id)
    .all<{
      id: string
      slug: string
      name: string
      sortOrder: number
      isBuiltin: number
    }>()

  return c.json({
    categories: (rows.results ?? []).map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      sortOrder: row.sortOrder,
      isBuiltin: Boolean(row.isBuiltin),
    })),
  })
})
