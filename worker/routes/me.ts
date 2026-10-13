import { Hono } from 'hono'

import type {
  CapacityMode,
  GoblinFrequency,
  NudgeFrequency,
  PlanningApproach,
  ThemePreference,
} from '../../shared/types'
import { parseHm } from '../../shared/magical/quietHours'
import type { Env } from '../env'
import type { AuthUser } from '../lib/session'
import { asString } from '../lib/validate'
import { loadSettings } from '../lib/settings'

type Vars = { user: AuthUser }

export const meRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

meRoutes.get('/', async (c) => {
  const user = c.get('user')
  const settings = await loadSettings(c.env.DB, user.id)
  return c.json({ user, settings })
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
  const quietHoursEnabled =
    typeof body?.quietHoursEnabled === 'boolean' ? body.quietHoursEnabled : null
  const quietHoursStart = asString(body?.quietHoursStart, 5)
  const quietHoursEnd = asString(body?.quietHoursEnd, 5)
  const nudgeFrequency = asString(
    body?.nudgeFrequency,
    20,
  ) as NudgeFrequency | null
  const dailyBriefingEnabled =
    typeof body?.dailyBriefingEnabled === 'boolean'
      ? body.dailyBriefingEnabled
      : null
  const eveningCheckinEnabled =
    typeof body?.eveningCheckinEnabled === 'boolean'
      ? body.eveningCheckinEnabled
      : null
  const reducedMotion =
    typeof body?.reducedMotion === 'boolean' ? body.reducedMotion : null
  const planningApproach = asString(
    body?.planningApproach,
    20,
  ) as PlanningApproach | null
  const goblinFrequency = asString(
    body?.goblinFrequency,
    20,
  ) as GoblinFrequency | null

  if (capacityMode && !['goblin', 'steady', 'quest'].includes(capacityMode)) {
    return c.json({ error: 'Invalid capacity mode' }, 400)
  }
  if (theme && !['light', 'dark', 'system'].includes(theme)) {
    return c.json({ error: 'Invalid theme' }, 400)
  }
  if (
    nudgeFrequency &&
    !['off', 'quiet', 'normal', 'chatty'].includes(nudgeFrequency)
  ) {
    return c.json({ error: 'Invalid nudge frequency' }, 400)
  }
  if (
    planningApproach &&
    !['minimal', 'balanced', 'ambitious'].includes(planningApproach)
  ) {
    return c.json({ error: 'Invalid planning approach' }, 400)
  }
  if (
    goblinFrequency &&
    !['quiet', 'normal', 'chatty'].includes(goblinFrequency)
  ) {
    return c.json({ error: 'Invalid goblin frequency' }, 400)
  }
  if (quietHoursStart && parseHm(quietHoursStart) === null) {
    return c.json({ error: 'Invalid quietHoursStart' }, 400)
  }
  if (quietHoursEnd && parseHm(quietHoursEnd) === null) {
    return c.json({ error: 'Invalid quietHoursEnd' }, 400)
  }

  const current = await loadSettings(c.env.DB, user.id)
  const next = {
    capacityMode: capacityMode ?? current.capacityMode,
    theme: theme ?? current.theme,
    gamificationEnabled: gamificationEnabled ?? current.gamificationEnabled,
    quietHoursEnabled: quietHoursEnabled ?? current.quietHoursEnabled,
    quietHoursStart: quietHoursStart ?? current.quietHoursStart,
    quietHoursEnd: quietHoursEnd ?? current.quietHoursEnd,
    nudgeFrequency: nudgeFrequency ?? current.nudgeFrequency,
    dailyBriefingEnabled: dailyBriefingEnabled ?? current.dailyBriefingEnabled,
    eveningCheckinEnabled:
      eveningCheckinEnabled ?? current.eveningCheckinEnabled,
    reducedMotion: reducedMotion ?? current.reducedMotion,
    planningApproach: planningApproach ?? current.planningApproach,
    goblinFrequency: goblinFrequency ?? current.goblinFrequency,
  }

  await c.env.DB.prepare(
    `UPDATE user_settings
     SET capacity_mode = ?, theme = ?, gamification_enabled = ?,
         quiet_hours_enabled = ?, quiet_hours_start = ?, quiet_hours_end = ?,
         nudge_frequency = ?, daily_briefing_enabled = ?,
         evening_checkin_enabled = ?, reduced_motion = ?,
         planning_approach = ?, goblin_frequency = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE user_id = ?`,
  )
    .bind(
      next.capacityMode,
      next.theme,
      next.gamificationEnabled ? 1 : 0,
      next.quietHoursEnabled ? 1 : 0,
      next.quietHoursStart,
      next.quietHoursEnd,
      next.nudgeFrequency,
      next.dailyBriefingEnabled ? 1 : 0,
      next.eveningCheckinEnabled ? 1 : 0,
      next.reducedMotion ? 1 : 0,
      next.planningApproach,
      next.goblinFrequency,
      user.id,
    )
    .run()

  const settings = await loadSettings(c.env.DB, user.id)
  return c.json({ settings })
})
