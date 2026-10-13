#!/usr/bin/env node
/**
 * Sprint 3 API smoke: intelligence interpret, breakdown, assist, memory, limits.
 * Requires `npm run dev` (API on 8787) after `npm run db:migrate:local`.
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

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
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
  return { res, body: await json(res) }
}

async function main() {
  const stamp = Date.now()
  const jar = cookieJar()
  const reg = await apiFetch(jar, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `sprint3-${stamp}@example.com`,
      password: 'password-sprint3',
      displayName: 'Sprint Three',
    }),
  })
  assert(reg.res.ok, `register: ${reg.body.error}`)

  const status = await apiFetch(jar, '/api/intelligence/status')
  assert(status.res.ok, `status: ${status.body.error}`)
  assert(
    status.body.aiConfigured === false || status.body.provider,
    'status shape',
  )

  const interpret = await apiFetch(jar, '/api/intelligence/interpret', {
    method: 'POST',
    body: JSON.stringify({
      text: 'Pay rent by Friday and buy milk.',
    }),
  })
  assert(interpret.res.ok, `interpret: ${interpret.body.error}`)
  assert(
    (interpret.body.result?.suggestions?.length ?? 0) >= 2,
    'expected multi suggestions',
  )
  assert(
    interpret.body.result.mode === 'rules',
    'expected rules mode without AI key',
  )

  const breakdown = await apiFetch(jar, '/api/intelligence/breakdown', {
    method: 'POST',
    body: JSON.stringify({ title: 'Sort out my taxes', level: 'tiny' }),
  })
  assert(breakdown.res.ok, `breakdown: ${breakdown.body.error}`)
  assert((breakdown.body.result?.steps?.length ?? 0) >= 2, 'expected steps')

  const accept = await apiFetch(jar, '/api/intelligence/breakdown/accept', {
    method: 'POST',
    body: JSON.stringify({
      parentTitle: 'Sort out my taxes',
      steps: breakdown.body.result.steps.slice(0, 2).map((s) => ({
        title: s.title,
      })),
    }),
  })
  assert(accept.res.ok, `accept breakdown: ${accept.body.error}`)

  const assist = await apiFetch(jar, '/api/intelligence/assist', {
    method: 'POST',
    body: JSON.stringify({ question: 'What do I need to do today?' }),
  })
  assert(assist.res.ok, `assist: ${assist.body.error}`)
  assert(assist.body.reply?.message, 'assist message missing')

  const mem = await apiFetch(jar, '/api/intelligence/memory', {
    method: 'POST',
    body: JSON.stringify({
      key: 'planning_style',
      value: 'Prefer tiny first steps',
    }),
  })
  assert(mem.res.ok, `memory: ${mem.body.error}`)
  const memId = mem.body.memory.id
  const del = await apiFetch(jar, `/api/intelligence/memory/${memId}`, {
    method: 'DELETE',
  })
  assert(del.res.ok, `memory delete: ${del.body.error}`)

  // Isolation: second user cannot see first user's memory list contents after delete anyway;
  // create a memory and ensure other user list empty of that key.
  const jarB = cookieJar()
  await apiFetch(jarB, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `sprint3-b-${stamp}@example.com`,
      password: 'password-sprint3b',
      displayName: 'Sprint Three B',
    }),
  })
  await apiFetch(jar, '/api/intelligence/memory', {
    method: 'POST',
    body: JSON.stringify({ key: 'secret_pref', value: 'only-a' }),
  })
  const memB = await apiFetch(jarB, '/api/intelligence/memory')
  assert(memB.res.ok, 'memory B')
  assert(
    !(memB.body.memories || []).some((m) => m.key === 'secret_pref'),
    'memory leaked across users',
  )

  console.log(
    'Sprint 3 smoke OK: interpret, breakdown, assist, memory, isolation (rules mode).',
  )
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
