/**
 * Administrative roles and subscription entitlements.
 *
 * They are deliberately separate:
 * - Roles (user_roles) grant administrative permissions. No API writes them;
 *   the only way in is the approval-gated promotion workflow.
 * - Entitlements (user_entitlements) grant customer features. Stripe will
 *   write `premium`; the promotion workflow writes `owner_premium`.
 * Buying Premium never grants a role, and a lapsed subscription never removes
 * Owner access or Owner Premium.
 */

export const ROLES = ['owner'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS = [
  'admin.access',
  'metrics.read',
  'customers.read',
  'customers.suspend',
  'customers.sessions.revoke',
  'subscriptions.read',
  'support.read',
  'support.write',
  'settings.read',
  'settings.write',
  'audit.read',
] as const
export type Permission = (typeof PERMISSIONS)[number]

/**
 * Role → permissions. A future restricted support role is one more entry
 * here (plus a row in the `roles` table), not a redesign.
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  owner: PERMISSIONS,
}

export function isRole(value: unknown): value is Role {
  return (
    typeof value === 'string' && (ROLES as readonly string[]).includes(value)
  )
}

export function permissionsFor(roles: readonly Role[]): Set<Permission> {
  const out = new Set<Permission>()
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) out.add(permission)
  }
  return out
}

export async function getActiveRoles(
  db: D1Database,
  userId: string,
): Promise<Role[]> {
  const rows = await db
    .prepare(
      `SELECT role FROM user_roles WHERE user_id = ? AND revoked_at IS NULL`,
    )
    .bind(userId)
    .all<{ role: string }>()
  return (rows.results ?? []).map((r) => r.role).filter(isRole)
}

// ------------------------------------------------------------------ plans

export const PLANS = ['free', 'premium', 'owner_premium'] as const
export type Plan = (typeof PLANS)[number]

export type EntitlementRow = {
  entitlement: string
  source: string
  status: string
  currentPeriodEnd: string | null
  endedAt: string | null
}

/** Stripe states that still give Premium access (past_due = retrying). */
const PREMIUM_ACCESS_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function resolvePlan(
  roles: readonly Role[],
  entitlements: readonly EntitlementRow[],
  now: Date = new Date(),
): Plan {
  // The Owner role always carries Owner Premium, whatever billing says.
  if (roles.includes('owner')) return 'owner_premium'
  const open = entitlements.filter((e) => !e.endedAt)
  if (
    open.some(
      (e) =>
        e.entitlement === 'owner_premium' &&
        e.source === 'admin' &&
        e.status === 'active',
    )
  ) {
    return 'owner_premium'
  }
  const premium = open.some(
    (e) =>
      e.entitlement === 'premium' &&
      PREMIUM_ACCESS_STATUSES.has(e.status) &&
      (!e.currentPeriodEnd || new Date(e.currentPeriodEnd) > now),
  )
  return premium ? 'premium' : 'free'
}

export async function getEntitlementRows(
  db: D1Database,
  userId: string,
): Promise<EntitlementRow[]> {
  const rows = await db
    .prepare(
      `SELECT entitlement, source, status,
              current_period_end as currentPeriodEnd, ended_at as endedAt
       FROM user_entitlements WHERE user_id = ?`,
    )
    .bind(userId)
    .all<EntitlementRow>()
  return rows.results ?? []
}

export type Access = {
  roles: Role[]
  plan: Plan
  isOwner: boolean
}

export async function loadAccess(
  db: D1Database,
  userId: string,
): Promise<Access> {
  const [roles, entitlements] = await Promise.all([
    getActiveRoles(db, userId),
    getEntitlementRows(db, userId),
  ])
  return {
    roles,
    plan: resolvePlan(roles, entitlements),
    isOwner: roles.includes('owner'),
  }
}

export const PLAN_LABELS: Record<Plan, string> = {
  free: 'Free',
  premium: 'Premium',
  owner_premium: 'Owner Premium',
}

/**
 * SQL twin of resolvePlan() for aggregate queries over many users. `u` must
 * alias the users table. Kept in step with resolvePlan by tests.
 */
export const PLAN_SQL = `CASE
  WHEN EXISTS (SELECT 1 FROM user_roles r
               WHERE r.user_id = u.id AND r.role = 'owner' AND r.revoked_at IS NULL)
    OR EXISTS (SELECT 1 FROM user_entitlements e
               WHERE e.user_id = u.id AND e.entitlement = 'owner_premium'
                 AND e.source = 'admin' AND e.status = 'active' AND e.ended_at IS NULL)
    THEN 'owner_premium'
  WHEN EXISTS (SELECT 1 FROM user_entitlements e
               WHERE e.user_id = u.id AND e.entitlement = 'premium'
                 AND e.status IN ('active', 'trialing', 'past_due')
                 AND e.ended_at IS NULL
                 AND (e.current_period_end IS NULL
                      OR e.current_period_end > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
    THEN 'premium'
  ELSE 'free'
END`
