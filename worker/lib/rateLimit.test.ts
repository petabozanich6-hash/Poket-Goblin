import { afterEach, describe, expect, it } from 'vitest'

import { checkRateLimit, clearRateLimits } from './rateLimit'

afterEach(() => {
  clearRateLimits()
})

describe('checkRateLimit', () => {
  it('allows under the limit and blocks over', () => {
    expect(checkRateLimit('k', 2, 60_000).ok).toBe(true)
    expect(checkRateLimit('k', 2, 60_000).ok).toBe(true)
    const blocked = checkRateLimit('k', 2, 60_000)
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })

  it('isolates keys', () => {
    expect(checkRateLimit('a', 1, 60_000).ok).toBe(true)
    expect(checkRateLimit('b', 1, 60_000).ok).toBe(true)
    expect(checkRateLimit('a', 1, 60_000).ok).toBe(false)
  })
})
