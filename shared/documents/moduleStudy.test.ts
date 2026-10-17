import { describe, expect, it } from 'vitest'

import { findDeadlines } from './deadlines'
import { suggestModuleStudy } from './moduleStudy'
import { understandDocument, withDeadlinePlan } from './understand'
import { previewDocumentPathway } from './pathwayPreview'

const reference = new Date('2026-10-17T00:00:00Z')
const moduleText = [
  'Module 1: Understanding loss, grief and mourning',
  'Learning outcomes: Define loss and grief. Explain mourning processes.',
  'Required readings: Work through the prescribed readings.',
  'Learning activities: Explore the different types of grief.',
  'Reflection activity: Reflect on your own experience of loss.',
  'Available ≡ OPEN ≡',
  '26 April 2027',
].join('\n')

describe('standalone study modules', () => {
  it('does not mistake module availability for a deadline', () => {
    expect(findDeadlines(moduleText, { reference })).toEqual([])
  })

  it('suggests grounded readings, notes, learning and reflection activities without made-up due dates', () => {
    const suggestions = suggestModuleStudy(moduleText)
    expect(suggestions.length).toBeGreaterThanOrEqual(4)
    expect(suggestions.map((s) => s.title)).toEqual(
      expect.arrayContaining([
        'Complete Module 1 prescribed readings',
        'Complete Module 1 learning activities',
        'Complete Module 1 reflection exercise',
      ]),
    )
    expect(suggestions.every((s) => s.group === 'Study module')).toBe(true)
    expect(suggestions.every((s) => s.dueDate === null)).toBe(true)
  })

  it('routes a module through the reviewed study pathway instead of adding a fake calendar entry', () => {
    const result = withDeadlinePlan(
      understandDocument(moduleText, 'Module 1 - UNE myLearn.pdf', {
        reference,
      }),
      moduleText,
      { reference, filename: 'Module 1 - UNE myLearn.pdf' },
    )
    expect(result.documentType).toBe('education')
    expect(result.suggestions.some((s) => s.type === 'appointment')).toBe(false)
    expect(result.suggestions.some((s) => s.group === 'Study module')).toBe(
      true,
    )
    const availability = Array.from({ length: 14 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 9, 17 + index)).toISOString().slice(0, 10),
      availableMinutes: 90,
    }))
    const missing = previewDocumentPathway(
      'module-test',
      result.suggestions,
      availability,
    )
    expect(missing.sessions).toHaveLength(0)
    expect(missing.unschedulable.length).toBeGreaterThan(0)
    const planned = previewDocumentPathway(
      'module-test',
      result.suggestions,
      availability,
      [],
      '2026-10-30',
    )
    expect(planned.sessions.length).toBeGreaterThan(1)
    expect(planned.warnings).toEqual([])
    expect(planned.unschedulable).toEqual([])
    expect(planned.sessions.every((s) => s.date <= '2026-10-30')).toBe(true)
    expect(planned.deadlines.every((d) => d.deadline === null)).toBe(true)
  })

  it('does not turn unrelated bills into study modules', () => {
    expect(suggestModuleStudy('Electricity bill due 20 October 2026.')).toEqual(
      [],
    )
  })
})
