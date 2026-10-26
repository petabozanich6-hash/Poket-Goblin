/**
 * Health tracking: shared types and pure calculations (used by the Worker and the screens).
 *
 * Tone and safety rules, applied everywhere:
 * - Trends, not single days: weight is shown as a weekly average, because day-to-day changes of a
 *   kilogram or more are normal (water, salt, timing).
 * - Gentle notes only, never judgement. A note appears when something is worth a word with a doctor or
 *   a label (losing faster than about 1 kg a week for several weeks, more doses than set, a lot of caffeine).
 * - General information, not medical advice; the person's own doctor comes first.
 */

import { NUTRIENTS, emptyNutrition, type Nutrition } from './recipes'

export type Units = 'metric' | 'imperial'
export type Meal = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'drink'
export type Intensity = 'light' | 'moderate' | 'vigorous'
export type Habit = 'water' | 'veg' | 'fruit' | 'sleep'

export const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack', 'drink']
export const HABITS: Habit[] = ['water', 'veg', 'fruit', 'sleep']
export const INTENSITIES: Intensity[] = ['light', 'moderate', 'vigorous']

export const HABIT_LABELS: Record<
  Habit,
  { label: string; unit: string; units: string }
> = {
  water: { label: 'Water', unit: 'glass', units: 'glasses' },
  veg: { label: 'Vegetables', unit: 'serve', units: 'serves' },
  fruit: { label: 'Fruit', unit: 'serve', units: 'serves' },
  sleep: { label: 'Sleep', unit: 'hour', units: 'hours' },
}

/**
 * Starting points from Australian guidance, all editable:
 * - 150 minutes of moderate activity a week (Australia's Physical Activity and Sedentary Behaviour Guidelines,
 *   150–300 minutes for adults).
 * - 5 serves of vegetables and 2 of fruit a day (Australian Dietary Guidelines).
 * - 7 hours of sleep (Sleep Health Foundation: 7–9 hours for adults).
 */
export const DEFAULT_TARGETS = {
  weeklyActivityMinutes: 150,
  water: 8,
  veg: 5,
  fruit: 2,
  sleep: 7,
}

/** A sustainable pace of weight loss is commonly given as about 0.5–1 kg a week. */
export const STEADY_LOSS_KG_PER_WEEK = 1
/** A commonly cited daily caffeine guide for healthy adults (not for pregnancy or some conditions). */
export const CAFFEINE_GUIDE_MG = 400

export const DISCLAIMER =
  'General information to help you keep track, not medical advice. Your doctor knows your situation best.'

export type MacroGoals = {
  calories: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
}

export type HealthProfile = {
  enabled: true
  consentedAt: string
  units: Units
  goalWeightKg: number | null
  weeklyActivityMinutes: number
  dailyCalorieGoal: number | null
  macros: MacroGoals
  targets: Record<Habit, number>
  hideNumbers: boolean
}

export type WeighIn = {
  id: string
  day: string
  weightKg: number | null
  waistCm: number | null
}
export type MealEntry = Nutrition & {
  id: string
  day: string
  meal: Meal
  description: string
  recipeId: string | null
  servings: number
  caffeineMg: number | null
}
export type Recipe = Nutrition & {
  id: string
  name: string
  sourceUrl: string | null
  servings: number | null
}
export type ActivityEntry = {
  id: string
  day: string
  kind: string
  minutes: number | null
  steps: number | null
  intensity: Intensity
}
export type Supplement = {
  id: string
  name: string
  dose: string | null
  dosesPerDay: number
  caffeineMg: number | null
}
export type SupplementToday = Supplement & { taken: number }

export type HealthNote = { kind: 'pace' | 'doses' | 'caffeine'; text: string }

export type HealthSummary = {
  enabled: true
  profile: HealthProfile
  today: string
  meals: MealEntry[]
  activities: ActivityEntry[]
  habits: Record<Habit, number>
  supplements: SupplementToday[]
  supplementsDue: number
  caffeineMg: number
  calories: number | null
  /** Today's totals from what was logged with numbers; `counted` meals had any numbers at all. */
  nutrition: Nutrition & { counted: number; uncounted: number }
  week: {
    start: string
    activityMinutes: number
    goalMinutes: number
    steps: number
  }
  weight: {
    weighIns: WeighIn[]
    weekly: { weekStart: string; averageKg: number }[]
    latestKg: number | null
    changeKg4Weeks: number | null
    paceKgPerWeek: number | null
  }
  streaks: Record<Habit, number>
  notes: HealthNote[]
}

// ---------------------------------------------------------------- units

export const KG_PER_LB = 0.45359237
export const LB_PER_STONE = 14
export const CM_PER_IN = 2.54

export const round1 = (n: number) => Math.round(n * 10) / 10

export function kgFromLb(lb: number): number {
  return lb * KG_PER_LB
}
export function lbFromKg(kg: number): number {
  return kg / KG_PER_LB
}
export function kgFromStone(stone: number, lb = 0): number {
  return kgFromLb(stone * LB_PER_STONE + lb)
}

/** "92.4 kg", or "203.7 lb" for imperial. */
export function formatWeight(kg: number, units: Units): string {
  return units === 'imperial'
    ? `${round1(lbFromKg(kg))} lb`
    : `${round1(kg)} kg`
}
export function formatWaist(cm: number, units: Units): string {
  return units === 'imperial'
    ? `${round1(cm / CM_PER_IN)} in`
    : `${round1(cm)} cm`
}

// ---------------------------------------------------------------- days

/** YYYY-MM-DD plus n days (UTC arithmetic on a date-only value, so no timezone drift). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Monday of the week containing `day` (weeks run Monday to Sunday). */
export function weekStart(day: string): string {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return addDays(day, -((dow + 6) % 7))
}

export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

// ---------------------------------------------------------------- calculations

/** Average weight per week (Monday start), oldest first. */
export function weeklyAverages(
  weighIns: WeighIn[],
): { weekStart: string; averageKg: number }[] {
  const byWeek = new Map<string, number[]>()
  for (const w of weighIns) {
    if (w.weightKg == null) continue
    const k = weekStart(w.day)
    byWeek.set(k, [...(byWeek.get(k) ?? []), w.weightKg])
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, xs]) => ({
      weekStart: k,
      averageKg: round1(xs.reduce((s, x) => s + x, 0) / xs.length),
    }))
}

/**
 * Change over the last four weeks and average weekly pace, from weekly averages (so one heavy or light
 * morning doesn't swing it). Needs at least two weeks with a weigh-in. Negative means losing.
 */
export function weightTrend(
  weekly: { weekStart: string; averageKg: number }[],
  today: string,
) {
  const recent = weekly.filter(
    (w) => w.weekStart >= addDays(weekStart(today), -28),
  )
  if (recent.length < 2) return { changeKg4Weeks: null, paceKgPerWeek: null }
  const first = recent[0]!,
    last = recent[recent.length - 1]!
  const weeks = Math.max(
    1,
    (Date.parse(last.weekStart) - Date.parse(first.weekStart)) /
      (7 * 86_400_000),
  )
  const change = last.averageKg - first.averageKg
  return {
    changeKg4Weeks: round1(change),
    paceKgPerWeek: round1(change / weeks),
  }
}

/** Consecutive days, ending yesterday or today, where the habit reached its target. */
export function habitStreak(
  amountsByDay: Map<string, number>,
  target: number,
  today: string,
): number {
  if (target <= 0) return 0
  let day =
    (amountsByDay.get(today) ?? 0) >= target ? today : addDays(today, -1)
  let n = 0
  while ((amountsByDay.get(day) ?? 0) >= target && n < 400) {
    n++
    day = addDays(day, -1)
  }
  return n
}

/** Gentle notes. Never about a single day's weight. */
export function healthNotes(input: {
  paceKgPerWeek: number | null
  weeksOfData: number
  supplements: SupplementToday[]
  caffeineMg: number
}): HealthNote[] {
  const notes: HealthNote[] = []
  if (
    input.paceKgPerWeek != null &&
    input.weeksOfData >= 3 &&
    input.paceKgPerWeek < -STEADY_LOSS_KG_PER_WEEK
  ) {
    notes.push({
      kind: 'pace',
      text: `You've been losing about ${Math.abs(input.paceKgPerWeek)} kg a week. That's faster than the 0.5–1 kg a week usually suggested, so it's worth mentioning to your doctor.`,
    })
  }
  for (const s of input.supplements) {
    if (s.taken > s.dosesPerDay) {
      notes.push({
        kind: 'doses',
        text: `${s.name}: ${s.taken} logged today, and you set ${s.dosesPerDay}. Check the label before taking more.`,
      })
    }
  }
  if (input.caffeineMg > CAFFEINE_GUIDE_MG) {
    notes.push({
      kind: 'caffeine',
      text: `About ${input.caffeineMg} mg of caffeine logged today. Around ${CAFFEINE_GUIDE_MG} mg a day is a commonly cited guide for healthy adults.`,
    })
  }
  return notes
}

// ---------------------------------------------------------------- macros

/** About 2,000 mg of sodium (5 g of salt) a day is Australia's suggested dietary target for adults. */
export const SODIUM_GUIDE_MG = 2000
/** Calorie goals below this need a plan with a doctor or dietitian; the app won't set one. */
export const MIN_CALORIE_GOAL = 1200

export type MacroPreset = {
  id: string
  label: string
  plain: string
  carbs: number
  protein: number
  fat: number
}

/**
 * Plain-English starting points (percent of calories). "Balanced" sits inside the ranges in Australia's
 * Nutrient Reference Values (carbs 45–65%, protein 15–25%, fat 20–35%).
 */
export const MACRO_PRESETS: MacroPreset[] = [
  {
    id: 'balanced',
    label: 'Balanced',
    plain: 'A bit of everything, close to the Australian guidelines.',
    carbs: 50,
    protein: 20,
    fat: 30,
  },
  {
    id: 'higher_protein',
    label: 'Higher protein',
    plain: 'More protein helps you feel full while eating less.',
    carbs: 40,
    protein: 30,
    fat: 30,
  },
  {
    id: 'lower_carb',
    label: 'Lower carb',
    plain: 'Fewer carbs, more protein and fat.',
    carbs: 25,
    protein: 35,
    fat: 40,
  },
]

/** Grams for a calorie goal and a split (protein and carbs have about 4 kcal per gram, fat about 9). */
export function macrosFor(
  calories: number,
  split: { carbs: number; protein: number; fat: number },
): MacroGoals {
  return {
    calories: Math.round(calories),
    proteinG: Math.round((calories * split.protein) / 100 / 4),
    carbsG: Math.round((calories * split.carbs) / 100 / 4),
    fatG: Math.round((calories * split.fat) / 100 / 9),
  }
}

export type CalorieInput = {
  weightKg: number
  heightCm: number
  age: number
  sex: 'male' | 'female' | 'unspecified'
  activity: 'little' | 'light' | 'moderate' | 'very'
}
const ACTIVITY_FACTOR = {
  little: 1.2,
  light: 1.375,
  moderate: 1.55,
  very: 1.725,
}

/**
 * A starting estimate only (Mifflin–St Jeor resting energy x activity), then about 500 kcal less a day,
 * which is roughly 0.5 kg a week. Never below 1,200. Runs on the device; nothing here is stored.
 */
export function suggestCalories(
  i: CalorieInput,
): { maintain: number; lose: number; floored: boolean } | null {
  if (!(
    i.weightKg >= 30 &&
    i.weightKg <= 300 &&
    i.heightCm >= 120 &&
    i.heightCm <= 230 &&
    i.age >= 18 &&
    i.age <= 100
  ))
    return null
  const sexTerm = i.sex === 'male' ? 5 : i.sex === 'female' ? -161 : -78
  const bmr = 10 * i.weightKg + 6.25 * i.heightCm - 5 * i.age + sexTerm
  const maintain = Math.round((bmr * ACTIVITY_FACTOR[i.activity]) / 10) * 10
  const target = maintain - 500
  return {
    maintain,
    lose: Math.max(MIN_CALORIE_GOAL, target),
    floored: target < MIN_CALORIE_GOAL,
  }
}

/** Today's nutrition from logged meals (only meals with numbers count towards the totals). */
export function totalNutrition(
  meals: MealEntry[],
): Nutrition & { counted: number; uncounted: number } {
  const out = { ...emptyNutrition(), counted: 0, uncounted: 0 }
  for (const m of meals) {
    const any = NUTRIENTS.some((k) => m[k] != null)
    if (any) out.counted++
    else if (m.meal !== 'drink') out.uncounted++
    for (const k of NUTRIENTS) {
      const v = m[k]
      if (v != null) out[k] = Math.round(((out[k] ?? 0) + v) * 10) / 10
    }
  }
  return out
}
