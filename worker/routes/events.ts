import { Hono } from 'hono'

import type { Env } from '../env'
import {
  addHoursIso,
  localDateTimeToIso,
  readOffsetMinutes,
} from '../lib/datetime'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const eventRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

function mapEvent(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? '',
    location: (row.location as string) ?? '',
    startsAt: row.startsAt as string,
    endsAt: row.endsAt as string,
    allDay: Boolean(row.allDay),
    timezone: (row.timezone as string) ?? 'local',
    categoryId: (row.categoryId as string) ?? null,
    linkedTaskId: (row.linkedTaskId as string) ?? null,
    recurrenceRuleId: (row.recurrenceRuleId as string) ?? null,
    seriesId: (row.seriesId as string) ?? null,
    status: row.status as 'scheduled' | 'cancelled',
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  }
}

const SELECT = `
  SELECT id, title, description, location,
         starts_at as startsAt, ends_at as endsAt, all_day as allDay,
         timezone, category_id as categoryId, linked_task_id as linkedTaskId,
         recurrence_rule_id as recurrenceRuleId, series_id as seriesId,
         status, created_at as createdAt, updated_at as updatedAt
  FROM events
`

eventRoutes.get('/', async (c) => {
  const user = c.get('user')
  const from = c.req.query('from')
  const to = c.req.query('to')
  let sql = `${SELECT} WHERE user_id = ? AND status = 'scheduled'`
  const binds: string[] = [user.id]
  if (from) {
    sql += ' AND starts_at >= ?'
    binds.push(from)
  }
  if (to) {
    sql += ' AND starts_at <= ?'
    binds.push(to)
  }
  sql += ' ORDER BY starts_at ASC LIMIT 200'
  const rows = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all()
  return c.json({ events: (rows.results ?? []).map((r) => mapEvent(r)) })
})

eventRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const title = asString(body?.title, 200)
  if (!title) return c.json({ error: 'Title is required' }, 400)

  const date =
    typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : null
  if (!date) return c.json({ error: 'A date is required' }, 400)

  const allDay = Boolean(body?.allDay)
  const startTime =
    typeof body?.startTime === 'string' && /^\d{2}:\d{2}$/.test(body.startTime)
      ? body.startTime
      : null
  if (!allDay && !startTime) {
    return c.json({ error: 'Start time is required for timed events' }, 400)
  }

  const offset = readOffsetMinutes(body)
  const startsAt = localDateTimeToIso(date, startTime, allDay, offset)
  const endTime =
    typeof body?.endTime === 'string' && /^\d{2}:\d{2}$/.test(body.endTime)
      ? body.endTime
      : null
  const endsAt = endTime
    ? localDateTimeToIso(date, endTime, false, offset)
    : addHoursIso(startsAt, allDay ? 24 : 1)

  const id = newId('evt')
  await c.env.DB.prepare(
    `INSERT INTO events
      (id, user_id, title, description, location, starts_at, ends_at, all_day, linked_task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      title,
      typeof body?.description === 'string'
        ? body.description.slice(0, 4000)
        : '',
      typeof body?.location === 'string' ? body.location.slice(0, 200) : '',
      startsAt,
      endsAt,
      allDay ? 1 : 0,
      typeof body?.linkedTaskId === 'string' ? body.linkedTaskId : null,
    )
    .run()

  const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()
  return c.json({ event: mapEvent(row!) }, 201)
})

eventRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare(
    `${SELECT} WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first()
  if (!existing) return c.json({ error: 'Event not found' }, 404)

  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const title =
    body?.title !== undefined
      ? asString(body.title, 200)
      : (existing.title as string)
  if (!title) return c.json({ error: 'Title is required' }, 400)

  let startsAt = existing.startsAt as string
  let endsAt = existing.endsAt as string
  let allDay = Boolean(existing.allDay)

  if (typeof body?.allDay === 'boolean') allDay = body.allDay
  if (typeof body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    const offset = readOffsetMinutes(body)
    const startTime = typeof body.startTime === 'string' ? body.startTime : null
    startsAt = localDateTimeToIso(body.date, startTime, allDay, offset)
    const endTime =
      typeof body?.endTime === 'string' && /^\d{2}:\d{2}$/.test(body.endTime)
        ? body.endTime
        : null
    endsAt = endTime
      ? localDateTimeToIso(body.date, endTime, false, offset)
      : addHoursIso(startsAt, allDay ? 24 : 1)
  }

  await c.env.DB.prepare(
    `UPDATE events SET title = ?, description = ?, location = ?,
      starts_at = ?, ends_at = ?, all_day = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      title,
      typeof body?.description === 'string'
        ? body.description.slice(0, 4000)
        : (existing.description as string),
      typeof body?.location === 'string'
        ? body.location.slice(0, 200)
        : (existing.location as string),
      startsAt,
      endsAt,
      allDay ? 1 : 0,
      id,
      user.id,
    )
    .run()

  const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()
  return c.json({ event: mapEvent(row!) })
})

eventRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    `UPDATE events SET status = 'cancelled',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Event not found' }, 404)
  return c.json({ ok: true })
})
