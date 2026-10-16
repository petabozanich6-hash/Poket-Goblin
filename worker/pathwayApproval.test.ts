import { beforeEach, describe, expect, it } from 'vitest'

import { persistApprovedPathway } from './lib/documents/pathwayApproval'
import { createHarness, type Harness, type TestUser } from './testing/harness'

let h: Harness
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = createHarness()
  alice = await h.register('pathway-alice@example.com')
  bob = await h.register('pathway-bob@example.com')
})

describe('approved pathway transactions and Undo', () => {
  it('creates tasks once, prevents duplicates, and undoes only the owner’s pathway tasks', async () => {
    const sessions = [
      {
        stepId: 'step-1',
        goalId: 'goal-1',
        title: 'Read chapter',
        date: '2030-05-12',
        minutes: 60,
        sequence: 1,
      },
    ]
    const first = await persistApprovedPathway(
      h.env.DB,
      alice.id,
      'doc-study',
      sessions,
    )
    expect(first.alreadySaved).toBe(false)
    const second = await persistApprovedPathway(
      h.env.DB,
      alice.id,
      'doc-study',
      sessions,
    )
    expect(second).toEqual({ id: first.id, alreadySaved: true })
    expect(
      h.query('SELECT id FROM tasks WHERE user_id = ?', alice.id),
    ).toHaveLength(1)

    const foreign = await h.request('/api/documents/doc-study/pathway-undo', {
      method: 'POST',
      cookie: bob.cookie,
    })
    expect(foreign.status).toBe(404)

    const undo = await h.request('/api/documents/doc-study/pathway-undo', {
      method: 'POST',
      cookie: alice.cookie,
    })
    expect(undo.status).toBe(200)
    expect(
      h.query('SELECT id FROM tasks WHERE user_id = ?', alice.id),
    ).toHaveLength(0)

    const repeated = await h.request('/api/documents/doc-study/pathway-undo', {
      method: 'POST',
      cookie: alice.cookie,
    })
    expect(repeated.status).toBe(200)
    expect(await repeated.json()).toMatchObject({ alreadyUndone: true })
  })

  it('rejects invalid sessions without persisting any tasks', async () => {
    await expect(
      persistApprovedPathway(h.env.DB, alice.id, 'bad-doc', [
        {
          stepId: 'bad',
          goalId: 'goal',
          title: 'Impossible date',
          date: '2030-02-30',
          minutes: 60,
          sequence: 1,
        },
      ]),
    ).rejects.toThrow('Invalid pathway session')
    expect(
      h.query('SELECT id FROM study_pathways WHERE user_id = ?', alice.id),
    ).toHaveLength(0)
  })

  it('keeps completed pathway tasks and unrelated tasks when Undo is requested', async () => {
    await persistApprovedPathway(h.env.DB, alice.id, 'mixed-doc', [
      {
        stepId: 'done-step',
        goalId: 'goal',
        title: 'Completed reading',
        date: '2030-05-12',
        minutes: 30,
        sequence: 1,
      },
      {
        stepId: 'open-step',
        goalId: 'goal',
        title: 'Pending writing',
        date: '2030-05-13',
        minutes: 60,
        sequence: 1,
      },
    ])
    await h.env.DB.prepare(
      "UPDATE tasks SET status = 'completed' WHERE user_id = ? AND title = ?",
    )
      .bind(alice.id, 'Completed reading')
      .run()
    await h.env.DB.prepare(
      'INSERT INTO tasks (id, user_id, title, priority, capacity_cost) VALUES (?, ?, ?, ?, ?)',
    )
      .bind('unrelated-task', alice.id, 'Unrelated chore', 'normal', 1)
      .run()

    const response = await h.request('/api/documents/mixed-doc/pathway-undo', {
      method: 'POST',
      cookie: alice.cookie,
    })
    expect(response.status).toBe(200)
    expect(
      h.query(
        'SELECT title FROM tasks WHERE user_id = ? ORDER BY title',
        alice.id,
      ),
    ).toEqual([{ title: 'Completed reading' }, { title: 'Unrelated chore' }])
  })

  it('creates a new active version after Undo without erasing cancelled history', async () => {
    const sessions = [
      {
        stepId: 'doc:0:Reading',
        goalId: 'doc:assessment',
        title: 'Reading',
        date: '2030-05-12',
        minutes: 60,
        sequence: 1,
      },
    ]
    const first = await persistApprovedPathway(
      h.env.DB,
      alice.id,
      'repeat-doc',
      sessions,
      new Map([['doc:0:Reading', '2030-05-20']]),
    )
    const undo = await h.request('/api/documents/repeat-doc/pathway-undo', {
      method: 'POST',
      cookie: alice.cookie,
    })
    expect(undo.status).toBe(200)
    const next = await persistApprovedPathway(
      h.env.DB,
      alice.id,
      'repeat-doc',
      sessions,
      new Map([['doc:0:Reading', '2030-05-20']]),
    )
    expect(next.alreadySaved).toBe(false)
    expect(next.id).not.toBe(first.id)
    expect(
      h.query(
        'SELECT status FROM study_pathways WHERE user_id = ? ORDER BY status',
        alice.id,
      ),
    ).toEqual([{ status: 'active' }, { status: 'cancelled' }])
    expect(
      h.query(
        'SELECT status FROM study_pathway_sessions WHERE user_id = ? ORDER BY status',
        alice.id,
      ),
    ).toEqual([{ status: 'cancelled' }, { status: 'planned' }])
    expect(
      h.query('SELECT id FROM tasks WHERE user_id = ?', alice.id),
    ).toHaveLength(1)
    const saved = await h.request('/api/documents/repeat-doc/pathway', {
      cookie: alice.cookie,
    })
    expect(saved.status).toBe(200)
    expect(await saved.json()).toMatchObject({
      pathway: { id: next.id, status: 'active' },
    })
  })

})
