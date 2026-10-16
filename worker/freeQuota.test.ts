import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness, type TestUser } from './testing/harness'
import { freeDocumentProcessingQuota } from './lib/freeQuota'

let h: Harness
let user: TestUser
beforeEach(async () => {
  h = createHarness()
  user = await h.register('free-limits@example.com')
})

async function create(path: string, body: Record<string, unknown>) {
  return h.request(path, { cookie: user.cookie, body })
}

describe('permanent Free quotas — direct routes', () => {
  it('limits open tasks, but allows completed tasks and blocks reopening above cap', async () => {
    const ids: string[] = []
    for (let i = 0; i < 10; i++) {
      const response = await create('/api/tasks', { title: `Task ${i}` })
      expect(response.status).toBe(201)
      ids.push(
        String(((await response.json()) as { task: { id: string } }).task.id),
      )
    }
    const blocked = await create('/api/tasks', { title: 'Extra task' })
    expect(blocked.status).toBe(403)
    expect(((await blocked.json()) as { code: string }).code).toBe(
      'FREE_PLAN_LIMIT',
    )

    expect(
      (
        await h.request(`/api/tasks/${ids[0]}`, {
          method: 'PATCH',
          cookie: user.cookie,
          body: { status: 'completed' },
        })
      ).status,
    ).toBe(200)
    expect(
      (await create('/api/tasks', { title: 'Replacement task' })).status,
    ).toBe(201)
    const reopen = await h.request(`/api/tasks/${ids[0]}`, {
      method: 'PATCH',
      cookie: user.cookie,
      body: { status: 'open' },
    })
    expect(reopen.status).toBe(403)
  })

  it('limits free notes to five', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await create('/api/notes', { title: `Note ${i}` })).status).toBe(
        201,
      )
    }
    expect((await create('/api/notes', { title: 'Sixth note' })).status).toBe(
      403,
    )
  })

  it('limits active reminders to three', async () => {
    for (let i = 0; i < 3; i++) {
      expect(
        (
          await create('/api/reminders', {
            title: `Reminder ${i}`,
            remindAt: '2026-12-01T12:00:00.000Z',
          })
        ).status,
      ).toBe(201)
    }
    expect(
      (
        await create('/api/reminders', {
          title: 'Fourth reminder',
          remindAt: '2026-12-01T12:00:00.000Z',
        })
      ).status,
    ).toBe(403)
  })

  it('limits recurring task creation by generated occurrence count', async () => {
    for (let i = 0; i < 8; i++) {
      expect((await create('/api/tasks', { title: `Task ${i}` })).status).toBe(
        201,
      )
    }
    const rejected = await create('/api/tasks', {
      title: 'Weekly',
      recurrenceFrequency: 'weekly',
      dueDate: '2026-11-01',
    })
    expect(rejected.status).toBe(403)
  })
})

describe('atomic Free document processing allowance', () => {
  it('allows only two simultaneous reservations per UTC month', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        freeDocumentProcessingQuota(h.db, user.id),
      ),
    )
    expect(attempts.filter((result) => result === null)).toHaveLength(2)
    expect(
      attempts.filter((result) => result?.code === 'FREE_PLAN_LIMIT'),
    ).toHaveLength(6)
  })
})

describe('database-enforced Free record limits', () => {
  it('rejects direct SQL inserts at the task, note and reminder caps', () => {
    for (let i = 0; i < 10; i++)
      h.run(
        'INSERT INTO tasks (id, user_id, title) VALUES (?, ?, ?)',
        `sql_task_${i}`,
        user.id,
        'Task',
      )
    expect(() =>
      h.run(
        "INSERT INTO tasks (id, user_id, title) VALUES ('too_many_tasks', ?, 'Extra')",
        user.id,
      ),
    ).toThrow(/FREE_PLAN_LIMIT:tasks/)
    for (let i = 0; i < 5; i++)
      h.run(
        'INSERT INTO notes (id, user_id, title) VALUES (?, ?, ?)',
        `sql_note_${i}`,
        user.id,
        'Note',
      )
    expect(() =>
      h.run(
        "INSERT INTO notes (id, user_id, title) VALUES ('too_many_notes', ?, 'Extra')",
        user.id,
      ),
    ).toThrow(/FREE_PLAN_LIMIT:notes/)
    for (let i = 0; i < 3; i++)
      h.run(
        'INSERT INTO reminders (id, user_id, title, remind_at) VALUES (?, ?, ?, ?)',
        `sql_rem_${i}`,
        user.id,
        'Remind',
        '2027-01-01T09:00:00Z',
      )
    expect(() =>
      h.run(
        "INSERT INTO reminders (id, user_id, title, remind_at) VALUES ('too_many_rems', ?, 'Extra', '2027-01-01')",
        user.id,
      ),
    ).toThrow(/FREE_PLAN_LIMIT:reminders/)
    h.run("UPDATE tasks SET status = 'completed' WHERE id = 'sql_task_0'")
    h.run(
      "INSERT INTO tasks (id, user_id, title) VALUES ('replacement', ?, 'Replacement')",
      user.id,
    )
    expect(() =>
      h.run("UPDATE tasks SET status = 'open' WHERE id = 'sql_task_0'"),
    ).toThrow(/FREE_PLAN_LIMIT:tasks/)
  })
  it('exempts the Owner and keeps pre-existing records editable', () => {
    h.makeOwner(user.id)
    for (let i = 0; i < 15; i++)
      h.run(
        'INSERT INTO notes (id, user_id, title) VALUES (?, ?, ?)',
        `owner_note_${i}`,
        user.id,
        'Owner',
      )
    expect(
      h.query('SELECT COUNT(*) as n FROM notes WHERE user_id = ?', user.id),
    ).toEqual([{ n: 15 }])
  })
})

describe('friendly atomic quota errors and safe downgrade', () => {
  it('returns an upgrade error rather than 500 when D1 rejects an insert', async () => {
    for (let i = 0; i < 5; i++)
      h.run(
        'INSERT INTO notes (id, user_id, title) VALUES (?, ?, ?)',
        `preexisting_note_${i}`,
        user.id,
        'Saved',
      )
    const result = await h.request('/api/notes', {
      cookie: user.cookie,
      body: { title: 'Over the limit' },
    })
    expect(result.status).toBe(403)
    expect(await result.json()).toMatchObject({
      code: 'FREE_PLAN_LIMIT',
      resource: 'notes',
      limit: 5,
    })
  })
  it('preserves Premium records when entitlement ends, and permits editing them', async () => {
    h.run(
      "INSERT INTO user_entitlements (id, user_id, entitlement, source, status, ended_at) VALUES ('upgrade', ?, 'premium', 'stripe', 'active', NULL)",
      user.id,
    )
    for (let i = 0; i < 8; i++)
      h.run(
        'INSERT INTO notes (id, user_id, title) VALUES (?, ?, ?)',
        `saved_${i}`,
        user.id,
        'Before downgrade',
      )
    h.run(
      "UPDATE user_entitlements SET ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), status = 'canceled' WHERE id = 'upgrade'",
    )
    h.run(
      "UPDATE notes SET title = 'Edited after downgrade' WHERE id = 'saved_0'",
    )
    expect(
      h.query('SELECT COUNT(*) AS n FROM notes WHERE user_id = ?', user.id),
    ).toEqual([{ n: 8 }])
    expect(() =>
      h.run(
        "INSERT INTO notes (id, user_id, title) VALUES ('extra', ?, 'Not allowed')",
        user.id,
      ),
    ).toThrow(/FREE_PLAN_LIMIT:notes/)
  })
})

describe('Free limits on indirect paths', () => {
  const seedTasks = (n: number, status = 'open') => {
    for (let i = 0; i < n; i++)
      h.run(
        'INSERT INTO tasks (id, user_id, title, status) VALUES (?, ?, ?, ?)',
        `seed_${status}_${i}`,
        user.id,
        `Seed ${i}`,
        status,
      )
  }

  it('Goblin undo that would exceed the cap fails cleanly and keeps the record true', async () => {
    seedTasks(9)
    h.run(
      "INSERT INTO tasks (id, user_id, title) VALUES ('t_milk', ?, 'Buy milk')",
      user.id,
    )
    const said = (await (
      await h.request('/api/goblin/act', {
        cookie: user.cookie,
        body: { text: 'I bought milk', timezoneOffsetMinutes: 0 },
      })
    ).json()) as { results: { kind: string; actionId: string }[] }
    const done = said.results.find((r) => r.kind === 'done')!
    // Fill the freed slot, then try to reopen "Buy milk" by undoing.
    expect(
      (await create('/api/tasks', { title: 'Something new' })).status,
    ).toBe(201)
    const undo = await h.request(`/api/goblin/actions/${done.actionId}/undo`, {
      cookie: user.cookie,
      body: {},
    })
    expect(undo.status).toBe(409)
    expect(((await undo.json()) as { error: string }).error).toMatch(
      /Free includes 10 active tasks/,
    )
    expect(h.query("SELECT status FROM tasks WHERE id = 't_milk'")).toEqual([
      { status: 'completed' },
    ])
    expect(
      h.query('SELECT status FROM goblin_actions WHERE id = ?', done.actionId),
    ).toEqual([{ status: 'done' }])
  })

  it('accepting a brain-dump suggestion respects the cap', async () => {
    seedTasks(10)
    const created = (await (
      await create('/api/captures', { text: 'Call the plumber tomorrow' })
    ).json()) as {
      capture: { id: string; items: { id: string; kind: string }[] }
    }
    const item = created.capture.items.find((i) => i.kind === 'task')
    expect(item).toBeDefined()
    if (!item) return
    const res = await h.request(
      `/api/captures/${created.capture.id}/items/${item.id}/accept`,
      { cookie: user.cookie, body: {} },
    )
    expect(res.status).toBe(403)
    expect(
      h.query("SELECT COUNT(*) AS n FROM tasks WHERE status = 'open'"),
    ).toEqual([{ n: 10 }])
  })

  it('snoozed or dismissed reminders coming back count toward the cap', () => {
    for (let i = 0; i < 3; i++)
      h.run(
        "INSERT INTO reminders (id, user_id, title, remind_at) VALUES (?, ?, 'R', '2030-01-01T00:00:00.000Z')",
        `r_${i}`,
        user.id,
      )
    h.run(
      "INSERT INTO reminders (id, user_id, title, remind_at, status) VALUES ('r_done', ?, 'Old', '2030-01-01T00:00:00.000Z', 'dismissed')",
      user.id,
    )
    expect(() =>
      h.run("UPDATE reminders SET status = 'pending' WHERE id = 'r_done'"),
    ).toThrow(/FREE_PLAN_LIMIT:reminders/)
  })

  it('Premium is not capped', async () => {
    h.run(
      "INSERT INTO user_entitlements (id, user_id, entitlement, source, status) VALUES ('p', ?, 'premium', 'stripe', 'active')",
      user.id,
    )
    seedTasks(10)
    expect((await create('/api/tasks', { title: 'Eleventh' })).status).toBe(201)
    for (let i = 0; i < 6; i++)
      expect((await create('/api/notes', { title: `N${i}` })).status).toBe(201)
  })
})

describe('reminder times', () => {
  it('rejects times that could never fire, and stores UTC', async () => {
    expect(
      (await create('/api/reminders', { title: 'Call', remindAt: 'tomorrow' }))
        .status,
    ).toBe(400)
    expect(
      (
        await create('/api/reminders', {
          title: 'Call',
          remindAt: '2030-01-01T09:00:00+10:00',
          repeatFrequency: 'weekly',
        })
      ).status,
    ).toBe(400)
    const ok = await create('/api/reminders', {
      title: 'Call',
      remindAt: '2030-01-01T09:00:00+10:00',
    })
    expect(ok.status).toBe(201)
    expect(h.query('SELECT remind_at AS at FROM reminders')).toEqual([
      { at: '2029-12-31T23:00:00.000Z' },
    ])
  })
})
