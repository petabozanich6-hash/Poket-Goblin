import { describe, expect, it } from 'vitest'
import type { DocumentSuggestion } from './understand'
import { previewDocumentPathway } from './pathwayPreview'

const suggestion = (
  title: string,
  step: string,
  dueDate = '2026-11-08',
): DocumentSuggestion => ({
  kind: 'suggestion',
  type: 'task',
  title,
  details: '',
  dueDate,
  confidence: 'high',
  uncertain: false,
  missingInformation: [],
  sourceExcerpt: 'Essay due 8 November',
  categorySlug: 'work_study',
  group: 'Essay',
  step,
})

describe('previewDocumentPathway', () => {
  it('allocates document steps in order without changing their due dates', () => {
    const result = previewDocumentPathway(
      'doc',
      [suggestion('Read the brief', '1/2'), suggestion('Draft essay', '2/2')],
      [
        { date: '2026-11-01', availableMinutes: 60 },
        { date: '2026-11-02', availableMinutes: 120 },
      ],
    )
    expect(result.sessions[0]?.title).toBe('Read the brief')
    expect(result.sessions.at(-1)?.title).toBe('Draft essay')
    expect(result.estimates).toHaveLength(2)
    expect(result.unscheduledMinutes).toBe(0)
  })

  it('keeps uncertain deadlines out of automatic scheduling', () => {
    const uncertain = {
      ...suggestion('Check submission date', '1/1'),
      uncertain: true,
    }
    const result = previewDocumentPathway(
      'doc',
      [uncertain],
      [{ date: '2026-11-01', availableMinutes: 300 }],
    )
    expect(result.sessions).toHaveLength(0)
    expect(result.unschedulable).toHaveLength(1)
  })

  it('warns when available time is less than estimated workload', () => {
    const result = previewDocumentPathway(
      'doc',
      [suggestion('Research essay', '1/1')],
      [{ date: '2026-11-01', availableMinutes: 30 }],
    )
    expect(result.unscheduledMinutes).toBe(90)
  })
  it('respects numbered phase order even when extraction returns suggestions out of order', () => {
    const result = previewDocumentPathway(
      'doc',
      [suggestion('Draft essay', '2/2'), suggestion('Read brief', '1/2')],
      [
        { date: '2026-11-01', availableMinutes: 60 },
        { date: '2026-11-02', availableMinutes: 120 },
      ],
    )
    expect(result.sessions[0]?.title).toBe('Read brief')
    expect(result.sessions.at(-1)?.title).toBe('Draft essay')
  })
})
