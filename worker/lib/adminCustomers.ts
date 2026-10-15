/**
 * Customer metadata for Goblin HQ.
 *
 * Privacy contract: these queries return account metadata (email, dates,
 * status, plan), counts and byte sizes only. They never select titles,
 * bodies, raw captures, file names, extracted text, locations or any other
 * customer content. Tests plant content and assert it never appears.
 */
import { PLAN_SQL, type Plan } from './access'

export type CustomerSummary = {
  id: string
  email: string
  displayName: string
  createdAt: string
  status: string
  plan: Plan
  isOwner: boolean
  lastSeenAt: string | null
  documentCount: number
  storageBytes: number
  problems: number
}

const SUMMARY_SELECT = `
  SELECT u.id, u.email, u.display_name as displayName, u.created_at as createdAt,
         u.status, ${PLAN_SQL} as plan,
         EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id
                 AND r.role = 'owner' AND r.revoked_at IS NULL) as isOwner,
         (SELECT MAX(COALESCE(s.last_seen_at, s.created_at)) FROM sessions s
          WHERE s.user_id = u.id) as lastSeenAt,
         (SELECT COUNT(*) FROM documents d WHERE d.user_id = u.id
          AND d.retention = 'keep') as documentCount,
         (SELECT COALESCE(SUM(d.byte_size), 0) FROM documents d
          WHERE d.user_id = u.id AND d.retention = 'keep') as storageBytes,
         (SELECT COUNT(*) FROM documents d WHERE d.user_id = u.id AND d.status = 'failed')
         + (SELECT COUNT(*) FROM ai_events a WHERE a.user_id = u.id
            AND a.outcome = 'ai_unavailable'
            AND a.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'))
           as problems
  FROM users u`

type SummaryRow = Omit<CustomerSummary, 'isOwner'> & { isOwner: number }

function mapSummary(row: SummaryRow): CustomerSummary {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt,
    status: row.status,
    plan: row.plan,
    isOwner: Boolean(row.isOwner),
    lastSeenAt: row.lastSeenAt ?? null,
    documentCount: Number(row.documentCount),
    storageBytes: Number(row.storageBytes),
    problems: Number(row.problems),
  }
}

export type CustomerFilter = {
  q?: string
  status?: 'active' | 'suspended'
  plan?: Plan
  problemsOnly?: boolean
  limit: number
  offset: number
}

/** Escape LIKE wildcards so a search for "_" or "%" means the character. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}

export async function searchCustomers(db: D1Database, f: CustomerFilter) {
  const where: string[] = []
  const args: unknown[] = []
  if (f.q) {
    where.push(`(u.email LIKE ? ESCAPE '\\' OR u.id = ?)`)
    args.push(likeTerm(f.q.toLowerCase()), f.q)
  }
  if (f.status) {
    where.push('u.status = ?')
    args.push(f.status)
  }
  const base = `${SUMMARY_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`
  const outer: string[] = []
  const outerArgs: unknown[] = []
  if (f.plan) {
    outer.push('plan = ?')
    outerArgs.push(f.plan)
  }
  if (f.problemsOnly) outer.push('problems > 0')
  const filtered = `SELECT * FROM (${base})${outer.length ? ` WHERE ${outer.join(' AND ')}` : ''}`

  const rows = await db
    .prepare(`${filtered} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
    .bind(...args, ...outerArgs, f.limit + 1, f.offset)
    .all<SummaryRow>()
  const list = (rows.results ?? []).map(mapSummary)
  return {
    customers: list.slice(0, f.limit),
    hasMore: list.length > f.limit,
  }
}

export async function getCustomerSummary(
  db: D1Database,
  id: string,
): Promise<CustomerSummary | null> {
  const row = await db
    .prepare(`${SUMMARY_SELECT} WHERE u.id = ?`)
    .bind(id)
    .first<SummaryRow>()
  return row ? mapSummary(row) : null
}

/** Record counts per area: how much someone uses Pocket Goblin, not what. */
export async function getUsageTotals(db: D1Database, userId: string) {
  const tables = [
    ['tasks', 'tasks'],
    ['notes', 'notes'],
    ['events', 'events'],
    ['reminders', 'reminders'],
    ['shoppingItems', 'shopping_items'],
    ['captures', 'captures'],
    ['documents', 'documents'],
  ] as const
  const out: Record<string, number> = {}
  for (const [name, table] of tables) {
    const row = await db
      .prepare(`SELECT COUNT(*) as n FROM ${table} WHERE user_id = ?`)
      .bind(userId)
      .first<{ n: number }>()
    out[name] = Number(row?.n ?? 0)
  }
  const ai = await db
    .prepare(
      `SELECT COALESCE(SUM(request_count), 0) as n FROM ai_usage_daily
       WHERE user_id = ? AND usage_date >= ?`,
    )
    .bind(
      userId,
      new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10),
    )
    .first<{ n: number }>()
  out.aiRequests30d = Number(ai?.n ?? 0)
  return out
}

export async function getCustomerDetail(db: D1Database, id: string) {
  const summary = await getCustomerSummary(db, id)
  if (!summary) return null

  const entitlements = await db
    .prepare(
      `SELECT entitlement, source, status, billing_interval as billingInterval,
              currency, current_period_end as currentPeriodEnd,
              cancel_at_period_end as cancelAtPeriodEnd,
              created_at as createdAt, ended_at as endedAt
       FROM user_entitlements WHERE user_id = ? ORDER BY created_at DESC`,
    )
    .bind(id)
    .all()
  const suspension = await db
    .prepare(
      `SELECT suspended_at as suspendedAt, suspended_reason as reason FROM users WHERE id = ?`,
    )
    .bind(id)
    .first<{ suspendedAt: string | null; reason: string | null }>()
  const securityEvents = await db
    .prepare(
      `SELECT event_type as type, detail, created_at as createdAt
       FROM security_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 25`,
    )
    .bind(id)
    .all()
  const auditTrail = await db
    .prepare(
      `SELECT action, actor_label as actor, detail_json as detail, created_at as createdAt
       FROM admin_audit_log WHERE target_type = 'user' AND target_id = ?
       ORDER BY created_at DESC LIMIT 25`,
    )
    .bind(id)
    .all()
  const sessions = await db
    .prepare(
      `SELECT COUNT(*) as n FROM sessions WHERE user_id = ? AND expires_at > ?`,
    )
    .bind(id, new Date().toISOString())
    .first<{ n: number }>()
  const failedDocuments = await db
    .prepare(
      `SELECT COUNT(*) as n FROM documents WHERE user_id = ? AND status = 'failed'`,
    )
    .bind(id)
    .first<{ n: number }>()
  const aiFailures = await db
    .prepare(
      `SELECT COUNT(*) as n FROM ai_events WHERE user_id = ? AND outcome = 'ai_unavailable'
       AND created_at >= ?`,
    )
    .bind(id, new Date(Date.now() - 7 * 86_400_000).toISOString())
    .first<{ n: number }>()

  const problems: string[] = []
  if (Number(failedDocuments?.n ?? 0) > 0) {
    problems.push(`${failedDocuments?.n} document(s) failed processing`)
  }
  if (Number(aiFailures?.n ?? 0) > 0) {
    problems.push(`${aiFailures?.n} AI request(s) fell back in the last 7 days`)
  }

  return {
    customer: summary,
    suspension: summary.status === 'suspended' ? suspension : null,
    entitlements: entitlements.results ?? [],
    usage: await getUsageTotals(db, id),
    activeSessions: Number(sessions?.n ?? 0),
    problems,
    securityEvents: securityEvents.results ?? [],
    auditTrail: (auditTrail.results ?? []).map((r) => {
      const row = r as { detail: string }
      let detail: unknown = {}
      try {
        detail = JSON.parse(row.detail)
      } catch {
        detail = {}
      }
      return { ...r, detail }
    }),
  }
}
