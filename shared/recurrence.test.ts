import { describe, expect, it } from 'vitest'

import { generateOccurrences, nextOccurrenceAfter } from './recurrence'

describe('recurrence', () => {
  it('generates weekly Thursdays', () => {
    const dates = generateOccurrences(
      {
        frequency: 'weekly',
        startsOn: '2026-10-15', // Thursday
        intervalValue: 1,
      },
      4,
    )
    expect(dates[0]).toBe('2026-10-15')
    expect(dates[1]).toBe('2026-10-22')
    expect(dates[2]).toBe('2026-10-29')
  })

  it('clamps monthly 31st into shorter months', () => {
    const dates = generateOccurrences(
      {
        frequency: 'monthly',
        startsOn: '2026-01-31',
        dayOfMonth: 31,
      },
      3,
    )
    expect(dates[0]).toBe('2026-01-31')
    expect(dates[1]).toBe('2026-02-28')
    expect(dates[2]).toBe('2026-03-31')
  })

  it('finds next occurrence after a date', () => {
    const next = nextOccurrenceAfter(
      { frequency: 'fortnightly', startsOn: '2026-10-01' },
      '2026-10-01',
    )
    expect(next).toBe('2026-10-15')
  })
})
