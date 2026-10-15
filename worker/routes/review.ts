import { Hono } from 'hono'

import type { Env } from '../env'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'
import { acceptReviewItem } from '../lib/reviewAccept'

type Vars = { user: AuthUser }

export const reviewRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

reviewRoutes.get('/', async (c) => {
  const user = c.get('user')
  const status = c.req.query('status') ?? 'pending'
  let sql = `
    SELECT id, source_type as sourceType, source_id as sourceId,
           title, summary, suggestion_type as suggestionType,
           payload_json as payloadJson, status, uncertain,
           snoozed_until as snoozedUntil, created_at as createdAt,
           reviewed_at as reviewedAt
    FROM review_items WHERE user_id = ?`
  const binds: string[] = [user.id]
  if (status !== 'all') {
    sql += ' AND status = ?'
    binds.push(status)
  }
  sql += ' ORDER BY created_at DESC LIMIT 100'
  const rows = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all()

  return c.json({
    items: (rows.results ?? []).map((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      title: row.title,
      summary: row.summary,
      suggestionType: row.suggestionType,
      payload:
        typeof row.payloadJson === 'string'
          ? JSON.parse(row.payloadJson as string)
          : {},
      status: row.status,
      uncertain: Boolean(row.uncertain),
      snoozedUntil: row.snoozedUntil,
      createdAt: row.createdAt,
      reviewedAt: row.reviewedAt,
    })),
  })
})

reviewRoutes.post('/from-capture/:captureId', async (c) => {
  const user = c.get('user')
  const captureId = c.req.param('captureId')
  const capture = await c.env.DB.prepare(
    `SELECT id, raw_text as rawText FROM captures WHERE id = ? AND user_id = ?`,
  )
    .bind(captureId, user.id)
    .first<{ id: string; rawText: string }>()
  if (!capture) return c.json({ error: 'Capture not found' }, 404)

  const items = await c.env.DB.prepare(
    `SELECT id, kind, title, due_date as dueDate, start_time as startTime,
            category_slug as categorySlug, uncertain, status
     FROM capture_items WHERE capture_id = ? AND user_id = ? AND status = 'suggested'`,
  )
    .bind(captureId, user.id)
    .all()

  let created = 0
  for (const item of items.results ?? []) {
    const existing = await c.env.DB.prepare(
      `SELECT id FROM review_items
       WHERE user_id = ? AND source_type = 'capture' AND source_id = ?
         AND title = ? AND status = 'pending'`,
    )
      .bind(user.id, item.id, item.title)
      .first()
    if (existing) continue
    await c.env.DB.prepare(
      `INSERT INTO review_items
        (id, user_id, source_type, source_id, title, summary, suggestion_type,
         payload_json, uncertain)
       VALUES (?, ?, 'capture', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId('rev'),
        user.id,
        item.id as string,
        item.title as string,
        capture.rawText.slice(0, 200),
        item.kind as string,
        JSON.stringify(item),
        item.uncertain ? 1 : 0,
      )
      .run()
    created += 1
  }
  return c.json({ created })
})

reviewRoutes.post('/:id/dismiss', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    `UPDATE review_items SET status = 'dismissed',
      reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ? AND status IN ('pending', 'snoozed')`,
  )
    .bind(id, user.id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Item not found' }, 404)
  // Skipped in the Inbox means skipped in Capture too.
  await c.env.DB.prepare(
    `UPDATE capture_items SET status = 'rejected'
     WHERE user_id = ? AND status = 'suggested' AND id = (
       SELECT source_id FROM review_items
       WHERE id = ? AND user_id = ? AND source_type = 'capture'
     )`,
  )
    .bind(user.id, id, user.id)
    .run()
  return c.json({ ok: true })
})

reviewRoutes.post('/:id/snooze', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const hours =
    typeof body?.hours === 'number' && body.hours > 0 ? body.hours : 24
  const until = new Date(Date.now() + hours * 3600_000).toISOString()
  const result = await c.env.DB.prepare(
    `UPDATE review_items SET status = 'snoozed', snoozed_until = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ? AND status IN ('pending', 'snoozed')`,
  )
    .bind(until, id, user.id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Item not found' }, 404)
  return c.json({ ok: true, snoozedUntil: until })
})

reviewRoutes.post('/:id/accept', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const result = await acceptReviewItem(
    c.env.DB,
    user.id,
    c.req.param('id'),
    body,
  )
  return c.json(result.body, result.status)
})
