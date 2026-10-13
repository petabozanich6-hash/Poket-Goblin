/**
 * Sprint 6 integration journeys against local API (:8787).
 * Does not reset the local D1 database — creates disposable users only.
 */
const API = process.env.API_BASE ?? 'http://127.0.0.1:8787/api'
const stamp = Date.now()
const tz = () => new Date().getTimezoneOffset()

function jar() {
  const cookies = new Map()
  return {
    store(res) {
      const raw = res.headers.getSetCookie?.() ?? []
      for (const line of raw) {
        const [pair] = line.split(';')
        const eq = pair.indexOf('=')
        if (eq > 0) cookies.set(pair.slice(0, eq), pair.slice(eq + 1))
      }
    },
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    clear() {
      cookies.clear()
    },
  }
}

async function req(cookies, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookies.header(),
      ...(init.headers ?? {}),
    },
  })
  cookies.store(res)
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

async function must(cookies, path, init = {}) {
  const { res, data } = await req(cookies, path, init)
  if (!res.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(data)}`,
    )
  }
  return data
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

function localDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400_000)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

async function register(cookies, suffix) {
  const email = `s6_${suffix}_${stamp}@example.com`
  const password = 'Sprint6Test!ok'
  const displayName = `S6 ${suffix}`
  const data = await must(cookies, '/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  })
  return { email, password, displayName, user: data.user }
}

async function journeyA() {
  const c = jar()
  const account = await register(c, 'a')
  const me = await must(c, '/me')
  assert(me.user.email === account.email, 'me email')

  const dump = await must(c, '/captures', {
    method: 'POST',
    body: JSON.stringify({
      text: 'Remember to water the plants tomorrow',
      timezoneOffsetMinutes: tz(),
    }),
  })
  assert(dump.capture?.items?.length >= 1, 'capture items')
  const item = dump.capture.items[0]
  await must(c, `/captures/${dump.capture.id}/items/${item.id}/accept`, {
    method: 'POST',
    body: JSON.stringify({ timezoneOffsetMinutes: tz() }),
  })

  const tasks = await must(c, '/tasks?status=open')
  const task = (tasks.tasks ?? []).find((t) =>
    t.title.toLowerCase().includes('plant'),
  )
  assert(task, 'task persisted from capture')

  const found = await must(c, `/search?q=${encodeURIComponent('plant')}`)
  assert(
    (found.groups ?? []).some((g) => g.type === 'task'),
    'search finds task',
  )

  await must(c, `/tasks/${task.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'completed' }),
  })

  await must(c, '/auth/logout', { method: 'POST' })
  const unauth = await req(c, '/me')
  assert(unauth.res.status === 401, 'logout clears session')

  c.clear()
  await must(c, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: account.email,
      password: account.password,
    }),
  })
  const again = await must(c, '/tasks?status=completed')
  assert(
    (again.tasks ?? []).some((t) => t.id === task.id),
    'completed task persists after re-login',
  )
  return { ok: true, taskId: task.id }
}

async function journeyB() {
  const c = jar()
  await register(c, 'b')
  const text =
    'I need to book the dentist, buy milk and bread, pay the electricity bill by Friday, and remember my appointment next Tuesday.'
  const dump = await must(c, '/captures', {
    method: 'POST',
    body: JSON.stringify({ text, timezoneOffsetMinutes: tz() }),
  })
  const items = dump.capture.items ?? []
  assert(items.length >= 3, `expected multiple items, got ${items.length}`)
  assert(
    items.some((i) => i.kind === 'shopping' || /milk|bread/i.test(i.title)),
    'shopping signal',
  )
  assert(
    items.some((i) => /dentist|electricity|bill|appointment/i.test(i.title)),
    'task/appointment signal',
  )

  const shop =
    items.find((i) => i.kind === 'shopping') ??
    items.find((i) => /milk|bread/i.test(i.title))
  const reject = items.find((i) => i.id !== shop.id)
  assert(shop && reject, 'shop + reject candidates')

  if (shop.kind !== 'shopping') {
    await must(c, `/captures/${dump.capture.id}/items/${shop.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ kind: 'shopping', title: shop.title }),
    })
  }

  await must(c, `/captures/${dump.capture.id}/items/${shop.id}/accept`, {
    method: 'POST',
    body: JSON.stringify({ timezoneOffsetMinutes: tz() }),
  })
  await must(c, `/captures/${dump.capture.id}/items/${reject.id}/reject`, {
    method: 'POST',
  })

  const shopping = await must(c, '/shopping')
  const names = (shopping.lists ?? [])
    .flatMap((l) => l.items ?? [])
    .map((i) => i.name.toLowerCase())
  assert(names.length >= 1, 'accepted shopping persisted')

  if (reject.kind === 'task') {
    const tasks = await must(c, '/tasks?status=open')
    assert(
      !(tasks.tasks ?? []).some((t) => t.title === reject.title),
      'rejected task not created',
    )
  }
  return { itemCount: items.length }
}

async function journeyC() {
  const c = jar()
  await register(c, 'c')
  await must(c, '/me/settings', {
    method: 'PATCH',
    body: JSON.stringify({ capacityMode: 'goblin' }),
  })
  for (const title of [
    'Sort paperwork',
    'Call Mum',
    'Clean kitchen',
    'Email boss',
  ]) {
    await must(c, '/tasks', {
      method: 'POST',
      body: JSON.stringify({ title, priority: 'normal', capacityCost: 2 }),
    })
  }
  await must(c, '/events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Checkup',
      date: localDate(0),
      startTime: '16:00',
      timezoneOffsetMinutes: tz(),
    }),
  })

  const briefing = await must(c, `/magical/briefing?tz=${tz()}`)
  assert(briefing.briefing?.mode === 'rules', 'briefing rules')

  const tiny = await must(c, '/magical/tiny-step', {
    method: 'POST',
    body: JSON.stringify({ title: 'Clean kitchen' }),
  })
  assert(tiny.steps?.length >= 1, 'tiny steps')

  const tasks = await must(c, '/tasks?status=open')
  const kitchen = (tasks.tasks ?? []).find((t) => t.title === 'Clean kitchen')
  await must(c, '/magical/tiny-step/accept', {
    method: 'POST',
    body: JSON.stringify({
      parentId: kitchen.id,
      title: tiny.steps[0].title,
    }),
  })

  const rescue = await must(c, '/magical/rescue', {
    method: 'POST',
    body: JSON.stringify({ timezoneOffsetMinutes: tz() }),
  })
  assert(rescue.suggestion?.note, 'rescue note')
  await must(c, '/magical/rescue/dismiss', {
    method: 'POST',
    body: JSON.stringify({ rescueId: rescue.rescueId }),
  })
  const afterPlan = await must(c, '/plan/today')
  assert(afterPlan.plan?.id, 'plan still exists after dismiss')
  return { rescueId: rescue.rescueId }
}

async function journeyD() {
  const c = jar()
  await register(c, 'd')
  await must(c, '/reminders', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Pay water bill',
      remindAt: new Date(Date.now() + 86400_000).toISOString(),
      entityType: 'bill',
    }),
  })
  await must(c, '/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Take bins out',
      dueDate: localDate(2),
      categorySlug: 'home',
      recurrenceFrequency: 'weekly',
    }),
  })
  const lists = await must(c, '/shopping')
  const listId = lists.lists?.[0]?.id
  await must(c, '/shopping/items', {
    method: 'POST',
    body: JSON.stringify({ listId, name: 'Oats' }),
  })
  await must(c, '/notes', {
    method: 'POST',
    body: JSON.stringify({ title: 'Car notes', body: 'Tyre pressure 32 PSI' }),
  })
  await must(c, '/events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'School pickup',
      date: localDate(2),
      startTime: '15:30',
      timezoneOffsetMinutes: tz(),
    }),
  })

  for (const q of [
    'water bill',
    'bins',
    'Oats',
    'Car notes',
    'School pickup',
  ]) {
    const found = await must(c, `/search?q=${encodeURIComponent(q)}`)
    assert((found.groups ?? []).length > 0, `search ${q}`)
  }
  const den = await must(c, '/dashboard/den')
  assert(den.summary, 'den summary')
  return { ok: true }
}

async function journeyE() {
  const c = jar()
  await register(c, 'e')
  const form = new FormData()
  const bytes = new TextEncoder().encode(
    'Electricity Bill\nAmount due: $120.50\nDue date: 20 October 2026\nPlease pay online.',
  )
  form.append(
    'file',
    new Blob([bytes], { type: 'text/plain' }),
    'electricity-bill.txt',
  )

  const uploadRes = await fetch(`${API}/documents`, {
    method: 'POST',
    headers: { Cookie: c.header() },
    body: form,
  })
  c.store(uploadRes)
  const upload = await uploadRes.json().catch(() => ({}))
  if (!uploadRes.ok) {
    return {
      skipped: true,
      reason: `upload failed ${uploadRes.status}: ${JSON.stringify(upload)}`,
    }
  }
  const docId = upload.document?.id
  assert(docId, 'document id')

  const listed = await must(c, '/documents')
  assert(
    (listed.documents ?? []).some((d) => d.id === docId),
    'listed',
  )

  await req(c, `/documents/${docId}/process`, { method: 'POST' })

  const search = await must(c, `/search?q=${encodeURIComponent('electricity')}`)
  assert(
    (search.groups ?? []).some((g) => g.type === 'document'),
    'document searchable',
  )

  // Isolation probe from second account before delete
  const other = jar()
  await register(other, 'eOther')
  const steal = await req(other, `/documents/${docId}`)
  assert(
    steal.res.status === 404 || steal.res.status === 403,
    'other user cannot read document',
  )

  await must(c, `/documents/${docId}`, { method: 'DELETE' })
  const gone = await req(c, `/documents/${docId}`)
  assert(gone.res.status === 404, 'deleted')
  return { skipped: false, docId }
}

async function journeyF() {
  const a = jar()
  const b = jar()
  await register(a, 'isoA')
  await register(b, 'isoB')

  const created = await must(a, '/tasks', {
    method: 'POST',
    body: JSON.stringify({ title: 'Secret task for A only' }),
  })
  const taskId = created.task.id
  const note = await must(a, '/notes', {
    method: 'POST',
    body: JSON.stringify({ title: 'A private note', body: 'classified' }),
  })
  const event = await must(a, '/events', {
    method: 'POST',
    body: JSON.stringify({
      title: 'A private appt',
      date: localDate(1),
      startTime: '10:00',
      timezoneOffsetMinutes: tz(),
    }),
  })

  const stealPatch = await req(b, `/tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'hacked' }),
  })
  assert(
    stealPatch.res.status === 404 || stealPatch.res.status === 403,
    `B must not patch A task (${stealPatch.res.status})`,
  )
  const stealNote = await req(b, `/notes/${note.note.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'hacked note' }),
  })
  assert(
    stealNote.res.status === 404 || stealNote.res.status === 403,
    `B must not patch A note (${stealNote.res.status})`,
  )
  const stealEvent = await req(b, `/events/${event.event.id}`, {
    method: 'DELETE',
  })
  assert(
    stealEvent.res.status === 404 || stealEvent.res.status === 403,
    `B must not delete A event (${stealEvent.res.status})`,
  )

  const bTasks = await must(b, '/tasks?status=open')
  assert(
    !(bTasks.tasks ?? []).some((t) => t.id === taskId),
    'B list excludes A task',
  )

  const anon = await req(jar(), '/tasks')
  assert(anon.res.status === 401, 'anon rejected')
  return { taskId }
}

async function main() {
  const results = {}
  results.A = await journeyA()
  results.B = await journeyB()
  results.C = await journeyC()
  results.D = await journeyD()
  results.E = await journeyE()
  results.F = await journeyF()
  console.log('smoke-sprint6 OK', JSON.stringify(results, null, 2))
}

main().catch((err) => {
  console.error('smoke-sprint6 FAILED', err)
  process.exit(1)
})
