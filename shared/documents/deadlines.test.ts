import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { extractText } from './binaryText'
import { findDeadlines, planDeadlines } from './deadlines'
import { understandDocument, withDeadlinePlan } from './understand'

const reference = new Date('2026-10-16T09:00:00Z')
const plan = (text: string) => planDeadlines(text, { reference })!

const COURSE = `COMM1000 Course Outline
Date of issue: 1 October 2026
ASSESSMENT SCHEDULE
Assessment 1: Literature review (30%) Due: Friday 13 November 2026, 5pm
Assessment 2: Group presentation (20%) Due: 27 November 2026
Final exam (50%) Exam period: 10 December 2026
Weekly quizzes are due in Week 3, 6 and 9.`

describe('finding every deadline', () => {
  it('reads an assessment schedule, ignoring the issue date', () => {
    const found = findDeadlines(COURSE, { reference })
    expect(
      found.map(({ label, iso, kind, weight, time }) => ({
        label,
        iso,
        kind,
        weight,
        time,
      })),
    ).toEqual([
      {
        label: 'Assessment 1 Literature review',
        iso: '2026-11-13',
        kind: 'work',
        weight: 30,
        time: '17:00',
      },
      {
        label: 'Assessment 2 Group presentation',
        iso: '2026-11-27',
        kind: 'work',
        weight: 20,
        time: null,
      },
      {
        label: 'Final exam',
        iso: '2026-12-10',
        kind: 'exam',
        weight: 50,
        time: null,
      },
    ])
  })

  it('reads table cells that arrive one per line', () => {
    const found = findDeadlines(
      'Task\nDue date\nReading reflection\n23 October 2026\nResearch proposal (40%)\n20 November 2026',
      { reference },
    )
    expect(found.map((d) => [d.label, d.iso])).toEqual([
      ['Reading reflection', '2026-10-23'],
      ['Research proposal', '2026-11-20'],
    ])
  })

  it('works for anyone’s paperwork, not just study', () => {
    expect(
      findDeadlines(
        'Community Grants 2026. Applications close at 5pm on 1 December 2026. Acquittal reports are due 30 June 2027.',
        { reference },
      ).map((d) => [d.label, d.iso, d.kind]),
    ).toEqual([
      ['Applications', '2026-12-01', 'form'],
      ['Acquittal reports', '2027-06-30', 'work'],
    ])
  })

  it('counts "within 28 days" from today and asks to check it', () => {
    const [d] = findDeadlines(
      'Notice of fine. You must pay this fine or request a review within 28 days of this notice.',
      { reference },
    )
    expect(d).toMatchObject({
      label: 'Pay this fine or request a review',
      iso: '2026-11-13',
      kind: 'payment',
      uncertain: true,
    })
  })

  it('skips dates long past, flags recent ones as overdue', () => {
    const found = findDeadlines(
      'Your library books were due back on 12 October 2026. Your gym membership expired on 1 September 2026.',
      { reference },
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ iso: '2026-10-12', overdue: true })
  })
})

describe('planning back from each deadline', () => {
  it('spreads a big piece of work into steps and puts the due date in the calendar', () => {
    const p = plan(COURSE)
    const essay = p.suggestions.filter(
      (s) => s.group === 'Assessment 1 Literature review',
    )
    expect(essay.map((s) => [s.type, s.dueDate, s.title])).toEqual([
      ['appointment', '2026-11-13', 'Due: Assessment 1 Literature review'],
      [
        'task',
        '2026-10-23',
        'Start Assessment 1 Literature review: read what’s needed and list the parts',
      ],
      [
        'task',
        '2026-10-30',
        'Assessment 1 Literature review: gather what you need',
      ],
      [
        'task',
        '2026-11-06',
        'Assessment 1 Literature review: do the main part (first draft)',
      ],
      [
        'task',
        '2026-11-11',
        'Assessment 1 Literature review: check it over and finish',
      ],
      ['task', '2026-11-13', 'Submit Assessment 1 Literature review'],
    ])
    expect(essay[0]).toMatchObject({ startTime: '17:00', details: 'Worth 30%' })
    // Revision sessions before the exam, and the exam itself in the calendar.
    const exam = p.suggestions.filter((s) => s.group === 'Final exam')
    expect(exam[0]).toMatchObject({ type: 'appointment', title: 'Final exam' })
    expect(exam.filter((s) => /Revise/.test(s.title))).toHaveLength(2)
    expect(p.summary).toMatch(/^I found 3 dates — the next is/)
    expect(p.warnings[0]).toMatch(/Week 5/)
  })

  it('never schedules a step before today when time is short', () => {
    const p = plan('Research report (40%) due 23 October 2026.')
    const tasks = p.suggestions.filter((s) => s.type === 'task')
    expect(tasks.every((s) => s.dueDate! >= '2026-10-16')).toBe(true)
    expect(tasks.every((s) => s.dueDate! <= '2026-10-23')).toBe(true)
    expect(tasks.map((s) => s.priority)).toEqual(tasks.map(() => 'high'))
  })

  it('puts urgent things on today, first, marked high priority', () => {
    const p = plan(
      'Dear taxpayer,\nURGENT: Your 2025 tax return is overdue. Lodge your tax return by 30 October 2026 to avoid a penalty.',
    )
    const first = p.suggestions.find((s) => s.type === 'task')!
    expect(first).toMatchObject({
      title: 'Urgent: Lodge your tax return: list what’s needed',
      dueDate: '2026-10-16',
      priority: 'high',
      urgent: true,
    })
    expect(p.summary).toMatch(/1 thing is urgent, so it’s on today/)
    // No second, duplicate "urgent" item for the same sentence.
    expect(p.suggestions.filter((s) => s.urgent)).toHaveLength(1)
  })

  it('anything due in the next two days becomes "do it straight away"', () => {
    const p = plan('Please return the signed consent form by 17 October 2026.')
    expect(p.suggestions.map((s) => [s.type, s.dueDate, s.title])).toEqual([
      ['appointment', '2026-10-17', 'Due: Return the signed consent form'],
      ['task', '2026-10-16', 'Return the signed consent form straight away'],
    ])
  })

  it('turns an undated urgent request into a task for today', () => {
    const p = plan(
      'Hi Peta, please call the office immediately about your enrolment. Thanks, Student Services',
    )
    expect(p.suggestions).toMatchObject([
      {
        type: 'task',
        title: 'Urgent: Call the office about your enrolment',
        dueDate: '2026-10-16',
        priority: 'high',
      },
    ])
  })

  it('returns nothing for a document with no deadlines', () => {
    expect(
      planDeadlines('Lovely to see you at the weekend!', { reference }),
    ).toBeNull()
  })
})

describe('withDeadlinePlan', () => {
  it('replaces the single generic task for a study notice', () => {
    const base = understandDocument(COURSE, 'outline.pdf', { reference })
    const result = withDeadlinePlan(base, COURSE, { reference })
    expect(result.suggestions.length).toBeGreaterThan(10)
    expect(result.summary).toMatch(/I found 3 dates/)
  })

  it('leaves a simple bill alone, but lifts its urgency', () => {
    const text =
      'Bright Energy electricity bill. FINAL NOTICE. Amount due $182.40. Please call us immediately if you cannot pay. Payment due 28 October 2026.'
    const base = understandDocument(text, 'bill.pdf', { reference })
    const result = withDeadlinePlan(base, text, { reference })
    expect(
      result.suggestions.find((s) => s.title === 'Pay electricity bill'),
    ).toMatchObject({ priority: 'high' })
  })
})

describe('from a real PDF', () => {
  it('plans a Chrome-printed assessment table, cell by cell', async () => {
    const bytes = new Uint8Array(
      readFileSync(
        join(
          dirname(fileURLToPath(import.meta.url)),
          'fixtures/chrome-assessment-table.pdf',
        ),
      ),
    )
    const { text } = await extractText(bytes, 'application/pdf')
    expect(text).toContain('Literature review 30% 13 November 2026, 5pm')
    expect(
      findDeadlines(text, { reference }).map((d) => [d.label, d.iso, d.weight]),
    ).toEqual([
      ['Literature review', '2026-11-13', 30],
      ['Group presentation', '2026-11-27', 20],
      ['Final exam', '2026-12-10', 50],
    ])
  })
})

/**
 * Shaped like a real university study schedule printed from the web: a print
 * header and footer, week numbers and week-start dates in their own cells,
 * emoji, sessions at set times, a date without a year, a census day and an
 * exam given only by week.
 */
const SCHEDULE = `Study Schedule
Book: Study Schedule
Printed by: A Student
Date: Friday, 16 October 2026, 8:19 AM
Study Schedule - Trimester 3 2026
Week Commencing Topic Assessment
16/10/2026, 08:19 Study Schedule | Example Uni
Week Commencing Topic Assessment
1 19 October 2026
Module 1: Approaching the topic
Meet & Greet - Drop In Tutorial Session
Tuesday 20th October 2026 - 4:30pm
2 26 October 2026
Module 2: Contexts
Essay Construction Briefing (Click Link)
Wednesday 28th October - 4:30pm
5
16 November
2026
⚠ Census Day
Assignment preparation and writing
6
23 November
2026
Module 5: Practice
🌟 Assessment 1 Due🌟
Sunday 29th November 2026 - 11:59pm
Non-teaching / University Shutdown Period (21st December 2026 - 4th January 2027)
10 04 January 2027 Exam Preparation and Writing
13 25 January 2027 Assessment and Intensive Period 2
🌟 Assessment 2 (Assurance Task) Exam
🌟
16/10/2026, 08:19 Study Schedule | Example Uni`

describe('a real-world study schedule', () => {
  const plan = () => planDeadlines(SCHEDULE, { reference })!

  it('finds what matters and ignores print dates and week starts', () => {
    expect(
      plan().deadlines.map((d) => [d.label, d.iso, d.kind, d.uncertain]),
    ).toEqual([
      ['Meet & Greet - Drop In Tutorial Session', '2026-10-20', 'event', false],
      // No year written: taken from the dates around it.
      ['Essay Construction Briefing', '2026-10-28', 'event', false],
      ['Census Day', '2026-11-16', 'event', true],
      ['Assessment 1', '2026-11-29', 'work', false],
      [
        'Non-teaching / University Shutdown Period',
        '2026-12-21',
        'event',
        false,
      ],
      // Only the week is written: in the calendar, but asks to check.
      ['Assessment 2 Assurance Task Exam', '2027-01-25', 'exam', true],
    ])
  })

  it('sessions keep their time; the assessment gets steps back from the due date', () => {
    const items = plan().suggestions
    expect(
      items.find((s) => s.title === 'Meet & Greet - Drop In Tutorial Session'),
    ).toMatchObject({ type: 'appointment', startTime: '16:30' })
    expect(items.find((s) => s.title === 'Due: Assessment 1')).toMatchObject({
      dueDate: '2026-11-29',
      startTime: '23:59',
    })
    expect(
      items.filter((s) => s.group === 'Assessment 1' && s.type === 'task'),
    ).toHaveLength(5)
    // Nothing from the print header, footer or week-start rows.
    expect(
      items.some((s) => /Printed|Example Uni|Week Commencing/.test(s.title)),
    ).toBe(false)
  })

  it('summarises an outline that lists assessments but no dates', () => {
    const outline = `Assessment Weighting Mandatory Description
Assessment 1 40% Yes Written assignment
Assessment 2
60% Yes Exam paper comprising multiple choice
If you need urgent support in a crisis, contact Student Wellbeing.`
    expect(planDeadlines(outline, { reference })).toEqual({
      deadlines: [],
      suggestions: [],
      warnings: [],
      summary:
        'This outlines 2 assessments: Assessment 1 (40%, written assignment) and Assessment 2 (60%, exam paper). It doesn’t give due dates — feed me the study schedule or assessment page and I’ll plan them.',
    })
  })
})
