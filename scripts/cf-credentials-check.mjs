#!/usr/bin/env node
/**
 * Safe diagnostics for the Cloudflare credentials used by the D1 workflow.
 *
 * Never prints secret values. It reports only presence, length, shape
 * problems (whitespace, quotes, "Bearer " prefix, an ID pasted instead of a
 * token) and what Cloudflare says about the token. Every request is a GET.
 *
 * Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CREDENTIAL_LABEL
 * (the GitHub secret name, used only in messages).
 */
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const TARGET_DATABASE_ID = '91a90710-dbd7-4a0c-8c90-b97cd3c86d90'
const API = 'https://api.cloudflare.com/client/v4'

/** Shape problems in a pasted token. Never returns the value itself. */
export function inspectToken(raw) {
  if (raw === undefined || raw === '') {
    return {
      present: false,
      length: 0,
      problems: ['is empty or not set'],
      warnings: [],
    }
  }
  const problems = []
  const warnings = []
  const trimmed = raw.trim()
  if (trimmed !== raw) {
    warnings.push(
      'has spaces or a line break at the start or end (ignored — trimmed automatically)',
    )
  }
  if (/\s/.test(trimmed))
    problems.push('contains spaces or line breaks inside it')
  if (/^["'].*["']$/.test(trimmed)) problems.push('is wrapped in quotes')
  if (/^bearer\s/i.test(trimmed)) {
    problems.push('starts with "Bearer " — paste only the token itself')
  }
  if (/^[0-9a-f]{32}$/i.test(trimmed)) {
    problems.push(
      'is 32 hex characters — that is an ID (token ID, account ID or zone ID), not the token secret',
    )
  } else if (/^[0-9a-f]{37}$/i.test(trimmed)) {
    problems.push(
      'looks like a Global API Key — this workflow needs an API Token',
    )
  }
  return { present: true, length: trimmed.length, problems, warnings }
}

/** Shape problems in a pasted account ID. */
export function inspectAccountId(raw, token) {
  if (raw === undefined || raw === '') {
    return { present: false, problems: ['is empty or not set'], warnings: [] }
  }
  const problems = []
  const warnings = []
  const trimmed = raw.trim()
  if (trimmed !== raw) {
    warnings.push(
      'has spaces or a line break at the start or end (ignored — trimmed automatically)',
    )
  }
  if (!/^[0-9a-f]{32}$/i.test(trimmed)) {
    problems.push(
      `is not a 32-character hex ID (length ${trimmed.length}). Copy "Account ID" from the Cloudflare dashboard`,
    )
  }
  if (token && trimmed === token.trim()) {
    problems.push('is the same value as the API token')
  }
  return { present: true, problems, warnings }
}

async function get(path, token) {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await res.json().catch(() => ({}))
    return {
      ok: res.ok && body.success !== false,
      status: res.status,
      codes: (body.errors ?? []).map((e) => e.code),
      result: body.result,
    }
  } catch {
    // Never echo the underlying error: it can include header values.
    return { ok: false, status: 0, codes: [], result: null }
  }
}

function annotate(level, message) {
  console.log(`::${level} title=Cloudflare credentials::${message}`)
}

function summary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
  }
  console.log(markdown)
}

async function main() {
  const label = process.env.CREDENTIAL_LABEL || 'CLOUDFLARE_API_TOKEN'
  const rawToken = process.env.CLOUDFLARE_API_TOKEN
  const rawAccount = process.env.CLOUDFLARE_ACCOUNT_ID
  const lines = []
  const failures = []

  const tokenShape = inspectToken(rawToken)
  const accountShape = inspectAccountId(rawAccount, rawToken)
  lines.push(
    `| \`${label}\` | ${tokenShape.present ? `present (${tokenShape.length} chars)` : '**missing**'} | ${[...tokenShape.problems, ...tokenShape.warnings].join('; ') || 'no shape problems'} |`,
    `| \`CLOUDFLARE_ACCOUNT_ID\` | ${accountShape.present ? 'present' : '**missing**'} | ${[...accountShape.problems, ...accountShape.warnings].join('; ') || 'looks like a valid account ID'} |`,
  )
  for (const p of tokenShape.problems) failures.push(`${label} ${p}.`)
  for (const p of accountShape.problems)
    failures.push(`CLOUDFLARE_ACCOUNT_ID ${p}.`)
  for (const w of tokenShape.warnings) annotate('warning', `${label} ${w}.`)
  for (const w of accountShape.warnings) {
    annotate('warning', `CLOUDFLARE_ACCOUNT_ID ${w}.`)
  }

  const checks = []
  if (tokenShape.present && accountShape.present) {
    const token = rawToken.trim()
    const account = rawAccount.trim()

    // 1. Is the token itself valid? (independent of the account ID)
    const user = await get('/user/tokens/verify', token)
    const owned = user.ok
      ? null
      : await get(`/accounts/${account}/tokens/verify`, token)
    const verified = user.ok ? user : owned?.ok ? owned : null

    if (verified) {
      const status = verified.result?.status ?? 'unknown'
      const kind = user.ok ? 'user API token' : 'account-owned API token'
      checks.push(
        `Token recognised by Cloudflare: **yes** (${kind}, status \`${status}\`)`,
      )
      if (verified.result?.expires_on) {
        checks.push(`Token expires: ${verified.result.expires_on}`)
      }
      if (verified.result?.not_before) {
        checks.push(`Token valid from: ${verified.result.not_before}`)
      }
      if (status !== 'active') {
        failures.push(
          `${label} is recognised but its status is "${status}". Re-enable it or roll it in Cloudflare.`,
        )
      }
    } else {
      checks.push(
        `Token recognised by Cloudflare: **no** (HTTP ${user.status}, codes ${user.codes.join(',') || 'none'})`,
      )
      failures.push(
        `Cloudflare does not recognise ${label}. The value saved in GitHub is not a working API token. ` +
          'Common causes: the token ID or another ID was pasted instead of the secret shown once at creation; ' +
          'the token was copied partially; or it was deleted or rolled after being saved. ' +
          'Fix: paste the token secret again into the GitHub secret (Cloudflare can "Roll" the token to show a new secret). ' +
          'Exception: if the token was created under Manage Account → Account API Tokens, a wrong CLOUDFLARE_ACCOUNT_ID also produces this result.',
      )
    }

    // 2. Can this token see the configured account, and the database in it?
    if (verified) {
      const accounts = await get('/accounts?per_page=50', token)
      if (accounts.ok && Array.isArray(accounts.result)) {
        const ids = accounts.result.map((a) => a.id)
        const match = ids.includes(account)
        checks.push(
          `CLOUDFLARE_ACCOUNT_ID is one of the ${ids.length} account(s) this token can access: **${match ? 'yes' : 'no'}**`,
        )
        if (!match && ids.length > 0) {
          failures.push(
            'CLOUDFLARE_ACCOUNT_ID is not an account this token can access. It may be a Zone ID or a different account. ' +
              'Copy "Account ID" from Workers & Pages → Overview, or check the token\'s Account Resources.',
          )
        }
      } else {
        checks.push(
          'Accounts visible to token: could not list (not needed, informational only)',
        )
      }

      const d1 = await get(
        `/accounts/${account}/d1/database?per_page=100`,
        token,
      )
      if (d1.ok && Array.isArray(d1.result)) {
        const found = d1.result.some((db) => db.uuid === TARGET_DATABASE_ID)
        checks.push(
          `D1 access in this account: **yes** (${d1.result.length} database(s)). pocket-goblin found: **${found ? 'yes' : 'no'}**`,
        )
        if (!found) {
          failures.push(
            'The token can read D1 in this account, but pocket-goblin (91a90710-…) is not in it. CLOUDFLARE_ACCOUNT_ID points at the wrong account.',
          )
        }
      } else {
        checks.push(
          `D1 access in this account: **no** (HTTP ${d1.status}, codes ${d1.codes.join(',') || 'none'})`,
        )
        failures.push(
          `The token is valid but cannot read D1 in the configured account. Either it lacks "Account → D1 → Read" (or Edit), ` +
            'or its Account Resources do not include this account, or CLOUDFLARE_ACCOUNT_ID is wrong.',
        )
      }
    }
  }

  const ok = failures.length === 0
  summary(
    [
      `## ${ok ? '✅' : '❌'} Cloudflare credentials check (${label})`,
      'Values are never shown, only whether each secret is present and its shape.',
      '| Secret | Present | Shape |\n|---|---|---|\n' + lines.join('\n'),
      checks.length ? checks.map((c) => `- ${c}`).join('\n') : null,
      ok
        ? null
        : `### What to fix\n${failures.map((f) => `- ${f}`).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  )
  for (const f of failures) annotate('error', f)
  if (!ok) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    annotate('error', 'Credentials check crashed before finishing.')
    process.exit(1)
  })
}
