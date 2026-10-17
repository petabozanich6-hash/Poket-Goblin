import { beforeEach, describe, expect, it } from 'vitest'

import { buildCalendar, escapeText, fold } from './lib/ics'
import { createHarness, type Harness, type TestUser } from './testing/harness'

let h: Harness
let alice: TestUser
let bob: TestUser

beforeEach(async () => {
  h = createHarness()
  alice = await h.register('alice@example.com')
  bob = await h.register('bob@example.com')
})

const soon = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

async function seed(user: TestUser) {
  await h.request('/api/events', {
    cookie: user.cookie,
    body: {
      title: 'Dentist, Smith St',
      date: soon(3),
      startTime: '15:00',
      timezoneOffsetMinutes: 0,
    },
  })
  await h.request('/api/events', {
    cookie: user.cookie,
    body: { title: 'Due: Essay', date: soon(10), allDay: true },
  })
  await h.request('/api/tasks', {
    cookie: user.cookie,
    body: { title: 'Pay rent', dueDate: soon(5), notes: 'secret note' },
  })
}

describe('calendar file', () => {
  it('escapes text and folds long lines', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne')
    const folded = fold(`SUMMARY:${'é'.repeat(60)}`)
    expect(
      folded
        .split('\r\n')
        .every((l) => new TextEncoder().encode(l).length <= 75),
    ).toBe(true)
  })

  it('puts all-day items on the local day of the person’s time zone', () => {
    const ics = buildCalendar(
      [
        {
          kind: 'event',
          id: 'e1',
          title: 'Due: Essay',
          location: '',
          // Local noon in Auckland (UTC+13) is 23:00 the day before in UTC.
          startsAt: '2026-11-12T23:00:00.000Z',
          endsAt: '2026-11-13T23:00:00.000Z',
          allDay: true,
          updatedAt: '2026-10-16T00:00:00.000Z',
        },
      ],
      { timeZone: 'Pacific/Auckland' },
    )
    expect(ics).toContain('DTSTART;VALUE=DATE:20261113')
    expect(ics).toContain('DTEND;VALUE=DATE:20261114')
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
  })
})

describe('Pocket Goblin in-app calendar', () => {
  it('shows dated tasks even when they were not created as events or approved pathways', async () => {
    await seed(alice)
    await seed(bob)
    const from = soon(0)
    const to = soon(20)
    const path = `/api/calendar/dated-tasks?from=${from}&to=${to}`
    const response = await h.request(path, { cookie: alice.cookie })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      tasks: Array<{
        id: string
        title: string
        date: string
        studyMinutes: number | null
      }>
    }
    expect(body.tasks).toEqual([
      expect.objectContaining({
        title: 'Pay rent',
        date: soon(5),
        studyMinutes: null,
      }),
    ])
    expect(JSON.stringify(body)).not.toContain('secret note')

    const other = await h.request(path, { cookie: bob.cookie })
    expect(other.status).toBe(200)
    expect((await other.json()) as { tasks: unknown[] }).toMatchObject({
      tasks: [{ title: 'Pay rent' }],
    })

    expect((await h.request(path)).status).toBe(401)
    expect(
      (
        await h.request(`/api/calendar/dated-tasks?from=2026-02-30&to=${to}`, {
          cookie: alice.cookie,
        })
      ).status,
    ).toBe(400)
  })

  it('removes a completed task from the upcoming calendar', async () => {
    const taskResponse = await h.request('/api/tasks', {
      cookie: alice.cookie,
      body: { title: 'Read module 1', dueDate: soon(2) },
    })
    expect(taskResponse.status).toBe(201)
    const data = (await taskResponse.json()) as { task: { id: string } }
    const calendarPath = `/api/calendar/dated-tasks?from=${soon(0)}&to=${soon(10)}`
    expect(
      (
        (await (
          await h.request(calendarPath, { cookie: alice.cookie })
        ).json()) as {
          tasks: Array<{ title: string }>
        }
      ).tasks.some((task) => task.title === 'Read module 1'),
    ).toBe(true)
    const complete = await h.request(`/api/tasks/${data.task.id}`, {
      method: 'PATCH',
      cookie: alice.cookie,
      body: { status: 'completed' },
    })
    expect(complete.status).toBe(200)
    const final = (await (
      await h.request(calendarPath, { cookie: alice.cookie })
    ).json()) as {
      tasks: Array<{ title: string }>
    }
    expect(final.tasks).toEqual([])
  })
})

describe('download', () => {
  it('exports appointments, task due dates and nothing private', async () => {
    await seed(alice)
    await seed(bob)
    const res = await h.request(
      '/api/calendar/export.ics?tz=Australia/Sydney',
      { cookie: alice.cookie },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toMatch(/^text\/calendar/)
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment/)
    const ics = await res.text()
    expect(ics).toContain('SUMMARY:Dentist\\, Smith St')
    expect(ics).toContain('SUMMARY:To do: Pay rent')
    expect(ics).toContain(`DTSTART;VALUE=DATE:${soon(5).replace(/-/g, '')}`)
    expect(ics).not.toContain('secret note')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3)
  })

  it('needs a signed-in person', async () => {
    expect((await h.request('/api/calendar/export.ics')).status).toBe(401)
  })
})

describe('live phone calendar link', () => {
  it('creates a private link that works without signing in, until turned off', async () => {
    await seed(alice)
    const created = await h.request('/api/calendar/feed', {
      cookie: alice.cookie,
      body: { timezone: 'Europe/London' },
    })
    expect(created.status).toBe(201)
    const { url, webcalUrl } = (await created.json()) as {
      url: string
      webcalUrl: string
    }
    expect(webcalUrl).toMatch(
      /^webcal:\/\/.+\/api\/ics\/[A-Za-z0-9_-]{43}\.ics$/,
    )
    const path = new URL(url).pathname

    // Calendar apps fetch it with no cookie.
    const feed = await h.request(path)
    expect(feed.status).toBe(200)
    expect(feed.headers.get('Cache-Control')).toBe('private, no-store')
    const ics = await feed.text()
    expect(ics).toContain('X-WR-TIMEZONE:Europe/London')
    expect(ics).toContain('SUMMARY:To do: Pay rent')

    // The token is never stored.
    const token = path.split('/').pop()!.replace('.ics', '')
    expect(
      JSON.stringify(h.query('SELECT * FROM calendar_feeds')),
    ).not.toContain(token)

    // A new link kills the old one; turning it off kills both.
    const second = await h.request('/api/calendar/feed', {
      cookie: alice.cookie,
      body: {},
    })
    const newPath = new URL(((await second.json()) as { url: string }).url)
      .pathname
    expect((await h.request(path)).status).toBe(404)
    expect((await h.request(newPath)).status).toBe(200)
    await h.request('/api/calendar/feed', {
      cookie: alice.cookie,
      method: 'DELETE',
    })
    expect((await h.request(newPath)).status).toBe(404)
  })

  it('stops working when the account is suspended', async () => {
    const created = await h.request('/api/calendar/feed', {
      cookie: alice.cookie,
      body: {},
    })
    const path = new URL(((await created.json()) as { url: string }).url)
      .pathname
    h.query(`UPDATE users SET status = 'suspended' WHERE id = ?`, alice.id)
    expect((await h.request(path)).status).toBe(404)
  })

  it('rejects made-up links', async () => {
    expect((await h.request(`/api/ics/${'a'.repeat(43)}.ics`)).status).toBe(404)
    expect((await h.request('/api/ics/../me')).status).not.toBe(200)
  })

  it('only shows your own calendar', async () => {
    await seed(bob)
    const created = await h.request('/api/calendar/feed', {
      cookie: alice.cookie,
      body: {},
    })
    const path = new URL(((await created.json()) as { url: string }).url)
      .pathname
    expect(await (await h.request(path)).text()).not.toContain('Pay rent')
  })
})
