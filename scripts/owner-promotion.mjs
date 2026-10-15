#!/usr/bin/env node
/**
 * One-time promotion of an existing account to Owner, for
 * .github/workflows/owner-promotion.yml. See docs/OWNER_PROMOTION.md.
 *
 *   node scripts/owner-promotion.mjs preflight   (read-only)
 *   node scripts/owner-promotion.mjs apply       (writes; approval-gated job)
 *   node scripts/owner-promotion.mjs verify      (read-only)
 *
 * Env:
 *   OWNER_USER_ID          internal user id (input; not personal data)
 *   OWNER_EXPECTED_EMAIL   GitHub environment secret; compared, never printed
 *   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
 *   GITHUB_RUN_ID, GITHUB_SERVER_URL, GITHUB_REPOSITORY (for the audit record)
 *
 * Safety:
 * - Targets only the pinned database, by UUID.
 * - Identifies the account by its internal id; the email on record must match
 *   the secret. Output shows only a masked email.
 * - Refuses if any Owner already exists: this is a one-time bootstrap. More
 *   Owners need a reviewed design, not a re-run.
 * - Never touches passwords, sessions, email or customer data. All writes are
 *   parameterised INSERT … SELECT statements guarded by the same checks, so a
 *   repeated or raced run cannot promote anyone else.
 */
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { TARGET } from './d1-migrations.mjs'

export const USER_ID = /^user_[0-9a-f]{32}$/
const REQUIRED_TABLES = [
  'users',
  'user_roles',
  'user_entitlements',
  'admin_audit_log',
]

export function maskEmail(email) {
  const [local = '', domain = ''] = String(email).split('@')
  if (!local || !domain) return '(unreadable)'
  const shown =
    local.length <= 2
      ? local[0]
      : `${local[0]}${'*'.repeat(local.length - 2)}${local.at(-1)}`
  return `${shown}@${domain}`
}

export function sameEmail(a, b) {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.trim().toLowerCase() === b.trim().toLowerCase() &&
    a.trim() !== ''
  )
}

/**
 * Decide whether promotion may proceed, from read-only facts.
 * Returns { errors, alreadyDone }.
 */
export function evaluate({ userId, expectedEmail, tables, user, owners }) {
  const errors = []
  if (!USER_ID.test(userId ?? '')) {
    errors.push('user_id must look like user_ followed by 32 hex characters.')
  }
  if (!expectedEmail || !String(expectedEmail).includes('@')) {
    errors.push('The OWNER_EXPECTED_EMAIL environment secret is missing.')
  }
  const missing = REQUIRED_TABLES.filter((t) => !tables.includes(t))
  if (missing.length) {
    errors.push(
      `Migration 0006 is not applied (missing: ${missing.join(', ')}). Run the D1 migrations workflow first.`,
    )
  }
  if (errors.length) return { errors, alreadyDone: false }

  if (!user) {
    errors.push('No account has that user id.')
    return { errors, alreadyDone: false }
  }
  if (!sameEmail(user.email, expectedEmail)) {
    errors.push(
      'The account email does not match OWNER_EXPECTED_EMAIL. Check the user id.',
    )
  }
  if (user.status !== 'active') errors.push('The account is not active.')

  const otherOwners = owners.filter((o) => o !== userId)
  if (otherOwners.length) {
    errors.push(
      'Another account already holds the Owner role. This workflow only bootstraps the first Owner.',
    )
  }
  return { errors, alreadyDone: errors.length === 0 && owners.includes(userId) }
}

// ---------------------------------------------------------------- statements
// Each write re-checks every condition inside the statement itself.

export const GRANT_ROLE_SQL = `
INSERT INTO user_roles (id, user_id, role, granted_by, reason)
SELECT ?1, u.id, 'owner', ?2, 'Initial Owner (one-time promotion)'
FROM users u
WHERE u.id = ?3 AND lower(u.email) = lower(?4) AND u.status = 'active'
  AND NOT EXISTS (SELECT 1 FROM user_roles r
                  WHERE r.role = 'owner' AND r.revoked_at IS NULL)`

export const GRANT_ENTITLEMENT_SQL = `
INSERT INTO user_entitlements (id, user_id, entitlement, source, status, granted_by, reason)
SELECT ?1, r.user_id, 'owner_premium', 'admin', 'active', ?2, 'Permanent Owner Premium'
FROM user_roles r
WHERE r.user_id = ?3 AND r.role = 'owner' AND r.revoked_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM user_entitlements e
                  WHERE e.user_id = ?3 AND e.entitlement = 'owner_premium'
                    AND e.ended_at IS NULL)`

export const AUDIT_SQL = `
INSERT INTO admin_audit_log (id, actor_user_id, actor_label, action, target_type, target_id, detail_json)
VALUES (?1, NULL, ?2, 'owner.promote', 'user', ?3, ?4)`

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`
}

// -------------------------------------------------------------------- remote

async function cloudflare(pathname, body) {
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim()
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim()
  if (!token || !account) {
    throw new Error(
      'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set.',
    )
  }
  let res
  try {
    res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${TARGET.uuid}${pathname}`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    )
  } catch {
    throw new Error('Could not reach the Cloudflare API.')
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.success === false) {
    const detail = (json.errors ?? [])
      .map((e) => `${e.code}: ${e.message}`)
      .join('; ')
    throw new Error(
      `Cloudflare API ${res.status}${detail ? ` — ${detail}` : ''}.`,
    )
  }
  return json.result
}

/** Parameterised statement; params never appear in logs. */
async function query(sql, params = []) {
  const result = await cloudflare('/query', { sql, params })
  const first = Array.isArray(result) ? result[0] : null
  return { rows: first?.results ?? [], changes: first?.meta?.changes ?? 0 }
}

async function readState(userId) {
  const db = await cloudflare('')
  if (db?.uuid && db.uuid !== TARGET.uuid)
    throw new Error('Unexpected database.')
  if (db?.name && db.name !== TARGET.name)
    throw new Error('Unexpected database name.')
  const tables = (
    await query(`SELECT name FROM sqlite_master WHERE type = 'table'`)
  ).rows.map((r) => String(r.name))
  if (!REQUIRED_TABLES.every((t) => tables.includes(t))) {
    return { tables, user: null, owners: [] }
  }
  const user =
    (
      await query(
        `SELECT id, email, status, created_at as createdAt FROM users WHERE id = ?1`,
        [userId],
      )
    ).rows[0] ?? null
  const owners = (
    await query(
      `SELECT user_id FROM user_roles WHERE role = 'owner' AND revoked_at IS NULL`,
    )
  ).rows.map((r) => String(r.user_id))
  const entitlement = USER_ID.test(userId)
    ? ((
        await query(
          `SELECT COUNT(*) as n FROM user_entitlements
           WHERE user_id = ?1 AND entitlement = 'owner_premium' AND ended_at IS NULL`,
          [userId],
        )
      ).rows[0]?.n ?? 0)
    : 0
  return { tables, user, owners, hasOwnerPremium: Number(entitlement) > 0 }
}

// -------------------------------------------------------------------- report

function summary(markdown) {
  console.log(markdown)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
  }
}

function output(key, value) {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
}

function describe(state, userId) {
  return [
    `**Database:** \`${TARGET.name}\` (\`${TARGET.uuid}\`)`,
    `**User id:** \`${userId}\``,
    state.user ? `**Email on record:** ${maskEmail(state.user.email)}` : null,
    state.user ? `**Account created:** ${state.user.createdAt}` : null,
    state.user ? `**Status:** ${state.user.status}` : null,
    `**Existing Owners:** ${state.owners.length}`,
  ]
    .filter(Boolean)
    .join('  \n')
}

async function main(mode) {
  const userId = (process.env.OWNER_USER_ID ?? '').trim()
  const expectedEmail = process.env.OWNER_EXPECTED_EMAIL ?? ''

  const state = await readState(userId)
  const verdict = evaluate({ userId, expectedEmail, ...state })

  if (verdict.errors.length) {
    summary(
      `## ❌ Owner promotion ${mode}: refused\n\n${describe(state, userId)}\n\n${verdict.errors.map((e) => `- ${e}`).join('\n')}\n\nNothing was changed.`,
    )
    process.exit(1)
  }

  if (mode === 'preflight') {
    output(
      'already_done',
      verdict.alreadyDone && state.hasOwnerPremium ? 'true' : 'false',
    )
    summary(
      `## ✅ Owner promotion preflight\n\n${describe(state, userId)}\n\n` +
        (verdict.alreadyDone && state.hasOwnerPremium
          ? 'This account is already the Owner with Owner Premium. Nothing to do.'
          : 'Checks passed. Confirm the masked email and creation date are yours, then run **apply**. It waits for approval before changing anything.'),
    )
    return
  }

  if (mode === 'verify') {
    if (
      !state.owners.includes(userId) ||
      state.owners.length !== 1 ||
      !state.hasOwnerPremium
    ) {
      summary(
        '## ❌ Verification failed: the account is not the sole Owner with Owner Premium.',
      )
      process.exit(1)
    }
    summary(
      `## ✅ Verified\n\n${describe(state, userId)}\n\nOwner role and Owner Premium are in place.`,
    )
    return
  }

  if (mode !== 'apply')
    throw new Error('Usage: owner-promotion.mjs <preflight|apply|verify>')

  const runUrl =
    process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : 'local'
  const actor = `operator:owner-promotion-workflow`

  const role = state.owners.includes(userId)
    ? { changes: 0 }
    : await query(GRANT_ROLE_SQL, [newId('role'), actor, userId, expectedEmail])
  if (!state.owners.includes(userId) && role.changes !== 1) {
    summary(
      '## ❌ The Owner role was not granted (conditions changed). Nothing else was done.',
    )
    process.exit(1)
  }
  const entitlement = await query(GRANT_ENTITLEMENT_SQL, [
    newId('ent'),
    actor,
    userId,
  ])
  if (role.changes || entitlement.changes) {
    await query(AUDIT_SQL, [
      newId('audit'),
      actor,
      userId,
      JSON.stringify({
        role: role.changes ? 'owner granted' : 'already owner',
        entitlement: entitlement.changes
          ? 'owner_premium granted'
          : 'already present',
        run: runUrl,
      }),
    ])
  }
  summary(
    `## ✅ Owner promotion applied\n\n${describe(state, userId)}\n\n` +
      `- Owner role: ${role.changes ? 'granted' : 'already held'}\n` +
      `- Owner Premium: ${entitlement.changes ? 'granted' : 'already held'}\n` +
      '- Password, email, sessions and data: unchanged',
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv[2]).catch((error) => {
    summary(`## ❌ Owner promotion failed\n\n${error.message}`)
    process.exit(1)
  })
}
