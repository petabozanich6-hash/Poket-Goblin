import { newId } from './ids'

export async function ensureDefaultShoppingList(
  db: D1Database,
  userId: string,
): Promise<string> {
  const existing = await db
    .prepare(
      `SELECT id FROM shopping_lists
       WHERE user_id = ? AND is_default = 1 LIMIT 1`,
    )
    .bind(userId)
    .first<{ id: string }>()
  if (existing) return existing.id

  const id = newId('slist')
  await db
    .prepare(
      `INSERT INTO shopping_lists (id, user_id, name, is_default)
       VALUES (?, ?, 'Groceries', 1)`,
    )
    .bind(id, userId)
    .run()
  return id
}
