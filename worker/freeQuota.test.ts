import { beforeEach, describe, expect, it } from 'vitest'
import { createHarness, type Harness, type TestUser } from './testing/harness'

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
      ids.push(String(((await response.json()) as { task: { id: string } }).task.id))
    }
    const blocked = await create('/api/tasks', { title: 'Extra task' })
    expect(blocked.status).toBe(403)
    expect((await blocked.json() as { code: string }).code).toBe('FREE_PLAN_LIMIT')

    expect((await h.request(`/api/tasks/${ids[0]}`, {
      method: 'PATCH', cookie: user.cookie, body: { status: 'completed' },
    })).status).toBe(200)
    expect((await create('/api/tasks', { title: 'Replacement task' })).status).toBe(201)
    const reopen = await h.request(`/api/tasks/${ids[0]}`, {
      method: 'PATCH', cookie: user.cookie, body: { status: 'open' },
    })
    expect(reopen.status).toBe(403)
  })

  it('limits free notes to five', async () => {
    for (let i = 0; i < 5; i++) {
      expect((await create('/api/notes', { title: `Note ${i}` })).status).toBe(201)
    }
    expect((await create('/api/notes', { title: 'Sixth note' })).status).toBe(403)
  })

  it('limits active reminders to three', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await create('/api/reminders', {
        title: `Reminder ${i}`, remindAt: '2026-12-01T12:00:00.000Z',
      })).status).toBe(201)
    }
    expect((await create('/api/reminders', {
      title: 'Fourth reminder', remindAt: '2026-12-01T12:00:00.000Z',
    })).status).toBe(403)
  })

  it('limits recurring task creation by generated occurrence count', async () => {
    for (let i = 0; i < 8; i++) {
      expect((await create('/api/tasks', { title: `Task ${i}` })).status).toBe(201)
    }
    const rejected = await create('/api/tasks', {
      title: 'Weekly', recurrenceFrequency: 'weekly', dueDate: '2026-11-01',
    })
    expect(rejected.status).toBe(403)
  })
})
