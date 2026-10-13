import { Hono } from 'hono'

import type { Env } from '../env'
import {
  addHoursIso,
  localDateTimeToIso,
  readOffsetMinutes,
} from '../lib/datetime'
import { newId } from '../lib/ids'
import { recordTaskHistory } from '../lib/history'
import type { AuthUser } from '../lib/session'
import { ensureDefaultShoppingList } from '../lib/shopping'
import { resolveCategoryId } from '../lib/tasks'
import { asString } from '../lib/validate'

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
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const item = await c.env.DB.prepare(
    `SELECT id, source_type as sourceType, source_id as sourceId,
            title, suggestion_type as suggestionType, payload_json as payloadJson,
            status
     FROM review_items WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first<{
      id: string
      sourceType: string
      sourceId: string | null
      title: string
      suggestionType: string
      payloadJson: string
      status: string
    }>()
  if (!item || !['pending', 'snoozed', 'edited'].includes(item.status)) {
    return c.json({ error: 'Item not found' }, 404)
  }

  const payload = JSON.parse(item.payloadJson || '{}') as Record<
    string,
    unknown
  >
  const title =
    asString(body?.title, 200) || asString(payload.title, 200) || item.title
  const type =
    asString(body?.type, 40) ||
    asString(payload.type, 40) ||
    item.suggestionType
  const dueDate =
    typeof body?.dueDate === 'string'
      ? body.dueDate
      : typeof payload.dueDate === 'string'
        ? payload.dueDate
        : null
  const offset = readOffsetMinutes(body)

  let createdId: string | null = null
  let createdKind = type

  if (type === 'shopping') {
    const listId = await ensureDefaultShoppingList(c.env.DB, user.id)
    createdId = newId('sitem')
    await c.env.DB.prepare(
      `INSERT INTO shopping_items (id, list_id, user_id, name, sort_order)
       VALUES (?, ?, ?, ?, 0)`,
    )
      .bind(createdId, listId, user.id, title)
      .run()
  } else if (type === 'note') {
    createdId = newId('note')
    const categoryId = await resolveCategoryId(
      c.env.DB,
      user.id,
      null,
      typeof payload.categorySlug === 'string' ? payload.categorySlug : null,
    )
    await c.env.DB.prepare(
      `INSERT INTO notes (id, user_id, title, body, category_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        createdId,
        user.id,
        title,
        typeof payload.details === 'string' ? payload.details : '',
        categoryId,
      )
      .run()
  } else if (type === 'appointment') {
    if (!dueDate) {
      return c.json(
        { error: 'Confirm a date before accepting this appointment' },
        400,
      )
    }
    createdId = newId('evt')
    const startTime =
      typeof body?.startTime === 'string'
        ? body.startTime
        : typeof payload.startTime === 'string'
          ? payload.startTime
          : null
    const startsAt = localDateTimeToIso(dueDate, startTime, !startTime, offset)
    await c.env.DB.prepare(
      `INSERT INTO events (id, user_id, title, starts_at, ends_at, all_day)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        createdId,
        user.id,
        title,
        startsAt,
        addHoursIso(startsAt, startTime ? 1 : 24),
        startTime ? 0 : 1,
      )
      .run()
  } else if (type === 'reminder' || type === 'follow_up') {
    if (!dueDate) {
      return c.json(
        { error: 'Confirm a date before accepting this reminder' },
        400,
      )
    }
    createdId = newId('rem')
    const remindAt = localDateTimeToIso(
      dueDate,
      typeof body?.startTime === 'string' ? body.startTime : '09:00',
      false,
      offset,
    )
    await c.env.DB.prepare(
      `INSERT INTO reminders (id, user_id, title, remind_at, entity_type)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        createdId,
        user.id,
        title,
        remindAt,
        type === 'follow_up' ? 'follow_up' : 'general',
      )
      .run()
  } else {
    createdId = newId('task')
    createdKind = 'task'
    const categoryId = await resolveCategoryId(
      c.env.DB,
      user.id,
      null,
      typeof payload.categorySlug === 'string' ? payload.categorySlug : null,
    )
    await c.env.DB.prepare(
      `INSERT INTO tasks
        (id, user_id, category_id, title, notes, priority, due_date, capacity_cost)
       VALUES (?, ?, ?, ?, ?, 'normal', ?, 2)`,
    )
      .bind(
        createdId,
        user.id,
        categoryId,
        title,
        typeof payload.details === 'string' ? payload.details : '',
        dueDate,
      )
      .run()
    await recordTaskHistory(
      c.env.DB,
      user.id,
      createdId,
      'created',
      'From inbox',
    )
  }

  if (item.sourceType === 'document' && item.sourceId && createdId) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO record_links
        (id, user_id, from_type, from_id, to_type, to_id, reason)
       VALUES (?, ?, 'document', ?, ?, ?, 'Accepted from review')`,
    )
      .bind(newId('link'), user.id, item.sourceId, createdKind, createdId)
      .run()
    if (createdKind === 'task') {
      await c.env.DB.prepare(
        `UPDATE documents SET linked_task_id = ? WHERE id = ? AND user_id = ?`,
      )
        .bind(createdId, item.sourceId, user.id)
        .run()
    }
  }

  await c.env.DB.prepare(
    `UPDATE review_items SET status = 'accepted',
      reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .run()

  return c.json({ ok: true, createdId, createdKind })
})
