import { describe, expect, it } from 'vitest'

import { interpretBrainDump, parseTime } from './brainDump'

describe('interpretBrainDump sprint 2', () => {
  const now = new Date('2026-10-13T12:00:00.000Z') // Tuesday

  it('does not invent a date without cues', () => {
    const [item] = interpretBrainDump('I need to book the dentist', now)
    expect(item?.dueDate).toBeNull()
    expect(item?.categorySlug).toBe('health')
  })

  it('parses next Thursday bill', () => {
    const [item] = interpretBrainDump(
      'My electricity bill is due next Thursday',
      now,
    )
    expect(item?.dueDate).toBe('2026-10-22')
    expect(item?.categorySlug).toBe('money')
  })

  it('splits task and shopping', () => {
    const items = interpretBrainDump(
      'Book the dentist and buy toothpaste.',
      now,
    )
    expect(items.length).toBe(2)
    expect(items.some((i) => i.kind === 'shopping')).toBe(true)
    expect(items.some((i) => /dentist/i.test(i.title))).toBe(true)
  })

  it('suggests appointment with time', () => {
    const [item] = interpretBrainDump('Meeting with Sarah Friday at 10am', now)
    expect(item?.kind).toBe('appointment')
    expect(item?.startTime).toBe('10:00')
    expect(item?.dueDate).toBe('2026-10-16')
  })

  it('suggests note for wifi password', () => {
    const [item] = interpretBrainDump(
      'Remember the WiFi password is written on the router.',
      now,
    )
    expect(item?.kind).toBe('note')
  })

  it('suggests recurring weekly task', () => {
    const [item] = interpretBrainDump('Bins out every Thursday.', now)
    expect(item?.kind).toBe('task')
    expect(item?.recurrenceFrequency).toBe('weekly')
  })

  it('suggests reminder', () => {
    const [item] = interpretBrainDump('Remind me to call Mum tomorrow.', now)
    expect(item?.kind).toBe('reminder')
    expect(item?.dueDate).toBe('2026-10-14')
  })

  it('splits multiple shopping items', () => {
    const items = interpretBrainDump(
      'Need toothpaste, washing powder and dog food.',
      now,
    )
    expect(items.length).toBe(3)
    expect(items.every((i) => i.kind === 'shopping')).toBe(true)
  })

  it('parses times', () => {
    expect(parseTime('at 2pm')).toBe('14:00')
    expect(parseTime('at 10:30')).toBe('10:30')
  })

  it('returns empty for blank input', () => {
    expect(interpretBrainDump('   ')).toEqual([])
  })
})
