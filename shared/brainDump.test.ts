import { describe, expect, it } from 'vitest'

import { interpretBrainDump } from './brainDump'

describe('interpretBrainDump', () => {
  const now = new Date('2026-10-13T12:00:00.000Z') // Tuesday

  it('does not invent a date without cues', () => {
    const [item] = interpretBrainDump('I need to book the dentist', now)
    expect(item?.dueDate).toBeNull()
    expect(item?.categorySlug).toBe('health')
    expect(item?.kind).toBe('task')
  })

  it('parses next Thursday', () => {
    const [item] = interpretBrainDump(
      'My electricity bill is due next Thursday',
      now,
    )
    expect(item?.dueDate).toBe('2026-10-22')
    expect(item?.categorySlug).toBe('money')
  })

  it('extracts multiple thoughts', () => {
    const items = interpretBrainDump(
      'I need to book the dentist. Buy milk tomorrow.',
      now,
    )
    expect(items.length).toBeGreaterThanOrEqual(2)
    expect(items.some((i) => i.kind === 'shopping')).toBe(true)
  })

  it('returns empty for blank input', () => {
    expect(interpretBrainDump('   ')).toEqual([])
  })
})
