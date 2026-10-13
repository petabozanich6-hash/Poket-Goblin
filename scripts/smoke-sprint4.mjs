#!/usr/bin/env node
/** Sprint 4 smoke: vault upload, review, connections honesty, isolation. */

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

async function apiFetch(jar, path, opts = {}) {
  const res = await fetch(`${api}${path}`, {
    ...opts,
    headers: {
      ...(opts.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...jar.header(),
      ...(opts.headers || {}),
    },
  })
  jar.store(res)
  return { res, body: await json(res) }
}

async function main() {
  const stamp = Date.now()
  const a = cookieJar()
  const reg = await apiFetch(a, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `sprint4-a-${stamp}@example.com`,
      password: 'password-sprint4a',
      displayName: 'Sprint Four A',
    }),
  })
  assert(reg.res.ok, `register A: ${reg.body.error}`)

  const form = new FormData()
  form.append(
    'file',
    new Blob(['Electricity bill\nAmount due: $55.00\nDue date: 2026-10-25\n'], {
      type: 'text/plain',
    }),
    'electricity.txt',
  )
  const upload = await apiFetch(a, '/api/documents', {
    method: 'POST',
    body: form,
  })
  assert(upload.res.ok, `upload: ${upload.body.error}`)
  const docId = upload.body.document.id
  assert(docId, 'document id missing')

  const list = await apiFetch(a, '/api/documents')
  assert(list.res.ok, 'list docs')
  assert(
    (list.body.documents || []).some((d) => d.id === docId),
    'uploaded doc missing',
  )

  const review = await apiFetch(a, '/api/review?status=pending')
  assert(review.res.ok, `review: ${review.body.error}`)
  assert((review.body.items || []).length >= 1, 'expected review suggestions')

  const item = review.body.items[0]
  const accept = await apiFetch(a, `/api/review/${item.id}/accept`, {
    method: 'POST',
    body: JSON.stringify({
      dueDate: '2026-10-25',
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    }),
  })
  assert(accept.res.ok, `accept: ${accept.body.error}`)

  const b = cookieJar()
  await apiFetch(b, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `sprint4-b-${stamp}@example.com`,
      password: 'password-sprint4b',
      displayName: 'Sprint Four B',
    }),
  })
  const listB = await apiFetch(b, '/api/documents')
  assert(listB.res.ok, 'list B')
  assert(
    !(listB.body.documents || []).some((d) => d.id === docId),
    'document leaked to other user',
  )

  const connections = await apiFetch(a, '/api/connections')
  assert(connections.res.ok, 'connections')
  assert(
    (connections.body.connections || []).every(
      (c) => c.status === 'not_connected' || c.oauthConfigured,
    ),
    'connections should be honest',
  )
  const connect = await apiFetch(a, '/api/connections/gmail/connect', {
    method: 'POST',
    body: JSON.stringify({}),
  })
  assert(connect.res.status === 503, 'gmail connect should 503 without secrets')

  const del = await apiFetch(a, `/api/documents/${docId}`, { method: 'DELETE' })
  assert(del.res.ok, `delete: ${del.body.error}`)

  console.log(
    'Sprint 4 smoke OK: vault upload/process/review/accept, isolation, honest OAuth.',
  )
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
