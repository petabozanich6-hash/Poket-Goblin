import { Hono } from 'hono'

import type { CapacityMode } from '../../shared/types'
import type { Env } from '../env'
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
