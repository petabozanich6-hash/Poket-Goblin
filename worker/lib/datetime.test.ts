import { describe, expect, it } from 'vitest'

import { localDateTimeToIso } from './datetime'

describe('localDateTimeToIso', () => {
  it('applies browser timezone offset (AEDT = -660)', () => {
    // 10:00 local AEDT → 2026-10-15T23:00:00.000Z
    const iso = localDateTimeToIso('2026-10-16', '10:00', false, -660)
    expect(iso).toBe('2026-10-15T23:00:00.000Z')
  })

  it('treats zero offset as UTC wall clock', () => {
    const iso = localDateTimeToIso('2026-10-16', '10:00', false, 0)
    expect(iso).toBe('2026-10-16T10:00:00.000Z')
  })
})
