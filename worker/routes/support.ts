import { Hono } from 'hono'
import type { Env } from '../env'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'
import { allowedOrigin } from '../lib/cors'

type Vars = { user: AuthUser }
type Reply = {
  id: string
  author: 'owner' | 'user'
  body: string
  createdAt: string
}
type Thread = {
  id: string
  category: string
  subject: string
  message: string
  status: string
  unreadForUser: number
  createdAt: string
  updatedAt: string
}

export const supportRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

supportRoutes.use('*', async (c, next) => {
  if (c.req.method !== 'GET') {
    const origin = c.req.header('Origin')
    if (origin && !allowedOrigin(origin, c.env.ENVIRONMENT)) {
      return c.json({ error: 'Request blocked' }, 403)
    }
    const site = c.req.header('Sec-Fetch-Site')
    if (site && site !== 'same-origin')
      return c.json({ error: 'Request blocked' }, 403)
  }
  c.header('Cache-Control', 'no-store')
  return next()
})

supportRoutes.get('/unread', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM support_threads WHERE user_id = ? AND unread_for_user = 1',
  )
    .bind(c.get('user').id)
    .first<{ n: number }>()
  // The reply id lets the client distinguish a genuinely new message from
  // one already acknowledged in this browser session.
  const latest = await c.env.DB.prepare(
    `SELECT r.id FROM support_replies r
     JOIN support_threads t ON t.id = r.thread_id
     WHERE t.user_id = ? AND t.unread_for_user = 1 AND r.author = 'owner'
     ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
  )
    .bind(c.get('user').id)
    .first<{ id: string }>()
  return c.json({
    unread: Number(row?.n ?? 0),
    latestReplyId: latest?.id ?? null,
  })
})

supportRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, category, subject, message, status, unread_for_user AS unreadForUser,
            created_at AS createdAt, updated_at AS updatedAt
     FROM support_threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 60`,
  )
    .bind(c.get('user').id)
    .all<Thread>()
  const reports = await Promise.all(
    (rows.results ?? []).map(async (r) => {
      const replies = await c.env.DB.prepare(
        'SELECT id, author, body, created_at AS createdAt FROM support_replies WHERE thread_id = ? ORDER BY created_at ASC',
      )
        .bind(r.id)
        .all<Reply>()
      return { ...r, replies: replies.results ?? [] }
    }),
  )
  return c.json({ reports })
})

supportRoutes.post('/', async (c) => {
  const data: unknown = await c.req.json().catch(() => null)
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return c.json({ error: 'Invalid message' }, 400)
  const body = data as Record<string, unknown>
  const category = body.category
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (
    !['problem', 'idea', 'feedback'].includes(String(category)) ||
    subject.length < 4 ||
    subject.length > 120 ||
    message.length < 10 ||
    message.length > 4000
  ) {
    return c.json(
      {
        error:
          'Choose a category, a 4–120 character subject and a 10–4000 character message.',
      },
      400,
    )
  }
  const id = newId('support')
  await c.env.DB.prepare(
    'INSERT INTO support_threads (id, user_id, category, subject, message) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, c.get('user').id, category, subject, message)
    .run()
  return c.json({ id, status: 'received' }, 201)
})

supportRoutes.post('/:id/read', async (c) => {
  const result = await c.env.DB.prepare(
    'UPDATE support_threads SET unread_for_user = 0 WHERE id = ? AND user_id = ?',
  )
    .bind(c.req.param('id'), c.get('user').id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

supportRoutes.post('/:id/reply', async (c) => {
  const data: unknown = await c.req.json().catch(() => null)
  const body =
    data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {}
  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (message.length < 2 || message.length > 4000)
    return c.json({ error: 'Reply must be 2–4000 characters' }, 400)
  const own = await c.env.DB.prepare(
    'SELECT id FROM support_threads WHERE id = ? AND user_id = ?',
  )
    .bind(c.req.param('id'), c.get('user').id)
    .first()
  if (!own) return c.json({ error: 'Not found' }, 404)
  await c.env.DB.batch([
    c.env.DB.prepare(
      'INSERT INTO support_replies (id, thread_id, author, body) VALUES (?, ?, ?, ?)',
    ).bind(newId('sr'), c.req.param('id'), 'user', message),
    c.env.DB.prepare(
      "UPDATE support_threads SET unread_for_owner = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND user_id = ?",
    ).bind(c.req.param('id'), c.get('user').id),
  ])
  return c.json({ ok: true })
})
