/**
 * The action-taking Goblin (/api/goblin): understand an utterance against
 * the user's own records, act on safe things with Undo, ask about the rest.
 */
import { Hono } from 'hono'

import type { Env } from '../env'
import { readOffsetMinutes } from '../lib/datetime'
import {
  actOnText,
  confirmAction,
  declineAction,
  undoAction,
} from '../lib/goblin/act'
import {
  validateExpression,
  validateProfilePatch,
} from '../../shared/goblin/profile'
import { converse } from '../lib/goblin/converse'
import {
  addExpression,
  deleteExpression,
  listExpressions,
  loadProfile,
  resetPersonalisation,
  saveProfile,
  updateExpression,
} from '../lib/goblin/profile'
import { checkRateLimit } from '../lib/rateLimit'
import type { AuthUser } from '../lib/session'

type Vars = { user: AuthUser }

export const goblinRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

goblinRoutes.post('/act', async (c) => {
  const user = c.get('user')
  const limit = checkRateLimit(`goblin-act:${user.id}`, 60, 60_000)
  if (!limit.ok)
    return c.json(
      { error: 'Slow down a moment — the goblin is catching up.' },
      429,
    )
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const text =
    typeof body?.text === 'string' ? body.text.trim().slice(0, 2000) : ''
  if (!text) return c.json({ error: 'Tell the goblin something first.' }, 400)
  const result = await actOnText(
    c.env.DB,
    user.id,
    text,
    readOffsetMinutes(body),
  )
  return c.json(result)
})

goblinRoutes.post('/actions/:id/undo', async (c) => {
  const result = await undoAction(c.env.DB, c.get('user').id, c.req.param('id'))
  return result.ok ? c.json(result) : c.json({ error: result.error }, 409)
})

goblinRoutes.post('/actions/:id/confirm', async (c) => {
  const result = await confirmAction(
    c.env.DB,
    c.get('user').id,
    c.req.param('id'),
  )
  return result.ok ? c.json(result) : c.json({ error: result.error }, 409)
})

goblinRoutes.post('/actions/:id/decline', async (c) => {
  const result = await declineAction(
    c.env.DB,
    c.get('user').id,
    c.req.param('id'),
  )
  return result.ok ? c.json(result) : c.json({ error: result.error }, 409)
})

// ------------------------------------------------- talking to the Goblin

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/
// Thoughts captured offline are understood as of when they were said, but
// only within a week (older relative dates would be misleading).
const MAX_OFFLINE_AGE_MS = 7 * 86_400_000

/**
 * One conversational turn (voice or typed). Replays of the same requestId
 * return the first answer instead of acting twice.
 */
goblinRoutes.post('/converse', async (c) => {
  const user = c.get('user')
  const limit = checkRateLimit(`goblin-converse:${user.id}`, 60, 60_000)
  if (!limit.ok)
    return c.json(
      { error: 'Slow down a moment — the goblin is catching up.' },
      429,
    )
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const text =
    typeof body?.text === 'string' ? body.text.trim().slice(0, 2000) : ''
  if (!text) return c.json({ error: 'Tell the goblin something first.' }, 400)
  const requestId =
    typeof body?.requestId === 'string' && REQUEST_ID.test(body.requestId)
      ? body.requestId
      : null
  const offline = body?.source === 'offline'
  let now = new Date()
  if (offline && typeof body?.capturedAt === 'string') {
    const at = new Date(body.capturedAt)
    if (
      !Number.isNaN(at.getTime()) &&
      at.getTime() <= now.getTime() &&
      now.getTime() - at.getTime() <= MAX_OFFLINE_AGE_MS
    )
      now = at
  }

  if (requestId) {
    const claim = await c.env.DB.prepare(
      `INSERT INTO goblin_requests (user_id, request_id) VALUES (?, ?)
       ON CONFLICT(user_id, request_id) DO NOTHING`,
    )
      .bind(user.id, requestId)
      .run()
    if (!claim.meta.changes) {
      const prior = await c.env.DB.prepare(
        `SELECT response_json as json FROM goblin_requests WHERE user_id = ? AND request_id = ?`,
      )
        .bind(user.id, requestId)
        .first<{ json: string | null }>()
      if (prior?.json)
        return c.json({ ...JSON.parse(prior.json), replayed: true })
      return c.json(
        { error: 'Still working on that one.', code: 'in_progress' },
        409,
      )
    }
  }
  try {
    const result = await converse(c.env.DB, user.id, {
      text,
      offset: readOffsetMinutes(body),
      now,
      live: !offline,
    })
    if (requestId)
      await c.env.DB.prepare(
        `UPDATE goblin_requests SET response_json = ? WHERE user_id = ? AND request_id = ?`,
      )
        .bind(JSON.stringify(result), user.id, requestId)
        .run()
    return c.json(result)
  } catch (error) {
    // Let a retry try again instead of being stuck "in progress".
    if (requestId)
      await c.env.DB.prepare(
        `DELETE FROM goblin_requests WHERE user_id = ? AND request_id = ?`,
      )
        .bind(user.id, requestId)
        .run()
    throw error
  }
})

// ------------------------------------------- Get to Know Your Goblin

goblinRoutes.get('/profile', async (c) => {
  const user = c.get('user')
  const [profile, expressions] = await Promise.all([
    loadProfile(c.env.DB, user.id),
    listExpressions(c.env.DB, user.id),
  ])
  return c.json({ profile, expressions })
})

goblinRoutes.patch('/profile', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  if (!body) return c.json({ error: 'Nothing to change.' }, 400)
  const checked = validateProfilePatch(body)
  if (!checked.ok) return c.json({ error: checked.error }, 400)
  const profile = await saveProfile(c.env.DB, c.get('user').id, checked.patch)
  return c.json({ profile })
})

goblinRoutes.delete('/profile', async (c) => {
  await resetPersonalisation(c.env.DB, c.get('user').id)
  return c.json({
    ok: true,
    profile: await loadProfile(c.env.DB, c.get('user').id),
    expressions: [],
  })
})

goblinRoutes.post('/expressions', async (c) => {
  const checked = validateExpression(
    (await c.req.json().catch(() => null)) as Record<string, unknown> | null,
  )
  if (!checked.ok) return c.json({ error: checked.error }, 400)
  const res = await addExpression(
    c.env.DB,
    c.get('user').id,
    checked.phrase,
    checked.meaning,
  )
  return res.ok ? c.json(res, 201) : c.json({ error: res.error }, 400)
})

goblinRoutes.patch('/expressions/:id', async (c) => {
  const checked = validateExpression(
    (await c.req.json().catch(() => null)) as Record<string, unknown> | null,
  )
  if (!checked.ok) return c.json({ error: checked.error }, 400)
  const ok = await updateExpression(
    c.env.DB,
    c.get('user').id,
    c.req.param('id'),
    checked.phrase,
    checked.meaning,
  )
  return ok ? c.json({ ok }) : c.json({ error: 'Not found' }, 404)
})

goblinRoutes.delete('/expressions/:id', async (c) => {
  const ok = await deleteExpression(
    c.env.DB,
    c.get('user').id,
    c.req.param('id'),
  )
  return ok ? c.json({ ok }) : c.json({ error: 'Not found' }, 404)
})
