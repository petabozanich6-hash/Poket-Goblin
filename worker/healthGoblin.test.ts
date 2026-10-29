import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createHarness, type Harness, type TestUser } from './testing/harness'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

type Result = { kind: string; actionId?: string; message: string }
type Reply = {
  results: Result[]
  questions: string[]
  capture: string[]
  reply: string
}

let h: Harness
let me: TestUser

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T08:00:00Z')) // evening in Sydney, morning UTC
  h = createHarness()
  me = await h.register('goblin-health@example.com')
})
afterEach(() => vi.useRealTimers())

async function talk(text: string): Promise<Reply> {
  const res = await h.request('/api/goblin/converse', {
    cookie: me.cookie,
    body: { text, timezoneOffsetMinutes: 0 },
  })
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as Reply
}
const health = (path: string, body?: unknown) =>
  h.request(`/api/my-health${path}`, {
    cookie: me.cookie,
    ...(body !== undefined ? { body } : {}),
  })
const summary = async () =>
  (await (await health('?timezoneOffsetMinutes=0')).json()) as Json

describe('talking to the Goblin about health', () => {
  it('before Health is on: says how to turn it on, saves nothing, and never queues it for AI review', async () => {
    const r = await talk('had toast for breakfast')
    expect(r.reply).toMatch(/turned on/)
    expect(r.capture).toEqual([])
  })

  describe('with Health on', () => {
    beforeEach(async () => {
      expect((await health('/enable', { consent: true })).status).toBe(201)
    })

    it('logs weight, activity, water, sleep and food in one breath, each undoable', async () => {
      const r = await talk(
        'I weighed 92.4 kilos, I walked 30 minutes and I drank 2 glasses of water',
      )
      expect(r.results.map((x) => x.kind)).toEqual(['done', 'done', 'done'])
      expect(r.capture).toEqual([])
      let s = await summary()
      expect(s.weight.latestKg).toBe(92.4)
      expect(s.week.activityMinutes).toBe(30)
      expect(s.habits.water).toBe(2)

      // Undo the walk only.
      const walk = r.results[1]!
      expect(
        (
          await h.request(`/api/goblin/actions/${walk.actionId}/undo`, {
            cookie: me.cookie,
            body: {},
          })
        ).status,
      ).toBe(200)
      s = await summary()
      expect(s.week.activityMinutes).toBe(0)
      expect(s.weight.latestKg).toBe(92.4)

      // Undo the water: back to nothing; undo the weigh-in: gone.
      await h.request(`/api/goblin/actions/${r.results[2]!.actionId}/undo`, {
        cookie: me.cookie,
        body: {},
      })
      await h.request(`/api/goblin/actions/${r.results[0]!.actionId}/undo`, {
        cookie: me.cookie,
        body: {},
      })
      s = await summary()
      expect(s.habits.water).toBe(0)
      expect(s.weight.weighIns).toEqual([])
    })

    it('a weigh-in in stone is stored in kg; an imperial profile reads bare numbers as pounds', async () => {
      expect((await talk("I'm 14 stone 3")).reply).toMatch(/90\.3 kg/)
      expect((await summary()).weight.latestKg).toBeCloseTo(90.26, 2)
      await h.request('/api/my-health/profile', {
        method: 'PATCH',
        cookie: me.cookie,
        body: { units: 'imperial' },
      })
      const r = await talk('weight 199')
      expect(r.reply).toMatch(/199 lb/)
      expect((await summary()).weight.latestKg).toBeCloseTo(90.26, 2)
    })

    it('matches a saved recipe by name and counts its numbers for the servings eaten', async () => {
      await health('/recipes', {
        name: 'Pork Belly Benedict With Gochujang Hollandaise',
        calories: 1071,
        proteinG: 30,
        fatG: 83,
        carbsG: 51,
        sodiumMg: 1870,
      })
      const r = await talk('had half the pork belly benedict for dinner')
      expect(r.results[0]!.kind).toBe('done')
      expect(r.reply).toMatch(/half a serve of Pork Belly Benedict/)
      expect(r.reply).toMatch(/536 kcal/)
      const s = await summary()
      expect(s.meals[0]).toMatchObject({
        meal: 'dinner',
        servings: 0.5,
        calories: 536,
        proteinG: 15,
      })
      expect(s.nutrition.calories).toBe(536)
    })

    it('food without a recipe is logged without numbers; a drink is a drink', async () => {
      await talk('had a chicken salad for lunch')
      await talk('drank a flat white')
      const s = await summary()
      expect(s.meals.map((m: Json) => [m.meal, m.description])).toEqual([
        ['lunch', 'Chicken salad'],
        ['drink', 'Flat white'],
      ])
      expect(s.nutrition.uncounted).toBe(1)
    })

    it('supplements: tick off by name or all at once, warn past the set dose, and answer "did I take…"', async () => {
      await health('/supplements', {
        name: 'Faction Labs Deficit Clinical',
        dosesPerDay: 1,
        caffeineMg: 200,
      })
      await health('/supplements', {
        name: 'Voost multivitamin',
        dosesPerDay: 1,
      })
      let r = await talk('had my Deficit')
      expect(r.reply).toMatch(/Ticked off Faction Labs Deficit Clinical/)
      r = await talk('did I take my vitamins today?')
      expect(r.reply).toMatch(/Still to take today: Voost multivitamin/)
      r = await talk('took my supplements')
      expect(r.reply).toMatch(/Ticked off Voost multivitamin/)
      r = await talk('took my deficit clinical')
      expect(r.reply).toMatch(/check the label/)
      const s = await summary()
      expect(s.supplements.map((x: Json) => x.taken)).toEqual([2, 1])
      expect(s.caffeineMg).toBe(400)
    })

    it('"had my coffee" and unknown "had my X" are food or drink, not supplements', async () => {
      await health('/supplements', { name: 'Voost multivitamin' })
      await talk('had my coffee')
      await talk('had my smoothie bowl')
      const s = await summary()
      expect(s.meals.map((m: Json) => m.description)).toEqual([
        'Coffee',
        'Smoothie bowl',
      ])
      expect(s.supplements[0].taken).toBe(0)
    })

    it('answers how the day and the weight trend are going, and hides numbers when asked to', async () => {
      await health('/meals', {
        meal: 'breakfast',
        description: 'Oats',
        calories: 350,
        proteinG: 12,
      })
      await health('/profile', undefined)
      await h.request('/api/my-health/profile', {
        method: 'PATCH',
        cookie: me.cookie,
        body: { dailyCalorieGoal: 1800, proteinGoalG: 130 },
      })
      let r = await talk("how's my eating today?")
      expect(r.reply).toMatch(/350 of 1800 kcal/)
      expect(r.reply).toMatch(/12 of 130 g protein/)
      for (const [day, kg] of [
        ['2026-09-24', 95],
        ['2026-10-01', 94.2],
        ['2026-10-08', 93.5],
        ['2026-10-14', 93],
      ] as const) {
        await health('/weigh-ins', { day, weightKg: kg })
      }
      r = await talk('how am I going with my weight?')
      expect(r.reply).toMatch(/down 2 kg over the last four weeks/)
      await h.request('/api/my-health/profile', {
        method: 'PATCH',
        cookie: me.cookie,
        body: { hideNumbers: true },
      })
      r = await talk('how am I going with my weight?')
      expect(r.reply).toMatch(/trending down/)
      expect(r.reply).not.toMatch(/kg/)
    })

    it('health talk it cannot place stays out of the AI review queue; everyday talk is unaffected', async () => {
      let r = await talk('something about my protein intake')
      expect(r.capture).toEqual([])
      expect(r.reply).toMatch(/didn.t quite catch/)
      r = await talk('walk the dog tomorrow')
      expect(r.results[0]?.message ?? r.reply).not.toMatch(/How long/)
      r = await talk('I need milk')
      expect(r.reply).toMatch(/Milk added/)
    })

    it('"Ask me first" proposes health logs too, and confirming applies them', async () => {
      await h.request('/api/me/settings', {
        method: 'PATCH',
        cookie: me.cookie,
        body: { goblinAutonomy: 'ask' },
      })
      const r = await talk('walked 45 minutes')
      if (r.results[0]!.kind === 'confirm') {
        expect((await summary()).week.activityMinutes).toBe(0)
        await h.request(
          `/api/goblin/actions/${r.results[0]!.actionId}/confirm`,
          { cookie: me.cookie, body: {} },
        )
      }
      expect((await summary()).week.activityMinutes).toBe(45)
    })
  })
})
