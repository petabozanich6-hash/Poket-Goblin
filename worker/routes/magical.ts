import { Hono } from 'hono'

import {
  nextTinierStep,
  suggestTinyFirstSteps,
} from '../../shared/magical/tinyStep'
import type { Env } from '../env'
import {
  acceptRescue,
  fetchBriefing,
  fetchPriorities,
  proposeRescue,
  syncNudges,
} from '../lib/magical'
import { newId } from '../lib/ids'
import { recordTaskHistory } from '../lib/history'
import type { AuthUser } from '../lib/session'
import { asString } from '../lib/validate'
import { loadSettings } from '../lib/settings'

type Vars = { user: AuthUser }

export const magicalRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

function offsetFromQuery(c: {
  req: { query: (k: string) => string | undefined }
}) {
  const raw = c.req.query('tz')
  if (raw === undefined) return 0
  const n = Number(raw)
  return Number.isFinite(n) ? Math.round(n) : 0
}

magicalRoutes.get('/briefing', async (c) => {
  const user = c.get('user')
  const tz = offsetFromQuery(c)
  const { briefing } = await fetchBriefing(
    c.env.DB,
    user.id,
    user.displayName,
    tz,
  )
  return c.json({ briefing })
})

magicalRoutes.get('/priorities', async (c) => {
  const user = c.get('user')
  const result = await fetchPriorities(c.env.DB, user.id, offsetFromQuery(c))
  return c.json(result)
})

magicalRoutes.post('/rescue', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const tz =
    typeof body?.timezoneOffsetMinutes === 'number'
      ? Math.round(body.timezoneOffsetMinutes)
      : 0
  const result = await proposeRescue(c.env.DB, user.id, tz)
  return c.json(result)
})

magicalRoutes.post('/rescue/accept', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const rescueId = asString(body?.rescueId, 80)
  if (!rescueId) return c.json({ error: 'rescueId is required' }, 400)
  const keepTaskIds = Array.isArray(body?.keepTaskIds)
    ? body.keepTaskIds.filter((id): id is string => typeof id === 'string')
    : []
  const settings = await loadSettings(c.env.DB, user.id)
  const plan = await acceptRescue(
    c.env.DB,
    user.id,
    rescueId,
    keepTaskIds,
    settings.capacityMode,
  )
  if (!plan) return c.json({ error: 'Rescue plan not found' }, 404)
  return c.json({ plan })
})

magicalRoutes.post('/rescue/dismiss', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const rescueId = asString(body?.rescueId, 80)
  if (!rescueId) return c.json({ error: 'rescueId is required' }, 400)
  await c.env.DB.prepare(
    `UPDATE rescue_plans SET status = 'dismissed',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(rescueId, user.id)
    .run()
  return c.json({ ok: true })
})

magicalRoutes.get('/nudges', async (c) => {
  const user = c.get('user')
  const result = await syncNudges(c.env.DB, user.id, offsetFromQuery(c))
  return c.json(result)
})

magicalRoutes.post('/nudges/:id/snooze', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const minutes =
    typeof body?.minutes === 'number' && body.minutes > 0
      ? Math.min(24 * 60, Math.round(body.minutes))
      : 60
  const until = new Date(Date.now() + minutes * 60_000).toISOString()
  const result = await c.env.DB.prepare(
    `UPDATE nudge_log
     SET status = 'snoozed', snoozed_until = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(until, id, user.id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true, snoozedUntil: until })
})

magicalRoutes.post('/nudges/:id/dismiss', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    `UPDATE nudge_log
     SET status = 'dismissed',
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

magicalRoutes.post('/tiny-step', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const title = asString(body?.title, 200)
  if (!title) return c.json({ error: 'Title is required' }, 400)
  const current = asString(body?.current, 200)
  const steps = current
    ? [nextTinierStep(current), ...suggestTinyFirstSteps(title, 2)]
    : suggestTinyFirstSteps(title, 3)
  return c.json({
    mode: 'rules' as const,
    title,
    steps: steps.map((step, index) => ({
      id: `tiny_${index}`,
      title: step,
    })),
    note: 'Suggested starting moves only — not assumptions about your situation.',
  })
})

magicalRoutes.post('/tiny-step/accept', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const parentId = asString(body?.parentId, 80)
  const stepTitle = asString(body?.title, 200)
  if (!parentId || !stepTitle) {
    return c.json({ error: 'parentId and title are required' }, 400)
  }
  const parent = await c.env.DB.prepare(
    `SELECT id, title FROM tasks WHERE id = ? AND user_id = ?`,
  )
    .bind(parentId, user.id)
    .first<{ id: string; title: string }>()
  if (!parent) return c.json({ error: 'Task not found' }, 404)

  const id = newId('task')
  await c.env.DB.prepare(
    `INSERT INTO tasks
      (id, user_id, title, notes, priority, capacity_cost, parent_id)
     VALUES (?, ?, ?, ?, 'normal', 1, ?)`,
  )
    .bind(id, user.id, stepTitle, `Tiny step for: ${parent.title}`, parentId)
    .run()
  await recordTaskHistory(c.env.DB, user.id, id, 'created', 'Tiny first step')
  return c.json({ task: { id, title: stepTitle, parentId } }, 201)
})

magicalRoutes.get('/achievements', async (c) => {
  const user = c.get('user')
  const settings = await loadSettings(c.env.DB, user.id)
  if (!settings.gamificationEnabled) {
    return c.json({ enabled: false, achievements: [], completedQuestCount: 0 })
  }
  const rows = await c.env.DB.prepare(
    `SELECT id, code, title, detail, earned_at as earnedAt
     FROM achievements WHERE user_id = ? ORDER BY earned_at DESC`,
  )
    .bind(user.id)
    .all()
  return c.json({
    enabled: true,
    achievements: rows.results ?? [],
    completedQuestCount: settings.completedQuestCount,
  })
})
