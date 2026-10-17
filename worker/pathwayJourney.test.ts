import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
    // Approval removes the exact proposed steps from the review queue,
    // atomically with the generated dated tasks.
    const proposalsAfterApproval = h.query(
      `SELECT status FROM review_items
       WHERE user_id = ? AND source_type = 'document' AND source_id = ?
         AND json_valid(payload_json) = 1
         AND json_extract(payload_json, '$.requiresReview') = 1`,
      owner.id,
      id,
    ) as Array<{ status: string }>
    expect(proposalsAfterApproval.length).toBeGreaterThan(0)
    expect(
      proposalsAfterApproval.every((item) => item.status === 'accepted'),
    ).toBe(true)

    // Pocket Goblin's calendar must show each dated study session without
    // duplicating it as a conventional appointment.
    const calendarUrl =
      '/api/documents/study-sessions?from=2026-10-19&to=2026-12-05'
    const calendarSessions = await h.request(calendarUrl, {
      cookie: owner.cookie,
    })
    expect(calendarSessions.status).toBe(200)
    const calendarData = (await calendarSessions.json()) as {
      sessions: Array<{
        id: string
        title: string
        date: string
        minutes: number
      }>
    }
    expect(calendarData.sessions).toHaveLength(view.preview.sessions.length)
    expect(
      calendarData.sessions.every(
        (session) =>
          session.minutes > 0 &&
          session.date >= '2026-10-19' &&
          session.date <= '2026-12-05',
      ),
    ).toBe(true)
    const strangersCalendar = await h.request(calendarUrl, {
      cookie: stranger.cookie,
    })
    expect(strangersCalendar.status).toBe(200)
    expect(await strangersCalendar.json()).toEqual({ sessions: [] })
    const invalidCalendar = await h.request(
      '/api/documents/study-sessions?from=2026-02-30&to=2026-12-05',
      { cookie: owner.cookie },
    )
    expect(invalidCalendar.status).toBe(400)
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
    expect(duplicated.status).toBe(200)
    expect(await duplicated.json()).toMatchObject({
      alreadySaved: true,
    })

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
    // The temporary file was finished, so no proposals need restoring.
    const afterUndoSessions = await h.request(calendarUrl, {
      cookie: owner.cookie,
    })
    expect(await afterUndoSessions.json()).toEqual({ sessions: [] })
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
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../shared/documents/fixtures/chrome-letter-spaced.pdf',
      ),
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
      .map(
        (row) =>
          JSON.parse(row.payload) as {
            title?: string
            type?: string
            requiresReview?: boolean
          },
      )
      .filter((item) => item.type === 'task' && item.requiresReview === true)
    expect(studyTasks.length).toBeGreaterThan(0)
    expect(
      studyTasks.some((item) => /reflective essay/i.test(item.title ?? '')),
    ).toBe(true)
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

describe('realistic standalone university modules', () => {
  it('keeps OPEN/AVAILABLE out of the calendar and requires approval of a personal study target', async () => {
    const module = [
      'UNE myLearn - Module 1 Understanding loss, grief and mourning',
      'Module learning outcomes: understand key concepts and definitions.',
      'Required readings: complete the prescribed readings.',
      'Learning activities: explore different types of grief.',
      'Reflection activity: consider the mourning process.',
      'Available ≡ OPEN ≡',
      '26 April 2027',
    ].join('\n')
    const form = new FormData()
    form.append(
      'file',
      new File([module], 'Module 1 UNE myLearn.txt', {
        type: 'text/plain',
      }),
    )
    const upload = await app.request(
      '/api/documents',
      {
        method: 'POST',
        headers: { Cookie: owner.cookie },
        body: form,
      },
      h.env,
    )
    expect(upload.status).toBe(201)
    const data = (await upload.json()) as {
      document: { id: string }
      autoAdded?: { added: number; already: number }
    }
    expect(data.autoAdded?.added ?? 0).toBe(0)
    const id = data.document.id
    const items = h.query(
      `SELECT payload_json as payload FROM review_items
       WHERE user_id = ? AND source_type = 'document' AND source_id = ?`,
      owner.id,
      id,
    ) as Array<{ payload: string }>
    const activities = items.map(
      (item) =>
        JSON.parse(item.payload) as {
          title: string
          dueDate: string | null
          requiresReview?: boolean
          group?: string
        },
    )
    expect(activities.length).toBeGreaterThanOrEqual(4)
    expect(
      activities.every(
        (item) =>
          item.group === 'Study module' &&
          item.dueDate === null &&
          item.requiresReview === true,
      ),
    ).toBe(true)

    const availability = availableDays()
    const noDate = await h.request(`/api/documents/${id}/pathway-preview`, {
      cookie: owner.cookie,
      body: { availability },
    })
    expect(noDate.status).toBe(200)
    const blocked = (await noDate.json()) as {
      preview: { sessions: unknown[]; unschedulable: unknown[] }
    }
    expect(blocked.preview.sessions).toEqual([])
    expect(blocked.preview.unschedulable.length).toBeGreaterThan(0)

    const planningTargetDate = '2026-11-02'
    const preview = await h.request(`/api/documents/${id}/pathway-preview`, {
      cookie: owner.cookie,
      body: { availability, planningTargetDate },
    })
    expect(preview.status).toBe(200)
    const proposed = (await preview.json()) as {
      preview: {
        sessions: Array<{ date: string; minutes: number }>
        warnings: unknown[]
        unscheduledMinutes: number
        unschedulable: unknown[]
        deadlines: Array<{ deadline: string | null }>
      }
    }
    expect(proposed.preview.sessions.length).toBeGreaterThan(0)
    expect(proposed.preview.warnings).toEqual([])
    expect(proposed.preview.unschedulable).toEqual([])
    expect(proposed.preview.unscheduledMinutes).toBe(0)
    expect(proposed.preview.deadlines.every((d) => d.deadline === null)).toBe(
      true,
    )

    const approve = await h.request(`/api/documents/${id}/pathway-approve`, {
      cookie: owner.cookie,
      body: {
        availability,
        planningTargetDate,
        expectedSessions: proposed.preview.sessions,
      },
    })
    expect(approve.status).toBe(201)
    const rows = h.query(
      'SELECT deadline_date as deadlineDate FROM study_pathway_sessions WHERE user_id = ?',
      owner.id,
    ) as Array<{ deadlineDate: string | null }>
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((s) => s.deadlineDate === null)).toBe(true)
    const assigned = h.query(
      `SELECT status FROM review_items
       WHERE user_id = ? AND source_type = 'document' AND source_id = ?
         AND json_valid(payload_json) = 1
         AND json_extract(payload_json, '$.requiresReview') = 1`,
      owner.id,
      id,
    ) as Array<{ status: string }>
    expect(assigned.length).toBe(activities.length)
    expect(assigned.every((item) => item.status === 'accepted')).toBe(true)

    const dates = availability.map((day) => day.date)
    const calendar = await h.request(
      `/api/calendar/dated-tasks?from=${dates[0]}&to=${dates[dates.length - 1]}`,
      { cookie: owner.cookie },
    )
    expect(calendar.status).toBe(200)
    const list = (await calendar.json()) as {
      tasks: Array<{ studyMinutes: number | null; title: string }>
    }
    expect(list.tasks.length).toBe(proposed.preview.sessions.length)
    expect(list.tasks.every((task) => (task.studyMinutes ?? 0) > 0)).toBe(true)

    const undo = await h.request(`/api/documents/${id}/pathway-undo`, {
      cookie: owner.cookie,
      method: 'POST',
    })
    expect(undo.status).toBe(200)
    const restored = h.query(
      `SELECT status FROM review_items
       WHERE user_id = ? AND source_type = 'document' AND source_id = ?
         AND json_valid(payload_json) = 1
         AND json_extract(payload_json, '$.requiresReview') = 1`,
      owner.id,
      id,
    ) as Array<{ status: string }>
    expect(restored.length).toBe(assigned.length)
    expect(restored.every((item) => item.status === 'pending')).toBe(true)
  })
})
