import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  TARGET,
  checkWranglerConfig,
  findDestructiveStatements,
  orderMigrations,
  parseD1Blocks,
  planMigrations,
} from './d1-migrations.mjs'

const FILES = [
  '0001_init.sql',
  '0002_sprint2_life.sql',
  '0003_sprint3_intelligence.sql',
]

describe('repository state', () => {
  it('wrangler.toml targets only the production Pocket Goblin database', () => {
    expect(checkWranglerConfig(readFileSync('wrangler.toml', 'utf8'))).toEqual(
      [],
    )
    expect(TARGET.uuid).toBe('91a90710-dbd7-4a0c-8c90-b97cd3c86d90')
  })

  it('existing migrations are in an unambiguous order', () => {
    expect(orderMigrations(readdirSync('migrations')).errors).toEqual([])
  })

  it('existing migrations are additive only', () => {
    for (const file of readdirSync('migrations')) {
      expect(
        findDestructiveStatements(readFileSync(`migrations/${file}`, 'utf8')),
      ).toEqual([])
    }
  })
})

describe('checkWranglerConfig', () => {
  const good = `
[[d1_databases]]
binding = "DB"
database_name = "pocket-goblin"
database_id = "${TARGET.uuid}"
migrations_dir = "migrations"

[[r2_buckets]]
bucket_name = "pocket-goblin-uploads"
`

  it('accepts the pinned database', () => {
    expect(parseD1Blocks(good)).toHaveLength(1)
    expect(checkWranglerConfig(good)).toEqual([])
  })

  it('rejects another database id or name', () => {
    expect(
      checkWranglerConfig(good.replace(TARGET.uuid, '0000-other')),
    ).toHaveLength(1)
    expect(
      checkWranglerConfig(good.replace('"pocket-goblin"', '"side-quest"')),
    ).toHaveLength(1)
  })

  it('rejects a second D1 binding', () => {
    expect(
      checkWranglerConfig(
        `${good}\n[[d1_databases]]\ndatabase_name = "x"\ndatabase_id = "y"\n`,
      ),
    ).toHaveLength(1)
  })
})

describe('orderMigrations', () => {
  it('orders by file name', () => {
    expect(orderMigrations([...FILES].reverse())).toEqual({
      files: FILES,
      errors: [],
    })
  })

  it('rejects gaps, duplicates and odd names', () => {
    expect(
      orderMigrations(['0001_a.sql', '0003_c.sql']).errors.length,
    ).toBeGreaterThan(0)
    expect(
      orderMigrations(['0001_a.sql', '0001_b.sql']).errors.length,
    ).toBeGreaterThan(0)
    expect(orderMigrations(['init.sql']).errors.length).toBeGreaterThan(0)
  })
})

describe('findDestructiveStatements', () => {
  it('ignores foreign-key actions, comments and strings', () => {
    expect(
      findDestructiveStatements(`
        -- DROP TABLE users;
        CREATE TABLE t (
          id TEXT REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE,
          note TEXT DEFAULT 'delete from x'
        );`),
    ).toEqual([])
  })

  it('flags statements that remove or overwrite data', () => {
    expect(findDestructiveStatements('DROP TABLE tasks;')).toEqual(['DROP'])
    expect(findDestructiveStatements('DELETE FROM tasks;')).toEqual([
      'DELETE FROM',
    ])
    expect(
      findDestructiveStatements("UPDATE tasks SET status = 'open';"),
    ).toEqual(['UPDATE … SET'])
    expect(
      findDestructiveStatements('ALTER TABLE tasks DROP COLUMN notes;'),
    ).toEqual(['ALTER TABLE … DROP/RENAME'])
    expect(
      findDestructiveStatements('INSERT OR REPLACE INTO t VALUES (1);'),
    ).toEqual(['REPLACE'])
  })
})

describe('planMigrations', () => {
  it('plans every migration on an empty database', () => {
    expect(planMigrations({ files: FILES, applied: [], tables: [] })).toEqual({
      pending: FILES,
      errors: [],
      hasTracking: false,
    })
  })

  it('plans only what is left, in order', () => {
    const plan = planMigrations({
      files: FILES,
      applied: ['0001_init.sql'],
      tables: ['d1_migrations', 'users'],
    })
    expect(plan.pending).toEqual(FILES.slice(1))
    expect(plan.errors).toEqual([])
  })

  it('reports nothing to do when up to date', () => {
    expect(
      planMigrations({
        files: FILES,
        applied: FILES,
        tables: ['d1_migrations'],
      }).pending,
    ).toEqual([])
  })

  it('refuses a schema created outside Wrangler', () => {
    expect(
      planMigrations({ files: FILES, applied: [], tables: ['users', 'tasks'] })
        .errors,
    ).toHaveLength(1)
  })

  it('refuses migrations the branch does not know about', () => {
    expect(
      planMigrations({
        files: FILES,
        applied: ['0001_init.sql', '0009_future.sql'],
        tables: ['d1_migrations'],
      }).errors.length,
    ).toBeGreaterThan(0)
  })

  it('refuses to fill a gap', () => {
    expect(
      planMigrations({
        files: FILES,
        applied: ['0002_sprint2_life.sql'],
        tables: ['d1_migrations'],
      }).errors.length,
    ).toBeGreaterThan(0)
  })
})
