import { describe, expect, it } from 'vitest'

import { createTestD1 } from '../test/sqliteD1.mjs'
import {
  AUDIT_SQL,
  GRANT_ENTITLEMENT_SQL,
  GRANT_ROLE_SQL,
  evaluate,
  maskEmail,
  sameEmail,
} from './owner-promotion.mjs'

const ID = `user_${'a'.repeat(32)}`
const OTHER = `user_${'b'.repeat(32)}`
const TABLES = ['users', 'user_roles', 'user_entitlements', 'admin_audit_log']
const owner = { email: 'Owner@Example.com', status: 'active' }

describe('maskEmail', () => {
  it('shows only the first and last character of the name', () => {
    expect(maskEmail('petabozanich6@gmail.com')).toBe('p***********6@gmail.com')
    expect(maskEmail('ab@x.io')).toBe('a@x.io')
  })
})

describe('evaluate', () => {
  const base = {
    userId: ID,
    expectedEmail: 'owner@example.com',
    tables: TABLES,
    user: owner,
    owners: [],
  }

  it('accepts the matching, active account when nobody is Owner yet', () => {
    expect(evaluate(base)).toEqual({ errors: [], alreadyDone: false })
  })

  it('compares email case-insensitively but exactly', () => {
    expect(sameEmail('Owner@Example.com', ' owner@example.com ')).toBe(true)
    expect(sameEmail('owner@example.com', 'owner@example.co')).toBe(false)
    expect(sameEmail('', '')).toBe(false)
  })

  it.each([
    ['a malformed id', { userId: "user_x' OR 1=1" }],
    ['a missing secret', { expectedEmail: '' }],
    ['schema not migrated', { tables: ['users'] }],
    ['an unknown account', { user: null }],
    ['a different email', { user: { ...owner, email: 'someone@else.com' } }],
    ['a suspended account', { user: { ...owner, status: 'suspended' } }],
    ['another existing Owner', { owners: [OTHER] }],
  ])('refuses %s', (_label, change) => {
    expect(evaluate({ ...base, ...change }).errors.length).toBeGreaterThan(0)
  })

  it('reports an already-promoted account as done', () => {
    expect(evaluate({ ...base, owners: [ID] })).toEqual({
      errors: [],
      alreadyDone: true,
    })
  })
})

describe('promotion statements on the real schema', () => {
  function setup() {
    const t = createTestD1()
    const insertUser = (id, email, status = 'active') =>
      t.run(
        `INSERT INTO users (id, email, password_hash, display_name, status)
         VALUES (?, ?, 'pbkdf2$100000$aa$bb', 'Name', ?)`,
        id,
        email,
        status,
      )
    insertUser(ID, 'owner@example.com')
    insertUser(OTHER, 'other@example.com')
    t.run(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES ('s1', ?, 'h1', '2999-01-01')`,
      ID,
    )
    return t
  }

  it('grants role, entitlement and audit without touching anything else', () => {
    const t = setup()
    const before = t.query('SELECT * FROM users ORDER BY id')
    const sessionsBefore = t.query('SELECT * FROM sessions')

    expect(
      Number(
        t.run(GRANT_ROLE_SQL, 'role_1', 'op', ID, 'OWNER@example.com').changes,
      ),
    ).toBe(1)
    expect(
      Number(t.run(GRANT_ENTITLEMENT_SQL, 'ent_1', 'op', ID).changes),
    ).toBe(1)
    t.run(AUDIT_SQL, 'audit_1', 'op', ID, '{}')

    expect(t.query(`SELECT user_id, role FROM user_roles`)).toEqual([
      { user_id: ID, role: 'owner' },
    ])
    expect(
      t.query(
        `SELECT user_id, entitlement, source, status FROM user_entitlements`,
      ),
    ).toEqual([
      {
        user_id: ID,
        entitlement: 'owner_premium',
        source: 'admin',
        status: 'active',
      },
    ])
    expect(
      t.query(`SELECT action, target_id, actor_user_id FROM admin_audit_log`),
    ).toEqual([{ action: 'owner.promote', target_id: ID, actor_user_id: null }])
    expect(t.query('SELECT * FROM users ORDER BY id')).toEqual(before)
    expect(t.query('SELECT * FROM sessions')).toEqual(sessionsBefore)
  })

  it('does nothing when the email does not match the id', () => {
    const t = setup()
    expect(
      Number(
        t.run(GRANT_ROLE_SQL, 'role_1', 'op', OTHER, 'owner@example.com')
          .changes,
      ),
    ).toBe(0)
    expect(
      Number(t.run(GRANT_ENTITLEMENT_SQL, 'ent_1', 'op', OTHER).changes),
    ).toBe(0)
    expect(t.query('SELECT * FROM user_roles')).toEqual([])
    expect(t.query('SELECT * FROM user_entitlements')).toEqual([])
  })

  it('cannot be repeated against another account once an Owner exists', () => {
    const t = setup()
    t.run(GRANT_ROLE_SQL, 'role_1', 'op', ID, 'owner@example.com')
    expect(
      Number(
        t.run(GRANT_ROLE_SQL, 'role_2', 'op', OTHER, 'other@example.com')
          .changes,
      ),
    ).toBe(0)
    expect(t.query('SELECT user_id FROM user_roles')).toEqual([{ user_id: ID }])
  })

  it('is idempotent for the same account', () => {
    const t = setup()
    t.run(GRANT_ROLE_SQL, 'role_1', 'op', ID, 'owner@example.com')
    t.run(GRANT_ENTITLEMENT_SQL, 'ent_1', 'op', ID)
    expect(
      Number(
        t.run(GRANT_ROLE_SQL, 'role_2', 'op', ID, 'owner@example.com').changes,
      ),
    ).toBe(0)
    expect(
      Number(t.run(GRANT_ENTITLEMENT_SQL, 'ent_2', 'op', ID).changes),
    ).toBe(0)
  })

  it('refuses a suspended account', () => {
    const t = setup()
    t.run(`UPDATE users SET status = 'suspended' WHERE id = ?`, ID)
    expect(
      Number(
        t.run(GRANT_ROLE_SQL, 'role_1', 'op', ID, 'owner@example.com').changes,
      ),
    ).toBe(0)
  })
})
