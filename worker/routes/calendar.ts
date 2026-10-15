/**
 * Getting Pocket Goblin into any phone or computer calendar, without needing
 * a Google or Microsoft connection:
 *
 * - GET  /api/calendar/export.ics   a one-off download (signed in)
 * - GET  /api/calendar/feed         whether a live link is on (signed in)
 * - POST /api/calendar/feed         turn on / make a new private link
 * - DELETE /api/calendar/feed       turn the link off
 * - GET  /api/ics/:token.ics        the live feed calendar apps poll (public,
 *                                   the unguessable token is the key)
 */
import { Hono } from 'hono'

import type { Env } from '../env'
import { recordSecurityEvent } from '../lib/audit'
import { newId } from '../lib/ids'
import { buildCalendar, isTimeZone, loadCalendarItems } from '../lib/ics'
import { hashToken } from '../lib/passwords'
import { checkRateLimit } from '../lib/rateLimit'
import { getSecret, type AuthUser } from '../lib/session'

type Vars = { user: AuthUser }

export const calendarRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()
export const icsFeedRoutes = new Hono<{ Bindings: Env }>()

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const ICS_HEADERS = { 'Content-Type': 'text/calendar; charset=utf-8' }

calendarRoutes.get('/export.ics', async (c) => {
  const user = c.get('user')
  const tz = c.req.query('tz')
  const body = buildCalendar(await loadCalendarItems(c.env.DB, user.id), {
    timeZone: isTimeZone(tz) ? tz : 'UTC',
  })
  return c.body(body, 200, {
    ...ICS_HEADERS,
    'Content-Disposition': 'attachment; filename="pocket-goblin.ics"',
    'Cache-Control': 'no-store',
  })
})

calendarRoutes.get('/feed', async (c) => {
  const user = c.get('user')
  const row = await c.env.DB.prepare(
    `SELECT created_at as createdAt, last_used_at as lastUsedAt
     FROM calendar_feeds WHERE user_id = ?`,
  )
    .bind(user.id)
    .first<{ createdAt: string; lastUsedAt: string | null }>()
  return c.json({ feed: row ?? null })
})

calendarRoutes.post('/feed', async (c) => {
  const user = c.get('user')
  const limit = checkRateLimit(`calendar-feed:${user.id}`, 10, 60 * 60_000)
  if (!limit.ok) return c.json({ error: 'Too many new links. Try later.' }, 429)
  const body = (await c.req.json().catch(() => null)) as {
    timezone?: unknown
  } | null
  const tz = isTimeZone(body?.timezone) ? body.timezone : 'UTC'
  const token = randomToken()
  const tokenHash = await hashToken(token, getSecret(c.env))
  // One link per person: a new link replaces (and kills) the old one.
  await c.env.DB.prepare(
    `INSERT INTO calendar_feeds (id, user_id, token_hash, timezone)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       token_hash = excluded.token_hash,
       timezone = excluded.timezone,
       created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       last_used_at = NULL`,
  )
    .bind(newId('calf'), user.id, tokenHash, tz)
    .run()
  await recordSecurityEvent(c.env.DB, user.id, 'calendar_feed_created')
  const origin = new URL(c.req.url).origin
  const url = `${origin}/api/ics/${token}.ics`
  return c.json({ url, webcalUrl: url.replace(/^https?:/, 'webcal:') }, 201)
})

calendarRoutes.delete('/feed', async (c) => {
  const user = c.get('user')
  await c.env.DB.prepare(`DELETE FROM calendar_feeds WHERE user_id = ?`)
    .bind(user.id)
    .run()
  await recordSecurityEvent(c.env.DB, user.id, 'calendar_feed_revoked')
  return c.json({ ok: true })
})

icsFeedRoutes.get('/:file', async (c) => {
  const match = /^([A-Za-z0-9_-]{43})\.ics$/.exec(c.req.param('file'))
  if (!match) return c.text('Not found', 404)
  const tokenHash = await hashToken(match[1]!, getSecret(c.env))
  const feed = await c.env.DB.prepare(
    `SELECT f.user_id as userId, f.timezone, f.last_used_at as lastUsedAt
     FROM calendar_feeds f JOIN users u ON u.id = f.user_id
     WHERE f.token_hash = ? AND u.status = 'active'`,
  )
    .bind(tokenHash)
    .first<{ userId: string; timezone: string; lastUsedAt: string | null }>()
  if (!feed) return c.text('Not found', 404)
  const now = new Date()
  if (
    !feed.lastUsedAt ||
    now.getTime() - Date.parse(feed.lastUsedAt) > 60 * 60_000
  ) {
    await c.env.DB.prepare(
      `UPDATE calendar_feeds SET last_used_at = ? WHERE token_hash = ?`,
    )
      .bind(now.toISOString(), tokenHash)
      .run()
  }
  const body = buildCalendar(
    await loadCalendarItems(c.env.DB, feed.userId, now),
    { timeZone: isTimeZone(feed.timezone) ? feed.timezone : 'UTC', now },
  )
  return c.body(body, 200, {
    ...ICS_HEADERS,
    'Cache-Control': 'private, max-age=900',
    'X-Robots-Tag': 'noindex',
  })
})
