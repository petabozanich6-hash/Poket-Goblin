/**
 * Cross-record links (document → task, note → event, reminder → task, …) must
 * only ever point at records the same user owns. Every route that stores a
 * client-supplied record id as a link target checks it here first.
 */

const OWNED_TABLES = {
  task: 'tasks',
  event: 'events',
  reminder: 'reminders',
} as const

export type LinkKind = keyof typeof OWNED_TABLES

export async function isOwnedRecord(
  db: D1Database,
  userId: string,
  kind: LinkKind,
  id: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM ${OWNED_TABLES[kind]} WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first()
  return Boolean(row)
}

export type LinkRequest = { kind: LinkKind; id: string | null | undefined }

/**
 * Returns the first requested link target the user does not own, or null when
 * every non-empty id is theirs. Unknown and foreign ids are treated the same
 * so the response never reveals whether another account's record exists.
 */
export async function firstUnownedLink(
  db: D1Database,
  userId: string,
  links: LinkRequest[],
): Promise<LinkKind | null> {
  for (const link of links) {
    if (!link.id) continue
    if (!(await isOwnedRecord(db, userId, link.kind, link.id))) return link.kind
  }
  return null
}

export function linkNotFound(kind: LinkKind) {
  return { error: `Linked ${kind} not found` }
}
