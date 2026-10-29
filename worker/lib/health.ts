/**
 * Health tracking storage. Every query is scoped to the signed-in person's user id.
 * Nothing here calls an AI model, and health entries are never sent to one.
 */
import {
  DEFAULT_TARGETS,
  HABITS,
  addDays,
  habitStreak,
  healthNotes,
  weekStart,
  weeklyAverages,
  totalNutrition,
  weightTrend,
  type ActivityEntry,
  type Habit,
  type HealthProfile,
  type HealthSummary,
  type Intensity,
  type Meal,
  type MealEntry,
  type Recipe,
  type Supplement,
  type SupplementToday,
  type WeighIn,
} from '../../shared/health'
import { NUTRIENTS, type Nutrition } from '../../shared/recipes'
import { newId } from './ids'

const ready = new WeakSet<D1Database>()

/**
 * The Worker can deploy before migration 0025 is applied (merges to main deploy automatically).
 * Until the tables exist, Health reports itself as unavailable instead of failing.
 */
export async function healthTablesReady(db: D1Database): Promise<boolean> {
  if (ready.has(db)) return true
  const row = await db
    .prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'health_supplement_doses'",
    )
    .first<{ ok: number }>()
  if (row) ready.add(db)
  return !!row
}

export const CONSENT_VERSION = 1

type ProfileRow = {
  consentedAt: string
  units: 'metric' | 'imperial'
  goalWeightKg: number | null
  weeklyActivityMinutes: number
  dailyCalorieGoal: number | null
  proteinGoalG: number | null
  carbsGoalG: number | null
  fatGoalG: number | null
  water: number
  veg: number
  fruit: number
  sleep: number
  hideNumbers: number
}

export async function loadProfile(
  db: D1Database,
  userId: string,
): Promise<HealthProfile | null> {
  const row = await db
    .prepare(
      `SELECT consented_at AS consentedAt, units, goal_weight_kg AS goalWeightKg,
              weekly_activity_minutes AS weeklyActivityMinutes, daily_calorie_goal AS dailyCalorieGoal,
              protein_goal_g AS proteinGoalG, carbs_goal_g AS carbsGoalG, fat_goal_g AS fatGoalG,
              water_glasses AS water, veg_serves AS veg, fruit_serves AS fruit, sleep_hours AS sleep,
              hide_numbers AS hideNumbers
       FROM health_profiles WHERE user_id = ?`,
    )
    .bind(userId)
    .first<ProfileRow>()
  if (!row) return null
  return {
    enabled: true,
    consentedAt: row.consentedAt,
    units: row.units,
    goalWeightKg: row.goalWeightKg,
    weeklyActivityMinutes: row.weeklyActivityMinutes,
    dailyCalorieGoal: row.dailyCalorieGoal,
    macros: {
      calories: row.dailyCalorieGoal,
      proteinG: row.proteinGoalG,
      carbsG: row.carbsGoalG,
      fatG: row.fatGoalG,
    },
    targets: {
      water: row.water,
      veg: row.veg,
      fruit: row.fruit,
      sleep: row.sleep,
    },
    hideNumbers: Boolean(row.hideNumbers),
  }
}

export async function enableHealth(
  db: D1Database,
  userId: string,
  now = new Date(),
) {
  await db
    .prepare(
      `INSERT INTO health_profiles (user_id, consented_at, consent_version) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .bind(userId, now.toISOString(), CONSENT_VERSION)
    .run()
}

export type ProfilePatch = Partial<{
  units: 'metric' | 'imperial'
  goalWeightKg: number | null
  weeklyActivityMinutes: number
  dailyCalorieGoal: number | null
  proteinGoalG: number | null
  carbsGoalG: number | null
  fatGoalG: number | null
  water: number
  veg: number
  fruit: number
  sleep: number
  hideNumbers: boolean
}>

const PROFILE_COLUMNS: Record<keyof ProfilePatch, string> = {
  units: 'units',
  goalWeightKg: 'goal_weight_kg',
  weeklyActivityMinutes: 'weekly_activity_minutes',
  dailyCalorieGoal: 'daily_calorie_goal',
  proteinGoalG: 'protein_goal_g',
  carbsGoalG: 'carbs_goal_g',
  fatGoalG: 'fat_goal_g',
  water: 'water_glasses',
  veg: 'veg_serves',
  fruit: 'fruit_serves',
  sleep: 'sleep_hours',
  hideNumbers: 'hide_numbers',
}

export async function updateProfile(
  db: D1Database,
  userId: string,
  patch: ProfilePatch,
) {
  const keys = Object.keys(patch) as (keyof ProfilePatch)[]
  if (!keys.length) return
  const values = keys.map((k) =>
    k === 'hideNumbers' ? (patch[k] ? 1 : 0) : (patch[k] ?? null),
  )
  await db
    .prepare(
      `UPDATE health_profiles SET ${keys.map((k) => `${PROFILE_COLUMNS[k]} = ?`).join(', ')},
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE user_id = ?`,
    )
    .bind(...values, userId)
    .run()
}

/** "Delete my health data": every health row and the consent itself. */
export async function deleteHealthData(db: D1Database, userId: string) {
  await db.batch([
    db
      .prepare('DELETE FROM health_supplement_doses WHERE user_id = ?')
      .bind(userId),
    db.prepare('DELETE FROM health_supplements WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM health_habit_days WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM health_activities WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM health_meals WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM health_recipes WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM health_weigh_ins WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM health_profiles WHERE user_id = ?').bind(userId),
  ])
}

// ---------------------------------------------------------------- weigh-ins

export async function weighInFor(
  db: D1Database,
  userId: string,
  day: string,
): Promise<WeighIn | null> {
  return db
    .prepare(
      `SELECT id, day, weight_kg AS weightKg, waist_cm AS waistCm FROM health_weigh_ins WHERE user_id = ? AND day = ?`,
    )
    .bind(userId, day)
    .first<WeighIn>()
}

/** Records (or replaces) that day's weigh-in. A value left out keeps what was already there. */
export async function saveWeighIn(
  db: D1Database,
  userId: string,
  day: string,
  values: { weightKg?: number | null; waistCm?: number | null },
): Promise<WeighIn> {
  const existing = await weighInFor(db, userId, day)
  const weightKg =
    values.weightKg !== undefined
      ? values.weightKg
      : (existing?.weightKg ?? null)
  const waistCm =
    values.waistCm !== undefined ? values.waistCm : (existing?.waistCm ?? null)
  const id = existing?.id ?? newId('hwt')
  await db
    .prepare(
      `INSERT INTO health_weigh_ins (id, user_id, day, weight_kg, waist_cm) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET weight_kg = excluded.weight_kg, waist_cm = excluded.waist_cm,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(id, userId, day, weightKg, waistCm)
    .run()
  return { id, day, weightKg, waistCm }
}

export async function restoreWeighIn(
  db: D1Database,
  userId: string,
  day: string,
  before: WeighIn | null,
) {
  if (!before || (before.weightKg == null && before.waistCm == null)) {
    await db
      .prepare('DELETE FROM health_weigh_ins WHERE user_id = ? AND day = ?')
      .bind(userId, day)
      .run()
    return
  }
  await saveWeighIn(db, userId, day, {
    weightKg: before.weightKg,
    waistCm: before.waistCm,
  })
}

// ---------------------------------------------------------------- meals, activity, habits

export const NUTRITION_COLUMNS: Record<keyof Nutrition, string> = {
  calories: 'calories',
  proteinG: 'protein_g',
  carbsG: 'carbs_g',
  fatG: 'fat_g',
  satFatG: 'sat_fat_g',
  sugarsG: 'sugars_g',
  fibreG: 'fibre_g',
  sodiumMg: 'sodium_mg',
}
export const NUTRITION_SELECT = NUTRIENTS.map(
  (k) => `${NUTRITION_COLUMNS[k]} AS ${k}`,
).join(', ')
export const MEAL_SELECT = `id, day, meal, description, recipe_id AS recipeId, servings, ${NUTRITION_SELECT}, caffeine_mg AS caffeineMg`

export async function addMeal(
  db: D1Database,
  userId: string,
  entry: {
    day: string
    meal: Meal
    description: string
    recipeId?: string | null
    servings?: number
    caffeineMg?: number | null
  } & Partial<Nutrition>,
): Promise<string> {
  const id = newId('hmeal')
  await db
    .prepare(
      `INSERT INTO health_meals (id, user_id, day, meal, description, recipe_id, servings, ${NUTRIENTS.map((k) => NUTRITION_COLUMNS[k]).join(', ')}, caffeine_mg)
       VALUES (?, ?, ?, ?, ?, ?, ?, ${NUTRIENTS.map(() => '?').join(', ')}, ?)`,
    )
    .bind(
      id,
      userId,
      entry.day,
      entry.meal,
      entry.description,
      entry.recipeId ?? null,
      entry.servings ?? 1,
      ...NUTRIENTS.map((k) => entry[k] ?? null),
      entry.caffeineMg ?? null,
    )
    .run()
  return id
}

// ---------------------------------------------------------------- recipes

export const MAX_RECIPES = 300
export const RECIPE_SELECT = `id, name, source_url AS sourceUrl, servings, ${NUTRITION_SELECT}`

export async function listRecipes(
  db: D1Database,
  userId: string,
): Promise<Recipe[]> {
  const { results } = await db
    .prepare(
      `SELECT ${RECIPE_SELECT} FROM health_recipes WHERE user_id = ? AND archived_at IS NULL ORDER BY lower(name), id`,
    )
    .bind(userId)
    .all<Recipe>()
  return results ?? []
}

export async function getRecipe(
  db: D1Database,
  userId: string,
  id: string,
): Promise<Recipe | null> {
  return db
    .prepare(
      `SELECT ${RECIPE_SELECT} FROM health_recipes WHERE id = ? AND user_id = ? AND archived_at IS NULL`,
    )
    .bind(id, userId)
    .first<Recipe>()
}

export async function saveRecipe(
  db: D1Database,
  userId: string,
  r: {
    id?: string
    name: string
    sourceUrl?: string | null
    servings?: number | null
  } & Nutrition,
): Promise<string> {
  const cols = NUTRIENTS.map((k) => NUTRITION_COLUMNS[k])
  if (r.id) {
    await db
      .prepare(
        `UPDATE health_recipes SET name = ?, source_url = ?, servings = ?, ${cols.map((c) => `${c} = ?`).join(', ')},
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND user_id = ? AND archived_at IS NULL`,
      )
      .bind(
        r.name,
        r.sourceUrl ?? null,
        r.servings ?? null,
        ...NUTRIENTS.map((k) => r[k]),
        r.id,
        userId,
      )
      .run()
    return r.id
  }
  const id = newId('hrec')
  await db
    .prepare(
      `INSERT INTO health_recipes (id, user_id, name, source_url, servings, ${cols.join(', ')}) VALUES (?, ?, ?, ?, ?, ${cols.map(() => '?').join(', ')})`,
    )
    .bind(
      id,
      userId,
      r.name,
      r.sourceUrl ?? null,
      r.servings ?? null,
      ...NUTRIENTS.map((k) => r[k]),
    )
    .run()
  return id
}

export async function addActivity(
  db: D1Database,
  userId: string,
  entry: {
    day: string
    kind: string
    minutes?: number | null
    steps?: number | null
    intensity: Intensity
  },
): Promise<string> {
  const id = newId('hact')
  await db
    .prepare(
      'INSERT INTO health_activities (id, user_id, day, kind, minutes, steps, intensity) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      userId,
      entry.day,
      entry.kind,
      entry.minutes ?? null,
      entry.steps ?? null,
      entry.intensity,
    )
    .run()
  return id
}

export async function habitAmount(
  db: D1Database,
  userId: string,
  day: string,
  habit: Habit,
): Promise<number | null> {
  const row = await db
    .prepare(
      'SELECT amount FROM health_habit_days WHERE user_id = ? AND day = ? AND habit = ?',
    )
    .bind(userId, day, habit)
    .first<{ amount: number }>()
  return row ? row.amount : null
}

export async function setHabit(
  db: D1Database,
  userId: string,
  day: string,
  habit: Habit,
  amount: number | null,
) {
  if (amount == null) {
    await db
      .prepare(
        'DELETE FROM health_habit_days WHERE user_id = ? AND day = ? AND habit = ?',
      )
      .bind(userId, day, habit)
      .run()
    return
  }
  await db
    .prepare(
      `INSERT INTO health_habit_days (user_id, day, habit, amount) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, day, habit) DO UPDATE SET amount = excluded.amount, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    )
    .bind(userId, day, habit, Math.max(0, Math.min(100, amount)))
    .run()
}

export const ENTRY_TABLES = {
  meal: 'health_meals',
  activity: 'health_activities',
  dose: 'health_supplement_doses',
} as const
export type EntryTable = keyof typeof ENTRY_TABLES

export async function deleteEntry(
  db: D1Database,
  userId: string,
  table: EntryTable,
  id: string,
): Promise<boolean> {
  const r = await db
    .prepare(`DELETE FROM ${ENTRY_TABLES[table]} WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run()
  return (r.meta?.changes ?? 0) > 0
}

// ---------------------------------------------------------------- supplements

export const MAX_SUPPLEMENTS = 30

export async function listSupplements(
  db: D1Database,
  userId: string,
): Promise<Supplement[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, dose, doses_per_day AS dosesPerDay, caffeine_mg AS caffeineMg
       FROM health_supplements WHERE user_id = ? AND archived_at IS NULL ORDER BY created_at, id`,
    )
    .bind(userId)
    .all<Supplement>()
  return results ?? []
}

export async function supplementsToday(
  db: D1Database,
  userId: string,
  day: string,
): Promise<SupplementToday[]> {
  const list = await listSupplements(db, userId)
  const { results } = await db
    .prepare(
      'SELECT supplement_id AS id, COUNT(*) AS n FROM health_supplement_doses WHERE user_id = ? AND day = ? GROUP BY supplement_id',
    )
    .bind(userId, day)
    .all<{ id: string; n: number }>()
  const taken = new Map((results ?? []).map((r) => [r.id, Number(r.n)]))
  return list.map((s) => ({ ...s, taken: taken.get(s.id) ?? 0 }))
}

export async function addDose(
  db: D1Database,
  userId: string,
  supplementId: string,
  day: string,
): Promise<string> {
  const id = newId('hdose')
  await db
    .prepare(
      'INSERT INTO health_supplement_doses (id, user_id, supplement_id, day) VALUES (?, ?, ?, ?)',
    )
    .bind(id, userId, supplementId, day)
    .run()
  return id
}

// ---------------------------------------------------------------- summary

export async function healthSummary(
  db: D1Database,
  userId: string,
  today: string,
): Promise<HealthSummary | null> {
  const profile = await loadProfile(db, userId)
  if (!profile) return null
  const since = addDays(today, -120)
  const week = weekStart(today)

  const [meals, activities, habitRows, weighIns, weekActivity, supplements] =
    await Promise.all([
      db
        .prepare(
          `SELECT ${MEAL_SELECT} FROM health_meals WHERE user_id = ? AND day = ? ORDER BY created_at, id`,
        )
        .bind(userId, today)
        .all<MealEntry>(),
      db
        .prepare(
          `SELECT id, day, kind, minutes, steps, intensity FROM health_activities
         WHERE user_id = ? AND day = ? ORDER BY created_at, id`,
        )
        .bind(userId, today)
        .all<ActivityEntry>(),
      db
        .prepare(
          'SELECT day, habit, amount FROM health_habit_days WHERE user_id = ? AND day >= ? AND day <= ?',
        )
        .bind(userId, since, today)
        .all<{ day: string; habit: Habit; amount: number }>(),
      db
        .prepare(
          `SELECT id, day, weight_kg AS weightKg, waist_cm AS waistCm FROM health_weigh_ins
         WHERE user_id = ? AND day >= ? AND day <= ? ORDER BY day`,
        )
        .bind(userId, since, today)
        .all<WeighIn>(),
      db
        .prepare(
          `SELECT COALESCE(SUM(minutes), 0) AS minutes, COALESCE(SUM(steps), 0) AS steps FROM health_activities
         WHERE user_id = ? AND day >= ? AND day <= ?`,
        )
        .bind(userId, week, today)
        .first<{ minutes: number; steps: number }>(),
      supplementsToday(db, userId, today),
    ])

  const habits = Object.fromEntries(HABITS.map((h) => [h, 0])) as Record<
    Habit,
    number
  >
  const byHabit = new Map<Habit, Map<string, number>>(
    HABITS.map((h) => [h, new Map()]),
  )
  for (const r of habitRows.results ?? []) {
    byHabit.get(r.habit)?.set(r.day, r.amount)
    if (r.day === today) habits[r.habit] = r.amount
  }
  const streaks = Object.fromEntries(
    HABITS.map((h) => [
      h,
      habitStreak(
        byHabit.get(h)!,
        profile.targets[h] ?? DEFAULT_TARGETS[h],
        today,
      ),
    ]),
  ) as Record<Habit, number>

  const mealList = meals.results ?? []
  const caffeineMg =
    mealList.reduce((s, m) => s + (m.caffeineMg ?? 0), 0) +
    supplements.reduce((s, x) => s + (x.caffeineMg ?? 0) * x.taken, 0)
  const withCalories = mealList.filter((m) => m.calories != null)
  const weighList = weighIns.results ?? []
  const weekly = weeklyAverages(weighList)
  const trend = weightTrend(weekly, today)
  const latest = [...weighList].reverse().find((w) => w.weightKg != null)

  return {
    enabled: true,
    profile,
    today,
    meals: mealList,
    activities: activities.results ?? [],
    habits,
    supplements,
    supplementsDue: supplements.reduce(
      (s, x) => s + Math.max(0, x.dosesPerDay - x.taken),
      0,
    ),
    caffeineMg,
    calories: withCalories.length
      ? withCalories.reduce((s, m) => s + (m.calories ?? 0), 0)
      : null,
    nutrition: totalNutrition(mealList),
    week: {
      start: week,
      activityMinutes: Number(weekActivity?.minutes ?? 0),
      goalMinutes: profile.weeklyActivityMinutes,
      steps: Number(weekActivity?.steps ?? 0),
    },
    weight: {
      weighIns: weighList,
      weekly,
      latestKg: latest?.weightKg ?? null,
      changeKg4Weeks: trend.changeKg4Weeks,
      paceKgPerWeek: trend.paceKgPerWeek,
    },
    streaks,
    notes: healthNotes({
      paceKgPerWeek: trend.paceKgPerWeek,
      weeksOfData: weekly.filter((w) => w.weekStart >= addDays(week, -28))
        .length,
      supplements,
      caffeineMg,
    }),
  }
}
