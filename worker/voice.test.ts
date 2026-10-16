import { beforeEach, describe, expect, it } from 'vitest'

import { createHarness, type Harness, type TestUser } from './testing/harness'

type Result = {
  kind: string
  actionId?: string
  message: string
  options?: { actionId: string; label: string }[]
}
type Reply = {
  results: Result[]
  questions: string[]
  capture: string[]
  overwhelm: boolean
  reply: string
  heard: string
  addressed: boolean
  answers: { title: string; lines: string[] }[]
  replayed?: boolean
}

let h: Harness
let user: TestUser

beforeEach(async () => {
  h = createHarness()
  user = await h.register('voice@example.com')
})

async function talk(
  text: string,
  extra: Record<string, unknown> = {},
  who = user,
): Promise<Reply> {
  const res = await h.request('/api/goblin/converse', {
    cookie: who.cookie,
    body: { text, timezoneOffsetMinutes: 0, ...extra },
  })
  expect(res.status, await res.clone().text()).toBe(200)
  return (await res.json()) as Reply
}

const activeShopping = (who = user) =>
  h.query(
    `SELECT name FROM shopping_items WHERE user_id = ? AND checked = 0 AND removed_at IS NULL ORDER BY name`,
    who.id,
  )

function today(offsetDays = 0): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function seedTask(
  title: string,
  due: string | null,
  priority = 'normal',
  who = user,
) {
  const id = `task_${title.replace(/\W/g, '').toLowerCase()}`
  h.run(
    `INSERT INTO tasks (id, user_id, title, due_date, priority) VALUES (?, ?, ?, ?, ?)`,
    id,
    who.id,
    title,
    due,
    priority,
  )
  return id
}

function seedEvent(title: string, startsAt: string, who = user) {
  const id = `evt_${title.replace(/\W/g, '').toLowerCase()}`
  const end = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString()
  h.run(
    `INSERT INTO events (id, user_id, title, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)`,
    id,
    who.id,
    title,
    startsAt,
    end,
  )
  return id
}

describe('one sentence, job done', () => {
  it('"Oi Goblin, we need milk" adds real milk and replies briefly', async () => {
    const res = await talk('Oi Goblin, we need milk.')
    expect(res.heard).toBe('we need milk.')
    expect(res.addressed).toBe(true)
    expect(res.results).toMatchObject([{ kind: 'done' }])
    expect(activeShopping()).toEqual([{ name: 'Milk' }])
    expect(res.reply).toMatch(/^Milk added\./)
  })

  it('"Milk." on its own goes on the shopping list', async () => {
    await talk('Milk.')
    expect(activeShopping()).toEqual([{ name: 'Milk' }])
  })

  it('every way of asking for milk adds exactly one milk', async () => {
    for (const said of [
      'Oi Goblin, I need milk.',
      'Hey Gobbo, chuck milk on the shopping list',
      'Milk.',
      'Excuse me, my esteemed Lord Reginald, would you be so kind as to put milk on my list?',
    ])
      await talk(said)
    expect(activeShopping()).toEqual([{ name: 'Milk' }])
  })

  it('an unclear bare word gets one question, not a guess', async () => {
    const res = await talk('Passport')
    expect(res.results).toMatchObject([{ kind: 'clarify' }])
    expect(h.query(`SELECT COUNT(*) as n FROM tasks`)).toEqual([{ n: 0 }])
    expect(activeShopping()).toEqual([])
    const shop = res.results[0]!.options!.find(
      (o) => o.label === 'Shopping list',
    )!
    await h.request(`/api/goblin/actions/${shop.actionId}/confirm`, {
      cookie: user.cookie,
      body: {},
    })
    expect(activeShopping()).toEqual([{ name: 'Passport' }])
  })

  it('follow-ups: "Add milk." then "Also bread." then a reminder', async () => {
    await talk('Add milk.')
    await talk('Also bread.')
    const res = await talk('Actually, remind me to call Mum tomorrow.')
    expect(activeShopping()).toEqual([{ name: 'Bread' }, { name: 'Milk' }])
    expect(res.results[0]?.message).toMatch(/remind you to call mum/i)
    expect(
      h.query(`SELECT title FROM reminders WHERE user_id = ?`, user.id),
    ).toEqual([{ title: 'Call Mum' }])
  })

  it('a brain dump becomes several real records', async () => {
    const res = await talk(
      'Goblin, we need milk, and I forgot to call the dentist, and the washing needs doing.',
    )
    expect(activeShopping()).toEqual([{ name: 'Milk' }])
    expect(
      h.query(
        `SELECT title FROM tasks WHERE user_id = ? ORDER BY title`,
        user.id,
      ),
    ).toEqual([{ title: 'Call the dentist' }, { title: 'Do the washing' }])
    expect(res.results.filter((r) => r.kind === 'done')).toHaveLength(3)
  })

  it('"Add washing the car to my tasks" makes a task, not shopping', async () => {
    await talk('Add washing the car to my tasks')
    expect(h.query(`SELECT title FROM tasks`)).toEqual([
      { title: 'Washing the car' },
    ])
    expect(activeShopping()).toEqual([])
  })
})

describe('undo by voice', () => {
  it('"Actually, remove that" undoes the last thing only', async () => {
    await talk('Buy bread')
    await talk('I need milk')
    const res = await talk('Actually, remove that.')
    expect(res.reply).toMatch(/Undone/)
    expect(activeShopping()).toEqual([{ name: 'Bread' }])
    const again = await talk('undo')
    // The bread from the earlier turn is now the latest thing.
    expect(again.reply).toMatch(/Undone/)
    expect(activeShopping()).toEqual([])
  })

  it('never undoes another account’s actions', async () => {
    const other = await h.register('other@example.com')
    await talk('I need milk', {}, other)
    const res = await talk('undo that')
    expect(res.reply).toBe('Nothing recent to undo.')
    expect(activeShopping(other)).toEqual([{ name: 'Milk' }])
  })
})

describe('the day, from real records', () => {
  it('the same overview however it is asked', async () => {
    seedEvent('Dentist', `${today()}T23:00:00.000Z`)
    seedTask('Laundry', today())
    const replies = []
    for (const said of [
      'Goblin, what’s on today?',
      'Oi Goblin, what’s on today?',
      'Hey Goblin, what’s on today?',
      'Excuse me good sir Mr Goblin, what is on the schedule for today?',
      'Lord Reginald, would you be so kind as to review today’s appointments?',
      'What’s happening today?',
    ]) {
      const res = await talk(said)
      replies.push(res.answers[0]?.lines)
    }
    for (const lines of replies) expect(lines).toEqual(replies[0])
    expect(replies[0]!.join('\n')).toMatch(/Dentist/)
    expect(replies[0]!.join('\n')).toMatch(/Laundry/)
  })

  it('custom names count as addressing the Goblin', async () => {
    await h.request('/api/goblin/profile', {
      cookie: user.cookie,
      method: 'PATCH',
      body: { name: 'Lord Reginald', aliases: ['Gobbo'] },
    })
    const res = await talk('Yo Gobbo, what’s the damage?')
    expect(res.addressed).toBe(true)
    expect(res.heard).toBe('what’s the damage?')
    expect(res.reply).toMatch(/today/i)
  })

  it('what can wait → move them → yes, with fixed things protected', async () => {
    const laundry = seedTask('Laundry', today())
    const desk = seedTask('Tidy desk', today())
    const rent = seedTask('Pay rent', today())
    const urgent = seedTask('Finish report', today(), 'high')
    const dentist = seedEvent('Dentist', `${today()}T23:00:00.000Z`)

    const wait = await talk('Which ones can wait?')
    expect(wait.reply).toMatch(/Laundry/)
    expect(wait.reply).toMatch(/Tidy desk/)
    // Nothing changes from a question.
    expect(
      h.query(`SELECT COUNT(*) as n FROM tasks WHERE due_date = ?`, today()),
    ).toEqual([{ n: 4 }])

    const move = await talk('Move them.')
    expect(move.results).toMatchObject([{ kind: 'confirm' }])
    expect(
      h.query(`SELECT due_date as d FROM tasks WHERE id = ?`, laundry),
    ).toEqual([{ d: today() }])

    const yes = await talk('Yes')
    expect(yes.results).toMatchObject([{ kind: 'done' }])
    const due = (id: string) =>
      (
        h.query(`SELECT due_date as d FROM tasks WHERE id = ?`, id) as {
          d: string
        }[]
      )[0]!.d
    expect(due(laundry)).toBe(today(1))
    expect(due(desk)).toBe(today(1))
    expect(due(rent)).toBe(today())
    expect(due(urgent)).toBe(today())
    expect(
      h.query(`SELECT starts_at as s FROM events WHERE id = ?`, dentist),
    ).toEqual([{ s: `${today()}T23:00:00.000Z` }])

    // And it can be taken back.
    await talk('undo that')
    expect(due(laundry)).toBe(today())
  })

  it('"move them" with no fresh context asks instead of guessing', async () => {
    seedTask('Laundry', today())
    const res = await talk('Move them')
    expect(res.reply).toMatch(/which ones/i)
    expect(h.query(`SELECT due_date as d FROM tasks`)).toEqual([{ d: today() }])
  })

  it('"no" declines the proposal', async () => {
    seedTask('Laundry', today())
    await talk('Can we make tomorrow’s problem tomorrow’s problem?')
    await talk('No')
    expect(h.query(`SELECT due_date as d FROM tasks`)).toEqual([{ d: today() }])
    expect(h.query(`SELECT status FROM goblin_actions`)).toEqual([
      { status: 'declined' },
    ])
  })

  it('what’s overdue, gently', async () => {
    seedTask('Return library books', today(-3))
    const res = await talk('What’s overdue?')
    expect(res.reply).toMatch(/Return library books/)
    expect(res.reply).not.toMatch(/should have|failed|lazy/i)
  })

  it('am I free', async () => {
    seedEvent('Team call', `${today(1)}T14:00:00.000Z`)
    const res = await talk('Am I free tomorrow afternoon?')
    expect(res.reply).toMatch(/Team call/)
    const morning = await talk('Am I free tomorrow morning?')
    expect(morning.reply).toMatch(/free/)
  })
})

describe('safety', () => {
  it('the same request id never acts twice', async () => {
    const first = await talk('I need milk', { requestId: 'req_abcdef12' })
    const second = await talk('I need milk', { requestId: 'req_abcdef12' })
    expect(second.replayed).toBe(true)
    expect(second.reply).toBe(first.reply)
    expect(h.query(`SELECT COUNT(*) as n FROM shopping_items`)).toEqual([
      { n: 1 },
    ])
  })

  it('request ids are per account', async () => {
    const other = await h.register('other@example.com')
    await talk('I need milk', { requestId: 'req_shared01' })
    const res = await talk('I need bread', { requestId: 'req_shared01' }, other)
    expect(res.replayed).toBeUndefined()
    expect(activeShopping(other)).toEqual([{ name: 'Bread' }])
  })

  it('offline thoughts never confirm or undo late', async () => {
    seedTask('Laundry', today())
    await talk('Which can wait?')
    await talk('Move them')
    const res = await talk('yes', {
      source: 'offline',
      capturedAt: new Date(Date.now() - 60_000).toISOString(),
      requestId: 'req_offline1',
    })
    expect(res.reply).toMatch(/offline/)
    expect(h.query(`SELECT due_date as d FROM tasks`)).toEqual([{ d: today() }])
  })

  it('a taught expression cannot skip a confirmation', async () => {
    seedTask('Laundry', today())
    await h.request('/api/goblin/expressions', {
      cookie: user.cookie,
      body: {
        phrase: 'future me problem',
        meaning: 'can we make tomorrows problem tomorrows problem',
      },
    })
    const res = await talk('future me problem')
    expect(res.results).toMatchObject([{ kind: 'confirm' }])
    expect(h.query(`SELECT due_date as d FROM tasks`)).toEqual([{ d: today() }])
  })

  it('requires sign-in', async () => {
    const res = await h.request('/api/goblin/converse', {
      body: { text: 'milk' },
    })
    expect(res.status).toBe(401)
  })

  it('stores no transcript', async () => {
    await talk('I need milk and my secret is hunter2', {
      requestId: 'req_secret01',
    })
    for (const table of ['goblin_context', 'goblin_actions'])
      expect(JSON.stringify(h.query(`SELECT * FROM ${table}`))).not.toMatch(
        /hunter2/,
      )
  })
})

describe('Get to Know Your Goblin', () => {
  it('defaults without any setup, then saves, validates and resets', async () => {
    const empty = await (
      await h.request('/api/goblin/profile', { cookie: user.cookie })
    ).json()
    expect(empty).toMatchObject({
      profile: { name: 'Goblin', style: 'friendly' },
      expressions: [],
    })

    const bad = await h.request('/api/goblin/profile', {
      cookie: user.cookie,
      method: 'PATCH',
      body: { style: 'rude' },
    })
    expect(bad.status).toBe(400)

    const ok = await h.request('/api/goblin/profile', {
      cookie: user.cookie,
      method: 'PATCH',
      body: { name: 'Gerald', style: 'quiet', speakReplies: true },
    })
    expect(
      ((await ok.json()) as { profile: { name: string } }).profile.name,
    ).toBe('Gerald')
    const quiet = await talk('Gerald, I need milk')
    expect(quiet.reply).toBe('Milk added.')

    const exp = await h.request('/api/goblin/expressions', {
      cookie: user.cookie,
      body: {
        phrase: 'the usual',
        meaning: 'add bread and eggs to my shopping list',
      },
    })
    expect(exp.status).toBe(201)
    await talk('the usual')
    expect(activeShopping()).toEqual([
      { name: 'Bread' },
      { name: 'Eggs' },
      { name: 'Milk' },
    ])

    await h.request('/api/goblin/profile', {
      cookie: user.cookie,
      method: 'DELETE',
    })
    const reset = await (
      await h.request('/api/goblin/profile', { cookie: user.cookie })
    ).json()
    expect(reset).toMatchObject({
      profile: { name: 'Goblin' },
      expressions: [],
    })
  })

  it('expressions belong to one account', async () => {
    const other = await h.register('other@example.com')
    const res = await h.request('/api/goblin/expressions', {
      cookie: user.cookie,
      body: { phrase: 'the usual', meaning: 'add bread to my shopping list' },
    })
    const { expression } = (await res.json()) as { expression: { id: string } }
    const del = await h.request(`/api/goblin/expressions/${expression.id}`, {
      cookie: other.cookie,
      method: 'DELETE',
    })
    expect(del.status).toBe(404)
    await talk('the usual', {}, other)
    expect(activeShopping(other)).toEqual([])
  })
})
