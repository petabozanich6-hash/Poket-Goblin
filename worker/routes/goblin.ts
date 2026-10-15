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
