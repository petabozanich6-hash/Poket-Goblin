import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it } from 'vitest'

import { app } from './index'
import { createHarness, type Harness, type TestUser } from './testing/harness'

let h: Harness
let owner: TestUser
let stranger: TestUser

const STUDY_SCHEDULE = [
  'University Study Schedule - Semester 2 2026',
  'Week Commencing Topic Assessment',
  '1 19 October 2026',
  'Module 1: Understanding evidence',
  '2 26 October 2026',
  'Module 2: Research and sources',
  'Assessment 1 Research essay (40%) due Sunday 29 November 2026',
].join('\n')

beforeEach(async () => {
  h = createHarness()
  owner = await h.register('study-journey-owner@example.com')
  stranger = await h.register('study-journey-stranger@example.com')
  // A full term's study pathway can exceed the deliberately restrictive
  // Free-plan task allowance. Verify the legitimate Premium workflow.
  h.makeOwner(owner.id)
})

async function uploadSchedule() {
  const data = new FormData()
  data.append(
    'file',
    new File([STUDY_SCHEDULE], 'University Study Schedule.txt', {
      type: 'text/plain',
    }),
  )
  const response = await app.request(
    '/api/documents',
    { method: 'POST', headers: { Cookie: owner.cookie }, body: data },
    h.env,
  )
  expect(response.status).toBe(201)
  const result = (await response.json()) as { document: { id: string } }
  return result.document.id
}

function availableDays() {
  return Array.from({ length: 43 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9, 19 + index))
      .toISOString()
      .slice(0, 10)
    return { date, availableMinutes: 240 }
  })
}

describe('document to approved study pathway journey', () => {
  it('retains academic weekly steps for review, then previews, approves and undoes safely', async () => {
    const id = await uploadSchedule()
    const rows = h.query(
      `SELECT payload_json as payload, status FROM review_items
       WHERE user_id = ? AND source_type = 'document' AND source_id = ?`,
      owner.id,
      id,
    ) as Array<{ payload: string; status: string }>
    const weekly = rows
      .map((row) => ({
        ...row,
        item: JSON.parse(row.payload) as {
          title: string
          group?: string
          requiresReview?: boolean
        },
      }))
      .filter((row) => row.item.group === 'Week by week')
    expect(weekly.length).toBeGreaterThan(0)
    expect(weekly.every((row) => row.item.requiresReview === true)).toBe(true)
    expect(weekly.every((row) => row.status === 'pending')).toBe(true)

    const availability = availableDays()
    const forbidden = await h.request(`/api/documents/${id}/pathway-preview`, {
      cookie: stranger.cookie,
      body: { availability },
    })
    expect(forbidden.status).toBe(404)

    const preview = await h.request(`/api/documents/${id}/pathway-preview`, {
      cookie: owner.cookie,
      body: { availability },
    })
    expect(preview.status).toBe(200)
    const view = (await preview.json()) as {
      preview: {
        sessions: Array<{
          stepId: string
          goalId: string
          title: string
          date: string
          minutes: number
          sequence: number
        }>
        unscheduledMinutes: number
        warnings: unknown[]
        unschedulable: unknown[]
      }
    }
    expect(view.preview.sessions.length).toBeGreaterThan(0)
    expect(
      view.preview.sessions.some((item) => item.title.includes('Week 1')),
    ).toBe(true)
    expect(view.preview.unscheduledMinutes).toBe(0)
    expect(view.preview.warnings).toEqual([])
    expect(view.preview.unschedulable).toEqual([])

    const approval = await h.request(`/api/documents/${id}/pathway-approve`, {
      cookie: owner.cookie,
      body: { availability, expectedSessions: view.preview.sessions },
    })
    expect(approval.status).toBe(201)
    // Calendar export must include the study tasks without a phone sync
    // connection, and Undo must remove their previously exported entries.
    const createdTasks = h.query(
      'SELECT id FROM tasks WHERE user_id = ? AND status = ? ORDER BY id',
      owner.id,
      'open',
    ) as Array<{ id: string }>
    const createdTask = createdTasks[0]!
    expect(createdTask).toBeTruthy()
    const beforeCalendar = await h.request('/api/calendar/export.ics', {
      cookie: owner.cookie,
    })
    expect(beforeCalendar.status).toBe(200)
    expect(await beforeCalendar.text()).toContain(
      `UID:task-${createdTask.id}@pocketgoblin.org`,
    )

    const saved = await h.request(`/api/documents/${id}/pathway`, {
      cookie: owner.cookie,
    })
    expect(saved.status).toBe(200)
    const stored = (await saved.json()) as { sessions: Array<{ id: string }> }
    expect(stored.sessions.length).toBe(view.preview.sessions.length)

    const duplicated = await h.request(`/api/documents/${id}/pathway-approve`, {
      cookie: owner.cookie,
      body: { availability, expectedSessions: view.preview.sessions },
    })
    expect(duplicated.status).not.toBe(201)

    // Finishing the default temporary upload must not hide or delete the
    // learner's approved pathway. The original document is disposable.
    const finished = await h.request(`/api/documents/${id}/finish`, {
      cookie: owner.cookie,
      method: 'POST',
    })
    expect(finished.status).toBe(200)
    const paths = await h.request('/api/documents/study-pathways', {
      cookie: owner.cookie,
    })
    expect(paths.status).toBe(200)
    expect(await paths.json()).toMatchObject({
      pathways: [
        { documentId: id, openSessions: view.preview.sessions.length },
      ],
    })
    const privatePaths = await h.request('/api/documents/study-pathways', {
      cookie: stranger.cookie,
    })
    expect(privatePaths.status).toBe(200)
    expect(await privatePaths.json()).toEqual({ pathways: [] })

    const reopened = await h.request(`/api/documents/${id}/pathway`, {
      cookie: owner.cookie,
    })
    expect(reopened.status).toBe(200)

    const undo = await h.request(`/api/documents/${id}/pathway-undo`, {
      cookie: owner.cookie,
      method: 'POST',
    })
    expect(undo.status).toBe(200)
    const afterCalendar = await h.request('/api/calendar/export.ics', {
      cookie: owner.cookie,
    })
    expect(afterCalendar.status).toBe(200)
    expect(await afterCalendar.text()).not.toContain(
      `UID:task-${createdTask.id}@pocketgoblin.org`,
    )
    const active = h.query(
      'SELECT status FROM study_pathways WHERE user_id = ?',
      owner.id,
    ) as Array<{ status: string }>
    expect(active).toEqual([{ status: 'cancelled' }])
  })

  it('extracts a real Chrome-generated university PDF into reviewable assessment steps', async () => {
    const bytes = readFileSync(
      new URL('../shared/documents/fixtures/chrome-letter-spaced.pdf', import.meta.url),
    )
    const data = new FormData()
    data.append(
      'file',
      new File([new Uint8Array(bytes)], 'UNE Study Schedule.pdf', {
        type: 'application/pdf',
      }),
    )
    const uploaded = await app.request(
      '/api/documents',
      { method: 'POST', headers: { Cookie: owner.cookie }, body: data },
      h.env,
    )
    expect(uploaded.status).toBe(201)
    const result = (await uploaded.json()) as {
      document: { id: string; documentType: string }
    }
    expect(result.document.documentType).toBe('education')
    const rows = h.query(
      `SELECT payload_json as payload FROM review_items
       WHERE user_id = ? AND source_type = 'document' AND source_id = ?`,
      owner.id,
      result.document.id,
    ) as Array<{ payload: string }>
    const studyTasks = rows
      .map((row) => JSON.parse(row.payload) as {
        title?: string
        type?: string
        requiresReview?: boolean
      })
      .filter((item) => item.type === 'task' && item.requiresReview === true)
    expect(studyTasks.length).toBeGreaterThan(0)
    expect(studyTasks.some((item) => /reflective essay/i.test(item.title ?? ''))).toBe(
      true,
    )
    const preview = await h.request(
      `/api/documents/${result.document.id}/pathway-preview`,
      { cookie: owner.cookie, body: { availability: availableDays() } },
    )
    expect(preview.status).toBe(200)
    const view = (await preview.json()) as {
      preview: { sessions: Array<{ title: string }> }
    }
    expect(view.preview.sessions.length).toBeGreaterThan(0)
  })

})
