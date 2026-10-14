import { describe, expect, it } from 'vitest'

import { inspectAccountId, inspectToken } from './cf-credentials-check.mjs'

const GOOD_TOKEN = 'Abcdefghij_klmnopqrstuvwxyz-0123456789AB' // 40 chars, fake
const GOOD_ACCOUNT = '0123456789abcdef0123456789abcdef' // fake

describe('inspectToken', () => {
  it('accepts a normal-looking token and reports only its length', () => {
    const result = inspectToken(GOOD_TOKEN)
    expect(result).toEqual({
      present: true,
      length: 40,
      problems: [],
      warnings: [],
    })
    expect(JSON.stringify(result)).not.toContain(GOOD_TOKEN)
  })

  it('reports a missing token', () => {
    expect(inspectToken(undefined).present).toBe(false)
    expect(inspectToken('').present).toBe(false)
  })

  it('catches copy-paste mistakes without echoing the value', () => {
    const cases = [
      `"${GOOD_TOKEN}"`,
      `Bearer ${GOOD_TOKEN}`,
      GOOD_ACCOUNT, // an ID pasted instead of the token secret
      `${GOOD_ACCOUNT}abcde`, // Global API Key shape
    ]
    for (const value of cases) {
      const result = inspectToken(value)
      expect(result.problems.length).toBeGreaterThan(0)
      expect(JSON.stringify(result)).not.toContain(GOOD_TOKEN)
    }
  })

  it('only warns about surrounding whitespace, which is trimmed', () => {
    for (const value of [`${GOOD_TOKEN}\n`, ` ${GOOD_TOKEN}`]) {
      const result = inspectToken(value)
      expect(result.problems).toEqual([])
      expect(result.warnings.length).toBe(1)
      expect(result.length).toBe(40)
    }
  })
})

describe('inspectAccountId', () => {
  it('accepts a 32-character hex account ID', () => {
    expect(inspectAccountId(GOOD_ACCOUNT, GOOD_TOKEN).problems).toEqual([])
  })

  it('flags wrong shapes, whitespace and the token pasted twice', () => {
    expect(inspectAccountId('my-account', GOOD_TOKEN).problems.length).toBe(1)
    expect(
      inspectAccountId(`${GOOD_ACCOUNT}\n`, GOOD_TOKEN).warnings.length,
    ).toBe(1)
    expect(
      inspectAccountId(GOOD_TOKEN, GOOD_TOKEN).problems.length,
    ).toBeGreaterThan(0)
    expect(inspectAccountId(undefined, GOOD_TOKEN).present).toBe(false)
  })
})
