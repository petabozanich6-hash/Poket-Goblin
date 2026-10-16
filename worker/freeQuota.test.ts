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
