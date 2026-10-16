import { describe, expect, it } from 'vitest'

import { createTestD1 } from '../../test/sqliteD1.mjs'
import { PLAN_SQL, resolvePlan, type EntitlementRow, type Role } from './access'
import {
  defaultSettings,
  highImpactReasons,
  validateSetting,
} from './platformSettings'

const future = '2999-01-01T00:00:00.000Z'
const past = '2000-01-01T00:00:00.000Z'

type Case = {
  name: string
  roles: Role[]
  rows: (Omit<EntitlementRow, 'endedAt' | 'currentPeriodEnd'> & {
    currentPeriodEnd?: string | null
    endedAt?: string | null
  })[]
  expected: string
}

const CASES: Case[] = [
  { name: 'nobody special', roles: [], rows: [], expected: 'free' },
  {
    name: 'owner role alone',
    roles: ['owner'],
    rows: [],
    expected: 'owner_premium',
  },
  {
    name: 'owner with a cancelled subscription',
    roles: ['owner'],
    rows: [
      {
        entitlement: 'premium',
        source: 'stripe',
        status: 'canceled',
        endedAt: past,
      },
    ],
    expected: 'owner_premium',
  },
  {
    name: 'owner premium grant without role',
    roles: [],
    rows: [{ entitlement: 'owner_premium', source: 'admin', status: 'active' }],
    expected: 'owner_premium',
  },
  {
    name: 'owner premium claimed by Stripe is ignored',
    roles: [],
    rows: [
      { entitlement: 'owner_premium', source: 'stripe', status: 'active' },
    ],
    expected: 'free',
  },
  {
    name: 'active subscription',
    roles: [],
    rows: [
      {
        entitlement: 'premium',
        source: 'stripe',
        status: 'active',
        currentPeriodEnd: future,
      },
    ],
    expected: 'premium',
  },
  {
    name: 'payment retrying',
    roles: [],
    rows: [
      {
        entitlement: 'premium',
        source: 'stripe',
        status: 'past_due',
        currentPeriodEnd: future,
      },
    ],
    expected: 'premium',
  },
  {
    name: 'period ended',
    roles: [],
    rows: [
      {
        entitlement: 'premium',
        source: 'stripe',
        status: 'active',
        currentPeriodEnd: past,
      },
    ],
    expected: 'free',
  },
  {
    name: 'cancelled',
    roles: [],
    rows: [{ entitlement: 'premium', source: 'stripe', status: 'canceled' }],
    expected: 'free',
  },
  {
    name: 'ended row',
    roles: [],
    rows: [
      {
        entitlement: 'premium',
        source: 'stripe',
        status: 'active',
        endedAt: past,
      },
    ],
    expected: 'free',
  },
]

describe('resolvePlan and PLAN_SQL agree', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const rows: EntitlementRow[] = c.rows.map((r) => ({
        currentPeriodEnd: null,
        endedAt: null,
        ...r,
      }))
      expect(resolvePlan(c.roles, rows)).toBe(c.expected)

      const t = createTestD1()
      t.run(
        `INSERT INTO users (id, email, password_hash, display_name) VALUES ('u', 'u@example.com', 'x', 'U')`,
      )
      for (const role of c.roles) {
        t.run(
          `INSERT INTO user_roles (id, user_id, role, granted_by) VALUES ('r', 'u', ?, 't')`,
          role,
        )
      }
      rows.forEach((r, i) =>
        t.run(
          `INSERT INTO user_entitlements (id, user_id, entitlement, source, status, current_period_end, ended_at)
           VALUES (?, 'u', ?, ?, ?, ?, ?)`,
          `e${i}`,
          r.entitlement,
          r.source,
          r.status,
          r.currentPeriodEnd,
          r.endedAt,
        ),
      )
      expect(t.query(`SELECT ${PLAN_SQL} as plan FROM users u`)).toEqual([
        { plan: c.expected },
      ])
    })
  }
})

describe('platform settings', () => {
  const env = { DB: {} as D1Database, ENVIRONMENT: 'production' }

  it('defaults keep Premium generous while restricting Free', () => {
    const d = defaultSettings(env)
    expect(d.features).toEqual({
      registrationsOpen: true,
      documentUploads: true,
      aiProvider: true,
    })
    expect(d.aiLimits.free).toBe(3)
    expect(d.aiLimits.premium).toBe(40)
    expect(d.aiLimits.owner).toBe(200)
  })

  it('validates every default', () => {
    const d = defaultSettings(env)
    for (const key of Object.keys(d) as (keyof typeof d)[]) {
      expect(validateSetting(key, d[key]).ok).toBe(true)
    }
  })

  it('flags turning paid AI back on as high impact', () => {
    const d = defaultSettings(env)
    expect(
      highImpactReasons(
        'features',
        { ...d.features, aiProvider: false },
        d.features,
      ),
    ).toEqual(['Turns paid AI provider calls back on'])
    expect(
      highImpactReasons('features', d.features, {
        ...d.features,
        aiProvider: false,
      }),
    ).toEqual([])
  })
})
