import { Hono, type Context } from 'hono'

import {
  HABITS,
  INTENSITIES,
  MEALS,
  addDays,
  isDay,
  type Habit,
  type Intensity,
  type Meal,
} from '../../shared/health'
import type { Env } from '../env'
import { todayLocalFromOffset } from '../lib/datetime'
import {
  MAX_SUPPLEMENTS,
  addActivity,
  addDose,
  addMeal,
  deleteEntry,
  deleteHealthData,
  enableHealth,
  habitAmount,
  healthSummary,
  healthTablesReady,
  listSupplements,
  loadProfile,
  restoreWeighIn,
  saveWeighIn,
  setHabit,
  updateProfile,
  weighInFor,
  type EntryTable,
  type ProfilePatch,
} from '../lib/health'
import { newId } from '../lib/ids'
import { checkRateLimit } from '../lib/rateLimit'
import type { AuthUser } from '../lib/session'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const healthRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

const UNAVAILABLE = { error: 'Health tracking is being set up. Please try again a little later.', code: 'health_unavailable' }
const OFF = { error: 'Turn on Health tracking first.', code: 'health_off' }
/** Entries can be added or fixed for today and the 60 days before it. */
const BACK_DAYS = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<{ Bindings: Env; Variables: Vars }, any>

function offsetOf(c: Ctx, body?: Record<string, unknown> | null): number {
  const raw = body?.timezoneOffsetMinutes ?? c.req.query('timezoneOffsetMinutes')
  const n = Number(raw)
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? Math.round(n) : 0
}

/** The day an entry is for: today (in the person's timezone) unless a recent past day is given. */
function dayOf(c: Ctx, body: Record<string, unknown> | null): string | null {
  const today = todayLocalFromOffset(offsetOf(c, body))
  const day = body?.day
  if (day === undefined || day === null || day === '') return today
  if (!isDay(day) || day > today || day < addDays(today, -BACK_DAYS)) return null
  return day
}

const num = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined
}
const int = (v: unknown, min: number, max: number) => {
  const n = num(v, min, max)
  return typeof n === 'number' ? Math.round(n) : n
}

async function json(c: Ctx): Promise<Record<string, unknown> | null> {
  return (await c.req.json().catch(() => null)) as Record<string, unknown> | null
}

// Every request: tables must exist; writes are rate limited; most routes need Health switched on.
healthRoutes.use('*', async (c, next) => {
  if (!(await healthTablesReady(c.env.DB))) {
    return c.req.method === 'GET' && c.req.path.endsWith('/my-health') ? c.json({ available: false, enabled: false }) : c.json(UNAVAILABLE, 503)
  }
  if (c.req.method !== 'GET') {
    const limit = checkRateLimit(`health:${c.get('user').id}`, 120, 60_000)
    if (!limit.ok) return c.json({ error: 'Slow down a moment, the Goblin is catching up.' }, 429)
  }
  await next()
})

const requireOn = async (c: Ctx) => (await loadProfile(c.env.DB, c.get('user').id)) !== null

healthRoutes.get('/', async (c) => {
  const user = c.get('user')
  c.header('Cache-Control', 'no-store')
  const summary = await healthSummary(c.env.DB, user.id, todayLocalFromOffset(offsetOf(c)))
  return c.json(summary ? { available: true, ...summary } : { available: true, enabled: false })
})

/** Turning Health on is the consent: it must be an explicit yes. */
healthRoutes.post('/enable', async (c) => {
  const body = await json(c)
  if (body?.consent !== true) return c.json({ error: 'Please confirm you want Pocket Goblin to keep your health details.' }, 400)
  const user = c.get('user')
  await enableHealth(c.env.DB, user.id)
  return c.json({ available: true, ...(await healthSummary(c.env.DB, user.id, todayLocalFromOffset(offsetOf(c, body)))) }, 201)
})

healthRoutes.patch('/profile', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const body = await json(c)
  if (!body) return c.json({ error: 'Nothing to change.' }, 400)
  const patch: ProfilePatch = {}
  const bad = (field: string) => c.json({ error: `That ${field} doesn't look right.` }, 400)
  if ('units' in body) {
    if (body.units !== 'metric' && body.units !== 'imperial') return bad('unit setting')
    patch.units = body.units
  }
  const fields: [keyof ProfilePatch, string, number, number, boolean][] = [
    ['goalWeightKg', 'goal weight', 30, 300, true],
    ['weeklyActivityMinutes', 'weekly activity goal', 0, 2000, false],
    ['dailyCalorieGoal', 'calorie goal', 1200, 6000, true],
    ['water', 'water goal', 0, 30, false],
    ['veg', 'vegetable goal', 0, 20, false],
    ['fruit', 'fruit goal', 0, 20, false],
    ['sleep', 'sleep goal', 0, 14, false],
  ]
  for (const [key, label, min, max, nullable] of fields) {
    if (!(key in body)) continue
    const v = num(body[key], min, max)
    if (v === undefined || (v === null && !nullable)) {
      return key === 'dailyCalorieGoal'
        ? c.json({ error: 'A daily calorie goal needs to be at least 1,200. Going lower is something to plan with your doctor.' }, 400)
        : bad(label)
    }
    ;(patch as Record<string, unknown>)[key] = key === 'sleep' || key === 'goalWeightKg' || v === null ? v : Math.round(v)
  }
  if ('hideNumbers' in body) {
    if (typeof body.hideNumbers !== 'boolean') return bad('setting')
    patch.hideNumbers = body.hideNumbers
  }
  const user = c.get('user')
  await updateProfile(c.env.DB, user.id, patch)
  return c.json({ profile: await loadProfile(c.env.DB, user.id) })
})

/** Deletes every health entry and the consent. The rest of the account is untouched. */
healthRoutes.delete('/', async (c) => {
  const body = await json(c)
  if (String(body?.confirm ?? '').trim() !== 'DELETE') return c.json({ error: 'Type DELETE to confirm.' }, 400)
  await deleteHealthData(c.env.DB, c.get('user').id)
  return c.json({ ok: true, enabled: false })
})

// ---------------------------------------------------------------- entries

healthRoutes.post('/weigh-ins', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const body = await json(c)
  const day = dayOf(c, body)
  if (!day) return c.json({ error: 'Choose today or a recent day.' }, 400)
  const weightKg = num(body?.weightKg, 20, 400)
  const waistCm = num(body?.waistCm, 30, 300)
  if (weightKg === undefined && waistCm === undefined) return c.json({ error: 'Enter a weight or a waist measurement.' }, 400)
  if ((body && 'weightKg' in body && weightKg === undefined) || (body && 'waistCm' in body && waistCm === undefined)) {
    return c.json({ error: "That measurement doesn't look right." }, 400)
  }
  const user = c.get('user')
  const before = await weighInFor(c.env.DB, user.id, day)
  const saved = await saveWeighIn(c.env.DB, user.id, day, { weightKg, waistCm })
  if (saved.weightKg == null && saved.waistCm == null) await restoreWeighIn(c.env.DB, user.id, day, null)
  return c.json({ weighIn: saved, replaced: !!before }, before ? 200 : 201)
})

healthRoutes.delete('/weigh-ins/:day', async (c) => {
  const day = c.req.param('day')
  if (!isDay(day)) return c.json({ error: 'Weigh-in not found' }, 404)
  const r = await c.env.DB.prepare('DELETE FROM health_weigh_ins WHERE user_id = ? AND day = ?').bind(c.get('user').id, day).run()
  return (r.meta?.changes ?? 0) > 0 ? c.json({ ok: true }) : c.json({ error: 'Weigh-in not found' }, 404)
})

healthRoutes.post('/meals', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const body = await json(c)
  const day = dayOf(c, body)
  if (!day) return c.json({ error: 'Choose today or a recent day.' }, 400)
  const meal = body?.meal as Meal
  if (!MEALS.includes(meal)) return c.json({ error: 'Choose breakfast, lunch, dinner, a snack or a drink.' }, 400)
  const description = asString(body?.description, 200)
  if (!description) return c.json({ error: 'Say what you had.' }, 400)
  const calories = int(body?.calories, 0, 10000)
  const caffeineMg = int(body?.caffeineMg, 0, 2000)
  if (calories === undefined && body?.calories !== undefined) return c.json({ error: "Those calories don't look right." }, 400)
  if (caffeineMg === undefined && body?.caffeineMg !== undefined) return c.json({ error: "That caffeine amount doesn't look right." }, 400)
  const id = await addMeal(c.env.DB, c.get('user').id, { day, meal, description, calories, caffeineMg })
  return c.json({ id }, 201)
})

healthRoutes.post('/activities', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const body = await json(c)
  const day = dayOf(c, body)
  if (!day) return c.json({ error: 'Choose today or a recent day.' }, 400)
  const kind = asString(body?.kind, 60)
  if (!kind) return c.json({ error: 'Say what you did.' }, 400)
  const minutes = int(body?.minutes, 1, 1440)
  const steps = int(body?.steps, 1, 200000)
  if (minutes == null && steps == null) return c.json({ error: 'Add how long it took, or your steps.' }, 400)
  const intensity = (body?.intensity ?? 'moderate') as Intensity
  if (!INTENSITIES.includes(intensity)) return c.json({ error: 'Choose light, moderate or vigorous.' }, 400)
  const id = await addActivity(c.env.DB, c.get('user').id, { day, kind, minutes, steps, intensity })
  return c.json({ id }, 201)
})

/** Set (`amount`) or add to (`add`) a habit's total for the day. */
healthRoutes.put('/habits/:habit', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const habit = c.req.param('habit') as Habit
  if (!HABITS.includes(habit)) return c.json({ error: 'Habit not found' }, 404)
  const body = await json(c)
  const day = dayOf(c, body)
  if (!day) return c.json({ error: 'Choose today or a recent day.' }, 400)
  const user = c.get('user')
  const current = (await habitAmount(c.env.DB, user.id, day, habit)) ?? 0
  const amount = num(body?.amount, 0, 100)
  const add = num(body?.add, -100, 100)
  const next = typeof amount === 'number' ? amount : typeof add === 'number' ? current + add : undefined
  if (next === undefined) return c.json({ error: "That amount doesn't look right." }, 400)
  await setHabit(c.env.DB, user.id, day, habit, Math.max(0, Math.min(100, next)))
  return c.json({ habit, day, amount: Math.max(0, Math.min(100, next)) })
})

healthRoutes.delete('/entries/:table/:id', async (c) => {
  const table = c.req.param('table') as EntryTable
  if (!['meal', 'activity', 'dose'].includes(table)) return c.json({ error: 'Entry not found' }, 404)
  return (await deleteEntry(c.env.DB, c.get('user').id, table, c.req.param('id')))
    ? c.json({ ok: true })
    : c.json({ error: 'Entry not found' }, 404)
})

/** Recent days, newest first, for looking back and fixing mistakes. */
healthRoutes.get('/history', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const user = c.get('user')
  const today = todayLocalFromOffset(offsetOf(c))
  const days = Math.min(60, Math.max(1, Number(c.req.query('days')) || 14))
  const from = addDays(today, -(days - 1))
  const q = (sql: string) => c.env.DB.prepare(sql).bind(user.id, from, today).all()
  const [weighIns, meals, activities, habits, doses] = await Promise.all([
    q('SELECT id, day, weight_kg AS weightKg, waist_cm AS waistCm FROM health_weigh_ins WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day DESC'),
    q('SELECT id, day, meal, description, calories, caffeine_mg AS caffeineMg FROM health_meals WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day DESC, created_at'),
    q('SELECT id, day, kind, minutes, steps, intensity FROM health_activities WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day DESC, created_at'),
    q('SELECT day, habit, amount FROM health_habit_days WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day DESC'),
    q(`SELECT d.id, d.day, s.name FROM health_supplement_doses d JOIN health_supplements s ON s.id = d.supplement_id AND s.user_id = d.user_id
       WHERE d.user_id = ? AND d.day >= ? AND d.day <= ? ORDER BY d.day DESC, d.created_at`),
  ])
  c.header('Cache-Control', 'no-store')
  return c.json({ from, to: today, weighIns: weighIns.results, meals: meals.results, activities: activities.results, habits: habits.results, doses: doses.results })
})

// ---------------------------------------------------------------- supplements

healthRoutes.get('/supplements', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  return c.json({ supplements: await listSupplements(c.env.DB, c.get('user').id) })
})

function supplementFields(body: Record<string, unknown> | null, partial: boolean) {
  const out: { name?: string; dose?: string | null; dosesPerDay?: number; caffeineMg?: number | null } = {}
  if (!partial || (body && 'name' in body)) {
    const name = asString(body?.name, 80)
    if (!name) return { error: 'Give the supplement a name.' }
    out.name = name
  }
  if (body && 'dose' in body) out.dose = body.dose === null || body.dose === '' ? null : asString(body.dose, 60)
  if (!partial || (body && 'dosesPerDay' in body)) {
    const n = int(body?.dosesPerDay ?? 1, 1, 6)
    if (typeof n !== 'number') return { error: 'Times a day should be between 1 and 6.' }
    out.dosesPerDay = n
  }
  if (body && 'caffeineMg' in body) {
    const n = int(body.caffeineMg, 0, 1000)
    if (n === undefined) return { error: "That caffeine amount doesn't look right." }
    out.caffeineMg = n
  }
  return { fields: out }
}

healthRoutes.post('/supplements', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const user = c.get('user')
  const parsed = supplementFields(await json(c), false)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  const f = parsed.fields
  if ((await listSupplements(c.env.DB, user.id)).length >= MAX_SUPPLEMENTS) {
    return c.json({ error: `You can keep up to ${MAX_SUPPLEMENTS} supplements. Remove one you no longer take first.` }, 409)
  }
  const id = newId('hsup')
  await c.env.DB.prepare('INSERT INTO health_supplements (id, user_id, name, dose, doses_per_day, caffeine_mg) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, user.id, f.name!, f.dose ?? null, f.dosesPerDay ?? 1, f.caffeineMg ?? null)
    .run()
  return c.json({ id, supplements: await listSupplements(c.env.DB, user.id) }, 201)
})

healthRoutes.patch('/supplements/:id', async (c) => {
  const user = c.get('user')
  const parsed = supplementFields(await json(c), true)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  const cols: Record<string, string> = { name: 'name', dose: 'dose', dosesPerDay: 'doses_per_day', caffeineMg: 'caffeine_mg' }
  const keys = Object.keys(parsed.fields) as (keyof typeof parsed.fields)[]
  if (!keys.length) return c.json({ error: 'Nothing to change.' }, 400)
  const r = await c.env.DB.prepare(
    `UPDATE health_supplements SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ? AND user_id = ? AND archived_at IS NULL`,
  )
    .bind(...keys.map((k) => parsed.fields[k] ?? null), c.req.param('id'), user.id)
    .run()
  if (!(r.meta?.changes ?? 0)) return c.json({ error: 'Supplement not found' }, 404)
  return c.json({ supplements: await listSupplements(c.env.DB, user.id) })
})

/** Stops tracking a supplement. Past doses stay in the history (and in the data export). */
healthRoutes.delete('/supplements/:id', async (c) => {
  const user = c.get('user')
  const r = await c.env.DB.prepare(
    "UPDATE health_supplements SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ? AND archived_at IS NULL",
  )
    .bind(c.req.param('id'), user.id)
    .run()
  if (!(r.meta?.changes ?? 0)) return c.json({ error: 'Supplement not found' }, 404)
  return c.json({ supplements: await listSupplements(c.env.DB, user.id) })
})

healthRoutes.post('/supplements/:id/doses', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const user = c.get('user')
  const body = await json(c)
  const day = dayOf(c, body)
  if (!day) return c.json({ error: 'Choose today or a recent day.' }, 400)
  const own = await c.env.DB.prepare('SELECT id FROM health_supplements WHERE id = ? AND user_id = ? AND archived_at IS NULL')
    .bind(c.req.param('id'), user.id)
    .first()
  if (!own) return c.json({ error: 'Supplement not found' }, 404)
  const id = await addDose(c.env.DB, user.id, c.req.param('id'), day)
  return c.json({ id }, 201)
})
