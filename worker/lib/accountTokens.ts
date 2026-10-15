/**
 * Single-use account tokens (password reset, email verification).
 *
 * The token is 32 random bytes (base64url) that only ever appears in the
 * email link. The database stores SHA-256(AUTH_SECRET:token), so a database
 * leak does not reveal usable links. Tokens expire, are single use, and
 * issuing a new one cancels older unused ones of the same purpose.
 */
import type { Env } from '../env'
import { newId } from './ids'
import { hashToken } from './passwords'
import { getSecret } from './session'

export type TokenPurpose = 'password_reset' | 'email_verify'

export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  password_reset: 30 * 60_000,
  email_verify: 7 * 24 * 60 * 60_000,
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function issueToken(
  env: Env,
  userId: string,
  purpose: TokenPurpose,
  now: Date = new Date(),
): Promise<string> {
  const token = randomToken()
  const tokenHash = await hashToken(token, getSecret(env))
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM account_tokens WHERE user_id = ? AND purpose = ? AND used_at IS NULL`,
    ).bind(userId, purpose),
    env.DB.prepare(
      `INSERT INTO account_tokens (id, user_id, purpose, token_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      newId('atok'),
      userId,
      purpose,
      tokenHash,
      new Date(now.getTime() + TOKEN_TTL_MS[purpose]).toISOString(),
    ),
  ])
  return token
}

/**
 * Atomically use a token: succeeds once, only before expiry, only for the
 * stated purpose. Returns the user id, or null.
 */
export async function consumeToken(
  env: Env,
  token: string,
  purpose: TokenPurpose,
  now: Date = new Date(),
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null
  const tokenHash = await hashToken(token, getSecret(env))
  const row = await env.DB.prepare(
    `UPDATE account_tokens SET used_at = ?
     WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?
     RETURNING user_id as userId`,
  )
    .bind(now.toISOString(), tokenHash, purpose, now.toISOString())
    .first<{ userId: string }>()
  return row?.userId ?? null
}

/** Public base URL for links in emails (never taken from request headers in production). */
export function appBaseUrl(env: Env, requestUrl: string): string {
  if (env.ENVIRONMENT === 'production') return 'https://pocketgoblin.org'
  return new URL(requestUrl).origin.replace(':8787', ':5173')
}
