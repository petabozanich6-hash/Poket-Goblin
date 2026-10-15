/**
 * The Devourer acts first: confident suggestions from a document become real
 * tasks, reminders and calendar entries straight away, with one Undo for the
 * lot. Anything uncertain (a guessed date, "within 28 days", an overdue
 * item) stays for the person to check. "Ask me before the Goblin changes
 * anything" in Settings turns this off.
 *
 * Only suggestions the built-in reader took straight from the document's
 * text are added. Anything a model suggested waits for a yes, so a document
 * with hidden instructions can't get the AI to put things on someone's list.
 */
import { acceptReviewItem } from '../reviewAccept'

export const AUTO_REASON = 'Added automatically'

export type AutoAddResult = { added: number; already: number }

export async function autoAddFromDocument(
  db: D1Database,
  userId: string,
  documentId: string,
  timezoneOffsetMinutes: number,
): Promise<AutoAddResult> {
  const result: AutoAddResult = { added: 0, already: 0 }
  const autonomy = await db
    .prepare(`SELECT goblin_autonomy as a FROM user_settings WHERE user_id = ?`)
    .bind(userId)
    .first<{ a: string }>()
  if (autonomy?.a === 'ask') return result

  const rows = await db
    .prepare(
      `SELECT id, suggestion_type as type, payload_json as payload, uncertain
       FROM review_items
       WHERE user_id = ? AND source_type = 'document' AND source_id = ?
         AND status = 'pending'
       ORDER BY created_at ASC, rowid ASC`,
    )
    .bind(userId, documentId)
    .all<{ id: string; type: string; payload: string; uncertain: number }>()

  for (const row of rows.results ?? []) {
    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(row.payload || '{}') as Record<string, unknown>
    } catch {
      continue
    }
    const dated = typeof payload.dueDate === 'string'
    if (row.uncertain || row.type === 'note' || payload.origin === 'ai')
      continue
    if (row.type !== 'task' && !dated) continue
    const accepted = await acceptReviewItem(
      db,
      userId,
      row.id,
      { timezoneOffsetMinutes },
      `${AUTO_REASON}:${row.id}`,
    )
    if (accepted.status === 200) result.added += 1
    else if (accepted.status === 409 && accepted.body.duplicateOf) {
      // Already on their list: don't make a twin, and don't ask about it.
      await db
        .prepare(
          `UPDATE review_items SET status = 'dismissed',
             reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND user_id = ? AND status = 'pending'`,
        )
        .bind(row.id, userId)
        .run()
      result.already += 1
    }
  }
  return result
}

/** Undo everything the Devourer added on its own from this document. */
export async function undoAutoAdd(
  db: D1Database,
  userId: string,
  documentId: string,
): Promise<number> {
  const links = await db
    .prepare(
      `SELECT id, to_type as toType, to_id as toId, reason FROM record_links
       WHERE user_id = ? AND from_type = 'document' AND from_id = ?
         AND reason LIKE ?`,
    )
    .bind(userId, documentId, `${AUTO_REASON}:%`)
    .all<{ id: string; toType: string; toId: string; reason: string }>()
  const statements: D1PreparedStatement[] = []
  for (const link of links.results ?? []) {
    const reviewId = link.reason.slice(AUTO_REASON.length + 1)
    const undo =
      link.toType === 'task'
        ? `UPDATE tasks SET status = 'cancelled',
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND user_id = ?`
        : link.toType === 'appointment'
          ? `UPDATE events SET status = 'cancelled',
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ? AND user_id = ?`
          : link.toType === 'reminder' || link.toType === 'follow_up'
            ? `UPDATE reminders SET status = 'dismissed',
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE id = ? AND user_id = ?`
            : link.toType === 'shopping'
              ? `UPDATE shopping_items SET removed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ? AND user_id = ?`
              : null
    if (undo) statements.push(db.prepare(undo).bind(link.toId, userId))
    statements.push(
      db
        .prepare(`DELETE FROM record_links WHERE id = ? AND user_id = ?`)
        .bind(link.id, userId),
      // Back to "check these", so they can pick and choose instead.
      db
        .prepare(
          `UPDATE review_items SET status = 'pending', reviewed_at = NULL
           WHERE id = ? AND user_id = ?`,
        )
        .bind(reviewId, userId),
    )
  }
  if (statements.length) await db.batch(statements)
  return links.results?.length ?? 0
}
