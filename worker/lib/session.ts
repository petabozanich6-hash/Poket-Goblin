import type { Context } from 'hono'

import type { Env } from '../env'
import { newId } from './ids'
import { hashToken } from './passwords'

export const SESSION_COOKIE = 'pg_session'
const SESSION_DAYS = 30

export type AuthUser = {
  id: string
  email: string
  displayName: string
  createdAt: string
}

type AppVars = { user: AuthUser }

const DEV_FALLBACK_SECRET = 'local-dev-only-change-me'
export const MIN_AUTH_SECRET_LENGTH = 32

/**
 * Production must have a real AUTH_SECRET. Session tokens are stored as
 * SHA-256(secret:token), so a public fallback would weaken every session.
 * Returns a reason when the secret is unusable in this environment.
 */
export function authSecretProblem(env: Env): string | null {
  if (env.ENVIRONMENT !== 'production') return null
  const secret = env.AUTH_SECRET?.trim() ?? ''
  if (!secret) return 'AUTH_SECRET is not set'
  if (secret.length < MIN_AUTH_SECRET_LENGTH) {
    return `AUTH_SECRET is shorter than ${MIN_AUTH_SECRET_LENGTH} characters`
  }
  return null
}

export function getSecret(env: Env): string {
  const problem = authSecretProblem(env)
  if (problem) throw new Error(problem)
  return env.AUTH_SECRET || DEV_FALLBACK_SECRET
}

export async function createSession(
  db: D1Database,
  env: Env,
  userId: string,
): Promise<{ token: string; expiresAt: string }> {
  const token = crypto.randomUUID() + crypto.randomUUID()
  const tokenHash = await hashToken(token, getSecret(env))
  const expires = new Date()
  expires.setDate(expires.getDate() + SESSION_DAYS)
  const expiresAt = expires.toISOString()
  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(newId('sess'), userId, tokenHash, expiresAt)
    .run()
  return { token, expiresAt }
}

export function setSessionCookie(
  c: Context<{ Bindings: Env; Variables: AppVars }>,
  token: string,
  expiresAt: string,
) {
  const secure = c.env.ENVIRONMENT === 'production' ? '; Secure' : ''
  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}${secure}`,
    { append: true },
  )
}

export function clearSessionCookie(
  c: Context<{ Bindings: Env; Variables: AppVars }>,
) {
  c.header(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    { append: true },
  )
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null
  const parts = header.split(';')
  for (const part of parts) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

export async function resolveUser(
  db: D1Database,
  env: Env,
  cookieHeader: string | undefined,
): Promise<AuthUser | null> {
  const token = readCookie(cookieHeader, SESSION_COOKIE)
  if (!token) return null
  const tokenHash = await hashToken(token, getSecret(env))
  const row = await db
    .prepare(
      `SELECT u.id, u.email, u.display_name as displayName, u.created_at as createdAt,
              s.expires_at as expiresAt
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<{
      id: string
      email: string
      displayName: string
      createdAt: string
      expiresAt: string
    }>()

  if (!row) return null
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    await db
      .prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(tokenHash)
      .run()
    return null
  }
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt,
  }
}

export async function destroySession(
  db: D1Database,
  env: Env,
  cookieHeader: string | undefined,
) {
  const token = readCookie(cookieHeader, SESSION_COOKIE)
  if (!token) return
  const tokenHash = await hashToken(token, getSecret(env))
  await db
    .prepare('DELETE FROM sessions WHERE token_hash = ?')
    .bind(tokenHash)
    .run()
}
