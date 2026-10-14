import { describe, expect, it } from 'vitest'

import {
  addMissedThoughts,
  findSourceFragment,
  groundDueDate,
  groundRecurrence,
  groundStartTime,
  groundSuggestions,
  normalizeTitle,
  userLocalNow,
} from './grounding'
import { interpretWithRules } from './ruleEngine'
import type { GoblinSuggestion } from './types'

// Wednesday 14 Oct 2026, noon — the user's local wall clock.
const localNow = new Date('2026-10-14T12:00:00.000Z')

function suggestion(partial: Partial<GoblinSuggestion>): GoblinSuggestion {
  return {
    id: 'x',
    type: 'task',
    title: 'Untitled',
    details: '',
    dueDate: null,
    startTime: null,
    recurrenceFrequency: null,
    categorySlug: null,
    priority: null,
    capacityCost: null,
    confidence: 'medium',
    uncertain: false,
    missingInformation: [],
    proposedAction: 'Create task',
    sourceReference: '',
    parentSuggestionId: null,
    ...partial,
  }
}

describe('userLocalNow', () => {
  it("uses the user's day, not the Worker's UTC day", () => {
    // 21:30 UTC Tuesday is 08:30 Wednesday in Sydney (AEDT, offset -660).
    const utc = new Date('2026-10-13T21:30:00.000Z')
    expect(userLocalNow(-660, utc).toISOString().slice(0, 10)).toBe(
      '2026-10-14',
    )
  })

  it('ignores impossible offsets', () => {
    const utc = new Date('2026-10-13T21:30:00.000Z')
    expect(userLocalNow(99_999, utc).getTime()).toBe(utc.getTime())
  })
})

describe('normalizeTitle', () => {
  it('treats small wording differences as the same item', () => {
    expect(normalizeTitle('Pay the electricity bill!')).toBe(
      normalizeTitle('pay electricity bill'),
    )
    expect(normalizeTitle('Buy milk')).not.toBe(normalizeTitle('Buy bread'))
  })
})

describe('findSourceFragment', () => {
  const raw = 'Pay the rent by Friday. Call mum about Christmas'

  it('accepts a verbatim quote', () => {
    expect(
      findSourceFragment(raw, {
        title: 'Pay rent',
        sourceReference: 'Pay the rent by Friday',
      }),
    ).toBe('pay the rent by friday')
  })

  it('falls back to the clause that matches the title', () => {
    expect(
      findSourceFragment(raw, {
        title: 'Call mum',
        sourceReference: 'made-up quote',
      }),
    ).toBe('call mum about christmas')
  })

  it('does not let a whole-dump quote stand in for one thought', () => {
    expect(
      findSourceFragment(raw, { title: 'Call mum', sourceReference: raw }),
    ).toBe('call mum about christmas')
  })

  it('returns null when nothing in the text matches', () => {
    expect(
      findSourceFragment(raw, { title: 'Renew passport', sourceReference: '' }),
    ).toBeNull()
  })
})

describe('groundDueDate', () => {
  it('recomputes relative days instead of trusting the model', () => {
    expect(groundDueDate('pay rent by friday', '2026-10-30', localNow)).toEqual(
      { dueDate: '2026-10-16', dropped: false },
    )
  })

  it('drops a date the user never gave', () => {
    expect(groundDueDate('book the dentist', '2026-10-20', localNow)).toEqual({
      dueDate: null,
      dropped: true,
    })
  })

  it('drops dates for vague horizons', () => {
    expect(
      groundDueDate('rego expires next month', '2026-11-01', localNow),
    ).toEqual({ dueDate: null, dropped: true })
    expect(
      groundDueDate('sort the garage next week', '2026-10-19', localNow),
    ).toEqual({ dueDate: null, dropped: true })
  })

  it('keeps an explicitly named calendar date', () => {
    expect(
      groundDueDate('passport renewal due 3 november', '2026-11-03', localNow),
    ).toEqual({ dueDate: '2026-11-03', dropped: false })
    expect(groundDueDate('invoice due 20/10', '2026-10-20', localNow)).toEqual({
      dueDate: '2026-10-20',
      dropped: false,
    })
  })

  it('rejects a named date the model got wrong', () => {
    expect(
      groundDueDate('passport renewal due 3 november', '2026-11-30', localNow),
    ).toEqual({ dueDate: null, dropped: true })
    expect(
      groundDueDate('passport renewal due 3 november', '2026-02-30', localNow),
    ).toEqual({ dueDate: null, dropped: true })
  })

  it('needs a fragment to keep any date', () => {
    expect(groundDueDate(null, '2026-10-20', localNow).dueDate).toBeNull()
  })
})

describe('groundStartTime', () => {
  it('keeps a stated time and drops an invented one', () => {
    expect(groundStartTime('dentist friday 3pm', '15:00').startTime).toBe(
      '15:00',
    )
    expect(groundStartTime('dentist friday', '09:00')).toEqual({
      startTime: null,
      dropped: true,
    })
  })

  it('accepts noon and 24h times', () => {
    expect(groundStartTime('lunch with sam at noon', '12:00').startTime).toBe(
      '12:00',
    )
    expect(groundStartTime('standup 09:30', '09:30').startTime).toBe('09:30')
  })
})

describe('groundRecurrence', () => {
  it('only keeps repeats the user said', () => {
    expect(groundRecurrence('put the bins out every tuesday', 'weekly')).toBe(
      'weekly',
    )
    expect(groundRecurrence('put the bins out', 'weekly')).toBeNull()
  })
})

describe('groundSuggestions', () => {
  const raw =
    'Pay the electricity bill by Thursday. Book the dentist. Buy milk. Car rego expires next month.'

  it('grounds each thought separately and flags removed dates', () => {
    const result = groundSuggestions(
      [
        suggestion({
          title: 'Pay electricity bill',
          dueDate: '2026-10-29', // wrong Thursday
          sourceReference: 'Pay the electricity bill by Thursday',
        }),
        suggestion({
          title: 'Book the dentist',
          dueDate: '2026-10-15', // invented
          sourceReference: 'Book the dentist',
        }),
        suggestion({ type: 'shopping', title: 'Milk', sourceReference: '' }),
        suggestion({
          type: 'reminder',
          title: 'Car rego expires',
          dueDate: '2026-11-01', // invented from "next month"
          sourceReference: 'Car rego expires next month',
        }),
      ],
      raw,
      localNow,
    )

    const [bill, dentist, milk, rego] = result.suggestions
    expect(bill?.dueDate).toBe('2026-10-15')
    expect(bill?.uncertain).toBe(false)
    expect(dentist?.dueDate).toBeNull()
    expect(dentist?.uncertain).toBe(true)
    expect(dentist?.missingInformation).toContain(
      'Exact date needs confirmation',
    )
    expect(milk?.dueDate).toBeNull()
    expect(rego?.dueDate).toBeNull()
    expect(rego?.confidence).toBe('low')
    expect(result.warnings.join(' ')).toMatch(/Removed 2 dates/)
  })

  it('merges a thought the model listed twice', () => {
    const result = groundSuggestions(
      [
        suggestion({ title: 'Book the dentist' }),
        suggestion({ title: 'book dentist' }),
      ],
      raw,
      localNow,
    )
    expect(result.suggestions).toHaveLength(1)
    expect(result.warnings.join(' ')).toMatch(/Merged 1/)
  })

  it('gives every suggestion a unique id', () => {
    const result = groundSuggestions(
      [
        suggestion({ id: 'same', title: 'Book the dentist' }),
        suggestion({ id: 'same', type: 'shopping', title: 'Milk' }),
      ],
      raw,
      localNow,
    )
    const ids = result.suggestions.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('addMissedThoughts', () => {
  it('adds back thoughts the AI skipped, flagged for review', () => {
    const raw = 'Book the dentist, pay the electricity bill by Thursday'
    const rules = interpretWithRules(raw, localNow).suggestions
    // Already grounded: sourceReference is the verified fragment.
    const ai = [
      suggestion({
        title: 'Book dentist',
        sourceReference: 'book the dentist',
      }),
    ]
    const result = addMissedThoughts(ai, rules)
    expect(result.added).toBe(1)
    const bill = result.suggestions.find((s) => /electric/i.test(s.title))
    expect(bill?.uncertain).toBe(true)
    expect(bill?.missingInformation).toContain(
      'The AI skipped this part — check it',
    )
  })

  it('adds nothing when the AI covered every thought', () => {
    const raw = 'Book the dentist and buy toothpaste'
    const rules = interpretWithRules(raw, localNow).suggestions
    const ai = [
      suggestion({ title: 'Book the dentist' }),
      suggestion({ type: 'shopping', title: 'Toothpaste' }),
    ]
    expect(addMissedThoughts(ai, rules).added).toBe(0)
  })
})
