import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { persistApprovedPathway } from './lib/documents/pathwayApproval'
import { createHarness, type Harness, type TestUser } from './testing/harness'

let h: Harness
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = createHarness()
  alice = await h.register('replan-owner@example.com')
  bob = await h.register('replan-stranger@example.com')
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2030-05-03T12:00:00Z'))
})

afterEach(() => {
  vi.restoreAllMocks()
})

const availability = [
  { date: '2030-05-03', availableMinutes: 120 },
  { date: '2030-05-04', availableMinutes: 120 },
]

describe('approved missed-day replan endpoint', () => {
  it('previews without writes and applies only the confirmed sessions for the owner', async () => {
    await persistApprovedPathway(
      h.env.DB,
      alice.id,
      'replan-doc',
      [
        {
          stepId: 'open-step',
          goalId: 'assessment',
          title: 'Draft the essay',
          date: '2030-05-01',
          minutes: 60,
          sequence: 1,
        },
        {
          stepId: 'done-step',
          goalId: 'assessment',
          title: 'Finished the reading',
          date: '2030-05-01',
          minutes: 60,
          sequence: 1,
        },
      ],
      new Map([
        ['open-step', '2030-05-10'],
        ['done-step', '2030-05-10'],
      ]),
    )
    await h.env.DB.prepare(
      "UPDATE tasks SET status = 'completed' WHERE user_id = ? AND title = ?",
    )
      .bind(alice.id, 'Finished the reading')
      .run()

    const foreign = await h.request(
      '/api/documents/replan-doc/pathway-replan',
      {
        cookie: bob.cookie,
        body: { availability },
      },
    )
    expect(foreign.status).toBe(404)

    const preview = await h.request(
      '/api/documents/replan-doc/pathway-replan',
      {
        cookie: alice.cookie,
        body: { availability },
      },
    )
    expect(preview.status).toBe(200)
    const proposal = (await preview.json()) as {
      applied: boolean
      missedCount: number
      moves: Array<{ sessionId: string; date: string; minutes: number }>
      warnings: unknown[]
    }
    expect(proposal.applied).toBe(false)
    expect(proposal.missedCount).toBe(1)
    expect(proposal.warnings).toEqual([])
    expect(proposal.moves).toHaveLength(1)
    const before = h.query(
      'SELECT due_date as day FROM tasks WHERE user_id = ? AND status = ?',
      alice.id,
      'open',
    ) as Array<{ day: string }>
    expect(before).toEqual([{ day: '2030-05-01' }])

    const changed = await h.request(
      '/api/documents/replan-doc/pathway-replan',
      {
        cookie: alice.cookie,
        body: { availability, apply: true, expectedMoves: proposal.moves },
      },
    )
    expect(changed.status).toBe(200)
    expect(await changed.json()).toMatchObject({ applied: true })
    expect(
      h.query(
        'SELECT due_date as day FROM tasks WHERE user_id = ? AND status = ?',
        alice.id,
        'open',
      ),
    ).toEqual([{ day: '2030-05-03' }])
    expect(
      h.query(
        'SELECT due_date as day FROM tasks WHERE user_id = ? AND status = ?',
        alice.id,
        'completed',
      ),
    ).toEqual([{ day: '2030-05-01' }])

    const repeated = await h.request(
      '/api/documents/replan-doc/pathway-replan',
      {
        cookie: alice.cookie,
        body: { availability, apply: true, expectedMoves: proposal.moves },
      },
    )
    expect(repeated.status).toBe(409)
  })

  it('blocks approval if the work cannot fit before its deadline', async () => {
    await persistApprovedPathway(
      h.env.DB,
      alice.id,
      'full-doc',
      [
        {
          stepId: 'important',
          goalId: 'assessment',
          title: 'Study for assessment',
          date: '2030-05-01',
          minutes: 120,
          sequence: 1,
        },
      ],
      new Map([['important', '2030-05-04']]),
    )
    const smallWindow = [{ date: '2030-05-04', availableMinutes: 60 }]
    const preview = await h.request('/api/documents/full-doc/pathway-replan', {
      cookie: alice.cookie,
      body: { availability: smallWindow },
    })
    const result = (await preview.json()) as {
      warnings: unknown[]
      moves: unknown[]
    }
    expect(result.moves).toHaveLength(0)
    expect(result.warnings).toHaveLength(1)
    const apply = await h.request('/api/documents/full-doc/pathway-replan', {
      cookie: alice.cookie,
      body: { availability: smallWindow, apply: true, expectedMoves: [] },
    })
    expect(apply.status).toBe(409)
    expect(
      h.query(
        'SELECT due_date as day FROM tasks WHERE user_id = ? AND status = ?',
        alice.id,
        'open',
      ),
    ).toEqual([{ day: '2030-05-01' }])
  })

  it('refuses to overwrite a study task independently moved in the task list', async () => {
    await persistApprovedPathway(
      h.env.DB,
      alice.id,
      'externally-moved-doc',
      [
        {
          stepId: 'read',
          goalId: 'essay',
          title: 'Read the paper',
          date: '2030-05-01',
          minutes: 60,
          sequence: 1,
        },
      ],
      new Map([['read', '2030-05-10']]),
    )
    const session = h.query(
      'SELECT id FROM study_pathway_sessions WHERE user_id = ?',
      alice.id,
    )[0] as { id: string }
    await h.env.DB.prepare(
      `UPDATE tasks SET due_date = '2030-05-06'
       WHERE user_id = ? AND title = 'Read the paper'`,
    )
      .bind(alice.id)
      .run()
    const preview = await h.request(
      '/api/documents/externally-moved-doc/pathway-replan',
      { cookie: alice.cookie, body: { availability } },
    )
    expect(preview.status).toBe(409)
    expect(await preview.json()).toMatchObject({
      conflictingSessionIds: [session.id],
    })
    const edit = await h.request(
      `/api/documents/externally-moved-doc/pathway-sessions/${session.id}`,
      {
        method: 'PATCH',
        cookie: alice.cookie,
        body: {
          date: '2030-05-04',
          minutes: 60,
          availableMinutes: 120,
        },
      },
    )
    expect(edit.status).toBe(409)
    expect(
      h.query(
        'SELECT scheduled_date as date FROM study_pathway_sessions WHERE id = ?',
        session.id,
      ),
    ).toEqual([{ date: '2030-05-01' }])
    expect(
      h.query('SELECT due_date as date FROM tasks WHERE user_id = ?', alice.id),
    ).toEqual([{ date: '2030-05-06' }])
  })

})
