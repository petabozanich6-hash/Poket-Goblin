import { describe, expect, it } from 'vitest'

import { normaliseAddress, startsWithAddress } from './address'
import {
  applyExpressions,
  bareItem,
  classifyConversation,
  looksLikeShopping,
  parseDayRange,
} from './conversation'
import { parseOperation } from './language'
import { styleReply } from './voiceStyle'

const names = ['Lord Reginald', 'Gobbo', 'Mr Goblin', 'Gerald']
// Thursday 15 October 2026, local noon (the engine's wall-clock convention).
const wallClock = new Date(2026, 9, 15, 12)

describe('how people address their Goblin', () => {
  it.each([
    ['Goblin, what’s on today?', 'what’s on today?'],
    ['Oi Goblin, what’s on today?', 'what’s on today?'],
    ['Hey Goblin, what’s on today?', 'what’s on today?'],
    [
      'Excuse me good sir Mr Goblin, what is on the schedule for today?',
      'what is on the schedule for today?',
    ],
    ['Yo Gobbo, what’s the damage?', 'what’s the damage?'],
    [
      'Lord Reginald, would you be so kind as to review today’s appointments?',
      'review today’s appointments?',
    ],
    ['Goblin, mate, what have I forgotten?', 'what have I forgotten?'],
    [
      'Good morning, esteemed Lord Reginald, would you care to review my calendar?',
      'review my calendar?',
    ],
    ['What’s happening today?', 'What’s happening today?'],
    ['Milk.', 'Milk.'],
    ['what’s on today, Goblin?', 'what’s on today?'],
    ['Oi Goblin, milk', 'milk'],
    ['Hey Gobbo, chuck milk on the shopping list', 'chuck milk on the shopping list'],
  ])('%s → %s', (said, request) => {
    expect(normaliseAddress(said, names).text).toBe(request)
  })

  it('never needs a name or a fixed phrase', () => {
    expect(normaliseAddress('Remind me to call Mum on Thursday').text).toBe(
      'Remind me to call Mum on Thursday',
    )
    expect(normaliseAddress('Remind me to call Mum on Thursday').addressed).toBe(false)
  })

  it('keeps words that only look like greetings', () => {
    expect(normaliseAddress('morning appointment moved to 10').text).toBe(
      'morning appointment moved to 10',
    )
    expect(normaliseAddress('my dentist appointment').text).toBe('my dentist appointment')
  })

  it('treats a bare name as attention, not a request', () => {
    expect(normaliseAddress('Goblin?')).toEqual({ text: '', addressed: true })
    expect(normaliseAddress('Excuse me, Sir Reginald', ['Reginald'])).toEqual({
      text: '',
      addressed: true,
    })
  })

  it('custom names work, and the built-in name always does', () => {
    expect(normaliseAddress('Gerald, buy bread', names).text).toBe('buy bread')
    expect(normaliseAddress('Gerald, buy bread', []).text).toBe('Gerald, buy bread')
    expect(normaliseAddress('Goblin, buy bread', ['Gerald']).text).toBe('buy bread')
  })

  it('hands-free: only an utterance that leads with a name counts', () => {
    expect(startsWithAddress('Hey Gobbo, sort my life out', names)).toBe(true)
    expect(startsWithAddress('Excuse me, Sir Reginald', ['Reginald'])).toBe(true)
    expect(startsWithAddress('my goblin figurine is on the shelf', names)).toBe(false)
    expect(startsWithAddress('pass the salt', names)).toBe(false)
  })
})

describe('the same schedule intent, however it is asked', () => {
  const asks = [
    'Goblin, what’s on today?',
    'Oi Goblin, what’s on today?',
    'Hey Goblin, what’s on today?',
    'Excuse me good sir Mr Goblin, what is on the schedule for today?',
    'Lord Reginald, would you be so kind as to review today’s appointments?',
    'What’s happening today?',
    'What have I got on?',
    'What’s on the agenda?',
    'Anything important happening?',
    'What fresh hell awaits?',
    'Excuse me, good sir Mr Goblin, might I trouble you for a summary of today’s impending disasters?',
  ]
  it.each(asks)('%s', (said) => {
    const request = normaliseAddress(said, names).text
    expect(classifyConversation(request, wallClock)).toMatchObject({
      kind: 'overview',
      range: { from: '2026-10-15', label: 'today' },
    })
  })

  it('understands other days', () => {
    expect(classifyConversation('Yo Goblin, what’s the damage tomorrow?'.replace(/^.*?, /, ''), wallClock)).toMatchObject({
      kind: 'overview',
      range: { from: '2026-10-16', to: '2026-10-17' },
    })
    expect(classifyConversation('What’s on this weekend?', wallClock)).toMatchObject({
      kind: 'overview',
      range: { from: '2026-10-17', to: '2026-10-19', label: 'this weekend' },
    })
    expect(classifyConversation('Am I free Thursday afternoon?', wallClock)).toMatchObject({
      kind: 'availability',
      range: { part: 'afternoon' },
    })
  })
})

describe('conversational requests', () => {
  it.each([
    ['What’s overdue?', 'overdue'],
    ['I’ve forgotten what I was supposed to be doing.', 'focus'],
    ['Help me work out what matters.', 'focus'],
    ['What’s absolutely essential today?', 'focus'],
    ['Which ones can wait?', 'flexible'],
    ['What can I move until tomorrow?', 'flexible'],
    ['Do I actually have to do all this today?', 'flexible'],
    ['Can we make tomorrow’s problem tomorrow’s problem?', 'flexible'],
    ['Move them.', 'defer_refs'],
    ['Push those to Monday', 'defer_refs'],
    ['Actually, remove that.', 'undo'],
    ['Undo', 'undo'],
    ['Yes please', 'affirm'],
    ['Nah, leave it', null],
    ['No', 'deny'],
  ])('%s → %s', (said, kind) => {
    expect(classifyConversation(said, wallClock)?.kind ?? null).toBe(kind)
  })

  it('"what can I move until tomorrow" is about today', () => {
    expect(classifyConversation('What can I move until tomorrow?', wallClock)).toMatchObject({
      range: { from: '2026-10-15' },
      propose: false,
    })
    expect(classifyConversation('Can we make tomorrow’s problem tomorrow’s problem?', wallClock)).toMatchObject({
      range: { from: '2026-10-15' },
      propose: true,
    })
  })

  it('leaves record requests to the action engine', () => {
    for (const said of [
      'Remind me to call Mum on Thursday',
      'Add dentist appointment tomorrow',
      'I have an appointment on Friday',
      'Move my dentist appointment to Friday',
      'When is my dentist?',
      'Buy bread',
    ])
      expect(classifyConversation(said, wallClock), said).toBeNull()
  })
})

describe('new everyday phrasings reach real operations', () => {
  it.each([
    ['We’re out of washing powder', 'shopping_add'],
    ['chuck milk on the shopping list', 'shopping_add'],
    ['Put coffee on my list', 'shopping_add'],
    [
      'ensure dairy products are included in my next expedition to the supermarket',
      'shopping_add',
    ],
    ['Add washing the car to my tasks', 'task_add'],
    ['I forgot to call the dentist', 'task_add'],
    ['the washing needs doing', 'task_add'],
    ['I’m out of time', 'capture'],
  ])('%s → %s', (said, op) => {
    expect(parseOperation(said, wallClock).op).toBe(op)
  })

  it('names tasks sensibly', () => {
    expect(parseOperation('the washing needs doing', wallClock)).toMatchObject({
      title: 'Do the washing',
    })
    expect(parseOperation('Add washing the car to my tasks', wallClock)).toMatchObject({
      title: 'Washing the car',
    })
    expect(parseOperation('I forgot to call the dentist', wallClock)).toMatchObject({
      title: 'Call the dentist',
    })
  })
})

describe('bare items', () => {
  it('spots an item said on its own', () => {
    expect(bareItem('Milk.')).toBe('milk')
    expect(bareItem('oat milk')).toBe('oat milk')
    expect(bareItem('I am tired')).toBeNull()
    expect(bareItem('that')).toBeNull()
    expect(looksLikeShopping('milk')).toBe(true)
    expect(looksLikeShopping('washing powder')).toBe(true)
    expect(looksLikeShopping('passport')).toBe(false)
  })
})

describe('user-taught expressions', () => {
  it('swaps the phrase for its meaning', () => {
    const out = applyExpressions('what’s the damage?', [
      { phrase: "What's the damage?", meaning: 'show me my schedule today' },
    ])
    expect(out.used).toEqual(["What's the damage?"])
    expect(classifyConversation(out.text, wallClock)?.kind).toBe('overview')
  })

  it('only matches whole words', () => {
    expect(
      applyExpressions('the usualness', [{ phrase: 'the usual', meaning: 'add milk' }]).used,
    ).toEqual([])
  })
})

describe('day ranges', () => {
  it('next week starts Monday', () => {
    expect(parseDayRange('next week', wallClock)).toMatchObject({
      from: '2026-10-19',
      to: '2026-10-26',
    })
  })
})

describe('reply styles', () => {
  const parts = [
    {
      tone: 'done' as const,
      topic: 'shopping' as const,
      text: 'Milk added to your shopping list.',
      brief: 'Milk added.',
      items: ['Milk'],
    },
  ]
  it('puts facts first in every style', () => {
    for (const style of ['friendly', 'professional', 'chaotic', 'quiet'] as const) {
      const reply = styleReply(parts, { style, humour: 'lots', replyLength: 'short' })
      expect(reply.toLowerCase()).toContain('milk added')
    }
  })
  it('quiet and professional never joke', () => {
    expect(styleReply(parts, { style: 'quiet', humour: 'lots', replyLength: 'short' })).toBe(
      'Milk added.',
    )
    expect(
      styleReply(parts, { style: 'professional', humour: 'lots', replyLength: 'detailed' }),
    ).toBe('Milk added to your shopping list.')
  })
  it('the dairy line, when humour is on', () => {
    expect(styleReply(parts, { style: 'friendly', humour: 'lots', replyLength: 'short' })).toBe(
      'Milk added. Another dairy emergency narrowly avoided.',
    )
  })
  it('no humour during something sensitive', () => {
    const reply = styleReply(
      [...parts, { tone: 'care', topic: 'none', text: 'That’s a lot to carry.' }],
      { style: 'chaotic', humour: 'lots', replyLength: 'short' },
    )
    expect(reply).not.toMatch(/dairy|BEHOLD|HUMAN|RIGHT\.|SORTED\./)
  })
})
