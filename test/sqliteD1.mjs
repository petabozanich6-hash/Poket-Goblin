// A minimal Cloudflare D1 stand-in backed by Node's built-in SQLite, for
// integration tests that need real SQL. It applies the real migrations from
// migrations/ so tests exercise the production schema.
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations',
)

function toSqlValue(value) {
  if (value === undefined) {
    throw new TypeError('D1_TYPE_ERROR: Type undefined is not supported')
  }
  if (typeof value === 'boolean') return value ? 1 : 0
  return value
}

const plain = (row) => (row ? { ...row } : row)

class Statement {
  constructor(sqlite, sql, args = []) {
    this.sqlite = sqlite
    this.sql = sql
    this.args = args
  }
  bind(...values) {
    return new Statement(this.sqlite, this.sql, values.map(toSqlValue))
  }
  async first(column) {
    const row = plain(this.sqlite.prepare(this.sql).get(...this.args))
    if (!row) return null
    return column ? (row[column] ?? null) : row
  }
  async all() {
    const results = this.sqlite
      .prepare(this.sql)
      .all(...this.args)
      .map(plain)
    return { success: true, results, meta: {} }
  }
  async run() {
    const info = this.sqlite.prepare(this.sql).run(...this.args)
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid),
      },
    }
  }
  async raw() {
    return this.sqlite
      .prepare(this.sql)
      .all(...this.args)
      .map((r) => Object.values(r))
  }
}

export function migrationFiles(upTo = Infinity) {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort()
    .filter((f) => Number(f.slice(0, 4)) <= upTo)
}

export function applyMigrations(sqlite, files) {
  for (const file of files) {
    sqlite.exec(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'))
  }
}

/** Fresh in-memory database with every migration (or up to `upTo`) applied. */
export function createTestD1({ upTo } = {}) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON')
  applyMigrations(sqlite, migrationFiles(upTo))
  const db = {
    prepare: (sql) => new Statement(sqlite, sql),
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const out = []
        for (const s of statements) out.push(await s.run())
        sqlite.exec('COMMIT')
        return out
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
    async exec(sql) {
      sqlite.exec(sql)
      return { count: 0, duration: 0 }
    },
  }
  return {
    db,
    sqlite,
    /** Run raw SQL synchronously for test setup/assertions. */
    query: (sql, ...args) =>
      sqlite
        .prepare(sql)
        .all(...args.map(toSqlValue))
        .map(plain),
    run: (sql, ...args) => sqlite.prepare(sql).run(...args.map(toSqlValue)),
  }
}
