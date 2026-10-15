import { describe, expect, it } from 'vitest'

import { detectIntent } from './intent'

describe('detectIntent', () => {
  it.each([
    ['Remind me to pay the electricity bill on Friday.', 'capture'],
    [
      'I need to book a dentist appointment, buy groceries and finish my application.',
      'capture',
    ],
    ['Add milk, bread and coffee to my shopping list.', 'capture'],
    ['Can you remind me to pay the bill on Friday?', 'capture'],
    ['milk\ncall mum\ndentist tuesday', 'capture'],
    ['What have I forgotten this week?', 'question'],
    ['What do I have on tomorrow?', 'question'],
    ['When is my dentist appointment', 'question'],
    ['Did I pay the water bill?', 'question'],
    ["I'm overwhelmed and don't know where to start.", 'overwhelm'],
    ['everything is too much today', 'overwhelm'],
    ['', 'capture'],
  ])('%s → %s', (text, intent) => {
    expect(detectIntent(text)).toBe(intent)
  })
})
