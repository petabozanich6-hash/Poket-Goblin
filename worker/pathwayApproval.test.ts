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
      {
        stepId: 'custom-notes',
        goalId: 'goal',
        title: 'My reading',
        date: '2030-05-14',
        minutes: 45,
        sequence: 1,
      },
      {
        stepId: 'custom-title',
        goalId: 'goal',
        title: 'Outline research',
        date: '2030-05-15',
        minutes: 45,
        sequence: 1,
      },
    ])
    await h.env.DB.prepare(
      "UPDATE tasks SET status = 'completed' WHERE user_id = ? AND title = ?",
    )
      .bind(alice.id, 'Completed reading')
      .run()
    await h.env.DB.prepare(
      "UPDATE tasks SET notes = 'Important personal notes' WHERE user_id = ? AND title = 'My reading'",
    )
      .bind(alice.id)
      .run()
    await h.env.DB.prepare(
      "UPDATE tasks SET title = 'My customised outline' WHERE user_id = ? AND title = 'Outline research'",
    )
      .bind(alice.id)
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
    expect(await response.json()).toMatchObject({ undone: 1, retained: 3 })
    expect(
      h.query(
        'SELECT title FROM tasks WHERE user_id = ? ORDER BY title',
        alice.id,
      ),
    ).toEqual([
      { title: 'Completed reading' },
      { title: 'My customised outline' },
      { title: 'My reading' },
      { title: 'Unrelated chore' },
    ])
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

  it('refuses session edits that cross the deadline or reverse prerequisites', async () => {
    const first = 'doc-order:1:Draft essay'
    const second = 'doc-order:0:Read chapter'
    await persistApprovedPathway(
      h.env.DB,
      alice.id,
      'doc-order',
      [
        {
          stepId: first,
          goalId: 'doc-order:essay',
          title: 'Draft essay',
          date: '2030-05-08',
          minutes: 60,
          sequence: 1,
        },
        {
          stepId: second,
          goalId: 'doc-order:essay',
          title: 'Read chapter',
          date: '2030-05-05',
          minutes: 60,
          sequence: 1,
        },
      ],
      new Map([
        [first, '2030-05-10'],
        [second, '2030-05-10'],
      ]),
      new Map([
        [first, 1],
        [second, 0],
      ]),
    )
    const sessions = h.query(
      'SELECT id, title, step_order as stepOrder FROM study_pathway_sessions WHERE user_id = ?',
      alice.id,
    ) as Array<{ id: string; title: string; stepOrder: number }>
    expect(
      sessions.find((item) => item.title === 'Read chapter')?.stepOrder,
    ).toBe(0)
    const reading = sessions.find((item) => item.title === 'Read chapter')!
    const draft = sessions.find((item) => item.title === 'Draft essay')!
    const send = (
      sessionId: string,
      date: string,
      minutes = 60,
      availableMinutes = 120,
    ) =>
      h.request(`/api/documents/doc-order/pathway-sessions/${sessionId}`, {
        method: 'PATCH',
        cookie: alice.cookie,
        body: { date, minutes, availableMinutes },
      })
    const foreign = await h.request(
      `/api/documents/doc-order/pathway-sessions/${draft.id}`,
      {
        method: 'PATCH',
        cookie: bob.cookie,
        body: { date: '2030-05-07', minutes: 60 },
      },
    )
    expect(foreign.status).toBe(404)
    expect((await send(draft.id, '2030-05-04')).status).toBe(409)
    expect((await send(reading.id, '2030-05-08')).status).toBe(409)
    expect((await send(draft.id, '2030-05-11')).status).toBe(409)
    expect((await send(draft.id, '2030-05-07', 120)).status).toBe(409)
    expect((await send(draft.id, '2030-05-07', 45)).status).toBe(200)
    expect(
      h.query(
        'SELECT notes FROM tasks WHERE user_id = ? AND title = ?',
        alice.id,
        'Draft essay',
      ),
    ).toEqual([
      {
        notes: expect.stringContaining('45 min · pathway '),
      },
    ])
    // A later day is allowed before the actual assessment deadline, but only
    // if its confirmed capacity covers all tasks already planned that day.
    await h.env.DB.prepare(
      `INSERT INTO tasks (id, user_id, title, priority, due_date, capacity_cost)
       VALUES ('existing-study-day-task', ?, 'Housework', 'normal', '2030-05-09', 1)`,
    )
      .bind(alice.id)
      .run()
    expect((await send(draft.id, '2030-05-09', 45, 60)).status).toBe(409)
    expect((await send(draft.id, '2030-05-09', 45, 90)).status).toBe(200)
    expect(
      h.query(
        'SELECT scheduled_date as date, minutes, deadline_date as deadline FROM study_pathway_sessions WHERE id = ?',
        draft.id,
      ),
    ).toEqual([{ date: '2030-05-09', minutes: 45, deadline: '2030-05-10' }])
    expect((await send(draft.id, '2030-05-11', 45, 240)).status).toBe(409)
    const noBudget = await h.request(
      `/api/documents/doc-order/pathway-sessions/${draft.id}`,
      {
        method: 'PATCH',
        cookie: alice.cookie,
        body: { date: '2030-05-10', minutes: 45 },
      },
    )
    expect(noBudget.status).toBe(400)
    await h.env.DB.prepare(
      "UPDATE tasks SET notes = 'Personal notes stay mine' WHERE user_id = ? AND title = ?",
    )
      .bind(alice.id, 'Draft essay')
      .run()
    expect((await send(draft.id, '2030-05-10', 30, 120)).status).toBe(200)
    expect(
      h.query(
        'SELECT notes FROM tasks WHERE user_id = ? AND title = ?',
        alice.id,
        'Draft essay',
      ),
    ).toEqual([{ notes: 'Personal notes stay mine' }])
  })

  it('removes approved pathways and sessions when a user deletes their account', async () => {
    const deletingUser = await h.register('delete-study-pathway@example.com')
    await persistApprovedPathway(h.env.DB, deletingUser.id, 'past-document', [
      {
        stepId: 'assessment:0:Read chapter',
        goalId: 'assessment',
        title: 'Read chapter',
        date: '2030-05-12',
        minutes: 45,
        sequence: 1,
      },
    ])
    expect(
      h.query(
        'SELECT id FROM study_pathways WHERE user_id = ?',
        deletingUser.id,
      ),
    ).toHaveLength(1)
    const deleted = await h.request('/api/account', {
      cookie: deletingUser.cookie,
      method: 'DELETE',
      body: { password: 'correct horse battery', confirm: 'DELETE' },
    })
    expect(deleted.status).toBe(200)
    expect(
      h.query(
        'SELECT id FROM study_pathways WHERE user_id = ?',
        deletingUser.id,
      ),
    ).toEqual([])
    expect(
      h.query(
        'SELECT id FROM study_pathway_sessions WHERE user_id = ?',
        deletingUser.id,
      ),
    ).toEqual([])
  })

  it('rolls back an entire pathway if it exceeds the Free task allowance', async () => {
    const sessions = Array.from({ length: 11 }, (_, index) => ({
      stepId: `free-limit-${index}`,
      goalId: 'free-study',
      title: `Study part ${index + 1}`,
      date: '2030-05-12',
      minutes: 30,
      sequence: 1,
    }))
    await expect(
      persistApprovedPathway(h.env.DB, alice.id, 'large-free-plan', sessions),
    ).rejects.toThrow('FREE_PLAN_LIMIT')
    expect(
      h.query('SELECT id FROM study_pathways WHERE user_id = ?', alice.id),
    ).toEqual([])
    expect(
      h.query(
        'SELECT id FROM study_pathway_sessions WHERE user_id = ?',
        alice.id,
      ),
    ).toEqual([])
    expect(h.query('SELECT id FROM tasks WHERE user_id = ?', alice.id)).toEqual(
      [],
    )
  })
})
