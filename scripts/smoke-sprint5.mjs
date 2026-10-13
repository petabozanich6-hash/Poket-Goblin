/**
 * Smoke test Sprint 5 magical endpoints against local API.
 * Usage: node scripts/smoke-sprint5.mjs
 * Requires API on :8787 with migrated local D1.
 */
const API = process.env.API_BASE ?? 'http://127.0.0.1:8787/api'
const email = `smoke5_${Date.now()}@example.com`
const password = 'SmokeTest5!ok'
const displayName = 'Smoke Five'

function jar() {
  const cookies = new Map()
  return {
    store(res) {
      const raw = res.headers.getSetCookie?.() ?? []
      for (const line of raw) {
        const [pair] = line.split(';')
        const [k, v] = pair.split('=')
        cookies.set(k, v)
      }
    },
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    },
  }
}

const cookies = jar()

async function req(path, init = {}) {
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
  if (!res.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} → ${res.status} ${JSON.stringify(data)}`,
    )
  }
  return data
}

async function main() {
  await req('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  })

  const me = await req('/me')
  if (me.settings.quietHoursEnabled === undefined) {
    throw new Error('settings missing Sprint 5 fields')
  }

  await req('/me/settings', {
    method: 'PATCH',
    body: JSON.stringify({
      quietHoursEnabled: true,
      nudgeFrequency: 'quiet',
      dailyBriefingEnabled: true,
    }),
  })

  const task = await req('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title: 'Clean the kitchen',
      priority: 'high',
      dueDate: new Date().toISOString().slice(0, 10),
    }),
  })

  const tz = new Date().getTimezoneOffset()
  const briefing = await req(`/magical/briefing?tz=${tz}`)
  if (!briefing.briefing?.body) throw new Error('briefing missing body')
  if (briefing.briefing.mode !== 'rules')
    throw new Error('expected rules briefing')

  const tiny = await req('/magical/tiny-step', {
    method: 'POST',
    body: JSON.stringify({ title: 'Clean the kitchen' }),
  })
  if (!tiny.steps?.length) throw new Error('tiny step empty')

  await req('/magical/tiny-step/accept', {
    method: 'POST',
    body: JSON.stringify({
      parentId: task.task.id,
      title: tiny.steps[0].title,
    }),
  })

  const rescue = await req('/magical/rescue', {
    method: 'POST',
    body: JSON.stringify({ timezoneOffsetMinutes: tz }),
  })
  if (!rescue.rescueId || !rescue.suggestion) throw new Error('rescue failed')

  await req('/magical/rescue/accept', {
    method: 'POST',
    body: JSON.stringify({
      rescueId: rescue.rescueId,
      keepTaskIds: rescue.suggestion.keep.map((k) => k.task.id),
    }),
  })

  const priorities = await req(`/magical/priorities?tz=${tz}`)
  if (!Array.isArray(priorities.items)) throw new Error('priorities missing')

  const nudges = await req(`/magical/nudges?tz=${tz}`)
  if (typeof nudges.quiet !== 'boolean') throw new Error('nudges shape')

  const search = await req(`/search?q=${encodeURIComponent('kitchen')}`)
  if (!search.groups?.some((g) => g.type === 'task')) {
    throw new Error('search should find kitchen task')
  }

  console.log('smoke-sprint5 OK', {
    email,
    briefing: briefing.briefing.headline,
    tiny: tiny.steps[0].title,
    keep: rescue.suggestion.keep.length,
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
