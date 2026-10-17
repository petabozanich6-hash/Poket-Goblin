import { describe, expect, it } from 'vitest'

import { understandDocument, withDeadlinePlan } from './understand'

describe('weekly-only study schedules', () => {
  it('keeps week-by-week coursework even when no assessment due date is listed', () => {
    const reference = new Date('2026-10-17T00:00:00Z')
    const document = [
      'University Study Schedule for Semester 2',
      'Week Commencing Topic Assessment',
      '1 19 October 2026',
      'Module 1: Understanding evidence',
      '2 26 October 2026',
      'Module 2: Research and sources',
    ].join('\n')
    const understood = withDeadlinePlan(
      understandDocument(document, 'University Study Schedule.txt', {
        reference,
      }),
      document,
      { reference },
    )
    expect(understood.documentType).toBe('education')
    const weekly = understood.suggestions.filter(
      (item) => item.group === 'Week by week',
    )
    expect(weekly.map((item) => item.title)).toEqual([
      'Week 1: Module 1: Understanding evidence',
      'Week 2: Module 2: Research and sources',
    ])
    expect(weekly.every((item) => item.type === 'task' && item.dueDate)).toBe(
      true,
    )
  })

  it('classifies a university assessment deadline as education rather than general paperwork', () => {
    const reference = new Date('2026-10-17T00:00:00Z')
    const document = [
      'Study Schedule',
      'Global: UNE myLearn Site: TRIMESTER 3 2026',
      'Assessment 1: Reflective essay (40%) due 20 November 2026',
    ].join('\n')
    const understood = withDeadlinePlan(
      understandDocument(document, 'UNE study outline.pdf', { reference }),
      document,
      { reference },
    )
    expect(understood.documentType).toBe('education')
    expect(
      understood.suggestions.some(
        (item) =>
          item.type === 'task' &&
          /reflective essay/i.test(item.title) &&
          /assessment/i.test(item.group ?? ''),
      ),
    ).toBe(true)
  })

})
