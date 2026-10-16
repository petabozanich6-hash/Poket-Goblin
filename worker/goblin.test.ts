import { beforeEach, describe, expect, it } from 'vitest'

import { createHarness, type Harness, type TestUser } from './testing/harness'

type Result = {
  kind: string
  actionId?: string
  message: string
  options?: { actionId: string; label: string }[]
}
type Response = {
  results: Result[]
  questions: string[]
  capture: string[]
  overwhelm: boolean
}

let h: Harness
let user: TestUser

beforeEach(async () => {
  h = createHarness()
  user = await h.register('goblin@example.com')
})

async function say(text: string, who = user): Promise<Response> {
  const res = await h.request('/api/goblin/act', {
    cookie: who.cookie,
    body: { text, timezoneOffsetMinutes: 0 },
  })
  expect(res.status).toBe(200)
  return (await res.json()) as Response
}

const post = (path: string, who = user) =>
  h.request(path, { cookie: who.cookie, body: {} })

const activeShopping = () =>
  h.query(
    `SELECT name, quantity FROM shopping_items WHERE user_id = ? AND checked = 0 AND removed_at IS NULL ORDER BY name`,
    user.id,
  )

describe('shopping, start to finish, with no approval screens', () => {
  it('adds milk, then crosses it off when bought', async () => {
    const add = await say('I need milk.')
    expect(add.results).toMatchObject([
      { kind: 'done', message: 'Milk added to your shopping list.' },
    ])
    expect(activeShopping()).toEqual([{ name: 'Milk', quantity: '' }])

    const bought = await say("I've bought the milk.")
    expect(bought.results).toMatchObject([
      { kind: 'done', message: 'Milk crossed off your list! 👹' },
    ])
    expect(activeShopping()).toEqual([])
    // Nothing waiting for review and no duplicate created.
    expect(h.query(`SELECT COUNT(*) as n FROM review_items`)).toEqual([
      { n: 0 },
    ])
    expect(h.query(`SELECT COUNT(*) as n FROM shopping_items`)).toEqual([
      { n: 1 },
    ])
  })

  it('is idempotent: buying it again says it was already done', async () => {
    await say('I need milk')
    await say('I bought milk')
    const again = await say('I already got the milk')
    expect(again.results).toMatchObject([
      { kind: 'info', message: 'Milk was already crossed off. 👍' },
    ])
  })

  it('never invents milk to cross off', async () => {
    const res = await say("I've bought the milk.")
    expect(res.results[0]?.message).toMatch(/couldn’t find milk on your list/)
    expect(h.query(`SELECT COUNT(*) as n FROM shopping_items`)).toEqual([
      { n: 0 },
    ])
  })

  it('understands the "brought" slip, but only for things on the list', async () => {
    await say('Need milk and bread')
    const res = await say('Brought milk')
    expect(res.results).toMatchObject([
      { kind: 'done', message: 'Milk crossed off your list! 👹' },
    ])
    expect(activeShopping()).toEqual([{ name: 'Bread', quantity: '' }])

    const kids = await say('I brought the kids to school')
    expect(kids.results).toEqual([])
    expect(kids.capture).toEqual(['I brought the kids to school'])
  })

  it('does not add duplicates', async () => {
    await say('I need milk')
    const again = await say('I need milk')
    expect(again.results).toMatchObject([
      { kind: 'info', message: 'Milk is already on your list.' },
    ])
    expect(activeShopping()).toHaveLength(1)
  })

  it('updates quantity instead of adding a second milk', async () => {
    await say('I need milk')
    const res = await say('Add two cartons of milk')
    expect(res.results).toMatchObject([
      { kind: 'done', message: 'Updated Milk to 2 cartons.' },
    ])
    expect(activeShopping()).toEqual([{ name: 'Milk', quantity: '2 cartons' }])
  })

  it('removes milk when no longer needed, keeping the record', async () => {
    await say('I need milk')
    const res = await say("I don't need milk anymore.")
    expect(res.results).toMatchObject([
      { kind: 'done', message: 'Milk is off your shopping list.' },
    ])
    expect(activeShopping()).toEqual([])
    expect(
      h.query(
        `SELECT COUNT(*) as n FROM shopping_items WHERE removed_at IS NOT NULL`,
      ),
    ).toEqual([{ n: 1 }])
  })

  it('answers "Did I buy milk?" from the records', async () => {
    await say('I need milk')
    expect((await say('Did I buy milk?')).results[0]?.message).toMatch(
      /Not yet/,
    )
    await say('Got the milk')
    expect((await say('Did I buy milk?')).results[0]?.message).toMatch(
      /^Yes! You crossed Milk off/,
    )
  })

  it('negation never completes anything', async () => {
    await say('I need milk')
    const res = await say("I haven't bought milk yet")
    expect(res.results[0]?.message).toMatch(/still on your list/)
    expect(activeShopping()).toHaveLength(1)
  })

  it('hides bought items from the active list but keeps them in history', async () => {
    await say('I need milk and bread')
    await say('Got the milk')
    const res = await h.request('/api/shopping', { cookie: user.cookie })
    const { lists } = (await res.json()) as {
      lists: {
        items: { name: string }[]
        completedItems: { name: string; checkedAt: string }[]
      }[]
    }
    expect(lists[0]?.items.map((i) => i.name)).toEqual(['Bread'])
    expect(lists[0]?.completedItems.map((i) => i.name)).toEqual(['Milk'])
    expect(lists[0]?.completedItems[0]?.checkedAt).toBeTruthy()
  })
})

describe('Undo', () => {
  it('genuinely reverses each kind of change', async () => {
    const add = await say('I need milk')
    expect(
      (await post(`/api/goblin/actions/${add.results[0]!.actionId}/undo`))
        .status,
    ).toBe(200)
    expect(activeShopping()).toEqual([])

    await say('I need eggs')
    const done = await say('Got the eggs')
    await post(`/api/goblin/actions/${done.results[0]!.actionId}/undo`)
    expect(activeShopping()).toEqual([{ name: 'Eggs', quantity: '' }])

    const task = await say('I need to call the dentist.')
    await post(`/api/goblin/actions/${task.results[0]!.actionId}/undo`)
    expect(h.query(`SELECT status FROM tasks`)).toEqual([
      { status: 'cancelled' },
    ])
  })

  it('cannot be applied twice or to someone else’s action', async () => {
    const add = await say('I need milk')
    const id = add.results[0]!.actionId!
    const other = await h.register('other@example.com')
    expect((await post(`/api/goblin/actions/${id}/undo`, other)).status).toBe(
      409,
    )
    expect((await post(`/api/goblin/actions/${id}/undo`)).status).toBe(200)
    expect((await post(`/api/goblin/actions/${id}/undo`)).status).toBe(409)
  })
})

describe('tasks', () => {
  it('creates, completes and remembers context for "remind me tomorrow"', async () => {
    const add = await say('I need to call the dentist.')
    expect(add.results).toMatchObject([
      { kind: 'done', message: 'Added “Call the dentist” to your tasks.' },
    ])
    const done = await say('I called the dentist.')
    expect(done.results).toMatchObject([
      { kind: 'done', message: 'Excellent — “Call the dentist” is done! 👹' },
    ])
    expect(h.query(`SELECT status FROM tasks`)).toEqual([
      { status: 'completed' },
    ])

    const remind = await say('Actually, remind me tomorrow.')
    expect(remind.results[0]).toMatchObject({ kind: 'done' })
    expect(remind.results[0]?.message).toMatch(
      /I’ll remind you to dentist|I’ll remind you to call the dentist/i,
    )
    expect(h.query(`SELECT COUNT(*) as n FROM reminders`)).toEqual([{ n: 1 }])
  })

  it('matches loosely: "electric bill" finds "Pay electricity bill"', async () => {
    await say('I need to pay the electricity bill')
    const res = await say('I paid the electric bill')
    expect(res.results[0]).toMatchObject({ kind: 'done' })
    expect(h.query(`SELECT status FROM tasks`)).toEqual([
      { status: 'completed' },
    ])
  })

  it('asks one question when several tasks could match', async () => {
    await say('I need to call the dentist about the bill')
    await say('I need to call the dentist about the appointment')
    const res = await say('I called the dentist')
    expect(res.results[0]).toMatchObject({ kind: 'clarify' })
    expect(res.results[0]?.options).toHaveLength(2)
    expect(
      h.query(`SELECT COUNT(*) as n FROM tasks WHERE status = 'open'`),
    ).toEqual([{ n: 2 }])

    const choice = res.results[0]!.options![1]!
    expect(
      (await post(`/api/goblin/actions/${choice.actionId}/confirm`)).status,
    ).toBe(200)
    expect(
      h.query(`SELECT COUNT(*) as n FROM tasks WHERE status = 'open'`),
    ).toEqual([{ n: 1 }])
    // The other option can no longer be chosen.
    expect(
      (
        await post(
          `/api/goblin/actions/${res.results[0]!.options![0]!.actionId}/confirm`,
        )
      ).status,
    ).toBe(409)
  })

  it('"I didn\'t pay the bill" does not complete it', async () => {
    await say('I need to pay the water bill')
    await say("I didn't pay the bill")
    expect(h.query(`SELECT status FROM tasks`)).toEqual([{ status: 'open' }])
  })
})

describe('calendar', () => {
  it('adds, answers, and asks before moving an appointment', async () => {
    const add = await say('I have a dentist appointment on Friday at 3pm')
    expect(add.results[0]).toMatchObject({ kind: 'done' })
    expect(
      (await say('When is my dentist appointment?')).results[0]?.message,
    ).toMatch(/^Dentist appointment is .* at 3:00/)

    const move = await say('Move my dentist appointment to Monday')
    expect(move.results[0]).toMatchObject({ kind: 'confirm' })
    const before = h.query(`SELECT starts_at FROM events`)
    // Nothing moved until the user says yes.
    expect(h.query(`SELECT starts_at FROM events`)).toEqual(before)
    expect(
      (await post(`/api/goblin/actions/${move.results[0]!.actionId}/confirm`))
        .status,
    ).toBe(200)
    expect(h.query(`SELECT starts_at FROM events`)).not.toEqual(before)
  })

  it('lists next week', async () => {
    const res = await say("What's on my calendar next week?")
    expect(res.results[0]?.message).toMatch(/next week/i)
  })
})

describe('mixed and leftovers', () => {
  it('handles completed, new and reminder actions in one sentence', async () => {
    await say('I need milk')
    const res = await say(
      "I've bought the milk, but I still need bread, and remind me to call Mum tomorrow.",
    )
    expect(res.results.map((r) => r.kind)).toEqual(['done', 'done', 'done'])
    expect(activeShopping()).toEqual([{ name: 'Bread', quantity: '' }])
    expect(h.query(`SELECT title FROM reminders`)).toEqual([
      { title: 'Call Mum' },
    ])
  })

  it('hands unrecognised thoughts and questions to the existing engines', async () => {
    const res = await say(
      'The landlord mentioned an inspection sometime soon. What have I forgotten this week?',
    )
    expect(res.capture).toEqual([
      'The landlord mentioned an inspection sometime soon.',
    ])
    expect(res.questions).toEqual(['What have I forgotten this week?'])
  })
})

describe('autonomy preference', () => {
  it('"ask me first" proposes instead of acting', async () => {
    await h.request('/api/me/settings', {
      method: 'PATCH',
      cookie: user.cookie,
      body: { goblinAutonomy: 'ask' },
    })
    const res = await say('I need milk')
    expect(res.results[0]).toMatchObject({ kind: 'confirm' })
    expect(activeShopping()).toEqual([])
    await post(`/api/goblin/actions/${res.results[0]!.actionId}/confirm`)
    expect(activeShopping()).toHaveLength(1)
  })
})

describe('isolation', () => {
  it('never matches another user’s records', async () => {
    await say('I need milk')
    const other = await h.register('other@example.com')
    const res = await say("I've bought the milk", other)
    expect(res.results[0]?.message).toMatch(/couldn’t find milk/)
    expect(activeShopping()).toHaveLength(1)
  })
})

describe('Free plan protects Goblin voice actions', () => {
  it('does not create an eleventh task from a spoken command', async () => {
    for (let i = 0; i < 10; i++) {
      const created = await h.request('/api/tasks', {
        cookie: user.cookie,
        body: { title: `Existing task ${i}` },
      })
      expect(created.status).toBe(201)
    }
    const response = await say('I need to call the dentist.')
    expect(response.results[0]).toMatchObject({ kind: 'info' })
    expect(response.results[0]?.message).toContain('Upgrade to Premium')
    expect(
      h.query(
        "SELECT COUNT(*) AS n FROM tasks WHERE user_id = ? AND status = 'open'",
        user.id,
      ),
    ).toEqual([{ n: 10 }])
  })
})
