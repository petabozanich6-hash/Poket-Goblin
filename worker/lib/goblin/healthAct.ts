/**
 * The Goblin's health logging: turns a parsed health phrase into an undoable action.
 * Rules only. Health details are never sent to an AI model, and a health phrase is never put in the
 * brain-dump review queue (which may use AI).
 */
import type { HealthOp } from '../../../shared/goblin/health'
import { bestMatch } from '../../../shared/goblin/match'
import {
  HABIT_LABELS,
  formatWaist,
  formatWeight,
  kgFromLb,
  round1,
  type Habit,
  type Meal,
  type WeighIn,
} from '../../../shared/health'
import { scaleNutrition } from '../../../shared/recipes'
import { todayLocalFromOffset } from '../datetime'
import {
  habitAmount,
  healthSummary,
  healthTablesReady,
  listRecipes,
  loadProfile,
  restoreWeighIn,
  saveWeighIn,
  setHabit,
  supplementsToday,
  weighInFor,
} from '../health'
import { newId } from '../ids'
import { act, type ActResult, type Ctx } from './act'

export type HealthPlan =
  | {
      kind: 'health_insert'
      entry: 'meal' | 'activity' | 'dose'
      /** Ids chosen up front, so undo can remove exactly these rows. */
      ids: string[]
      rows: Record<string, unknown>[]
      name: string
    }
  | {
      kind: 'health_update'
      entry: 'weigh_in'
      day: string
      before: WeighIn | null
      after: { weightKg?: number | null; waistCm?: number | null }
      name: string
    }
  | {
      kind: 'health_update'
      entry: 'habit'
      day: string
      habit: Habit
      before: number | null
      after: number
      name: string
    }

const OFF_MESSAGE =
  'I can keep track of that for you once Health is turned on (My life → Health). Nothing was saved.'

/** Applies a health plan; returns the first record id (or the day for updates). */
export async function applyHealthPlan(
  db: D1Database,
  userId: string,
  plan: HealthPlan,
): Promise<string> {
  if (plan.kind === 'health_update') {
    if (plan.entry === 'weigh_in') {
      await saveWeighIn(db, userId, plan.day, plan.after)
      return plan.day
    }
    await setHabit(db, userId, plan.day, plan.habit, plan.after)
    return plan.day
  }
  for (let i = 0; i < plan.rows.length; i++) {
    const row = plan.rows[i] as Record<string, never>
    const id = plan.ids[i]!
    if (plan.entry === 'meal') {
      await insertWithId(db, 'health_meals', id, userId, row)
    } else if (plan.entry === 'activity') {
      await insertWithId(db, 'health_activities', id, userId, row)
    } else {
      await insertWithId(db, 'health_supplement_doses', id, userId, row)
    }
  }
  return plan.ids[0] ?? ''
}

const COLUMNS: Record<string, Record<string, string>> = {
  health_meals: {
    day: 'day',
    meal: 'meal',
    description: 'description',
    recipeId: 'recipe_id',
    servings: 'servings',
    calories: 'calories',
    proteinG: 'protein_g',
    carbsG: 'carbs_g',
    fatG: 'fat_g',
    satFatG: 'sat_fat_g',
    sugarsG: 'sugars_g',
    fibreG: 'fibre_g',
    sodiumMg: 'sodium_mg',
    caffeineMg: 'caffeine_mg',
  },
  health_activities: {
    day: 'day',
    kind: 'kind',
    minutes: 'minutes',
    steps: 'steps',
    intensity: 'intensity',
  },
  health_supplement_doses: { day: 'day', supplementId: 'supplement_id' },
}

async function insertWithId(
  db: D1Database,
  table: keyof typeof COLUMNS,
  id: string,
  userId: string,
  row: Record<string, unknown>,
) {
  const map = COLUMNS[table]!
  const keys = Object.keys(row).filter((k) => k in map && row[k] !== undefined)
  // A dose must belong to one of the person's own supplements.
  if (table === 'health_supplement_doses') {
    const own = await db
      .prepare(
        'SELECT 1 AS ok FROM health_supplements WHERE id = ? AND user_id = ?',
      )
      .bind(row.supplementId as string, userId)
      .first()
    if (!own) throw new Error('Supplement not found')
  }
  await db
    .prepare(
      `INSERT INTO ${table} (id, user_id, ${keys.map((k) => map[k]).join(', ')}) VALUES (?, ?, ${keys.map(() => '?').join(', ')})`,
    )
    .bind(
      id,
      userId,
      ...keys.map((k) => (row[k] ?? null) as string | number | null),
    )
    .run()
}

/** Undo: removes exactly the rows added, or puts back what was there before. */
export async function revertHealthPlan(
  db: D1Database,
  userId: string,
  plan: HealthPlan,
) {
  if (plan.kind === 'health_update') {
    if (plan.entry === 'weigh_in')
      await restoreWeighIn(db, userId, plan.day, plan.before)
    else await setHabit(db, userId, plan.day, plan.habit, plan.before)
    return
  }
  const table =
    plan.entry === 'meal'
      ? 'health_meals'
      : plan.entry === 'activity'
        ? 'health_activities'
        : 'health_supplement_doses'
  for (const id of plan.ids)
    await db
      .prepare(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`)
      .bind(id, userId)
      .run()
}

// ---------------------------------------------------------------- the Goblin's side

function mealByClock(ctx: Ctx): Meal {
  const h = new Date(ctx.now.getTime() - ctx.offset * 60_000).getUTCHours()
  return h < 10
    ? 'breakfast'
    : h < 14
      ? 'lunch'
      : h >= 17 && h < 21
        ? 'dinner'
        : 'snack'
}

const servingsText = (s: number) =>
  s === 1 ? '' : s === 0.5 ? 'half a serve of ' : `${s} serves of `

export async function healthAct(ctx: Ctx, op: HealthOp): Promise<ActResult> {
  if (!(await healthTablesReady(ctx.db)))
    return { kind: 'info', message: OFF_MESSAGE }
  const profile = await loadProfile(ctx.db, ctx.userId)
  if (!profile) return { kind: 'info', message: OFF_MESSAGE }
  const day = todayLocalFromOffset(ctx.offset, ctx.now)

  switch (op.kind) {
    case 'unclear':
      return { kind: 'info', message: op.hint }

    case 'weigh': {
      let weightKg: number | undefined
      if (op.weight != null) {
        const unit =
          op.weightUnit ?? (profile.units === 'imperial' ? 'lb' : 'kg')
        // Two decimals, so a weight said in pounds or stone reads back exactly as it was said.
        weightKg =
          Math.round((unit === 'lb' ? kgFromLb(op.weight) : op.weight) * 100) /
          100
        if (weightKg < 20 || weightKg > 400)
          return {
            kind: 'info',
            message:
              "That weight doesn't look right. Try something like “I weighed 92.4 kg”.",
          }
      }
      const waistCm = op.waistCm != null ? round1(op.waistCm) : undefined
      if (waistCm != null && (waistCm < 30 || waistCm > 300))
        return {
          kind: 'info',
          message: "That waist measurement doesn't look right.",
        }
      const before = await weighInFor(ctx.db, ctx.userId, day)
      const parts = [
        weightKg != null
          ? profile.hideNumbers
            ? 'your weight'
            : formatWeight(weightKg, profile.units)
          : null,
        waistCm != null
          ? profile.hideNumbers
            ? 'your waist'
            : `waist ${formatWaist(waistCm, profile.units)}`
          : null,
      ].filter(Boolean)
      const plan: HealthPlan = {
        kind: 'health_update',
        entry: 'weigh_in',
        day,
        before,
        after: {
          ...(weightKg != null ? { weightKg } : {}),
          ...(waistCm != null ? { waistCm } : {}),
        },
        name: 'weigh-in',
      }
      return act(
        ctx,
        plan,
        `Logged ${parts.join(' and ')} for today${before ? ' (it replaces the earlier one)' : ''}. Weekly averages tell the real story, so don't sweat a single day.`,
      )
    }

    case 'activity': {
      const label =
        op.activity === 'steps'
          ? `${op.steps!.toLocaleString('en-AU')} steps`
          : `${op.minutes} minutes of ${op.activity === 'gym' ? 'gym' : op.activity}`
      const id = newId('hact')
      const plan: HealthPlan = {
        kind: 'health_insert',
        entry: 'activity',
        ids: [id],
        rows: [
          {
            day,
            kind: op.activity,
            minutes: op.minutes,
            steps: op.steps,
            intensity: op.intensity,
          },
        ],
        name: label,
      }
      return act(ctx, plan, `Nice one: ${label} logged.`)
    }

    case 'habit': {
      const before = await habitAmount(ctx.db, ctx.userId, day, op.habit)
      const after = Math.min(
        100,
        op.mode === 'add' ? (before ?? 0) + op.amount : op.amount,
      )
      const { units, label } = HABIT_LABELS[op.habit]
      const target = profile.targets[op.habit]
      const plan: HealthPlan = {
        kind: 'health_update',
        entry: 'habit',
        day,
        habit: op.habit,
        before,
        after,
        name: label.toLowerCase(),
      }
      const progress =
        op.habit === 'sleep'
          ? `${after} hours of sleep logged`
          : `${label}: ${after} of ${target} ${units} today`
      return act(
        ctx,
        plan,
        `${progress}.${op.habit !== 'sleep' && after >= target && (before ?? 0) < target ? ' Goal reached!' : ''}`,
      )
    }

    case 'meal': {
      const meal = op.meal ?? mealByClock(ctx)
      const recipes = await listRecipes(ctx.db, ctx.userId)
      const m = bestMatch(
        op.food,
        recipes.map((r) => ({ id: r.id, title: r.name, type: 'recipe' })),
      )
      const recipe =
        m.kind === 'one'
          ? (recipes.find((r) => r.id === m.match.id) ?? null)
          : null
      const id = newId('hmeal')
      if (recipe) {
        const totals = scaleNutrition(recipe, op.servings)
        const plan: HealthPlan = {
          kind: 'health_insert',
          entry: 'meal',
          ids: [id],
          rows: [
            {
              day,
              meal,
              description: recipe.name,
              recipeId: recipe.id,
              servings: op.servings,
              ...totals,
            },
          ],
          name: recipe.name,
        }
        const nums =
          !profile.hideNumbers && totals.calories != null
            ? ` (about ${totals.calories} kcal${totals.proteinG != null ? `, ${totals.proteinG} g protein` : ''})`
            : ''
        return act(
          ctx,
          plan,
          `Logged ${servingsText(op.servings)}${recipe.name} for ${meal}${nums}.`,
        )
      }
      const description = op.food.charAt(0).toUpperCase() + op.food.slice(1)
      const plan: HealthPlan = {
        kind: 'health_insert',
        entry: 'meal',
        ids: [id],
        rows: [{ day, meal, description, servings: op.servings }],
        name: description,
      }
      return act(
        ctx,
        plan,
        `Logged ${description.toLowerCase()} for ${meal === 'drink' ? 'a drink' : meal}. Add the numbers on the Health page if you'd like it counted towards your macros.`,
      )
    }

    case 'dose': {
      const today = await supplementsToday(ctx.db, ctx.userId, day)
      if (!today.length)
        return {
          kind: 'info',
          message:
            'Add your supplements on the Health page first, then I can tick them off for you.',
        }
      let picked = today
      if (op.name) {
        const m = bestMatch(
          op.name,
          today.map((s) => ({ id: s.id, title: s.name, type: 'supplement' })),
        )
        if (m.kind === 'none') {
          // "had my X" that isn't a supplement: it's something they ate or drank.
          if (op.viaHad)
            return healthAct(ctx, {
              kind: 'meal',
              meal: null,
              food: op.name,
              servings: 1,
            })
          return {
            kind: 'info',
            message: `I couldn't find “${op.name}” in your supplements. You can add it on the Health page.`,
          }
        }
        picked =
          m.kind === 'one'
            ? today.filter((s) => s.id === m.match.id)
            : today.filter((s) => m.matches.some((x) => x.id === s.id))
        if (picked.length > 1) {
          return {
            kind: 'info',
            message: `Which one: ${picked.map((s) => s.name).join(' or ')}?`,
          }
        }
      } else {
        picked = today.filter((s) => s.taken < s.dosesPerDay)
        if (!picked.length)
          return {
            kind: 'info',
            message:
              'All your supplements are already ticked off for today. 👍',
          }
      }
      const over = picked.filter((s) => s.taken + 1 > s.dosesPerDay)
      const names = picked.map((s) => s.name)
      const plan: HealthPlan = {
        kind: 'health_insert',
        entry: 'dose',
        ids: picked.map(() => newId('hdose')),
        rows: picked.map((s) => ({ day, supplementId: s.id })),
        name: names.join(', '),
      }
      const warn = over.length
        ? ` Heads up: that's more than the ${over[0]!.dosesPerDay} a day you set for ${over[0]!.name}, so check the label.`
        : ''
      return act(
        ctx,
        plan,
        `Ticked off ${names.join(' and ')} for today.${warn}`,
      )
    }

    case 'query': {
      const s = await healthSummary(ctx.db, ctx.userId, day)
      if (!s) return { kind: 'info', message: OFF_MESSAGE }
      if (op.what === 'supplements') {
        if (!s.supplements.length)
          return {
            kind: 'info',
            message:
              "You haven't added any supplements yet. You can on the Health page.",
          }
        const left = s.supplements
          .filter((x) => x.taken < x.dosesPerDay)
          .map((x) => x.name)
        const done = s.supplements
          .filter((x) => x.taken >= x.dosesPerDay)
          .map((x) => x.name)
        return {
          kind: 'info',
          message: left.length
            ? `Still to take today: ${left.join(', ')}.${done.length ? ` Done: ${done.join(', ')}.` : ''}`
            : `Yes, all done for today: ${done.join(', ')}. 👍`,
        }
      }
      if (op.what === 'weight') {
        const { latestKg, changeKg4Weeks } = s.weight
        if (latestKg == null)
          return {
            kind: 'info',
            message:
              'No weigh-ins yet. Tell me your weight any time, like “I weighed 92 kg”.',
          }
        if (changeKg4Weeks == null)
          return {
            kind: 'info',
            message:
              'I need about two weeks of weigh-ins to show a trend. Keep going!',
          }
        const dir =
          changeKg4Weeks < 0 ? 'down' : changeKg4Weeks > 0 ? 'up' : 'steady'
        if (profile.hideNumbers)
          return {
            kind: 'info',
            message: `Your weekly average is trending ${dir} over the last few weeks.`,
          }
        return {
          kind: 'info',
          message: `Your weekly average is ${formatWeight(s.weight.weekly.at(-1)!.averageKg, profile.units)}, ${dir === 'steady' ? 'steady' : `${dir} ${Math.abs(changeKg4Weeks)} kg`} over the last four weeks.${s.notes.find((n) => n.kind === 'pace') ? ` ${s.notes.find((n) => n.kind === 'pace')!.text}` : ''}`,
        }
      }
      const n = s.nutrition
      const goal = profile.macros
      const parts: string[] = []
      if (n.calories != null)
        parts.push(
          `${n.calories}${goal.calories ? ` of ${goal.calories}` : ''} kcal`,
        )
      if (n.proteinG != null)
        parts.push(
          `${n.proteinG}${goal.proteinG ? ` of ${goal.proteinG}` : ''} g protein`,
        )
      if (n.carbsG != null) parts.push(`${n.carbsG} g carbs`)
      if (n.fatG != null) parts.push(`${n.fatG} g fat`)
      const food = parts.length
        ? `So far today: ${parts.join(', ')}.`
        : s.meals.length
          ? `You've logged ${s.meals.length} thing${s.meals.length === 1 ? '' : 's'} today, without numbers.`
          : 'Nothing logged yet today.'
      const move = `${s.week.activityMinutes} of ${s.week.goalMinutes} active minutes this week.`
      return { kind: 'info', message: `${food} ${move}` }
    }
  }
}
