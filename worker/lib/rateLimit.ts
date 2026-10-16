/**
 * Lightweight in-memory rate limiter for Worker isolates.
 * Resets when the isolate is recycled — good enough for local/dev abuse brakes.
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true }
  }
  if (existing.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }
  existing.count += 1
  return { ok: true }
}

/** Test helper */
export function clearRateLimits() {
  buckets.clear()
}

async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`pg-rate:${key}`),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export type LimitResult = { ok: true } | { ok: false; retryAfterSec: number }

/**
 * Durable fixed-window limit, shared by every Worker instance (D1). Counts
 * this attempt and refuses once `limit` is reached. If the table is missing
 * (migration not yet applied) or D1 errors, falls back to the in-memory
 * limiter rather than locking everyone out.
 */
export async function checkDurableLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<LimitResult> {
  const window = Math.floor(now / windowMs)
  const retryAfterSec = Math.max(
    1,
    Math.ceil(((window + 1) * windowMs - now) / 1000),
  )
  try {
    const row = await db
      .prepare(
        `INSERT INTO auth_rate_limits (key, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET
           count = CASE WHEN window_start < excluded.window_start THEN 1 ELSE count + 1 END,
           window_start = excluded.window_start
         RETURNING count`,
      )
      .bind(await hashKey(key), window * windowMs)
      .first<{ count: number }>()
    return (row?.count ?? 1) <= limit
      ? { ok: true }
      : { ok: false, retryAfterSec }
  } catch {
    return checkRateLimit(key, limit, windowMs)
  }
}

/** How many attempts are counted in the current window, without adding one. */
export async function durableCount(
  db: D1Database,
  key: string,
  windowMs: number,
  now = Date.now(),
): Promise<number> {
  try {
    const row = await db
      .prepare(
        `SELECT count FROM auth_rate_limits WHERE key = ? AND window_start = ?`,
      )
      .bind(await hashKey(key), Math.floor(now / windowMs) * windowMs)
      .first<{ count: number }>()
    return row?.count ?? 0
  } catch {
    return 0
  }
}

/** "Try again in about 12 minutes." */
export function waitMessage(retryAfterSec: number): string {
  const minutes = Math.ceil(retryAfterSec / 60)
  return minutes <= 1
    ? 'Try again in a minute.'
    : `Try again in about ${minutes} minutes.`
}
