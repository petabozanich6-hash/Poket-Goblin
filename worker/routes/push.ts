import { Hono } from 'hono'

import type { Env } from '../env'
import {
  describeNotice,
  loadPrefs,
  pushTablesReady,
  savePrefs,
  validTime,
  validTimezone,
  type NoticeKind,
  type PushPreferences,
  type ShownNotice,
} from '../lib/push/notices'
import { isPushEndpoint, loadVapid, sendEmptyPush } from '../lib/push/vapid'
import { checkRateLimit } from '../lib/rateLimit'
import type { AuthUser, SessionInfo } from '../lib/session'

type Vars = { user: AuthUser; session: SessionInfo }

export const pushRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

/** Devices per account; the oldest is forgotten beyond this. */
const MAX_DEVICES = 10

pushRoutes.use('*', async (c, next) => {
  if (await pushTablesReady(c.env.DB)) return next()
  if (c.req.method === 'GET' && c.req.path.endsWith('/push'))
    return c.json({ available: false, configured: false })
  // The service worker asks for notices; nothing to show yet.
  if (c.req.method === 'GET') return c.json({ notices: [] })
  return c.json({ error: 'Notifications aren’t available yet.' }, 503)
})

pushRoutes.get('/', async (c) => {
  const user = c.get('user')
  const vapid = await loadVapid(c.env)
  const devices = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?',
  )
    .bind(user.id)
    .first<{ n: number }>()
  return c.json({
    available: true,
    configured: !!vapid,
    publicKey: vapid?.publicKey ?? null,
    preferences: await loadPrefs(c.env.DB, user.id),
    devices: Number(devices?.n ?? 0),
  })
})

const readBody = async (c: { req: { json: () => Promise<unknown> } }) =>
  ((await c.req.json().catch(() => null)) ?? {}) as Record<string, unknown>

/** Turn on (or refresh) this device. Re-sent on every app open, so a new
 * sign-in quietly moves the device to the new session. */
pushRoutes.post('/subscriptions', async (c) => {
  const user = c.get('user')
  const body = await readBody(c)
  if (!isPushEndpoint(body.endpoint)) {
    return c.json(
      { error: 'This browser’s notification service isn’t supported.' },
      400,
    )
  }
  if (!(await loadVapid(c.env))) {
    return c.json({ error: 'Notifications aren’t switched on yet.' }, 503)
  }
  const limit = checkRateLimit(`push-sub:${user.id}`, 30, 60_000)
  if (!limit.ok) return c.json({ error: 'Please try again shortly.' }, 429)
  const timezone = validTimezone(body.timezone) ?? 'UTC'
  const db = c.env.DB
  await db.batch([
    db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, user_id, session_id, timezone, last_notice_seq)
         VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(seq), 0) FROM push_notices WHERE user_id = ?))
         ON CONFLICT(endpoint) DO UPDATE SET
           last_notice_seq = CASE WHEN push_subscriptions.user_id = excluded.user_id
             THEN push_subscriptions.last_notice_seq ELSE excluded.last_notice_seq END,
           user_id = excluded.user_id, session_id = excluded.session_id,
           timezone = excluded.timezone,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .bind(body.endpoint, user.id, c.get('session').id, timezone, user.id),
    db
      .prepare(
        `INSERT INTO push_preferences (user_id, timezone) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET timezone = excluded.timezone,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      )
      .bind(user.id, timezone),
    db
      .prepare(
        `DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint NOT IN (
           SELECT endpoint FROM push_subscriptions WHERE user_id = ?
           ORDER BY updated_at DESC LIMIT ${MAX_DEVICES})`,
      )
      .bind(user.id, user.id),
  ])
  return c.json({ ok: true, preferences: await loadPrefs(db, user.id) }, 201)
})

pushRoutes.delete('/subscriptions', async (c) => {
  const body = await readBody(c)
  if (typeof body.endpoint === 'string') {
    await c.env.DB.prepare(
      'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
    )
      .bind(body.endpoint, c.get('user').id)
      .run()
  }
  return c.json({ ok: true })
})

pushRoutes.patch('/preferences', async (c) => {
  const body = await readBody(c)
  const patch: Partial<PushPreferences> = {}
  for (const key of [
    'remindersEnabled',
    'messagesEnabled',
    'morningEnabled',
    'eveningEnabled',
  ] as const) {
    if (body[key] === undefined) continue
    if (typeof body[key] !== 'boolean')
      return c.json({ error: 'Choose on or off.' }, 400)
    patch[key] = body[key]
  }
  for (const key of ['morningTime', 'eveningTime'] as const) {
    if (body[key] === undefined) continue
    const time = validTime(body[key])
    if (!time) return c.json({ error: 'Choose a time like 08:00.' }, 400)
    patch[key] = time
  }
  if (body.timezone !== undefined) {
    const tz = validTimezone(body.timezone)
    if (!tz) return c.json({ error: 'Unknown time zone.' }, 400)
    patch.timezone = tz
  }
  return c.json({
    preferences: await savePrefs(c.env.DB, c.get('user').id, patch),
  })
})

/** A sample notification on every device, straight away. */
pushRoutes.post('/test', async (c) => {
  const user = c.get('user')
  const vapid = await loadVapid(c.env)
  if (!vapid)
    return c.json({ error: 'Notifications aren’t switched on yet.' }, 503)
  const limit = checkRateLimit(`push-test:${user.id}`, 5, 10 * 60_000)
  if (!limit.ok)
    return c.json({ error: 'That’s plenty of tests for now.' }, 429)
  const db = c.env.DB
  const { results } = await db
    .prepare('SELECT endpoint FROM push_subscriptions WHERE user_id = ?')
    .bind(user.id)
    .all<{ endpoint: string }>()
  const endpoints = (results ?? []).map((r) => r.endpoint)
  if (!endpoints.length)
    return c.json(
      { error: 'Turn notifications on for this device first.' },
      409,
    )
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO push_notices (user_id, kind, ref, pushed_at) VALUES (?, 'test', ?, ?)`,
    )
    .bind(user.id, now, now)
    .run()
  const outcomes = await Promise.all(
    endpoints.map((e) => sendEmptyPush(vapid, e, 'high')),
  )
  const gone = endpoints.filter((_, i) => outcomes[i] === 'gone')
  for (const endpoint of gone) {
    await db
      .prepare('DELETE FROM push_subscriptions WHERE endpoint = ?')
      .bind(endpoint)
      .run()
  }
  return c.json({
    sent: outcomes.filter((o) => o === 'sent').length,
    devices: endpoints.length - gone.length,
  })
})

/**
 * The service worker's question after a push: "what should I show?"
 * Each device gets each notice once, even if it is woken twice.
 */
pushRoutes.get('/notices', async (c) => {
  const user = c.get('user')
  const db = c.env.DB
  const endpoint = c.req.query('endpoint') ?? ''
  const device = endpoint
    ? await db
        .prepare(
          'SELECT last_notice_seq AS lastSeq FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
        )
        .bind(endpoint, user.id)
        .first<{ lastSeq: number }>()
    : null
  const rows = device
    ? await db
        .prepare(
          `SELECT seq, kind, ref FROM push_notices
           WHERE user_id = ? AND seq > ? AND pushed_at IS NOT NULL
           ORDER BY seq LIMIT 5`,
        )
        .bind(user.id, device.lastSeq)
        .all<{ seq: number; kind: NoticeKind; ref: string }>()
    : await db
        .prepare(
          `SELECT seq, kind, ref FROM push_notices
           WHERE user_id = ? AND pushed_at >= ?
           ORDER BY seq DESC LIMIT 3`,
        )
        .bind(user.id, new Date(Date.now() - 10 * 60_000).toISOString())
        .all<{ seq: number; kind: NoticeKind; ref: string }>()
  const list = rows.results ?? []
  if (device && list.length) {
    await db
      .prepare(
        'UPDATE push_subscriptions SET last_notice_seq = ? WHERE endpoint = ? AND user_id = ?',
      )
      .bind(Math.max(...list.map((n) => n.seq)), endpoint, user.id)
      .run()
  }
  const notices: ShownNotice[] = []
  for (const n of list) {
    const shown = await describeNotice(db, user, n)
    if (shown) notices.push(shown)
  }
  c.header('Cache-Control', 'no-store')
  return c.json({ notices })
})
