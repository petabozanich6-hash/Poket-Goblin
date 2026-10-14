#!/usr/bin/env node
/**
 * Read-only checks for applying D1 migrations to the production
 * Pocket Goblin database. Used by .github/workflows/d1-migrations.yml.
 *
 * This script never changes the database. It sends only SELECT statements,
 * via the Cloudflare D1 HTTP API, to the database whose UUID is pinned below.
 *
 *   node scripts/d1-migrations.mjs preflight
 *   node scripts/d1-migrations.mjs recheck   (needs EXPECTED_PENDING)
 *   node scripts/d1-migrations.mjs verify
 *
 * Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, and optionally
 * GITHUB_OUTPUT / GITHUB_STEP_SUMMARY (set by GitHub Actions).
 */
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** The only database this tooling will ever touch. */
export const TARGET = Object.freeze({
  name: 'pocket-goblin',
  uuid: '91a90710-dbd7-4a0c-8c90-b97cd3c86d90',
  migrationsDir: 'migrations',
})

/** Tables that prove the app schema already exists. */
const APP_TABLES = ['users', 'tasks', 'captures']

const MIGRATION_FILE = /^(\d{4})_[a-z0-9_]+\.sql$/

// ---------------------------------------------------------------- pure logic

/** Every [[d1_databases]] block in wrangler.toml, as simple key/value maps. */
export function parseD1Blocks(toml) {
  const blocks = []
  let current = null
  for (const rawLine of toml.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      current = line === '[[d1_databases]]' ? {} : null
      if (current) blocks.push(current)
      continue
    }
    const match = current && line.match(/^([A-Za-z0-9_]+)\s*=\s*"([^"]*)"$/)
    if (match) current[match[1]] = match[2]
  }
  return blocks
}

/** wrangler.toml must point at exactly the pinned database. */
export function checkWranglerConfig(toml) {
  const errors = []
  const blocks = parseD1Blocks(toml)
  if (blocks.length !== 1) {
    errors.push(
      `Expected exactly one [[d1_databases]] block, found ${blocks.length}.`,
    )
    return errors
  }
  const [db] = blocks
  if (db.database_name !== TARGET.name) {
    errors.push(
      `database_name is "${db.database_name}", expected "${TARGET.name}".`,
    )
  }
  if (db.database_id !== TARGET.uuid) {
    errors.push(
      `database_id is "${db.database_id}", expected "${TARGET.uuid}".`,
    )
  }
  if ((db.migrations_dir ?? 'migrations') !== TARGET.migrationsDir) {
    errors.push(
      `migrations_dir is "${db.migrations_dir}", expected "${TARGET.migrationsDir}".`,
    )
  }
  return errors
}

/**
 * Migration files in the order Wrangler applies them (by file name).
 * Numbers must start at 0001 and have no gaps or repeats, so the order
 * on disk is unambiguous.
 */
export function orderMigrations(fileNames) {
  const errors = []
  const sql = fileNames.filter((f) => f.endsWith('.sql')).sort()
  const files = []
  sql.forEach((name, index) => {
    const match = name.match(MIGRATION_FILE)
    if (!match) {
      errors.push(`"${name}" does not match NNNN_lower_snake_name.sql.`)
      return
    }
    const expected = String(index + 1).padStart(4, '0')
    if (match[1] !== expected) {
      errors.push(`"${name}" is out of sequence; expected number ${expected}.`)
    }
    files.push(name)
  })
  if (files.length === 0) errors.push('No migration files found.')
  return { files, errors }
}

function stripSqlNoise(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
}

const DESTRUCTIVE = [
  [/\bDROP\s+(TABLE|INDEX|VIEW|TRIGGER)\b/i, 'DROP'],
  [/\bALTER\s+TABLE\s+\S+\s+(DROP|RENAME)\b/i, 'ALTER TABLE … DROP/RENAME'],
  [/\bDELETE\s+FROM\b/i, 'DELETE FROM'],
  [/\bTRUNCATE\b/i, 'TRUNCATE'],
  [/\bUPDATE\s+\S+\s+SET\b/i, 'UPDATE … SET'],
  [/\b(INSERT\s+OR\s+REPLACE|REPLACE\s+INTO)\b/i, 'REPLACE'],
]

/** Statements that could remove or overwrite existing user data. */
export function findDestructiveStatements(sql) {
  const clean = stripSqlNoise(sql)
  return DESTRUCTIVE.filter(([pattern]) => pattern.test(clean)).map(
    ([, label]) => label,
  )
}

/**
 * Decide what applying would do, from read-only facts about the live
 * database. Refuses anything ambiguous instead of guessing.
 */
export function planMigrations({ files, applied, tables }) {
  const errors = []
  const tableSet = new Set(tables)
  const hasTracking = tableSet.has('d1_migrations')

  if (!hasTracking) {
    const present = APP_TABLES.filter((t) => tableSet.has(t))
    if (present.length > 0) {
      errors.push(
        `App tables already exist (${present.join(', ')}) but there is no d1_migrations table. ` +
          'The schema was created outside Wrangler, so re-running 0001 would fail or collide. ' +
          'Stop and review manually.',
      )
    }
  }

  const unknown = applied.filter((name) => !files.includes(name))
  if (unknown.length > 0) {
    errors.push(
      `The database records migrations that are not in this branch: ${unknown.join(', ')}. ` +
        'Run from the branch that contains them.',
    )
  }

  const prefix = files.slice(0, applied.length)
  if (unknown.length === 0 && prefix.join() !== [...applied].sort().join()) {
    errors.push(
      `Applied migrations (${applied.join(', ') || 'none'}) are not the first ` +
        `${applied.length} files in order. Refusing to fill a gap.`,
    )
  }

  const pending = files.filter((name) => !applied.includes(name))
  return { pending, errors, hasTracking }
}

// ------------------------------------------------------------ remote (read)

async function cloudflare(pathname, init = {}) {
  const token = process.env.CLOUDFLARE_API_TOKEN
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  if (!token || !account) {
    throw new Error(
      'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set (GitHub environment secrets).',
    )
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}${pathname}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    },
  )
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    const detail = (body.errors ?? [])
      .map((e) => `${e.code}: ${e.message}`)
      .join('; ')
    throw new Error(
      `Cloudflare API ${res.status} on ${pathname}${detail ? ` — ${detail}` : ''}`,
    )
  }
  return body.result
}

/** Read-only SELECT against the pinned database. */
async function select(sql) {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error('Only SELECT is allowed.')
  const result = await cloudflare(`/d1/database/${TARGET.uuid}/raw`, {
    method: 'POST',
    body: JSON.stringify({ sql }),
  })
  const first = Array.isArray(result) ? result[0] : null
  return first?.results?.rows ?? []
}

async function readLiveState() {
  const db = await cloudflare(`/d1/database/${TARGET.uuid}`)
  if (db?.uuid && db.uuid !== TARGET.uuid) {
    throw new Error(
      `API returned database ${db.uuid}, expected ${TARGET.uuid}.`,
    )
  }
  if (db?.name && db.name !== TARGET.name) {
    throw new Error(
      `Database ${TARGET.uuid} is named "${db.name}", expected "${TARGET.name}". Refusing.`,
    )
  }
  const tables = (
    await select(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name",
    )
  ).map((row) => String(row[0]))
  const applied = tables.includes('d1_migrations')
    ? (await select('SELECT name FROM d1_migrations ORDER BY id')).map((row) =>
        String(row[0]),
      )
    : []
  return { db, tables, applied }
}

// ------------------------------------------------------------------ report

function output(key, value) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
  }
}

function summary(markdown) {
  console.log(markdown)
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
  }
}

function list(items) {
  return items.length ? items.map((i) => `- \`${i}\``).join('\n') : '- _none_'
}

// -------------------------------------------------------------------- main

async function main(mode) {
  const root = process.cwd()
  const errors = []

  errors.push(
    ...checkWranglerConfig(
      readFileSync(path.join(root, 'wrangler.toml'), 'utf8'),
    ),
  )
  const dir = path.join(root, TARGET.migrationsDir)
  const ordered = orderMigrations(readdirSync(dir))
  errors.push(...ordered.errors)

  if (errors.length > 0) {
    summary(`## ❌ D1 ${mode}: local checks failed\n\n${list(errors)}`)
    process.exit(1)
  }

  const state = await readLiveState()
  const plan = planMigrations({
    files: ordered.files,
    applied: state.applied,
    tables: state.tables,
  })

  const destructive = plan.pending.flatMap((file) =>
    findDestructiveStatements(readFileSync(path.join(dir, file), 'utf8')).map(
      (label) => `${file}: ${label}`,
    ),
  )
  if (destructive.length > 0) {
    plan.errors.push(
      `Pending migrations contain statements that can remove or overwrite data:\n${list(destructive)}\n` +
        'This workflow only applies additive migrations. Review and apply these by hand.',
    )
  }

  if (mode === 'recheck') {
    const expected = (process.env.EXPECTED_PENDING ?? '').trim()
    if (plan.pending.join(',') !== expected) {
      plan.errors.push(
        `Database changed since preflight. Preflight pending: ${expected || 'none'}. ` +
          `Now pending: ${plan.pending.join(',') || 'none'}. Re-run preflight.`,
      )
    }
  }
  if (mode === 'verify' && plan.pending.length > 0) {
    plan.errors.push(
      `Still pending after apply: ${plan.pending.join(', ')}. The apply did not complete.`,
    )
  }

  output('pending', plan.pending.join(','))
  output('pending_count', String(plan.pending.length))

  const facts = [
    `**Database:** \`${TARGET.name}\` (\`${TARGET.uuid}\`)`,
    state.db?.created_at ? `**Created:** ${state.db.created_at}` : null,
    typeof state.db?.file_size === 'number'
      ? `**Size:** ${(state.db.file_size / 1024).toFixed(1)} KiB`
      : null,
    `**Tables:** ${state.tables.length}`,
    `**Migration tracking table:** ${plan.hasTracking ? 'present' : 'not created yet'}`,
  ]
    .filter(Boolean)
    .join('  \n')

  const ok = plan.errors.length === 0
  const title = {
    preflight: ok
      ? plan.pending.length
        ? `✅ Preflight passed — ${plan.pending.length} migration(s) ready to apply`
        : '✅ Preflight passed — database is up to date, nothing to apply'
      : '❌ Preflight failed — nothing will be applied',
    recheck: ok
      ? '✅ Re-check passed — database unchanged since preflight'
      : '❌ Re-check failed — nothing was applied',
    verify: ok
      ? '✅ Migrations applied and verified'
      : '❌ Verification failed',
  }[mode]

  summary(
    [
      `## ${title}`,
      facts,
      `### Already applied (${state.applied.length})\n${list(state.applied)}`,
      `### Pending, in apply order (${plan.pending.length})\n${list(plan.pending)}`,
      ok
        ? null
        : `### Problems\n${plan.errors.map((e) => `- ${e}`).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  )
  if (!ok) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2]
  if (!['preflight', 'recheck', 'verify'].includes(mode)) {
    console.error(
      'Usage: node scripts/d1-migrations.mjs <preflight|recheck|verify>',
    )
    process.exit(2)
  }
  main(mode).catch((error) => {
    summary(`## ❌ D1 ${mode} could not complete\n\n${error.message}`)
    process.exit(1)
  })
}
