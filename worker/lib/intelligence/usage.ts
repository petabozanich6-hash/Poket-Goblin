import type { Env } from '../../env'
import { loadAccess, type Plan } from '../access'
import { newId } from '../ids'
import { aiDailyLimitFor, loadPlatformSettings } from '../platformSettings'

export function dailyLimit(env: Env): number {
  const raw = env.AI_DAILY_USER_LIMIT
  const n = raw ? Number(raw) : 40
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40
}

export async function getUsageToday(
  db: D1Database,
  userId: string,
): Promise<{ requestCount: number; provider: string }> {
  const today = new Date().toISOString().slice(0, 10)
  const row = await db
    .prepare(
      `SELECT request_count as requestCount, provider
       FROM ai_usage_daily WHERE user_id = ? AND usage_date = ?`,
    )
    .bind(userId, today)
    .first<{ requestCount: number; provider: string }>()
  return {
    requestCount: row?.requestCount ?? 0,
    provider: row?.provider ?? 'none',
  }
}

export type AiPolicy = {
  plan: Plan
  /** Daily limit for this user's plan. The Owner has one too (cost control). */
  limit: number
  /** False when the Owner has switched paid AI provider calls off. */
  providerEnabled: boolean
  /** Env to hand to the intelligence engine (provider stripped if disabled). */
  env: Env
}

export async function loadAiPolicy(
  db: D1Database,
  env: Env,
  userId: string,
): Promise<AiPolicy> {
  const [settings, access] = await Promise.all([
    loadPlatformSettings(db, env),
    loadAccess(db, userId),
  ])
  const providerEnabled = settings.features.aiProvider
  return {
    plan: access.plan,
    limit: aiDailyLimitFor(access.plan, settings),
    providerEnabled,
    env: providerEnabled
      ? {
          ...env,
          aiRequest: {
            userId,
            dailyLimit: aiDailyLimitFor(access.plan, settings),
          },
        }
      : { ...env, AI_PROVIDER: 'none', aiRequest: undefined },
  }
}

export async function assertUnderLimit(
  db: D1Database,
  policy: AiPolicy,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const usage = await getUsageToday(db, userId)
  const limit = policy.limit
  if (usage.requestCount >= limit) {
    return {
      ok: false,
      error: `Daily goblin-intelligence limit reached (${limit}). Try again tomorrow, or keep using rule-based suggestions.`,
    }
  }
  return { ok: true }
}

export type AiFeature =
  'brain_dump' | 'interpret' | 'breakdown' | 'assist' | 'document'
export type AiOutcome =
  'ai' | 'ai_unavailable' | 'rules' | 'limit_reached' | 'disabled'

/** Metadata for Goblin HQ: which feature, which path. Never content. */
export async function recordAiEvent(
  db: D1Database,
  userId: string,
  feature: AiFeature,
  provider: string,
  outcome: AiOutcome,
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO ai_events (id, user_id, feature, provider, outcome)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(newId('aiev'), userId, feature, provider.slice(0, 40), outcome)
      .run()
  } catch (error) {
    console.error('ai event not recorded', error)
  }
}

/** Map an engine result onto an outcome for ai_events. */
export function outcomeOf(
  result: { mode?: string; aiCalled?: boolean },
  gateOk: boolean,
  providerEnabled: boolean,
): AiOutcome {
  if (!gateOk) return 'limit_reached'
  if (result.mode === 'ai_unavailable') return 'ai_unavailable'
  if (result.mode === 'ai' || result.aiCalled) return 'ai'
  return providerEnabled ? 'rules' : 'disabled'
}

export async function recordUsage(
  db: D1Database,
  userId: string,
  provider: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  await db
    .prepare(
      `INSERT INTO ai_usage_daily (user_id, usage_date, request_count, provider)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, usage_date) DO UPDATE SET
         request_count = request_count + 1,
         provider = excluded.provider`,
    )
    .bind(userId, today, provider)
    .run()
}
