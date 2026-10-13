import { describe, expect, it } from 'vitest'

import { buildDailyBriefing } from './briefing'
import { isInQuietHours, parseHm } from './quietHours'
import { rankTasks, scoreTaskWithReasons } from './prioritize'
import { buildRescuePlan } from './rescue'
import { nextTinierStep, suggestTinyFirstSteps } from './tinyStep'
import type { Task } from '../types'

function task(partial: Partial<Task> & { id: string; title: string }): Task {
  return {
    categoryId: null,
    categorySlug: null,
    categoryName: null,
    notes: '',
    status: 'open',
    priority: 'normal',
    dueDate: null,
    capacityCost: 1,
    parentId: null,
    completedAt: null,
    recurrenceRuleId: null,
    seriesId: null,
    occurrenceDate: null,
    skipped: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('quiet hours', () => {
  it('parses HH:MM', () => {
    expect(parseHm('21:00')).toBe(21 * 60)
    expect(parseHm('08:30')).toBe(8 * 60 + 30)
    expect(parseHm('bad')).toBeNull()
  })

  it('handles overnight windows', () => {
    expect(isInQuietHours(22 * 60, '21:00', '08:00', true)).toBe(true)
    expect(isInQuietHours(7 * 60, '21:00', '08:00', true)).toBe(true)
    expect(isInQuietHours(12 * 60, '21:00', '08:00', true)).toBe(false)
    expect(isInQuietHours(22 * 60, '21:00', '08:00', false)).toBe(false)
  })
})

describe('briefing', () => {
  it('uses real facts and never invents appointments', () => {
    const briefing = buildDailyBriefing({
      displayName: 'Peta',
      capacityMode: 'steady',
      todayLocal: '2026-10-13',
      now: new Date('2026-10-13T09:00:00'),
      appointmentsToday: [
        {
          id: 'e1',
          title: 'Dentist',
          description: '',
          location: '',
          startsAt: '2026-10-13T01:00:00.000Z',
          endsAt: '2026-10-13T02:00:00.000Z',
          allDay: false,
          timezone: 'UTC',
          categoryId: null,
          linkedTaskId: null,
          recurrenceRuleId: null,
          seriesId: null,
          status: 'scheduled',
          createdAt: '',
          updatedAt: '',
        },
      ],
      overdueTasks: [
        task({ id: 't1', title: 'Pay electricity', dueDate: '2026-10-10' }),
      ],
      dueTodayTasks: [],
      planTasks: [task({ id: 't2', title: 'Buy milk' })],
      dueReminders: [],
      pendingReview: 1,
      unprocessedCaptures: 0,
    })

    expect(briefing.mode).toBe('rules')
    expect(briefing.greeting).toContain('Peta')
    expect(briefing.body.toLowerCase()).toContain('appointment')
    expect(briefing.facts.some((f) => f.kind === 'appointment')).toBe(true)
    expect(briefing.facts.some((f) => f.kind === 'overdue')).toBe(true)
    expect(briefing.focusTaskId).toBe('t1')
  })

  it('stays calm when shelves are empty', () => {
    const briefing = buildDailyBriefing({
      displayName: 'Peta',
      capacityMode: 'goblin',
      todayLocal: '2026-10-13',
      appointmentsToday: [],
      overdueTasks: [],
      dueTodayTasks: [],
      planTasks: [],
      dueReminders: [],
      pendingReview: 0,
      unprocessedCaptures: 0,
    })
    expect(briefing.body.toLowerCase()).toContain('nothing urgent')
    expect(briefing.focusTaskId).toBeNull()
  })
})

describe('prioritise', () => {
  it('explains overdue ranking', () => {
    const overdue = task({
      id: 'a',
      title: 'Bill',
      dueDate: '2026-10-01',
      priority: 'high',
    })
    const later = task({
      id: 'b',
      title: 'Someday',
      dueDate: '2026-11-01',
      priority: 'low',
    })
    const ranked = rankTasks([later, overdue], '2026-10-13', 'steady', false)
    expect(ranked[0]!.taskId).toBe('a')
    const reasons = scoreTaskWithReasons(overdue, '2026-10-13', 'steady', false)
    expect(reasons.reasons.join(' ')).toMatch(/due date|high priority/i)
  })
})

describe('rescue', () => {
  it('keeps a small set late in the day without changing due dates', () => {
    const plan = buildRescuePlan({
      now: new Date('2026-10-13T16:00:00'),
      todayLocal: '2026-10-13',
      capacityMode: 'steady',
      openTasks: [
        task({
          id: '1',
          title: 'Urgent',
          dueDate: '2026-10-13',
          priority: 'high',
        }),
        task({ id: '2', title: 'Also due', dueDate: '2026-10-13' }),
        task({ id: '3', title: 'Later', dueDate: '2026-10-20' }),
        task({ id: '4', title: 'Someday' }),
      ],
      remainingAppointments: [],
      planTaskIds: ['1', '2', '3'],
    })
    expect(plan.keep.length).toBeLessThanOrEqual(2)
    expect(plan.keep.some((k) => k.task.id === '1')).toBe(true)
    expect(plan.note.toLowerCase()).toContain('due dates')
    expect(plan.defer.some((d) => d.task.id === '4')).toBe(true)
  })
})

describe('tiny step', () => {
  it('suggests kitchen-scale starts', () => {
    const steps = suggestTinyFirstSteps('Clean the kitchen')
    expect(steps[0]!.toLowerCase()).toContain('plate')
  })

  it('can go tinier', () => {
    expect(nextTinierStep('Open the document').toLowerCase()).toMatch(
      /find|icon|bookmark/,
    )
  })
})
