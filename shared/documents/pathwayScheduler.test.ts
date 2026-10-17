import { describe, expect, it } from 'vitest'
import { recommendPathway, type PathwayStep } from './pathwayScheduler'

const step = (overrides: Partial<PathwayStep> = {}): PathwayStep => ({
  id: 'read',
  goalId: 'essay',
  title: 'Read the brief',
  minutes: 90,
  deadline: '2026-11-05',
  ...overrides,
})

describe('recommendPathway', () => {
  it('spreads work across available days and subtracts commitments', () => {
    const result = recommendPathway(
      [step({ minutes: 180 })],
      [
        { date: '2026-11-01', availableMinutes: 90 },
        { date: '2026-11-02', availableMinutes: 90, committedMinutes: 60 },
        { date: '2026-11-03', availableMinutes: 120, blocked: true },
        { date: '2026-11-04', availableMinutes: 90 },
      ],
    )
    expect(result.sessions.map((s) => [s.date, s.minutes])).toEqual([
      ['2026-11-01', 60],
      ['2026-11-01', 30],
      ['2026-11-02', 30],
      ['2026-11-04', 60],
    ])
    expect(result.unscheduledMinutes).toBe(0)
  })
  it('does not invent capacity or silently move a fixed deadline', () => {
    const result = recommendPathway(
      [step({ minutes: 200, deadline: '2026-11-02' })],
      [
        { date: '2026-11-01', availableMinutes: 30 },
        { date: '2026-11-03', availableMinutes: 500 },
      ],
    )
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]?.date).toBe('2026-11-01')
    expect(result.unscheduledMinutes).toBe(170)
    expect(result.warnings[0]?.reason).toBe('insufficient_capacity')
  })
  it('schedules prerequisite before dependent step', () => {
    const result = recommendPathway(
      [
        step({ id: 'draft', title: 'Draft', minutes: 60, dependsOn: ['read'] }),
        step({ id: 'read', minutes: 60 }),
      ],
      [
        { date: '2026-11-01', availableMinutes: 60 },
        { date: '2026-11-02', availableMinutes: 60 },
      ],
    )
    expect(result.sessions.map((s) => s.stepId)).toEqual(['read', 'draft'])
  })
  it('does not reschedule completed steps', () => {
    const result = recommendPathway(
      [
        step({ id: 'read' }),
        step({ id: 'draft', dependsOn: ['read'], minutes: 30 }),
      ],
      [{ date: '2026-11-02', availableMinutes: 30 }],
      { completedStepIds: ['read'] },
    )
    expect(result.sessions.map((s) => s.stepId)).toEqual(['draft'])
  })
  it('reports unknown dependencies', () => {
    const result = recommendPathway(
      [step({ dependsOn: ['missing'] })],
      [{ date: '2026-11-01', availableMinutes: 90 }],
    )
    expect(result.sessions).toHaveLength(0)
    expect(result.warnings[0]?.reason).toBe('missing_dependency')
    expect(result.unscheduledMinutes).toBe(90)
  })
  it('does not add duplicate capacity for duplicate day rows', () => {
    const result = recommendPathway(
      [step({ minutes: 120 })],
      [
        { date: '2026-11-01', availableMinutes: 60 },
        { date: '2026-11-01', availableMinutes: 60 },
      ],
    )
    expect(result.unscheduledMinutes).toBe(60)
  })
  it('rejects impossible dates rather than treating rollover dates as deadlines', () => {
    const result = recommendPathway(
      [step({ deadline: '2026-02-30' })],
      [{ date: '2026-02-27', availableMinutes: 120 }],
    )
    expect(result.sessions).toHaveLength(0)
    expect(result.warnings[0]?.reason).toBe('invalid_deadline')
  })

  it('does not create study time from non-finite availability values', () => {
    const result = recommendPathway(
      [step({ minutes: 60 })],
      [
        { date: '2026-11-01', availableMinutes: Number.NaN },
        {
          date: '2026-11-02',
          availableMinutes: 60,
          committedMinutes: Number.NaN,
        },
      ],
    )
    expect(result.sessions).toHaveLength(0)
    expect(result.unscheduledMinutes).toBe(60)
  })

  it('rejects impossible availability dates rather than inventing a study day', () => {
    const result = recommendPathway(
      [step({ minutes: 60 })],
      [{ date: '2026-02-30', availableMinutes: 90 }],
    )
    expect(result.sessions).toHaveLength(0)
    expect(result.unscheduledMinutes).toBe(60)
  })
})
