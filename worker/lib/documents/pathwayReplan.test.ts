import { describe, expect, it } from 'vitest'

import {
  planMissedStudySessions,
  type SavedSessionForReplan,
} from './pathwayReplan'

const session = (
  id: string,
  overrides: Partial<SavedSessionForReplan> = {},
): SavedSessionForReplan => ({
  id,
  date: '2030-05-01',
  deadlineDate: '2030-05-10',
  minutes: 60,
  status: 'planned',
  taskStatus: 'open',
  taskId: 'task-' + id,
  ...overrides,
})

describe('missed study day replanning', () => {
  it('redistributes missed sessions without exceeding free daily capacity', () => {
    const result = planMissedStudySessions(
      '2030-05-03',
      [session('read'), session('draft')],
      [
        { date: '2030-05-03', availableMinutes: 90, committedMinutes: 30 },
        { date: '2030-05-04', availableMinutes: 90, committedMinutes: 30 },
      ],
    )
    expect(result.warnings).toEqual([])
    expect(result.moves).toEqual([
      { sessionId: 'draft', date: '2030-05-03', minutes: 60 },
      { sessionId: 'read', date: '2030-05-04', minutes: 60 },
    ])
  })

  it('never moves completed, future, cancelled or deleted tasks', () => {
    const result = planMissedStudySessions(
      '2030-05-03',
      [
        session('completed', { taskStatus: 'completed' }),
        session('future', { date: '2030-05-05' }),
        session('cancelled', { status: 'cancelled' }),
        session('removed', { taskStatus: null }),
      ],
      [{ date: '2030-05-04', availableMinutes: 240 }],
    )
    expect(result.missedCount).toBe(0)
    expect(result.moves).toEqual([])
  })

  it('warns instead of moving work beyond its original deadline', () => {
    const result = planMissedStudySessions(
      '2030-05-04',
      [
        session('expired', { deadlineDate: '2030-05-03' }),
        session('unknown', { deadlineDate: null }),
        session('full', { deadlineDate: '2030-05-05', minutes: 120 }),
      ],
      [{ date: '2030-05-05', availableMinutes: 90 }],
    )
    expect(result.moves).toEqual([])
    expect(result.warnings).toEqual([
      { sessionId: 'unknown', reason: 'missing_deadline' },
      { sessionId: 'expired', reason: 'deadline_passed' },
      { sessionId: 'full', reason: 'insufficient_capacity' },
    ])
  })

  it('rejects impossible dates and does not add capacity from duplicate days', () => {
    const result = planMissedStudySessions(
      '2030-05-03',
      [session('first')],
      [
        { date: '2030-02-30', availableMinutes: 200 },
        { date: '2030-05-04', availableMinutes: 90 },
        { date: '2030-05-04', availableMinutes: 10 },
      ],
    )
    expect(result.moves).toEqual([])
    expect(result.warnings).toEqual([
      { sessionId: 'first', reason: 'insufficient_capacity' },
    ])
  })
})
