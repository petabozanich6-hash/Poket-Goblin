import { describe, expect, it } from 'vitest'

import {
  applyMigrations,
  createTestD1,
  migrationFiles,
} from '../test/sqliteD1.mjs'

describe('migration 0006 (owner administration schema)', () => {
  it('applies on top of a populated database without changing existing rows', () => {
    const t = createTestD1({ upTo: 5 })
    t.run(
      `INSERT INTO users (id, email, password_hash, display_name, created_at)
       VALUES ('user_a', 'someone@example.com', 'pbkdf2$100000$aa$bb', 'Someone', '2026-10-01T00:00:00.000Z')`,
    )
    t.run(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ('sess_a', 'user_a', 'hash_a', '2999-01-01T00:00:00.000Z')`,
    )
    t.run(
      `INSERT INTO tasks (id, user_id, title) VALUES ('task_a', 'user_a', 'Private task')`,
    )
    const before = t.query('SELECT * FROM users')

    applyMigrations(t.sqlite, migrationFiles().slice(5))

    const after = t.query(
      'SELECT id, email, password_hash, display_name, created_at FROM users',
    )
    expect(after).toEqual(before)
    expect(t.query('SELECT status, suspended_at FROM users')).toEqual([
      { status: 'active', suspended_at: null },
    ])
    expect(
      t.query('SELECT token_hash, last_seen_at, elevated_until FROM sessions'),
    ).toEqual([
      { token_hash: 'hash_a', last_seen_at: null, elevated_until: null },
    ])
    expect(t.query('SELECT title FROM tasks')).toEqual([
      { title: 'Private task' },
    ])
  })

  it('grants nobody any role or entitlement', () => {
    const t = createTestD1()
    expect(t.query('SELECT name FROM roles')).toEqual([{ name: 'owner' }])
    expect(t.query('SELECT * FROM user_roles')).toEqual([])
    expect(t.query('SELECT * FROM user_entitlements')).toEqual([])
    expect(t.query('SELECT * FROM platform_settings')).toEqual([])
  })

  it('allows only one active grant of a role per user', () => {
    const t = createTestD1()
    t.run(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES ('user_a', 'a@example.com', 'x', 'A')`,
    )
    t.run(
      `INSERT INTO user_roles (id, user_id, role, granted_by) VALUES ('r1', 'user_a', 'owner', 'test')`,
    )
    expect(() =>
      t.run(
        `INSERT INTO user_roles (id, user_id, role, granted_by) VALUES ('r2', 'user_a', 'owner', 'test')`,
      ),
    ).toThrow()
    expect(() =>
      t.run(
        `INSERT INTO user_roles (id, user_id, role, granted_by) VALUES ('r3', 'user_a', 'superuser', 'test')`,
      ),
    ).toThrow()
  })

  it('rejects unknown account statuses', () => {
    const t = createTestD1()
    expect(() =>
      t.run(
        `INSERT INTO users (id, email, password_hash, display_name, status)
         VALUES ('user_b', 'b@example.com', 'x', 'B', 'owner')`,
      ),
    ).toThrow()
  })
})

describe('migration 0007 (Document Devourer)', () => {
  it('keeps every existing document as a kept document', () => {
    const t = createTestD1({ upTo: 6 })
    t.run(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES ('user_a', 'a@example.com', 'x', 'A')`,
    )
    t.run(
      `INSERT INTO documents (id, user_id, display_name, storage_key, mime_type, byte_size, status)
       VALUES ('doc_a', 'user_a', 'bill.pdf', 'user_a/doc_a/bill.pdf', 'application/pdf', 10, 'ready')`,
    )
    applyMigrations(t.sqlite, migrationFiles().slice(6))
    expect(
      t.query('SELECT id, storage_key, retention, expires_at FROM documents'),
    ).toEqual([
      {
        id: 'doc_a',
        storage_key: 'user_a/doc_a/bill.pdf',
        retention: 'keep',
        expires_at: null,
      },
    ])
    expect(() =>
      t.run(`UPDATE documents SET retention = 'forever' WHERE id = 'doc_a'`),
    ).toThrow()
  })
})


describe('migrations 0019–0020 (approved study pathways)', () => {
  it('upgrades an existing database without changing previously saved tasks', () => {
    const t = createTestD1({ upTo: 18 })
    t.run(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES ('study_user', 'study@example.com', 'x', 'Study User')`,
    )
    t.run(
      `INSERT INTO tasks (id, user_id, title, due_date)
       VALUES ('prior_task', 'study_user', 'Existing chore', '2026-11-01')`,
    )
    applyMigrations(t.sqlite, migrationFiles().slice(18))
    expect(
      t.query(
        'SELECT id, title, due_date as dueDate FROM tasks WHERE user_id = ?',
        'study_user',
      ),
    ).toEqual([
      { id: 'prior_task', title: 'Existing chore', dueDate: '2026-11-01' },
    ])
    const columns = t.query('PRAGMA table_info(study_pathway_sessions)') as Array<{
      name: string
    }>
    expect(columns.map((column) => column.name)).toContain('deadline_date')
    expect(columns.map((column) => column.name)).toContain('step_order')
    expect(columns.map((column) => column.name)).toContain('goal_id')
  })

  it('keeps cancelled versions, rejects duplicate active versions and deletes account data', () => {
    const t = createTestD1()
    t.run(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES ('study_user', 'study@example.com', 'x', 'Study User')`,
    )
    t.run(
      `INSERT INTO study_pathways (id, user_id, document_id)
       VALUES ('first', 'study_user', 'source_doc')`,
    )
    expect(() =>
      t.run(
        `INSERT INTO study_pathways (id, user_id, document_id)
         VALUES ('duplicate', 'study_user', 'source_doc')`,
      ),
    ).toThrow()
    t.run(`UPDATE study_pathways SET status = 'cancelled' WHERE id = 'first'`)
    t.run(
      `INSERT INTO study_pathways (id, user_id, document_id)
       VALUES ('second', 'study_user', 'source_doc')`,
    )
    t.run(
      `INSERT INTO study_pathway_sessions
       (id, pathway_id, user_id, step_id, title, scheduled_date, minutes,
        sequence, deadline_date, goal_id, step_order)
       VALUES ('session_one', 'second', 'study_user', 'read', 'Read article',
               '2026-11-02', 45, 1, '2026-11-10', 'essay', 0)`,
    )
    expect(t.query('SELECT status FROM study_pathways ORDER BY id')).toEqual([
      { status: 'cancelled' },
      { status: 'active' },
    ])
    t.run(`DELETE FROM users WHERE id = 'study_user'`)
    expect(t.query('SELECT id FROM study_pathways')).toEqual([])
    expect(t.query('SELECT id FROM study_pathway_sessions')).toEqual([])
  })
})
