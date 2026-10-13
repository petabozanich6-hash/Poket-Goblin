import { describe, expect, it } from 'vitest'

import { breakdownTaskWithRules } from './breakdown'
import { interpretWithRules } from './ruleEngine'
import { validateSuggestions } from './validate'

describe('goblin intelligence rules', () => {
  const now = new Date('2026-10-13T12:00:00.000Z') // Tuesday

  it('extracts multi-action dump without inventing next-month dates', () => {
    const result = interpretWithRules(
      'I need to pay the electricity bill by Thursday, book the dentist, get milk and bread, and remember that my car registration expires next month.',
      now,
    )
    expect(result.mode).toBe('rules')
    expect(result.suggestions.length).toBeGreaterThanOrEqual(4)

    const bill = result.suggestions.find((s) => /electric/i.test(s.title))
    expect(bill?.type).toBe('task')
    expect(bill?.dueDate).toBe('2026-10-15') // Thursday
    expect(bill?.categorySlug).toBe('money')

    const dentist = result.suggestions.find((s) => /dentist/i.test(s.title))
    expect(dentist?.type).toBe('task')
    expect(dentist?.dueDate).toBeNull()

    const shopping = result.suggestions.filter((s) => s.type === 'shopping')
    expect(shopping.length).toBeGreaterThanOrEqual(2)

    const rego = result.suggestions.find((s) =>
      /registration|expire/i.test(s.title),
    )
    expect(rego?.dueDate).toBeNull()
    expect(rego?.uncertain).toBe(true)
    expect(rego?.missingInformation.length).toBeGreaterThan(0)
  })

  it('suggests follow-up when an outbound action is described', () => {
    const result = interpretWithRules(
      'I emailed the real estate agent about the repair.',
      now,
    )
    expect(result.suggestions.some((s) => s.type === 'follow_up')).toBe(true)
    expect(
      result.suggestions.find((s) => s.type === 'follow_up')?.uncertain,
    ).toBe(true)
  })

  it('breaks down taxes into manageable steps', () => {
    const result = breakdownTaskWithRules('Sort out my taxes', 'normal')
    expect(result.steps.length).toBeGreaterThanOrEqual(4)
    expect(result.steps[0]?.type).toBe('breakdown_step')
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('rejects malformed AI payloads', () => {
    expect(
      validateSuggestions([
        { type: 'task', title: 'Ok', confidence: 'high' },
        { type: 'hack', title: 'Nope' },
        { type: 'task' },
        null,
      ]),
    ).toHaveLength(1)
  })
})
