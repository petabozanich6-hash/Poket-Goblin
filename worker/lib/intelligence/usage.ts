import type { Env } from '../../env'

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

export async function assertUnderLimit(
  db: D1Database,
  env: Env,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const usage = await getUsageToday(db, userId)
  const limit = dailyLimit(env)
  if (usage.requestCount >= limit) {
    return {
      ok: false,
      error: `Daily goblin-intelligence limit reached (${limit}). Try again tomorrow, or keep using rule-based suggestions.`,
    }
  }
  return { ok: true }
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
