import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestD1 } from '../test/sqliteD1.mjs'
import { app } from './index'
import { createHarness, type Harness, type TestUser } from './testing/harness'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

let h: Harness
let me: TestUser

const TODAY = '2026-10-15'

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T03:00:00Z`))
  h = createHarness()
  me = await h.register('health@example.com')
})
afterEach(() => vi.useRealTimers())

const api = (
  path: string,
  init: { method?: string; body?: unknown; user?: TestUser } = {},
) =>
  h.request(`/api/my-health${path}`, {
    method: init.method,
    body: init.body,
    cookie: (init.user ?? me).cookie,
  })
const enable = (user = me) =>
  api('/enable', { body: { consent: true, timezoneOffsetMinutes: 0 }, user })
const summary = async (user = me) =>
  (await (await api('?timezoneOffsetMinutes=0', { user })).json()) as Json

describe('turning Health on', () => {
  it('is off until the person says yes, and nothing can be logged before that', async () => {
    expect(await summary()).toEqual({ available: true, enabled: false })
    expect((await api('/weigh-ins', { body: { weightKg: 92 } })).status).toBe(
      409,
    )
    expect((await api('/enable', { body: {} })).status).toBe(400)
    expect((await enable()).status).toBe(201)
    const s = await summary()
    expect(s.enabled).toBe(true)
    expect(s.profile).toMatchObject({
      units: 'metric',
      weeklyActivityMinutes: 150,
      targets: { water: 8, veg: 5, fruit: 2, sleep: 7 },
    })
  })

  it('reports itself unavailable (not an error) before its migration is applied', async () => {
    const early = createHarness({ DB: createTestD1({ upTo: 24 }).db })
    const user = await early.register('early@example.com')
    const r = await early.request('/api/my-health', { cookie: user.cookie })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ available: false, enabled: false })
    expect(
      (
        await early.request('/api/my-health/enable', {
          cookie: user.cookie,
          body: { consent: true },
        })
      ).status,
    ).toBe(503)
    // The data export still works in that gap.
    expect(
      (await early.request('/api/account/export', { cookie: user.cookie }))
        .status,
    ).toBe(200)
  })
})

describe('logging', () => {
  beforeEach(async () => {
    await enable()
  })

  it('weigh-ins: one per day (a second replaces it), weekly averages and a 4-week trend', async () => {
    const days = [
      '2026-09-17',
      '2026-09-24',
      '2026-10-01',
      '2026-10-08',
      '2026-10-14',
    ]
    const kg = [96, 95.2, 94.6, 94, 93.4]
    for (let i = 0; i < days.length; i++) {
      expect(
        (
          await api('/weigh-ins', {
            body: { day: days[i], weightKg: kg[i], timezoneOffsetMinutes: 0 },
          })
        ).status,
      ).toBe(201)
    }
    const again = await api('/weigh-ins', {
      body: {
        day: '2026-10-14',
        weightKg: 93.2,
        waistCm: 101,
        timezoneOffsetMinutes: 0,
      },
    })
    expect(again.status).toBe(200)
    expect(((await again.json()) as Json).replaced).toBe(true)
    const s = await summary()
    expect(s.weight.latestKg).toBe(93.2)
    expect(s.weight.weighIns).toHaveLength(5)
    expect(s.weight.weekly.at(-1)).toEqual({
      weekStart: '2026-10-12',
      averageKg: 93.2,
    })
    expect(s.weight.changeKg4Weeks).toBeLessThan(0)
    expect(s.weight.paceKgPerWeek).toBeGreaterThan(-1)
    expect(s.notes).toEqual([]) // a steady pace needs no note
  })

  it('rejects impossible or future entries', async () => {
    expect((await api('/weigh-ins', { body: { weightKg: 5 } })).status).toBe(
      400,
    )
    expect(
      (await api('/weigh-ins', { body: { day: '2026-10-16', weightKg: 90 } }))
        .status,
    ).toBe(400)
    expect(
      (await api('/meals', { body: { meal: 'brunch', description: 'eggs' } }))
        .status,
    ).toBe(400)
    expect((await api('/activities', { body: { kind: 'walk' } })).status).toBe(
      400,
    )
    expect(
      (
        await api('/profile', {
          method: 'PATCH',
          body: { dailyCalorieGoal: 800 },
        })
      ).status,
    ).toBe(400)
  })

  it('food, drinks, activity, habits and supplements add up for today and the week', async () => {
    await api('/meals', {
      body: {
        meal: 'breakfast',
        description: 'Toast with peanut butter',
        calories: 350,
      },
    })
    await api('/meals', {
      body: { meal: 'drink', description: 'Flat white', caffeineMg: 120 },
    })
    await api('/activities', {
      body: { kind: 'walk', minutes: 30, intensity: 'moderate' },
    })
    await api('/activities', {
      body: {
        day: '2026-10-13',
        kind: 'gym',
        minutes: 45,
        intensity: 'vigorous',
      },
    })
    await api('/activities', { body: { kind: 'steps', steps: 8000 } })
    await api('/habits/water', { method: 'PUT', body: { add: 3 } })
    await api('/habits/water', { method: 'PUT', body: { add: 2 } })
    await api('/habits/sleep', { method: 'PUT', body: { amount: 7.5 } })
    const sup = (await (
      await api('/supplements', {
        body: {
          name: 'Faction Labs Deficit Clinical',
          dose: '2 capsules',
          dosesPerDay: 1,
          caffeineMg: 200,
        },
      })
    ).json()) as Json
    await api('/supplements', {
      body: { name: 'Voost multivitamin', dosesPerDay: 1 },
    })
    await api(`/supplements/${sup.id}/doses`, { body: {} })

    const s = await summary()
    expect(s.calories).toBe(350)
    expect(s.habits).toMatchObject({ water: 5, sleep: 7.5 })
    expect(s.week).toMatchObject({
      start: '2026-10-12',
      activityMinutes: 75,
      goalMinutes: 150,
      steps: 8000,
    })
    expect(s.supplements.map((x: Json) => [x.name, x.taken])).toEqual([
      ['Faction Labs Deficit Clinical', 1],
      ['Voost multivitamin', 0],
    ])
    expect(s.supplementsDue).toBe(1)
    expect(s.caffeineMg).toBe(320)
    expect(s.notes).toEqual([])

    // A second dose of a once-a-day supplement, and caffeine past the usual guide: gentle notes, no blocking.
    await api(`/supplements/${sup.id}/doses`, { body: {} })
    const t = await summary()
    expect(t.notes.map((n: Json) => n.kind)).toEqual(['doses', 'caffeine'])
    expect(t.notes[0].text).toMatch(/Check the label/)
  })

  it('history lists recent days, entries can be removed, and nothing crosses accounts', async () => {
    await api('/meals', {
      body: { meal: 'lunch', description: 'Chicken salad' },
    })
    const other = await h.register('other@example.com')
    await enable(other)
    const hist = (await (
      await api('/history?days=7&timezoneOffsetMinutes=0')
    ).json()) as Json
    expect(hist.meals).toHaveLength(1)
    const id = hist.meals[0].id
    expect(
      (await api(`/entries/meal/${id}`, { method: 'DELETE', user: other }))
        .status,
    ).toBe(404)
    expect(
      ((await (await api('/history?days=7', { user: other })).json()) as Json)
        .meals,
    ).toEqual([])
    expect(
      (await api(`/entries/meal/${id}`, { method: 'DELETE' })).status,
    ).toBe(200)
    expect((await summary()).meals).toEqual([])
  })

  it('"delete my health data" removes every health row and the consent, nothing else', async () => {
    await api('/weigh-ins', { body: { weightKg: 92 } })
    await api('/supplements', { body: { name: 'Fish oil' } })
    await h.request('/api/notes', {
      cookie: me.cookie,
      body: { title: 'Keep me', body: 'not health' },
    })
    expect(
      (await api('', { method: 'DELETE', body: { confirm: 'nope' } })).status,
    ).toBe(400)
    expect(
      (await api('', { method: 'DELETE', body: { confirm: 'DELETE' } })).status,
    ).toBe(200)
    expect(await summary()).toEqual({ available: true, enabled: false })
    for (const t of [
      'health_profiles',
      'health_weigh_ins',
      'health_supplements',
    ]) {
      expect(
        h.query(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, me.id),
      ).toEqual([{ n: 0 }])
    }
  })

  it('a pace faster than about 1 kg a week for three weeks earns a gentle note', async () => {
    const days = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12']
    const kg = [100, 98, 96.2, 94.4]
    for (let i = 0; i < days.length; i++)
      await api('/weigh-ins', { body: { day: days[i], weightKg: kg[i] } })
    const s = await summary()
    expect(s.notes.map((n: Json) => n.kind)).toEqual(['pace'])
    expect(s.notes[0].text).toMatch(/doctor/)
  })
})

// ---------------------------------------------------------------- recipes, macros and meal analysis

const MOB = {
  name: 'Pork Belly Benedict With Gochujang Hollandaise',
  calories: 1071,
  proteinG: 30,
  fatG: 83,
  satFatG: 36,
  carbsG: 51,
  sugarsG: 14,
  fibreG: 4,
  sodiumMg: 1870,
}

describe('recipes and macros', () => {
  beforeEach(async () => {
    await enable()
  })

  it('a saved recipe logs its per-serving numbers times the servings eaten, against macro goals', async () => {
    expect(
      (
        await api('/profile', {
          method: 'PATCH',
          body: {
            dailyCalorieGoal: 1900,
            proteinGoalG: 140,
            carbsGoalG: 190,
            fatGoalG: 63,
          },
        })
      ).status,
    ).toBe(200)
    const r = (await (
      await api('/recipes', {
        body: {
          ...MOB,
          servings: 4,
          sourceUrl: 'https://www.mob.co.uk/recipes/pork-belly-benedict',
        },
      })
    ).json()) as Json
    expect(r.recipe).toMatchObject({
      name: MOB.name,
      calories: 1071,
      sodiumMg: 1870,
      servings: 4,
    })
    expect(
      (
        await api('/meals', {
          body: { meal: 'dinner', recipeId: r.id, servings: 0.5 },
        })
      ).status,
    ).toBe(201)
    await api('/meals', {
      body: {
        meal: 'breakfast',
        description: 'Greek yoghurt',
        calories: 150,
        proteinG: 15,
      },
    })
    await api('/meals', { body: { meal: 'lunch', description: 'Sandwich' } })
    const s = await summary()
    expect(s.profile.macros).toEqual({
      calories: 1900,
      proteinG: 140,
      carbsG: 190,
      fatG: 63,
    })
    expect(s.nutrition).toMatchObject({
      calories: 686,
      proteinG: 30,
      fatG: 41.5,
      sodiumMg: 935,
      counted: 2,
      uncounted: 1,
    })
    expect(s.meals.find((m: Json) => m.meal === 'dinner')).toMatchObject({
      description: MOB.name,
      servings: 0.5,
      recipeId: r.id,
    })

    // Changing or removing the recipe never changes what was already eaten.
    await api(`/recipes/${r.id}`, {
      method: 'PUT',
      body: { ...MOB, calories: 500 },
    })
    await api(`/recipes/${r.id}`, { method: 'DELETE' })
    expect((await summary()).nutrition.calories).toBe(686)
    expect(((await (await api('/recipes')).json()) as Json).recipes).toEqual([])
  })

  it('refuses a calorie goal under 1,200 and silly macro numbers', async () => {
    const low = await api('/profile', {
      method: 'PATCH',
      body: { dailyCalorieGoal: 1000 },
    })
    expect(low.status).toBe(400)
    expect(((await low.json()) as Json).error).toMatch(/doctor/)
    expect(
      (await api('/profile', { method: 'PATCH', body: { proteinGoalG: 5000 } }))
        .status,
    ).toBe(400)
    expect(
      (await api('/recipes', { body: { name: 'x', calories: -5 } })).status,
    ).toBe(400)
  })

  it("reads a recipe link from the page's published nutrition, and only fetches public https pages", async () => {
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Recipe',
      name: MOB.name,
      recipeYield: '4',
      nutrition: {
        calories: '1071 kcal',
        proteinContent: '30 g',
        fatContent: '83 g',
        sodiumContent: '1870 mg',
      },
    }
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      if (url.includes('redirect'))
        return new Response(null, {
          status: 302,
          headers: { location: 'https://localhost/admin' },
        })
      if (url.includes('plain'))
        return new Response('<html>No recipe here</html>', {
          headers: { 'content-type': 'text/html' },
        })
      return new Response(
        `<html><script type="application/ld+json">${JSON.stringify(ld)}</script></html>`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      )
    })
    try {
      const ok = await api('/recipes/from-link', {
        body: { url: 'https://www.mob.co.uk/recipes/pork-belly-benedict' },
      })
      expect(ok.status).toBe(200)
      expect(((await ok.json()) as Json).preview).toMatchObject({
        name: MOB.name,
        servings: 4,
        calories: 1071,
        proteinG: 30,
        fatG: 83,
        sodiumMg: 1870,
        carbsG: null,
      })
      expect(
        (
          await api('/recipes/from-link', {
            body: { url: 'https://example.com/plain' },
          })
        ).status,
      ).toBe(422)
      for (const bad of [
        'http://example.com/r',
        'https://127.0.0.1/r',
        'https://localhost/r',
        'https://[::1]/r',
        'https://printer.local/r',
        'https://example.com:8080/r',
        'file:///etc/passwd',
      ]) {
        expect(
          (await api('/recipes/from-link', { body: { url: bad } })).status,
          bad,
        ).toBe(400)
      }
      expect(
        (
          await api('/recipes/from-link', {
            body: { url: 'https://example.com/redirect' },
          })
        ).status,
      ).toBe(422)
      expect(fetched.some((u) => u.includes('localhost'))).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('reading a nutrition panel screenshot', () => {
  const PANEL =
    'Nutritional information per serving:\nCalories\n1071 kcal\nProtein\n30 g\nFat 83g\nSaturated Fat 36g\nCarbohydrates 51g\nSugars 14g\nDietary Fibre 4g\nSodium 1870mg'
  const upload = (env: Json, user: TestUser, type = 'image/png') => {
    const form = new FormData()
    form.append(
      'image',
      new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'mob.png', {
        type,
      }),
    )
    return app.request(
      '/api/my-health/recipes/from-image',
      { method: 'POST', headers: { Cookie: user.cookie }, body: form },
      env,
    )
  }

  it('transcribes with the vision model, reads the numbers by rules, counts one AI request, stores nothing', async () => {
    const calls: string[] = []
    const ai = {
      run: async (model: string) => (calls.push(model), { response: PANEL }),
    }
    h = createHarness({ AI_PROVIDER: 'workers_ai', AI: ai as unknown as Ai })
    me = await h.register('panel@example.com')
    await enable()
    const r = await upload(h.env, me)
    expect(r.status).toBe(200)
    const body = (await r.json()) as Json
    expect(body.preview).toMatchObject({
      calories: 1071,
      proteinG: 30,
      fatG: 83,
      satFatG: 36,
      carbsG: 51,
      sugarsG: 14,
      fibreG: 4,
      sodiumMg: 1870,
    })
    expect(body.warnings).toEqual([])
    expect(calls).toEqual(['@cf/meta/llama-4-scout-17b-16e-instruct'])
    expect(
      h.query(
        'SELECT request_count FROM ai_usage_daily WHERE user_id = ?',
        me.id,
      ),
    ).toEqual([{ request_count: 1 }])
    expect(
      h.query(
        'SELECT COUNT(*) AS n FROM health_recipes WHERE user_id = ?',
        me.id,
      ),
    ).toEqual([{ n: 0 }])
    expect((await upload(h.env, me, 'application/pdf')).status).toBe(400)
  })

  it("says so plainly when pictures can't be read, so the numbers can be typed", async () => {
    const r = await upload(h.env, me)
    expect(r.status).toBe(409) // Health not on yet in this account
    await enable()
    const off = await upload(h.env, me)
    expect(off.status).toBe(503)
    expect(((await off.json()) as Json).error).toMatch(/Type the numbers/)
  })
})
