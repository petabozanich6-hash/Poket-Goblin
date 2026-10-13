import { Hono } from 'hono'

import type { CapacityMode } from '../../shared/types'
import type { Env } from '../env'
import { todayLocalFromOffset } from '../lib/datetime'
import { buildDailyPlan, getDailyPlan } from '../lib/plan'
import type { AuthUser } from '../lib/session'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const planRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

planRoutes.get('/today', async (c) => {
  const user = c.get('user')
  let plan = await getDailyPlan(c.env.DB, user.id)
  if (!plan) {
    const settings = await c.env.DB.prepare(
      `SELECT capacity_mode as capacityMode FROM user_settings WHERE user_id = ?`,
    )
      .bind(user.id)
      .first<{ capacityMode: CapacityMode }>()
    plan = await buildDailyPlan(
      c.env.DB,
      user.id,
      settings?.capacityMode ?? 'steady',
    )
  }
  return c.json({ plan })
})

planRoutes.post('/today', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const capacityMode = (asString(body?.capacityMode, 20) ??
    'steady') as CapacityMode
  if (!['goblin', 'steady', 'quest'].includes(capacityMode)) {
    return c.json({ error: 'Invalid capacity mode' }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE user_settings SET capacity_mode = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE user_id = ?`,
  )
    .bind(capacityMode, user.id)
    .run()

  const plan = await buildDailyPlan(c.env.DB, user.id, capacityMode)
  return c.json({ plan })
})

planRoutes.post('/today/add', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const taskId = asString(body?.taskId, 80)
  if (!taskId) return c.json({ error: 'taskId is required' }, 400)

  const owned = await c.env.DB.prepare(
    `SELECT id FROM tasks WHERE id = ? AND user_id = ? AND status = 'open'`,
  )
    .bind(taskId, user.id)
    .first()
  if (!owned) return c.json({ error: 'Task not found' }, 404)

  const tz =
    typeof body?.timezoneOffsetMinutes === 'number'
      ? Math.round(body.timezoneOffsetMinutes)
      : 0
  const planDate = todayLocalFromOffset(tz)
  let plan = await getDailyPlan(c.env.DB, user.id, planDate)
  if (!plan) {
    const settings = await c.env.DB.prepare(
      `SELECT capacity_mode as capacityMode FROM user_settings WHERE user_id = ?`,
    )
      .bind(user.id)
      .first<{ capacityMode: CapacityMode }>()
    plan = await buildDailyPlan(
      c.env.DB,
      user.id,
      settings?.capacityMode ?? 'steady',
      planDate,
    )
  }

  if (!plan.taskIds.includes(taskId)) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO daily_plan_tasks (plan_id, task_id, sort_order)
       VALUES (?, ?, ?)`,
    )
      .bind(plan.id, taskId, plan.taskIds.length)
      .run()
  }

  const refreshed = await getDailyPlan(c.env.DB, user.id, planDate)
  return c.json({ plan: refreshed })
})
