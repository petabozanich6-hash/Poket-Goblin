import { loadAccess } from './access'

export type FreeResource = 'tasks' | 'notes' | 'reminders'
const resources: Record<
  FreeResource,
  { table: string; predicate: string; limit: number; label: string }
> = {
  tasks: {
    table: 'tasks',
    predicate: "status = 'open'",
    limit: 10,
    label: 'active tasks',
  },
  notes: { table: 'notes', predicate: '1 = 1', limit: 5, label: 'notes' },
  reminders: {
    table: 'reminders',
    predicate: "status IN ('pending', 'snoozed')",
    limit: 3,
    label: 'active reminders',
  },
}

/** Free-plan write gate. Use on every creation or reopening path. */
export async function freeQuota(
  db: D1Database,
  userId: string,
  resource: FreeResource,
  adding = 1,
) {
  const access = await loadAccess(db, userId)
  if (access.plan !== 'free') return null
  const rule = resources[resource]
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM ${rule.table} WHERE user_id = ? AND ${rule.predicate}`,
    )
    .bind(userId)
    .first<{ n: number }>()
  if (Number(row?.n ?? 0) + adding <= rule.limit) return null
  return {
    error: `Free includes ${rule.limit} ${rule.label}. Upgrade to Premium to add more.`,
    code: 'FREE_PLAN_LIMIT',
    resource,
    limit: rule.limit,
  }
}

/**
 * Reserve a Free document read atomically before processing. Uses the same
 * D1 conditional-upsert technique as Workers AI to prevent concurrent reads
 * slipping through a count-then-write race. Reservations are intentionally
 * not refunded on failed processing (cost-protective, but disclose in UX).
 */
export async function freeDocumentProcessingQuota(
  db: D1Database,
  userId: string,
) {
  const access = await loadAccess(db, userId)
  if (access.plan !== 'free') return null
  const now = new Date()
  const month = now.getUTCFullYear() * 12 + now.getUTCMonth()
  const row = await db
    .prepare(
      `INSERT INTO ai_request_limits (scope, user_id, window_start, request_count)
     VALUES (?, ?, ?, 1)
     ON CONFLICT(scope) DO UPDATE SET
       window_start = excluded.window_start,
       request_count = CASE WHEN window_start < excluded.window_start
         THEN 1 ELSE request_count + 1 END
     WHERE window_start < excluded.window_start
       OR (window_start = excluded.window_start AND request_count < 2)`,
    )
    .bind(`document-month:${userId}`, userId, month)
    .run()
  if (row.meta.changes === 1) return null
  return {
    error:
      'Free includes 2 document reads per month. Upgrade to Premium for more.',
    code: 'FREE_PLAN_LIMIT',
    resource: 'document_processing',
    limit: 2,
  }
}
