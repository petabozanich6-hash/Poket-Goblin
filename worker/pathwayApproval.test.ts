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
})
