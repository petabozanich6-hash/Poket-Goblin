import { Hono } from 'hono'

import type { Env } from '../env'
import { pushConfigured, safePushEndpoint } from '../lib/push'
import type { AuthUser, SessionInfo } from '../lib/session'

type Vars = { user: AuthUser; session: SessionInfo }
export const pushRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

pushRoutes.get('/status', async (c) => {
  const configured = pushConfigured(c.env)
  const session = c.get('session')
  const row = await c.env.DB.prepare(
    'SELECT 1 AS found FROM push_subscriptions WHERE user_id = ? AND session_id = ? LIMIT 1',
  )
    .bind(c.get('user').id, session.id)
    .first<{ found: number }>()
  c.header('Cache-Control', 'no-store')
  return c.json({
    configured,
    subscribed: Boolean(row),
    publicKey: configured ? c.env.VAPID_PUBLIC_KEY : null,
  })
})

pushRoutes.post('/subscriptions', async (c) => {
  if (!pushConfigured(c.env))
    return c.json({ error: 'Push notifications are not configured yet.' }, 503)
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const endpoint = safePushEndpoint(body?.endpoint)
  if (!endpoint) return c.json({ error: 'Invalid browser push endpoint' }, 400)
  const timezone =
    typeof body?.timezone === 'string' && body.timezone.length <= 80
      ? body.timezone
      : 'UTC'
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone })
  } catch {
    return c.json({ error: 'Invalid time zone' }, 400)
  }
  const user = c.get('user')
  const session = c.get('session')
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, session_id, timezone)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id,
         session_id = excluded.session_id, timezone = excluded.timezone,
         reminders_enabled = 1, messages_enabled = 1,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  )
    .bind(endpoint, user.id, session.id, timezone)
    .run()
  // Cap per account; endpoints are opaque credentials, never returned to clients.
  await c.env.DB.prepare(
    `DELETE FROM push_subscriptions
       WHERE user_id = ? AND endpoint NOT IN
       (SELECT endpoint FROM push_subscriptions WHERE user_id = ?
         ORDER BY updated_at DESC LIMIT 5)`,
  )
    .bind(user.id, user.id)
    .run()
  c.header('Cache-Control', 'no-store')
  return c.json({ subscribed: true }, 201)
})

pushRoutes.delete('/subscriptions', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const endpoint = safePushEndpoint(body?.endpoint)
  if (!endpoint) return c.json({ error: 'Invalid browser push endpoint' }, 400)
  await c.env.DB.prepare(
    'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ? AND session_id = ?',
  )
    .bind(endpoint, c.get('user').id, c.get('session').id)
    .run()
  return c.json({ subscribed: false })
})
