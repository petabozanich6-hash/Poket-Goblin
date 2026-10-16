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

/** Counts document processing events in the current UTC calendar month. */
export async function freeDocumentProcessingQuota(
  db: D1Database,
  userId: string,
) {
  const access = await loadAccess(db, userId)
  if (access.plan !== 'free') return null
  const monthStart = new Date().toISOString().slice(0, 7) + '-01'
  const used = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM ai_events WHERE user_id = ? AND feature = 'document' AND created_at >= ?",
    )
    .bind(userId, monthStart)
    .first<{ n: number }>()
  if (Number(used?.n ?? 0) < 2) return null
  return {
    error:
      'Free includes 2 document reads per month. Upgrade to Premium for more.',
    code: 'FREE_PLAN_LIMIT',
    resource: 'document_processing',
    limit: 2,
  }
}
