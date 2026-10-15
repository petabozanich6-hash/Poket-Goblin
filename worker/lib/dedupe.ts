import { normalizeTitle, type ExistingItemRef } from '../../shared/intelligence'

/**
 * Duplicate protection for organised suggestions.
 *
 * - `loadOpenItemIndex` / `findExistingItem`: does the user already have an
 *   open task or unticked shopping item with the same (normalised) title?
 * - `claimCaptureItem`: atomically moves a suggestion out of `suggested`, so a
 *   double-tap or accepting from both Capture and Inbox creates one record.
 */

export type OpenItemIndex = {
  tasks: Map<string, ExistingItemRef>
  shopping: Map<string, ExistingItemRef>
}

export async function loadOpenItemIndex(
  db: D1Database,
  userId: string,
): Promise<OpenItemIndex> {
  const [tasks, shopping] = await Promise.all([
    db
      .prepare(
        `SELECT id, title FROM tasks
         WHERE user_id = ? AND status = 'open'
         ORDER BY created_at DESC LIMIT 1000`,
      )
      .bind(userId)
      .all<{ id: string; title: string }>(),
    db
      .prepare(
        `SELECT id, name as title FROM shopping_items
         WHERE user_id = ? AND checked = 0 AND removed_at IS NULL
         ORDER BY created_at DESC LIMIT 500`,
      )
      .bind(userId)
      .all<{ id: string; title: string }>(),
  ])

  const index: OpenItemIndex = { tasks: new Map(), shopping: new Map() }
  for (const row of tasks.results ?? []) {
    const key = normalizeTitle(row.title)
    if (key && !index.tasks.has(key)) {
      index.tasks.set(key, { kind: 'task', id: row.id, title: row.title })
    }
  }
  for (const row of shopping.results ?? []) {
    const key = normalizeTitle(row.title)
    if (key && !index.shopping.has(key)) {
      index.shopping.set(key, {
        kind: 'shopping',
        id: row.id,
        title: row.title,
      })
    }
  }
  return index
}

/** Kinds that create a task (reminders also create a linked task). */
const TASK_KINDS = new Set(['task', 'follow_up', 'reminder'])

export function findExistingItem(
  index: OpenItemIndex,
  kind: string,
  title: string,
): ExistingItemRef | null {
  const key = normalizeTitle(title)
  if (!key) return null
  if (kind === 'shopping') return index.shopping.get(key) ?? null
  if (TASK_KINDS.has(kind)) return index.tasks.get(key) ?? null
  return null
}

export async function findExistingForUser(
  db: D1Database,
  userId: string,
  kind: string,
  title: string,
): Promise<ExistingItemRef | null> {
  if (kind !== 'shopping' && !TASK_KINDS.has(kind)) return null
  return findExistingItem(await loadOpenItemIndex(db, userId), kind, title)
}

/** Returns true only for the single request that wins the suggestion. */
export async function claimCaptureItem(
  db: D1Database,
  userId: string,
  itemId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE capture_items SET status = 'accepted'
       WHERE id = ? AND user_id = ? AND status = 'suggested'`,
    )
    .bind(itemId, userId)
    .run()
  return Boolean(result.meta.changes)
}

/** Undo a claim when creating the record failed, so the user can retry. */
export async function releaseCaptureItem(
  db: D1Database,
  userId: string,
  itemId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE capture_items SET status = 'suggested'
       WHERE id = ? AND user_id = ? AND status = 'accepted'
         AND created_task_id IS NULL AND created_event_id IS NULL
         AND created_note_id IS NULL AND created_shopping_item_id IS NULL
         AND created_reminder_id IS NULL`,
    )
    .bind(itemId, userId)
    .run()
}

export function duplicateMessage(existing: ExistingItemRef): string {
  return existing.kind === 'shopping'
    ? `“${existing.title}” is already on your shopping list.`
    : `You already have an open task “${existing.title}”.`
}
