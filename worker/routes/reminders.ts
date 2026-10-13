import { Hono } from 'hono'

import type { Env } from '../env'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const reminderRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

function mapReminder(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    title: row.title as string,
    remindAt: row.remindAt as string,
    status: row.status as string,
    entityType: row.entityType as string,
    entityId: (row.entityId as string) ?? null,
    repeatFrequency: row.repeatFrequency as string,
    snoozedUntil: (row.snoozedUntil as string) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
  }
}

const SELECT = `
  SELECT id, title, remind_at as remindAt, status,
         entity_type as entityType, entity_id as entityId,
         repeat_frequency as repeatFrequency, snoozed_until as snoozedUntil,
         created_at as createdAt, updated_at as updatedAt
  FROM reminders
`

reminderRoutes.get('/', async (c) => {
  const user = c.get('user')
  const status = c.req.query('status') ?? 'pending'
  let sql = `${SELECT} WHERE user_id = ?`
  const binds: string[] = [user.id]
  if (status !== 'all') {
    sql += ' AND status = ?'
    binds.push(status)
  }
  sql += ' ORDER BY remind_at ASC LIMIT 100'
  const rows = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all()
  return c.json({ reminders: (rows.results ?? []).map((r) => mapReminder(r)) })
})

reminderRoutes.get('/due', async (c) => {
  const user = c.get('user')
  const now = new Date().toISOString()
  const rows = await c.env.DB.prepare(
    `${SELECT} WHERE user_id = ? AND status IN ('pending', 'snoozed')
     AND (
       (status = 'pending' AND remind_at <= ?)
       OR (status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?)
     )
     ORDER BY remind_at ASC LIMIT 50`,
  )
    .bind(user.id, now, now)
    .all()
  return c.json({ reminders: (rows.results ?? []).map((r) => mapReminder(r)) })
})

reminderRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const title = asString(body?.title, 200)
  const remindAt = asString(body?.remindAt, 40)
  if (!title || !remindAt) {
    return c.json({ error: 'Title and remindAt are required' }, 400)
  }

  const id = newId('rem')
  await c.env.DB.prepare(
    `INSERT INTO reminders
      (id, user_id, title, remind_at, entity_type, entity_id, repeat_frequency)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      title,
      remindAt,
      typeof body?.entityType === 'string' ? body.entityType : 'general',
      typeof body?.entityId === 'string' ? body.entityId : null,
      typeof body?.repeatFrequency === 'string' ? body.repeatFrequency : 'none',
    )
    .run()

  const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()
  return c.json({ reminder: mapReminder(row!) }, 201)
})

reminderRoutes.post('/:id/snooze', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const minutes =
    typeof body?.minutes === 'number' && body.minutes > 0 ? body.minutes : 60
  const until = new Date(Date.now() + minutes * 60_000).toISOString()

  const result = await c.env.DB.prepare(
    `UPDATE reminders SET status = 'snoozed', snoozed_until = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ? AND status IN ('pending', 'snoozed')`,
  )
    .bind(until, id, user.id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Reminder not found' }, 404)

  const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()
  return c.json({ reminder: mapReminder(row!) })
})

reminderRoutes.post('/:id/dismiss', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    `UPDATE reminders SET status = 'dismissed',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Reminder not found' }, 404)
  return c.json({ ok: true })
})

reminderRoutes.post('/:id/complete', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    `UPDATE reminders SET status = 'completed',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Reminder not found' }, 404)
  return c.json({ ok: true })
})
