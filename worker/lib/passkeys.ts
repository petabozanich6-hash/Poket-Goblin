/**
 * Passkeys (WebAuthn) for administrative step-up.
 *
 * Phishing-resistant: the browser binds every assertion to the site's origin,
 * so a look-alike domain cannot replay it. Challenges are single-use, expire
 * after five minutes and are bound to the session that requested them.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server'

import { newId } from './ids'

export const STEP_UP_MINUTES = 15
const CHALLENGE_TTL_MS = 5 * 60_000
const RP_NAME = 'Pocket Goblin'

export type RelyingParty = { origin: string; rpID: string }

export type StoredCredential = {
  id: string
  publicKey: string
  counter: number
  transports: string
  label: string
  createdAt: string
  lastUsedAt: string | null
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

function parseTransports(raw: string): AuthenticatorTransportFuture[] {
  try {
    const value = JSON.parse(raw) as unknown
    return Array.isArray(value)
      ? (value.filter(
          (t) => typeof t === 'string',
        ) as AuthenticatorTransportFuture[])
      : []
  } catch {
    return []
  }
}

export async function listCredentials(
  db: D1Database,
  userId: string,
): Promise<StoredCredential[]> {
  const rows = await db
    .prepare(
      `SELECT id, public_key as publicKey, counter, transports, label,
              created_at as createdAt, last_used_at as lastUsedAt
       FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at ASC`,
    )
    .bind(userId)
    .all<StoredCredential>()
  return rows.results ?? []
}

async function storeChallenge(
  db: D1Database,
  userId: string,
  sessionId: string,
  purpose: 'register' | 'authenticate',
  challenge: string,
  now: Date,
) {
  // One outstanding challenge per session and purpose.
  await db
    .prepare(
      `DELETE FROM webauthn_challenges
       WHERE (user_id = ? AND session_id = ? AND purpose = ?) OR expires_at < ?`,
    )
    .bind(userId, sessionId, purpose, now.toISOString())
    .run()
  await db
    .prepare(
      `INSERT INTO webauthn_challenges (id, user_id, session_id, purpose, challenge, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('wch'),
      userId,
      sessionId,
      purpose,
      challenge,
      new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
    )
    .run()
}

/** Fetch and delete the session's challenge: it can be used exactly once. */
async function consumeChallenge(
  db: D1Database,
  userId: string,
  sessionId: string,
  purpose: 'register' | 'authenticate',
  now: Date,
): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT id, challenge, expires_at as expiresAt FROM webauthn_challenges
       WHERE user_id = ? AND session_id = ? AND purpose = ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, sessionId, purpose)
    .first<{ id: string; challenge: string; expiresAt: string }>()
  if (!row) return null
  await db
    .prepare(`DELETE FROM webauthn_challenges WHERE id = ?`)
    .bind(row.id)
    .run()
  return row.expiresAt > now.toISOString() ? row.challenge : null
}

export async function registrationOptions(
  db: D1Database,
  rp: RelyingParty,
  user: { id: string; email: string; displayName: string },
  sessionId: string,
  now: Date = new Date(),
) {
  const existing = await listCredentials(db, user.id)
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: user.email,
    userDisplayName: user.displayName,
    userID: new Uint8Array(new TextEncoder().encode(user.id)),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: parseTransports(c.transports),
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  })
  await storeChallenge(
    db,
    user.id,
    sessionId,
    'register',
    options.challenge,
    now,
  )
  return options
}

export async function verifyRegistration(
  db: D1Database,
  rp: RelyingParty,
  userId: string,
  sessionId: string,
  response: RegistrationResponseJSON,
  label: string,
  now: Date = new Date(),
): Promise<{ ok: true; credentialId: string } | { ok: false; error: string }> {
  const challenge = await consumeChallenge(
    db,
    userId,
    sessionId,
    'register',
    now,
  )
  if (!challenge)
    return { ok: false, error: 'The passkey request expired. Try again.' }
  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    })
  } catch {
    return { ok: false, error: 'The passkey could not be verified.' }
  }
  if (!verification.verified) {
    return { ok: false, error: 'The passkey could not be verified.' }
  }
  const info = verification.registrationInfo
  await db
    .prepare(
      `INSERT INTO webauthn_credentials
        (id, user_id, public_key, counter, transports, device_type, backed_up, label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      info.credential.id,
      userId,
      toBase64Url(info.credential.publicKey),
      info.credential.counter,
      JSON.stringify(info.credential.transports ?? []),
      info.credentialDeviceType,
      info.credentialBackedUp ? 1 : 0,
      label,
    )
    .run()
  return { ok: true, credentialId: info.credential.id }
}

export async function authenticationOptions(
  db: D1Database,
  rp: RelyingParty,
  userId: string,
  sessionId: string,
  now: Date = new Date(),
) {
  const credentials = await listCredentials(db, userId)
  if (credentials.length === 0) return null
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: credentials.map((c) => ({
      id: c.id,
      transports: parseTransports(c.transports),
    })),
    userVerification: 'required',
  })
  await storeChallenge(
    db,
    userId,
    sessionId,
    'authenticate',
    options.challenge,
    now,
  )
  return options
}

export async function verifyAuthentication(
  db: D1Database,
  rp: RelyingParty,
  userId: string,
  sessionId: string,
  response: AuthenticationResponseJSON,
  now: Date = new Date(),
): Promise<{ ok: true; elevatedUntil: string } | { ok: false; error: string }> {
  const challenge = await consumeChallenge(
    db,
    userId,
    sessionId,
    'authenticate',
    now,
  )
  if (!challenge)
    return { ok: false, error: 'The passkey request expired. Try again.' }
  // Only this user's own credentials can satisfy their step-up.
  const credential = (await listCredentials(db, userId)).find(
    (c) => c.id === response.id,
  )
  if (!credential)
    return { ok: false, error: 'That passkey is not registered.' }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: fromBase64Url(credential.publicKey),
        counter: credential.counter,
        transports: parseTransports(credential.transports),
      },
    })
  } catch {
    return { ok: false, error: 'The passkey could not be verified.' }
  }
  if (!verification.verified) {
    return { ok: false, error: 'The passkey could not be verified.' }
  }

  const elevatedUntil = new Date(
    now.getTime() + STEP_UP_MINUTES * 60_000,
  ).toISOString()
  await db
    .prepare(
      `UPDATE webauthn_credentials SET counter = ?, last_used_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .bind(
      verification.authenticationInfo.newCounter,
      now.toISOString(),
      credential.id,
      userId,
    )
    .run()
  await db
    .prepare(
      `UPDATE sessions SET elevated_until = ? WHERE id = ? AND user_id = ?`,
    )
    .bind(elevatedUntil, sessionId, userId)
    .run()
  return { ok: true, elevatedUntil }
}

export function isElevated(
  elevatedUntil: string | null,
  now: Date = new Date(),
): boolean {
  return Boolean(elevatedUntil && elevatedUntil > now.toISOString())
}
