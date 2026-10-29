import { describe, expect, it } from 'vitest'

import { looksLikeHealth, parseHealth } from './health'

describe('health phrases', () => {
  it.each([
    [
      'I weighed 92.4 kilos this morning',
      { kind: 'weigh', weight: 92.4, weightUnit: 'kg', waistCm: null },
    ],
    ['weight 92', { kind: 'weigh', weight: 92, weightUnit: null }],
    ["I'm 14 stone 3", { kind: 'weigh', weight: 199, weightUnit: 'lb' }],
    [
      'the scales said 203 pounds',
      { kind: 'weigh', weight: 203, weightUnit: 'lb' },
    ],
    ['waist is 98 cm', { kind: 'weigh', weight: null, waistCm: 98 }],
  ])('weight: %s', (text, want) =>
    expect(parseHealth(text)).toMatchObject(want),
  )

  it('"I\'m 45" is an age, not a weight', () => {
    expect(parseHealth("I'm 45")).toBeNull()
  })

  it.each([
    [
      'walked 30 minutes',
      {
        kind: 'activity',
        activity: 'walk',
        minutes: 30,
        intensity: 'moderate',
      },
    ],
    [
      'went for a 20 minute run',
      { kind: 'activity', activity: 'run', minutes: 20, intensity: 'vigorous' },
    ],
    [
      'did an hour at the gym',
      { kind: 'activity', activity: 'gym', minutes: 60 },
    ],
    [
      'half an hour of yoga',
      { kind: 'activity', activity: 'yoga', minutes: 30, intensity: 'light' },
    ],
    ['10,000 steps today', { kind: 'activity', steps: 10000 }],
    ['8.5k steps', { kind: 'activity', steps: 8500 }],
  ])('activity: %s', (text, want) =>
    expect(parseHealth(text)).toMatchObject(want),
  )

  it('asks how long when no time is given', () => {
    expect(parseHealth('went for a walk')).toMatchObject({
      kind: 'unclear',
      hint: expect.stringMatching(/How long was your walk/),
    })
  })

  it.each([
    [
      'had toast for breakfast',
      { kind: 'meal', meal: 'breakfast', food: 'toast', servings: 1 },
    ],
    [
      'had toast and eggs for brekkie',
      { kind: 'meal', meal: 'breakfast', food: 'toast and eggs' },
    ],
    [
      'for dinner I had the pork belly benedict',
      { kind: 'meal', meal: 'dinner', food: 'pork belly benedict' },
    ],
    ['half the pork belly benedict for dinner', null],
    [
      'had half the pork belly benedict for dinner',
      {
        kind: 'meal',
        meal: 'dinner',
        food: 'pork belly benedict',
        servings: 0.5,
      },
    ],
    [
      'ate a chicken salad',
      { kind: 'meal', meal: null, food: 'chicken salad' },
    ],
    ['snacked on an apple', { kind: 'meal', meal: 'snack', food: 'apple' }],
    ['drank a flat white', { kind: 'meal', meal: 'drink', food: 'flat white' }],
    [
      'lunch was a ham sandwich',
      { kind: 'meal', meal: 'lunch', food: 'ham sandwich' },
    ],
  ])('food: %s', (text, want) => {
    const got = parseHealth(text)
    if (want === null) expect(got?.kind === 'meal').toBe(false)
    else expect(got).toMatchObject(want)
  })

  it.each([
    'I had a meeting',
    'had a great day',
    'I need milk',
    'took the bins out',
    'took my dog to the vet',
    'remind me to call Mum',
    'walk the dog tomorrow',
    'need to walk the dog',
    'remind me to take my vitamins',
    'I need to weigh myself tomorrow',
    'go for a run',
  ])('not health: %s', (text) => {
    const got = parseHealth(text)
    expect(got === null || got.kind === 'unclear').toBe(true)
    if (got) expect(got.kind).not.toBe('meal')
  })

  it.each([
    [
      'drank 2 glasses of water',
      { kind: 'habit', habit: 'water', amount: 2, mode: 'add' },
    ],
    ['had a bottle of water', { kind: 'habit', habit: 'water', amount: 2 }],
    ['had 3 serves of veg', { kind: 'habit', habit: 'veg', amount: 3 }],
    [
      'slept 7 and a half hours',
      { kind: 'habit', habit: 'sleep', amount: 7.5, mode: 'set' },
    ],
    ['got 6 hours of sleep', { kind: 'habit', habit: 'sleep', amount: 6 }],
  ])('habit: %s', (text, want) => expect(parseHealth(text)).toMatchObject(want))

  it.each([
    ['took my multivitamin', { kind: 'dose', name: 'multivitamin' }],
    ['had my Deficit', { kind: 'dose', name: 'deficit' }],
    [
      'took my Deficit Clinical this morning',
      { kind: 'dose', name: 'deficit clinical' },
    ],
    ['took my supplements', { kind: 'dose', name: null }],
    ['took my vitamins', { kind: 'dose', name: null }],
  ])('supplement: %s', (text, want) =>
    expect(parseHealth(text)).toMatchObject(want),
  )

  it.each([
    ['did I take my vitamins today?', 'supplements'],
    ['have I taken my Deficit yet?', 'supplements'],
    ['how am I going with my weight?', 'weight'],
    ["how's my eating today?", 'today'],
    ['how many calories have I had today?', 'today'],
  ])('question: %s', (text, what) =>
    expect(parseHealth(text)).toEqual({ kind: 'query', what }),
  )

  it('spots health talk it could not parse, so it never goes to the AI review', () => {
    expect(looksLikeHealth('something about my protein intake')).toBe(true)
    expect(looksLikeHealth('pick up the dry cleaning')).toBe(false)
  })
})

it('"had my coffee" is a drink, "had my X" otherwise may be a supplement', () => {
  expect(parseHealth('had my coffee')).toMatchObject({
    kind: 'meal',
    meal: 'drink',
    food: 'coffee',
  })
  expect(parseHealth('had my lunch')).toBeNull()
  expect(parseHealth('had my voost')).toMatchObject({
    kind: 'dose',
    name: 'voost',
    viaHad: true,
  })
})
