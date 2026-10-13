#!/usr/bin/env node
/**
 * Sprint 2 API smoke: multi-user isolation + life-management CRUD.
 * Requires `npm run dev` (API on 8787).
 */

const api = process.env.PG_API_URL || 'http://127.0.0.1:8787'

function cookieJar() {
  let cookie = ''
  return {
    store(res) {
      const raw = res.headers.getSetCookie?.() ?? []
      const parts = raw.length
        ? raw
        : [res.headers.get('set-cookie')].filter(Boolean)
      for (const p of parts) {
        const m = String(p).match(/^(pg_session=[^;]+)/)
        if (m) cookie = m[1]
      }
    },
    header() {
      return cookie ? { Cookie: cookie } : {}
    },
  }
}

async function json(res) {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Non-JSON ${res.status}: ${text.slice(0, 200)}`)
  }
}

async function register(email, password, displayName) {
  const jar = cookieJar()
  const res = await fetch(`${api}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, displayName }),
  })
  jar.store(res)
  const body = await json(res)
  if (!res.ok) throw new Error(`register ${email}: ${body.error || res.status}`)
  return { jar, user: body.user }
}

async function apiFetch(jar, path, opts = {}) {
  const res = await fetch(`${api}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...jar.header(),
      ...(opts.headers || {}),
    },
  })
  jar.store(res)
  const body = await json(res)
  return { res, body }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function main() {
  const stamp = Date.now()
  const a = await register(
    `sprint2-a-${stamp}@example.com`,
    'password-a-12345',
    'Sprint Two A',
  )
  const b = await register(
    `sprint2-b-${stamp}@example.com`,
    'password-b-12345',
    'Sprint Two B',
  )

  // Events
  const ev = await apiFetch(a.jar, '/api/events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Dentist',
      date: '2026-10-20',
      startTime: '14:00',
      endTime: '15:00',
      description: 'Checkup',
      location: 'Clinic',
    }),
  })
  assert(ev.res.ok, `event create: ${ev.body.error}`)
  const eventId = ev.body.event.id

  const evListB = await apiFetch(b.jar, '/api/events')
  assert(evListB.res.ok, 'events list B')
  assert(
    !(evListB.body.events || []).some((e) => e.id === eventId),
    'user B must not see user A event',
  )

  // Notes
  const note = await apiFetch(a.jar, '/api/notes', {
    method: 'POST',
    body: JSON.stringify({
      title: 'WiFi',
      body: 'Password on router',
      pinned: true,
    }),
  })
  assert(note.res.ok, `note create: ${note.body.error}`)

  // Shopping
  const lists = await apiFetch(a.jar, '/api/shopping')
  assert(lists.res.ok, `shopping lists: ${lists.body.error}`)
  assert((lists.body.lists || []).length >= 1, 'default shopping list missing')
  const item = await apiFetch(a.jar, '/api/shopping/items', {
    method: 'POST',
    body: JSON.stringify({ name: 'Milk', quantity: '2L' }),
  })
  assert(item.res.ok, `shopping item: ${item.body.error}`)

  // Reminders
  const rem = await apiFetch(a.jar, '/api/reminders', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Call Mum',
      remindAt: '2026-10-14T09:00:00.000Z',
    }),
  })
  assert(rem.res.ok, `reminder create: ${rem.body.error}`)
  const remId = rem.body.reminder.id
  const snooze = await apiFetch(a.jar, `/api/reminders/${remId}/snooze`, {
    method: 'POST',
    body: JSON.stringify({ minutes: 30 }),
  })
  assert(snooze.res.ok, `reminder snooze: ${snooze.body.error}`)

  // Recurring task via brain dump
  const bins = await apiFetch(a.jar, '/api/captures', {
    method: 'POST',
    body: JSON.stringify({ text: 'Bins out every Thursday.' }),
  })
  assert(bins.res.ok, `recurring capture: ${bins.body.error}`)
  const binsItem = (bins.body.capture?.items || [])[0]
  assert(
    binsItem?.recurrenceFrequency === 'weekly',
    'expected weekly recurrence',
  )
  const acceptBins = await apiFetch(
    a.jar,
    `/api/captures/${bins.body.capture.id}/items/${binsItem.id}/accept`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  assert(acceptBins.res.ok, `accept recurring: ${acceptBins.body.error}`)

  // Brain dump multi-type
  const cap = await apiFetch(a.jar, '/api/captures', {
    method: 'POST',
    body: JSON.stringify({
      text: 'Book the dentist and buy toothpaste.',
    }),
  })
  assert(cap.res.ok, `capture: ${cap.body.error}`)
  const suggestions = cap.body.capture?.items || []
  assert(suggestions.length >= 2, 'capture should suggest multiple items')

  // Search scoped
  const searchA = await apiFetch(
    a.jar,
    `/api/search?q=${encodeURIComponent('Dentist')}`,
  )
  assert(searchA.res.ok, `search A: ${searchA.body.error}`)
  const searchB = await apiFetch(
    b.jar,
    `/api/search?q=${encodeURIComponent('Dentist')}`,
  )
  assert(searchB.res.ok, `search B: ${searchB.body.error}`)
  const hitsB = JSON.stringify(searchB.body)
  assert(!hitsB.includes(eventId), 'search must not leak user A event id')

  // History
  const hist = await apiFetch(a.jar, '/api/history/tasks')
  assert(hist.res.ok, `history: ${hist.body.error}`)

  // Dashboard
  const den = await apiFetch(a.jar, '/api/dashboard/den')
  assert(den.res.ok, `dashboard: ${den.body.error}`)

  // Router includes Sprint 2 pages
  const web = process.env.PG_WEB_URL || 'http://localhost:5173'
  const routerSrc = await fetch(`${web}/src/app/router.tsx`)
  assert(routerSrc.ok, 'fetch router')
  const routerText = await routerSrc.text()
  for (const page of ['CalendarPage', 'LifePage', 'SearchPage']) {
    assert(routerText.includes(page), `router missing ${page}`)
  }

  console.log(
    'Sprint 2 smoke OK: events, notes, shopping, reminders, recurrence, capture, search isolation, history, den.',
  )
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
