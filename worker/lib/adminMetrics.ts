/**
 * Goblin HQ metrics. Every number here is an exact count or sum from D1.
 * Anything Pocket Goblin cannot measure is returned as `null` with a reason,
 * and the UI shows "Not configured" / "Data unavailable" instead of a guess.
 *
 * Privacy: only counts, sizes, dates and statuses. No titles, bodies, file
 * names or other customer content leave these queries.
 */
import type { Env } from '../env'
import { PLAN_SQL, type Plan } from './access'
import { resolveProvider } from './intelligence/provider'
import {
  aiDailyLimitFor,
  storageQuotaBytesFor,
  type PlatformSettings,
} from './platformSettings'

export type Unavailable = { available: false; reason: string }
const notConfigured = (reason: string): Unavailable => ({
  available: false,
  reason,
})

function daysAgo(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString()
}

async function count(
  db: D1Database,
  sql: string,
  ...args: unknown[]
): Promise<number> {
  const row = await db
    .prepare(sql)
    .bind(...args)
    .first<{ n: number }>()
  return Number(row?.n ?? 0)
}

export function stripeConfigured(env: Env): boolean {
  return Boolean(env.STRIPE_SECRET_KEY)
}

export async function customerMetrics(db: D1Database, now: Date) {
  const plans = await db
    .prepare(
      `SELECT plan, COUNT(*) as n FROM (SELECT ${PLAN_SQL} as plan FROM users u)
       GROUP BY plan`,
    )
    .all<{ plan: Plan; n: number }>()
  const byPlan: Record<Plan, number> = { free: 0, premium: 0, owner_premium: 0 }
  for (const row of plans.results ?? []) byPlan[row.plan] = Number(row.n)

  return {
    total: await count(db, `SELECT COUNT(*) as n FROM users`),
    active30d: await count(
      db,
      `SELECT COUNT(DISTINCT user_id) as n FROM sessions
       WHERE COALESCE(last_seen_at, created_at) >= ?`,
      daysAgo(now, 30),
    ),
    new7d: await count(
      db,
      `SELECT COUNT(*) as n FROM users WHERE created_at >= ?`,
      daysAgo(now, 7),
    ),
    new30d: await count(
      db,
      `SELECT COUNT(*) as n FROM users WHERE created_at >= ?`,
      daysAgo(now, 30),
    ),
    suspended: await count(
      db,
      `SELECT COUNT(*) as n FROM users WHERE status = 'suspended'`,
    ),
    byPlan,
    activeDefinition:
      'Signed in, or used the app, in the last 30 days (activity is recorded hourly).',
  }
}

export async function subscriptionMetrics(db: D1Database, env: Env) {
  const configured = stripeConfigured(env)
  const rows = await db
    .prepare(
      `SELECT status, billing_interval as interval, cancel_at_period_end as cancelAtPeriodEnd,
              COUNT(*) as n
       FROM user_entitlements
       WHERE entitlement = 'premium' AND source = 'stripe' AND ended_at IS NULL
       GROUP BY status, billing_interval, cancel_at_period_end`,
    )
    .all<{
      status: string
      interval: string | null
      cancelAtPeriodEnd: number
      n: number
    }>()
  const rowsList = rows.results ?? []
  const sum = (pred: (r: (typeof rowsList)[number]) => boolean) =>
    rowsList.filter(pred).reduce((acc, r) => acc + Number(r.n), 0)
  const live = (r: { status: string }) =>
    ['active', 'trialing', 'past_due'].includes(r.status)

  return {
    stripeConfigured: configured,
    active: sum(live),
    monthly: sum((r) => live(r) && r.interval === 'month'),
    annual: sum((r) => live(r) && r.interval === 'year'),
    failedPayments: sum((r) => r.status === 'past_due'),
    upcomingCancellations: sum((r) => live(r) && r.cancelAtPeriodEnd === 1),
    cancelled: await count(
      db,
      `SELECT COUNT(*) as n FROM user_entitlements
       WHERE entitlement = 'premium' AND source = 'stripe' AND status IN ('canceled', 'expired')`,
    ),
    // Revenue needs Stripe's own amounts and currencies; never estimated here.
    recurringRevenue: notConfigured(
      configured
        ? 'Revenue reporting arrives with the Stripe integration.'
        : 'Stripe is not connected yet.',
    ),
  }
}

export async function aiMetrics(
  db: D1Database,
  env: Env,
  settings: PlatformSettings,
  now: Date,
) {
  const provider = resolveProvider(env)
  const today = now.toISOString().slice(0, 10)
  const since = (days: number) => daysAgo(now, days).slice(0, 10)
  const providerCalls = async (fromDate: string) =>
    count(
      db,
      `SELECT COALESCE(SUM(request_count), 0) as n FROM ai_usage_daily WHERE usage_date >= ?`,
      fromDate,
    )

  const byFeature = await db
    .prepare(
      `SELECT feature, outcome, COUNT(*) as n FROM ai_events
       WHERE created_at >= ? GROUP BY feature, outcome ORDER BY feature, outcome`,
    )
    .bind(daysAgo(now, 30))
    .all<{ feature: string; outcome: string; n: number }>()
  const trackedSince = await db
    .prepare(`SELECT MIN(created_at) as since FROM ai_events`)
    .first<{ since: string | null }>()

  // Customers at or above 80% of their plan's daily limit today.
  const todayRows = await db
    .prepare(
      `SELECT u.id as userId, d.request_count as used, ${PLAN_SQL} as plan
       FROM ai_usage_daily d JOIN users u ON u.id = d.user_id
       WHERE d.usage_date = ?`,
    )
    .bind(today)
    .all<{ userId: string; used: number; plan: Plan }>()
  const approaching = (todayRows.results ?? [])
    .map((r) => {
      const limit = aiDailyLimitFor(r.plan, settings)
      return { userId: r.userId, plan: r.plan, used: Number(r.used), limit }
    })
    .filter((r) => r.limit > 0 && r.used >= r.limit * 0.8)
    .sort((a, b) => b.used / b.limit - a.used / a.limit)
    .slice(0, 20)

  return {
    providerConfigured: provider.configured,
    providerEnabled: settings.features.aiProvider,
    model: provider.model,
    requests: {
      today: await providerCalls(today),
      last7d: await providerCalls(since(6)),
      last30d: await providerCalls(since(29)),
    },
    byFeature30d: (byFeature.results ?? []).map((r) => ({
      feature: r.feature,
      outcome: r.outcome,
      count: Number(r.n),
    })),
    failed30d: await count(
      db,
      `SELECT COUNT(*) as n FROM ai_events WHERE outcome = 'ai_unavailable' AND created_at >= ?`,
      daysAgo(now, 30),
    ),
    eventsTrackedSince: trackedSince?.since ?? null,
    approachingLimit: approaching,
    // Token prices differ by provider and model; not configured, not guessed.
    costs: notConfigured(
      'AI cost reporting is not configured. Check your AI provider’s billing dashboard.',
    ),
  }
}

export async function storageMetrics(
  db: D1Database,
  settings: PlatformSettings,
) {
  const totals = await db
    .prepare(
      `SELECT COUNT(*) as documents, COALESCE(SUM(byte_size), 0) as bytes
       FROM documents WHERE retention = 'keep'`,
    )
    .first<{ documents: number; bytes: number }>()
  const perPlan = await db
    .prepare(
      `SELECT plan, COUNT(*) as documents, COALESCE(SUM(bytes), 0) as bytes FROM (
         SELECT ${PLAN_SQL} as plan, d.byte_size as bytes
         FROM documents d JOIN users u ON u.id = d.user_id
         WHERE d.retention = 'keep'
       ) GROUP BY plan`,
    )
    .all<{ plan: Plan; documents: number; bytes: number }>()
  const perUser = await db
    .prepare(
      `SELECT u.id as userId, ${PLAN_SQL} as plan, SUM(d.byte_size) as bytes
       FROM documents d JOIN users u ON u.id = d.user_id
       WHERE d.retention = 'keep'
       GROUP BY u.id`,
    )
    .all<{ userId: string; plan: Plan; bytes: number }>()
  const nearQuota = (perUser.results ?? [])
    .map((r) => {
      const quota = storageQuotaBytesFor(r.plan, settings)
      return { userId: r.userId, plan: r.plan, bytes: Number(r.bytes), quota }
    })
    .filter((r) => r.quota > 0 && r.bytes >= r.quota * 0.8)
    .slice(0, 20)

  return {
    trackedBytes: Number(totals?.bytes ?? 0),
    documents: Number(totals?.documents ?? 0),
    source:
      'Documents customers chose to keep, from sizes recorded in D1. Temporary “Just sort it” files are excluded; objects added outside Pocket Goblin are not counted.',
    byPlan: (perPlan.results ?? []).map((r) => ({
      plan: r.plan,
      documents: Number(r.documents),
      bytes: Number(r.bytes),
    })),
    processingFailures: await count(
      db,
      `SELECT COUNT(*) as n FROM documents WHERE status = 'failed'`,
    ),
    temporaryInReview: await count(
      db,
      `SELECT COUNT(*) as n FROM documents WHERE retention = 'temporary'`,
    ),
    awaitingOcr: await count(
      db,
      `SELECT COUNT(*) as n FROM documents WHERE status = 'needs_ocr'`,
    ),
    nearQuota,
  }
}

export async function healthMetrics(
  db: D1Database,
  env: Env,
  settings: PlatformSettings,
  now: Date,
) {
  const errors24h = await count(
    db,
    `SELECT COUNT(*) as n FROM app_errors WHERE created_at >= ?`,
    daysAgo(now, 1),
  )
  const errors7d = await count(
    db,
    `SELECT COUNT(*) as n FROM app_errors WHERE created_at >= ?`,
    daysAgo(now, 7),
  )
  const topRoutes = await db
    .prepare(
      `SELECT method, route, COUNT(*) as n, MAX(created_at) as lastSeen
       FROM app_errors WHERE created_at >= ?
       GROUP BY method, route ORDER BY n DESC LIMIT 5`,
    )
    .bind(daysAgo(now, 7))
    .all<{ method: string; route: string; n: number; lastSeen: string }>()
  const failedJobs = await count(
    db,
    `SELECT COUNT(*) as n FROM processing_jobs WHERE status = 'failed' AND created_at >= ?`,
    daysAgo(now, 7),
  )

  const warnings: string[] = []
  if (!resolveProvider(env).configured) {
    warnings.push(
      'AI provider is not configured: goblin intelligence runs on rules only.',
    )
  } else if (!settings.features.aiProvider) {
    warnings.push(
      'Paid AI provider calls are switched off in platform settings.',
    )
  }
  if (!settings.features.registrationsOpen) {
    warnings.push('New registrations are paused.')
  }
  if (!settings.features.documentUploads) {
    warnings.push('Document uploads are paused.')
  }
  if (settings.maintenance.enabled) {
    warnings.push('Maintenance messaging is showing to customers.')
  }
  if (!env.UPLOADS) {
    warnings.push('R2 bucket binding is missing: uploads use temporary memory.')
  }
  if (errors24h > 0) {
    warnings.push(`${errors24h} unhandled API error(s) in the last 24 hours.`)
  }

  return {
    api: { status: 'ok' as const, environment: env.ENVIRONMENT },
    errors24h,
    errors7d,
    topErrorRoutes: (topRoutes.results ?? []).map((r) => ({
      method: r.method,
      route: r.route,
      count: Number(r.n),
      lastSeen: r.lastSeen,
    })),
    failedJobs7d: failedJobs,
    deployments: notConfigured(
      'Deployment history lives in Cloudflare (Workers & Pages → pocket-goblin → Deployments).',
    ),
    warnings,
  }
}
