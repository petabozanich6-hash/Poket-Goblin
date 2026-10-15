import { describe, expect, it } from 'vitest'

import {
  parseOperation,
  parseShoppingEntry,
  parseUtterance,
  splitClauses,
} from './language'

// Thursday 15 October 2026, noon.
const now = new Date('2026-10-15T12:00:00')
const op = (text: string) => parseOperation(text, now)

describe('shopping', () => {
  it.each([
    ['I need milk.', [{ name: 'milk', quantity: '' }]],
    [
      'Add milk, bread and coffee to my shopping list.',
      [
        { name: 'milk', quantity: '' },
        { name: 'bread', quantity: '' },
        { name: 'coffee', quantity: '' },
      ],
    ],
    ['Add two cartons of milk', [{ name: 'milk', quantity: '2 cartons' }]],
    [
      'Actually, I need two cartons of milk',
      [{ name: 'milk', quantity: '2 cartons' }],
    ],
    ['buy oat milk', [{ name: 'oat milk', quantity: '' }]],
  ])('%s → add', (text, items) => {
    expect(op(text)).toMatchObject({ op: 'shopping_add', items })
  })

  it.each([
    "I've bought the milk.",
    'I bought milk',
    'Got the milk',
    'Picked up milk',
    'I already got the milk',
    'Milk is done',
  ])('%s → complete milk', (text) => {
    expect(op(text)).toMatchObject({ op: 'complete', target: 'milk' })
  })

  it.each([
    "I don't need milk anymore.",
    'Remove milk from my shopping list',
    'forget the milk',
  ])('%s → cancel milk', (text) => {
    expect(op(text)).toMatchObject({ op: 'cancel', target: 'milk' })
  })

  it('asks about state instead of adding', () => {
    expect(op('Did I buy milk?')).toMatchObject({
      op: 'query_done',
      target: 'milk',
      domain: 'shopping',
    })
  })

  it.each(["I haven't bought milk yet", "I didn't pay the bill"])(
    '%s → never completes',
    (text) => {
      expect(op(text).op).toBe('not_yet')
    },
  )

  it('parses quantities', () => {
    expect(parseShoppingEntry('a dozen eggs')).toEqual({
      name: 'eggs',
      quantity: '12',
    })
    expect(parseShoppingEntry('milk tomorrow')).toEqual({
      name: 'milk',
      quantity: '',
    })
    expect(parseShoppingEntry('bread on Friday')).toEqual({
      name: 'bread',
      quantity: '',
    })
    expect(parseShoppingEntry('3 tins of tomatoes')).toEqual({
      name: 'tomatoes',
      quantity: '3 tins',
    })
  })
})

describe('tasks', () => {
  it('creates', () => {
    expect(op('I need to call the dentist.')).toMatchObject({
      op: 'task_add',
      title: 'Call the dentist',
    })
    expect(op('I have to finish my assignment by Friday')).toMatchObject({
      op: 'task_add',
      title: 'Finish my assignment',
      dueDate: '2026-10-16',
    })
  })

  it.each([
    ['I called the dentist.', 'dentist'],
    ["I've finished my assignment.", 'assignment'],
    ['I paid the electricity bill.', 'electricity bill'],
  ])('%s → complete task', (text, target) => {
    const parsed = op(text)
    expect(parsed).toMatchObject({ op: 'complete', domain: 'task' })
    expect(parsed.op === 'complete' && parsed.target).toContain(target)
  })

  it('treats "that appointment is done" as completing an appointment', () => {
    expect(op('That appointment is done')).toMatchObject({
      op: 'complete',
      domain: 'event',
    })
  })

  it('reminders with and without a subject', () => {
    expect(op('remind me to call Mum tomorrow')).toMatchObject({
      op: 'reminder_add',
      subject: 'call Mum',
      date: '2026-10-16',
    })
    expect(op('Actually, remind me tomorrow.')).toMatchObject({
      op: 'reminder_add',
      subject: null,
      date: '2026-10-16',
    })
  })
})

describe('calendar', () => {
  it('creates, asks, moves and lists', () => {
    expect(op('I have an appointment Thursday')).toMatchObject({
      op: 'event_add',
      title: 'Appointment',
    })
    expect(op('When is my appointment?')).toMatchObject({
      op: 'query_event',
      target: 'appointment',
    })
    expect(op('Move my appointment to Friday')).toMatchObject({
      op: 'event_move',
      target: 'appointment',
      date: '2026-10-16',
    })
    expect(op("What's on my calendar next week?")).toMatchObject({
      op: 'query_calendar',
      range: 'next_week',
    })
  })
})

describe('mixed instructions', () => {
  it('separates completed, new and reminder actions', () => {
    const ops = parseUtterance(
      "I've bought the milk, but I still need bread, and remind me to call Mum tomorrow.",
      now,
    )
    expect(ops.map((o) => o.op)).toEqual([
      'complete',
      'shopping_add',
      'reminder_add',
    ])
    expect(ops[1]).toMatchObject({ items: [{ name: 'bread' }] })
  })

  it('keeps item lists together', () => {
    expect(splitClauses('I still need bread and eggs')).toEqual([
      'I still need bread and eggs',
    ])
  })

  it('leaves long free-form thoughts to the brain-dump review', () => {
    expect(
      op('The landlord mentioned the inspection might be sometime soon').op,
    ).toBe('capture')
  })

  it('recognises overwhelm', () => {
    expect(op("I'm overwhelmed and don't know where to start").op).toBe(
      'overwhelm',
    )
  })
})
