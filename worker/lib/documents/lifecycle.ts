/**
 * Document lifecycle: what is kept, for how long, and how it is forgotten.
 *
 * Forgetting a document removes the original from storage, every suggestion
 * and extraction derived from it, its links, and the document record itself.
 * It never touches tasks, reminders, events or notes the user approved:
 * those are the user's own records now.
 */
import type { Env } from '../../env'
import { getObjectStore } from '../storage'

/** "Just sort it" originals live at most this long. */
export const TEMPORARY_TTL_MS = 24 * 60 * 60_000
/** A "keep" upload that never finished storing is cleaned up after this. */
export const UPLOAD_GRACE_MS = 60 * 60_000
/** Fair use for temporary processing. */
export const MAX_PENDING_TEMPORARY = 10
export const DAILY_DOCUMENT_PROCESSING = {
  free: 10,
  premium: 100,
  owner_premium: 200,
} as const

export function temporaryKey(userId: string, documentId: string) {
  return `tmp/${userId}/${documentId}`
}

export function keptKey(userId: string, documentId: string, safeName: string) {
  return `${userId}/${documentId}/${safeName}`
}

/** Delete a document's original from storage. Missing objects are fine. */
export async function deleteOriginal(env: Env, storageKey: string | null) {
  if (!storageKey) return
  try {
    await getObjectStore(env).delete(storageKey)
  } catch (error) {
    // Leave expires_at in place so the sweep retries.
    console.error(
      'original not deleted; will retry',
      error instanceof Error ? error.name : 'Error',
    )
    throw error
  }
}

/**
 * Forget a document completely. Scoped to the owner; returns false if the
 * document does not exist for this user.
 */
export async function forgetDocument(
  env: Env,
  userId: string,
  documentId: string,
): Promise<boolean> {
  const doc = await env.DB.prepare(
    `SELECT storage_key as storageKey FROM documents WHERE id = ? AND user_id = ?`,
  )
    .bind(documentId, userId)
    .first<{ storageKey: string }>()
  if (!doc) return false
  await deleteOriginal(env, doc.storageKey)
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM review_items WHERE user_id = ? AND source_type = 'document' AND source_id = ?`,
    ).bind(userId, documentId),
    env.DB.prepare(
      `DELETE FROM document_extractions WHERE user_id = ? AND document_id = ?`,
    ).bind(userId, documentId),
    env.DB.prepare(
      `DELETE FROM record_links WHERE user_id = ? AND from_type = 'document' AND from_id = ?`,
    ).bind(userId, documentId),
    env.DB.prepare(`DELETE FROM documents WHERE id = ? AND user_id = ?`).bind(
      documentId,
      userId,
    ),
  ])
  return true
}

/**
 * Sweep: forget every document past its expiry — abandoned "Just sort it"
 * reviews and uploads that never finished. Runs hourly (Cron Trigger) and
 * opportunistically on upload. Logs counts only, never names or content.
 */
export async function sweepExpiredDocuments(
  env: Env,
  now: Date = new Date(),
  limit = 200,
): Promise<{ forgotten: number; failed: number }> {
  const rows = await env.DB.prepare(
    `SELECT id, user_id as userId FROM documents
     WHERE expires_at IS NOT NULL AND expires_at < ?
     ORDER BY expires_at ASC LIMIT ?`,
  )
    .bind(now.toISOString(), limit)
    .all<{ id: string; userId: string }>()
  let forgotten = 0
  let failed = 0
  for (const row of rows.results ?? []) {
    try {
      if (await forgetDocument(env, row.userId, row.id)) forgotten += 1
    } catch {
      failed += 1
    }
  }
  return { forgotten, failed }
}

/** Housekeeping for other short-lived security rows. */
export async function sweepExpiredChallenges(env: Env, now: Date = new Date()) {
  await env.DB.prepare(`DELETE FROM webauthn_challenges WHERE expires_at < ?`)
    .bind(now.toISOString())
    .run()
}
