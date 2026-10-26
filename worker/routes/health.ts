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
import {
  NUTRIENTS,
  NUTRIENT_LABELS,
  emptyNutrition,
  hasNutrition,
  nutritionFromText,
  panelIsPer100g,
  recipeFromHtml,
  scaleNutrition,
  type Nutrition,
} from '../../shared/recipes'
import type { Env } from '../env'
import { todayLocalFromOffset } from '../lib/datetime'
import {
  MAX_RECIPES,
  MAX_SUPPLEMENTS,
  addActivity,
  addDose,
  addMeal,
  deleteEntry,
  deleteHealthData,
  enableHealth,
  getRecipe,
  habitAmount,
  healthSummary,
  healthTablesReady,
  listRecipes,
  listSupplements,
  loadProfile,
  restoreWeighIn,
  saveRecipe,
  saveWeighIn,
  setHabit,
  updateProfile,
  weighInFor,
  type EntryTable,
  type ProfilePatch,
} from '../lib/health'
import { newId } from '../lib/ids'
import {
  assertUnderLimit,
  loadAiPolicy,
  recordAiEvent,
  recordUsage,
} from '../lib/intelligence/usage'
import {
  WorkersAiBlockedError,
  transcribeImageWithWorkersAi,
} from '../lib/intelligence/workersAi'
import { checkRateLimit } from '../lib/rateLimit'
import type { AuthUser } from '../lib/session'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const healthRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

const UNAVAILABLE = {
  error: 'Health tracking is being set up. Please try again a little later.',
  code: 'health_unavailable',
}
const OFF = { error: 'Turn on Health tracking first.', code: 'health_off' }
/** Entries can be added or fixed for today and the 60 days before it. */
const BACK_DAYS = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = Context<{ Bindings: Env; Variables: Vars }, any>

function offsetOf(c: Ctx, body?: Record<string, unknown> | null): number {
  const raw =
    body?.timezoneOffsetMinutes ?? c.req.query('timezoneOffsetMinutes')
  const n = Number(raw)
  return Number.isFinite(n) && Math.abs(n) <= 14 * 60 ? Math.round(n) : 0
}

/** The day an entry is for: today (in the person's timezone) unless a recent past day is given. */
function dayOf(c: Ctx, body: Record<string, unknown> | null): string | null {
  const today = todayLocalFromOffset(offsetOf(c, body))
  const day = body?.day
  if (day === undefined || day === null || day === '') return today
  if (!isDay(day) || day > today || day < addDays(today, -BACK_DAYS))
    return null
  return day
}

const num = (
  v: unknown,
  min: number,
  max: number,
): number | null | undefined => {
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
  return (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
}

// Every request: tables must exist; writes are rate limited; most routes need Health switched on.
healthRoutes.use('*', async (c, next) => {
  if (!(await healthTablesReady(c.env.DB))) {
    return c.req.method === 'GET' && c.req.path.endsWith('/my-health')
      ? c.json({ available: false, enabled: false })
      : c.json(UNAVAILABLE, 503)
  }
  if (c.req.method !== 'GET') {
    const limit = checkRateLimit(`health:${c.get('user').id}`, 120, 60_000)
    if (!limit.ok)
      return c.json(
        { error: 'Slow down a moment, the Goblin is catching up.' },
        429,
      )
  }
  await next()
})

const requireOn = async (c: Ctx) =>
  (await loadProfile(c.env.DB, c.get('user').id)) !== null

healthRoutes.get('/', async (c) => {
  const user = c.get('user')
  c.header('Cache-Control', 'no-store')
  const summary = await healthSummary(
    c.env.DB,
    user.id,
    todayLocalFromOffset(offsetOf(c)),
  )
  return c.json(
    summary
      ? { available: true, ...summary }
      : { available: true, enabled: false },
  )
})

/** Turning Health on is the consent: it must be an explicit yes. */
healthRoutes.post('/enable', async (c) => {
  const body = await json(c)
  if (body?.consent !== true)
    return c.json(
      {
        error:
          'Please confirm you want Pocket Goblin to keep your health details.',
      },
      400,
    )
  const user = c.get('user')
  await enableHealth(c.env.DB, user.id)
  return c.json(
    {
      available: true,
      ...(await healthSummary(
        c.env.DB,
        user.id,
        todayLocalFromOffset(offsetOf(c, body)),
      )),
    },
    201,
  )
})

healthRoutes.patch('/profile', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const body = await json(c)
  if (!body) return c.json({ error: 'Nothing to change.' }, 400)
  const patch: ProfilePatch = {}
  const bad = (field: string) =>
    c.json({ error: `That ${field} doesn't look right.` }, 400)
  if ('units' in body) {
    if (body.units !== 'metric' && body.units !== 'imperial')
      return bad('unit setting')
    patch.units = body.units
  }
  const fields: [keyof ProfilePatch, string, number, number, boolean][] = [
    ['goalWeightKg', 'goal weight', 30, 300, true],
    ['weeklyActivityMinutes', 'weekly activity goal', 0, 2000, false],
    ['dailyCalorieGoal', 'calorie goal', 1200, 6000, true],
    ['proteinGoalG', 'protein goal', 0, 600, true],
    ['carbsGoalG', 'carbs goal', 0, 1000, true],
    ['fatGoalG', 'fat goal', 0, 500, true],
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
        ? c.json(
            {
              error:
                'A daily calorie goal needs to be at least 1,200. Going lower is something to plan with your doctor.',
            },
            400,
          )
        : bad(label)
    }
    ;(patch as Record<string, unknown>)[key] =
      key === 'sleep' || key === 'goalWeightKg' || v === null
        ? v
        : Math.round(v)
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
  if (String(body?.confirm ?? '').trim() !== 'DELETE')
    return c.json({ error: 'Type DELETE to confirm.' }, 400)
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
  if (weightKg === undefined && waistCm === undefined)
    return c.json({ error: 'Enter a weight or a waist measurement.' }, 400)
  if (
    (body && 'weightKg' in body && weightKg === undefined) ||
    (body && 'waistCm' in body && waistCm === undefined)
  ) {
    return c.json({ error: "That measurement doesn't look right." }, 400)
  }
  const user = c.get('user')
  const before = await weighInFor(c.env.DB, user.id, day)
  const saved = await saveWeighIn(c.env.DB, user.id, day, { weightKg, waistCm })
  if (saved.weightKg == null && saved.waistCm == null)
    await restoreWeighIn(c.env.DB, user.id, day, null)
  return c.json({ weighIn: saved, replaced: !!before }, before ? 200 : 201)
})

healthRoutes.delete('/weigh-ins/:day', async (c) => {
  const day = c.req.param('day')
  if (!isDay(day)) return c.json({ error: 'Weigh-in not found' }, 404)
  const r = await c.env.DB.prepare(
    'DELETE FROM health_weigh_ins WHERE user_id = ? AND day = ?',
  )
    .bind(c.get('user').id, day)
    .run()
  return (r.meta?.changes ?? 0) > 0
    ? c.json({ ok: true })
    : c.json({ error: 'Weigh-in not found' }, 404)
})

healthRoutes.post('/meals', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const user = c.get('user')
  const body = await json(c)
  const day = dayOf(c, body)
  if (!day) return c.json({ error: 'Choose today or a recent day.' }, 400)
  const meal = body?.meal as Meal
  if (!MEALS.includes(meal))
    return c.json(
      { error: 'Choose breakfast, lunch, dinner, a snack or a drink.' },
      400,
    )
  const servings = num(body?.servings ?? 1, 0.1, 20)
  if (typeof servings !== 'number')
    return c.json({ error: 'Servings should be between 0.1 and 20.' }, 400)
  const caffeineMg = int(body?.caffeineMg, 0, 2000)
  if (caffeineMg === undefined && body?.caffeineMg !== undefined)
    return c.json({ error: "That caffeine amount doesn't look right." }, 400)

  // From a saved recipe: its per-serving numbers times the servings eaten (copied, so history never changes).
  if (body?.recipeId !== undefined && body.recipeId !== null) {
    const recipe = await getRecipe(c.env.DB, user.id, String(body.recipeId))
    if (!recipe) return c.json({ error: 'Recipe not found' }, 404)
    const totals = scaleNutrition(recipe, servings)
    const id = await addMeal(c.env.DB, user.id, {
      day,
      meal,
      description: recipe.name,
      recipeId: recipe.id,
      servings,
      caffeineMg,
      ...totals,
    })
    return c.json({ id }, 201)
  }

  const description = asString(body?.description, 200)
  if (!description) return c.json({ error: 'Say what you had.' }, 400)
  const nutrition = readNutrition(body)
  if ('error' in nutrition) return c.json({ error: nutrition.error }, 400)
  const id = await addMeal(c.env.DB, user.id, {
    day,
    meal,
    description,
    servings,
    caffeineMg,
    ...nutrition.values,
  })
  return c.json({ id }, 201)
})

/** Optional nutrition numbers (any may be left out). */
function readNutrition(
  body: Record<string, unknown> | null,
): { values: Nutrition } | { error: string } {
  const values = emptyNutrition()
  for (const k of NUTRIENTS) {
    if (body?.[k] === undefined) continue
    const { label, max } = NUTRIENT_LABELS[k]
    const v = num(body[k], 0, max)
    if (v === undefined) return { error: `${label} doesn't look right.` }
    values[k] =
      v === null
        ? null
        : k === 'calories' || k === 'sodiumMg'
          ? Math.round(v)
          : Math.round(v * 10) / 10
  }
  return { values }
}

healthRoutes.post('/activities', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const body = await json(c)
  const day = dayOf(c, body)
  if (!day) return c.json({ error: 'Choose today or a recent day.' }, 400)
  const kind = asString(body?.kind, 60)
  if (!kind) return c.json({ error: 'Say what you did.' }, 400)
  const minutes = int(body?.minutes, 1, 1440)
  const steps = int(body?.steps, 1, 200000)
  if (minutes == null && steps == null)
    return c.json({ error: 'Add how long it took, or your steps.' }, 400)
  const intensity = (body?.intensity ?? 'moderate') as Intensity
  if (!INTENSITIES.includes(intensity))
    return c.json({ error: 'Choose light, moderate or vigorous.' }, 400)
  const id = await addActivity(c.env.DB, c.get('user').id, {
    day,
    kind,
    minutes,
    steps,
    intensity,
  })
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
  const next =
    typeof amount === 'number'
      ? amount
      : typeof add === 'number'
        ? current + add
        : undefined
  if (next === undefined)
    return c.json({ error: "That amount doesn't look right." }, 400)
  await setHabit(
    c.env.DB,
    user.id,
    day,
    habit,
    Math.max(0, Math.min(100, next)),
  )
  return c.json({ habit, day, amount: Math.max(0, Math.min(100, next)) })
})

healthRoutes.delete('/entries/:table/:id', async (c) => {
  const table = c.req.param('table') as EntryTable
  if (!['meal', 'activity', 'dose'].includes(table))
    return c.json({ error: 'Entry not found' }, 404)
  return (await deleteEntry(
    c.env.DB,
    c.get('user').id,
    table,
    c.req.param('id'),
  ))
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
  const q = (sql: string) =>
    c.env.DB.prepare(sql).bind(user.id, from, today).all()
  const [weighIns, meals, activities, habits, doses] = await Promise.all([
    q(
      'SELECT id, day, weight_kg AS weightKg, waist_cm AS waistCm FROM health_weigh_ins WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day DESC',
    ),
    q(
      'SELECT id, day, meal, description, calories, caffeine_mg AS caffeineMg FROM health_meals WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day DESC, created_at',
    ),
    q(
      'SELECT id, day, kind, minutes, steps, intensity FROM health_activities WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day DESC, created_at',
    ),
    q(
      'SELECT day, habit, amount FROM health_habit_days WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day DESC',
    ),
    q(`SELECT d.id, d.day, s.name FROM health_supplement_doses d JOIN health_supplements s ON s.id = d.supplement_id AND s.user_id = d.user_id
       WHERE d.user_id = ? AND d.day >= ? AND d.day <= ? ORDER BY d.day DESC, d.created_at`),
  ])
  c.header('Cache-Control', 'no-store')
  return c.json({
    from,
    to: today,
    weighIns: weighIns.results,
    meals: meals.results,
    activities: activities.results,
    habits: habits.results,
    doses: doses.results,
  })
})

// ---------------------------------------------------------------- supplements

healthRoutes.get('/supplements', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  return c.json({
    supplements: await listSupplements(c.env.DB, c.get('user').id),
  })
})

function supplementFields(
  body: Record<string, unknown> | null,
  partial: boolean,
) {
  const out: {
    name?: string
    dose?: string | null
    dosesPerDay?: number
    caffeineMg?: number | null
  } = {}
  if (!partial || (body && 'name' in body)) {
    const name = asString(body?.name, 80)
    if (!name) return { error: 'Give the supplement a name.' }
    out.name = name
  }
  if (body && 'dose' in body)
    out.dose =
      body.dose === null || body.dose === '' ? null : asString(body.dose, 60)
  if (!partial || (body && 'dosesPerDay' in body)) {
    const n = int(body?.dosesPerDay ?? 1, 1, 6)
    if (typeof n !== 'number')
      return { error: 'Times a day should be between 1 and 6.' }
    out.dosesPerDay = n
  }
  if (body && 'caffeineMg' in body) {
    const n = int(body.caffeineMg, 0, 1000)
    if (n === undefined)
      return { error: "That caffeine amount doesn't look right." }
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
    return c.json(
      {
        error: `You can keep up to ${MAX_SUPPLEMENTS} supplements. Remove one you no longer take first.`,
      },
      409,
    )
  }
  const id = newId('hsup')
  await c.env.DB.prepare(
    'INSERT INTO health_supplements (id, user_id, name, dose, doses_per_day, caffeine_mg) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(
      id,
      user.id,
      f.name!,
      f.dose ?? null,
      f.dosesPerDay ?? 1,
      f.caffeineMg ?? null,
    )
    .run()
  return c.json(
    { id, supplements: await listSupplements(c.env.DB, user.id) },
    201,
  )
})

healthRoutes.patch('/supplements/:id', async (c) => {
  const user = c.get('user')
  const parsed = supplementFields(await json(c), true)
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  const cols: Record<string, string> = {
    name: 'name',
    dose: 'dose',
    dosesPerDay: 'doses_per_day',
    caffeineMg: 'caffeine_mg',
  }
  const keys = Object.keys(parsed.fields) as (keyof typeof parsed.fields)[]
  if (!keys.length) return c.json({ error: 'Nothing to change.' }, 400)
  const r = await c.env.DB.prepare(
    `UPDATE health_supplements SET ${keys.map((k) => `${cols[k]} = ?`).join(', ')} WHERE id = ? AND user_id = ? AND archived_at IS NULL`,
  )
    .bind(
      ...keys.map((k) => parsed.fields[k] ?? null),
      c.req.param('id'),
      user.id,
    )
    .run()
  if (!(r.meta?.changes ?? 0))
    return c.json({ error: 'Supplement not found' }, 404)
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
  if (!(r.meta?.changes ?? 0))
    return c.json({ error: 'Supplement not found' }, 404)
  return c.json({ supplements: await listSupplements(c.env.DB, user.id) })
})

healthRoutes.post('/supplements/:id/doses', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const user = c.get('user')
  const body = await json(c)
  const day = dayOf(c, body)
  if (!day) return c.json({ error: 'Choose today or a recent day.' }, 400)
  const own = await c.env.DB.prepare(
    'SELECT id FROM health_supplements WHERE id = ? AND user_id = ? AND archived_at IS NULL',
  )
    .bind(c.req.param('id'), user.id)
    .first()
  if (!own) return c.json({ error: 'Supplement not found' }, 404)
  const id = await addDose(c.env.DB, user.id, c.req.param('id'), day)
  return c.json({ id }, 201)
})

// ---------------------------------------------------------------- recipes and meal analysis

healthRoutes.get('/recipes', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  return c.json({ recipes: await listRecipes(c.env.DB, c.get('user').id) })
})

function recipeFields(body: Record<string, unknown> | null) {
  const name = asString(body?.name, 120)
  if (!name) return { error: 'Give the recipe a name.' }
  let sourceUrl: string | null = null
  if (body?.sourceUrl) {
    const u = safeUrl(String(body.sourceUrl))
    if (!u) return { error: "That link doesn't look right." }
    sourceUrl = u.toString()
  }
  const servings =
    body?.servings == null || body.servings === ''
      ? null
      : int(body.servings, 1, 100)
  if (servings === undefined)
    return { error: 'Servings should be between 1 and 100.' }
  const nutrition = readNutrition(body)
  if ('error' in nutrition) return { error: nutrition.error }
  return { fields: { name, sourceUrl, servings, ...nutrition.values } }
}

healthRoutes.post('/recipes', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const user = c.get('user')
  const parsed = recipeFields(await json(c))
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  if ((await listRecipes(c.env.DB, user.id)).length >= MAX_RECIPES) {
    return c.json(
      { error: `You can keep up to ${MAX_RECIPES} recipes. Remove one first.` },
      409,
    )
  }
  const id = await saveRecipe(c.env.DB, user.id, parsed.fields)
  return c.json({ id, recipe: await getRecipe(c.env.DB, user.id, id) }, 201)
})

healthRoutes.put('/recipes/:id', async (c) => {
  const user = c.get('user')
  if (!(await getRecipe(c.env.DB, user.id, c.req.param('id'))))
    return c.json({ error: 'Recipe not found' }, 404)
  const parsed = recipeFields(await json(c))
  if ('error' in parsed) return c.json({ error: parsed.error }, 400)
  await saveRecipe(c.env.DB, user.id, {
    ...parsed.fields,
    id: c.req.param('id'),
  })
  return c.json({
    recipe: await getRecipe(c.env.DB, user.id, c.req.param('id')),
  })
})

/** Removes a recipe from the list. Meals already logged keep their numbers. */
healthRoutes.delete('/recipes/:id', async (c) => {
  const r = await c.env.DB.prepare(
    "UPDATE health_recipes SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ? AND archived_at IS NULL",
  )
    .bind(c.req.param('id'), c.get('user').id)
    .run()
  return (r.meta?.changes ?? 0)
    ? c.json({ ok: true })
    : c.json({ error: 'Recipe not found' }, 404)
})

/** Public https web pages only: never an address, a local name or a non-standard port. */
export function safeUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  const host = u.hostname.toLowerCase()
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    (u.port && u.port !== '443')
  )
    return null
  if (
    !host.includes('.') ||
    /^[\d.]+$/.test(host) ||
    host.includes(':') ||
    host.startsWith('[')
  )
    return null
  if (/(^|\.)(localhost|local|internal|lan|home|arpa)$/.test(host)) return null
  return u
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
const MAX_PAGE_BYTES = 2 * 1024 * 1024

/** Fetches a recipe page (following up to 3 redirects, each re-checked), reading at most 2 MB. */
export async function fetchRecipePage(
  raw: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ html: string; url: string } | null> {
  let url = safeUrl(raw)
  for (let hop = 0; url && hop < 4; hop++) {
    const res = await fetchImpl(url.toString(), {
      redirect: 'manual',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'PocketGoblin/1.0 (recipe nutrition reader)',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location')
      url = next ? safeUrl(new URL(next, url).toString()) : null
      continue
    }
    if (
      !res.ok ||
      !/text\/html|xhtml/i.test(res.headers.get('content-type') ?? '') ||
      !res.body
    )
      return null
    const reader = res.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_PAGE_BYTES) {
        await reader.cancel()
        break
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(chunks.reduce((s, ch) => s + ch.byteLength, 0))
    let at = 0
    for (const ch of chunks) {
      bytes.set(ch, at)
      at += ch.byteLength
    }
    return { html: new TextDecoder().decode(bytes), url: url.toString() }
  }
  return null
}

/**
 * Reads a recipe link's published nutrition (schema.org data that recipe sites provide for search engines).
 * No AI. Returns a preview to check and save; nothing is stored here.
 */
healthRoutes.post('/recipes/from-link', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const limit = checkRateLimit(
    `health-link:${c.get('user').id}`,
    10,
    60 * 60_000,
  )
  if (!limit.ok)
    return c.json(
      { error: 'Please wait a little before reading more links.' },
      429,
    )
  const body = await json(c)
  if (!safeUrl(String(body?.url ?? '')))
    return c.json({ error: 'Paste a full https:// recipe link.' }, 400)
  let page: Awaited<ReturnType<typeof fetchRecipePage>> = null
  try {
    page = await fetchRecipePage(String(body!.url))
  } catch {
    page = null
  }
  const recipe = page ? recipeFromHtml(page.html) : null
  if (!recipe || !hasNutrition(recipe.nutrition)) {
    return c.json(
      {
        error:
          "I couldn't find nutrition details published on that page. Try a screenshot of the nutrition panel, or type the numbers in.",
        code: 'no_nutrition',
      },
      422,
    )
  }
  return c.json({
    preview: {
      name: recipe.name,
      servings: recipe.servings,
      sourceUrl: page!.url,
      ...recipe.nutrition,
    },
  })
})

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

/**
 * Reads a screenshot or photo of a nutrition panel. The image is sent to Cloudflare Workers AI only to
 * write out its text (the person is told this first); the numbers are then read by rules here, so they can
 * be checked. Counts as one AI request. Nothing is stored until the person saves the preview.
 */
healthRoutes.post('/recipes/from-image', async (c) => {
  if (!(await requireOn(c))) return c.json(OFF, 409)
  const user = c.get('user')
  let file: File | null = null
  try {
    const form = await c.req.formData()
    const f = form.get('image')
    file = f instanceof File ? f : null
  } catch {
    file = null
  }
  if (!file)
    return c.json(
      { error: 'Choose a screenshot or photo of the nutrition panel.' },
      400,
    )
  if (
    file.size > MAX_IMAGE_BYTES ||
    !/^image\/(jpeg|png|webp)$/.test(file.type)
  ) {
    return c.json({ error: 'Use a JPEG, PNG or WebP image under 5 MB.' }, 400)
  }
  const policy = await loadAiPolicy(c.env.DB, c.env, user.id)
  const typeIt = 'Type the numbers in instead, they only take a moment.'
  if (
    !policy.providerEnabled ||
    policy.env.AI_PROVIDER?.toLowerCase() !== 'workers_ai' ||
    !policy.env.AI
  ) {
    await recordAiEvent(
      c.env.DB,
      user.id,
      'nutrition',
      'workers_ai',
      'disabled',
    )
    return c.json(
      {
        error: `Reading pictures isn't available right now. ${typeIt}`,
        code: 'ai_unavailable',
      },
      503,
    )
  }
  const gate = await assertUnderLimit(c.env.DB, policy, user.id)
  if (!gate.ok) {
    await recordAiEvent(
      c.env.DB,
      user.id,
      'nutrition',
      'workers_ai',
      'limit_reached',
    )
    return c.json(
      { error: `You've used today's AI requests. ${typeIt}`, code: 'ai_limit' },
      429,
    )
  }
  let text = ''
  try {
    text = await transcribeImageWithWorkersAi(
      policy.env,
      new Uint8Array(await file.arrayBuffer()),
      file.type,
    )
  } catch (e) {
    await recordAiEvent(
      c.env.DB,
      user.id,
      'nutrition',
      'workers_ai',
      e instanceof WorkersAiBlockedError ? 'limit_reached' : 'ai_unavailable',
    )
    return c.json(
      {
        error: `I couldn't read that picture just now. ${typeIt}`,
        code: 'ai_unavailable',
      },
      503,
    )
  }
  await recordUsage(c.env.DB, user.id, 'workers_ai')
  await recordAiEvent(c.env.DB, user.id, 'nutrition', 'workers_ai', 'ai')
  const nutrition = nutritionFromText(text)
  if (!hasNutrition(nutrition)) {
    return c.json(
      {
        error: `I couldn't find nutrition numbers in that picture. ${typeIt}`,
        code: 'no_nutrition',
      },
      422,
    )
  }
  const warnings = panelIsPer100g(text)
    ? [
        'This panel looks like it is per 100 g, not per serving. Check the numbers before saving.',
      ]
    : []
  return c.json({
    preview: { name: null, servings: null, sourceUrl: null, ...nutrition },
    warnings,
  })
})
