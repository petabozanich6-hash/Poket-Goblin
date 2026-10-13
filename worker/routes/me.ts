import { Hono } from 'hono'

import type { CapacityMode, ThemePreference } from '../../shared/types'
import type { Env } from '../env'
import type { AuthUser } from '../lib/session'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const meRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

meRoutes.get('/', async (c) => {
  const user = c.get('user')
  const settings = await c.env.DB.prepare(
    `SELECT capacity_mode as capacityMode, theme, gamification_enabled as gamificationEnabled
     FROM user_settings WHERE user_id = ?`,
  )
    .bind(user.id)
    .first<{
      capacityMode: CapacityMode
      theme: ThemePreference
      gamificationEnabled: number
    }>()

  return c.json({
    user,
    settings: {
      capacityMode: settings?.capacityMode ?? 'steady',
      theme: settings?.theme ?? 'system',
      gamificationEnabled: Boolean(settings?.gamificationEnabled ?? 1),
    },
  })
})

meRoutes.patch('/settings', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null

  const capacityMode = asString(body?.capacityMode, 20) as CapacityMode | null
  const theme = asString(body?.theme, 20) as ThemePreference | null
  const gamificationEnabled =
    typeof body?.gamificationEnabled === 'boolean'
      ? body.gamificationEnabled
      : null

  if (capacityMode && !['goblin', 'steady', 'quest'].includes(capacityMode)) {
    return c.json({ error: 'Invalid capacity mode' }, 400)
  }
  if (theme && !['light', 'dark', 'system'].includes(theme)) {
    return c.json({ error: 'Invalid theme' }, 400)
  }

  const current = await c.env.DB.prepare(
    `SELECT capacity_mode as capacityMode, theme, gamification_enabled as gamificationEnabled
     FROM user_settings WHERE user_id = ?`,
  )
    .bind(user.id)
    .first<{
      capacityMode: CapacityMode
      theme: ThemePreference
      gamificationEnabled: number
    }>()

  const next = {
    capacityMode: capacityMode ?? current?.capacityMode ?? 'steady',
    theme: theme ?? current?.theme ?? 'system',
    gamificationEnabled:
      gamificationEnabled ?? Boolean(current?.gamificationEnabled ?? 1),
  }

  await c.env.DB.prepare(
    `UPDATE user_settings
     SET capacity_mode = ?, theme = ?, gamification_enabled = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE user_id = ?`,
  )
    .bind(
      next.capacityMode,
      next.theme,
      next.gamificationEnabled ? 1 : 0,
      user.id,
    )
    .run()

  return c.json({ settings: next })
})
