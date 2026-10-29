import { useQuery } from '@tanstack/react-query'
import { Check, HeartPulse, Minus, Plus } from 'lucide-react'
import { useState } from 'react'

import {
  CAFFEINE_GUIDE_MG,
  DISCLAIMER,
  HABITS,
  HABIT_LABELS,
  SODIUM_GUIDE_MG,
  formatWeight,
  kgFromLb,
  lbFromKg,
  round1,
  type HealthSummary,
  type Intensity,
  type Meal,
} from '@shared/health'
import { NUTRIENTS, NUTRIENT_LABELS, type Nutrition } from '@shared/recipes'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import pageStyles from '@/pages/Page.module.css'

import {
  addSupplement,
  changeHabit,
  deleteEntry,
  deleteWeighIn,
  fetchHealth,
  fetchHistory,
  fetchRecipes,
  logActivity,
  logMeal,
  logWeighIn,
  removeSupplement,
  takeDose,
} from './healthApi'
import { HealthConsent, HealthSettings } from './HealthSetup'
import styles from './HealthPage.module.css'
import { mealLabel, nutritionLine } from './healthFormat'
import { AnalyseRecipe, MyRecipes } from './RecipeTools'
import { useHealthAction } from './useHealthAction'

type Tab = 'today' | 'weight' | 'recipes' | 'history' | 'goals'
const TABS: [Tab, string][] = [
  ['today', 'Today'],
  ['weight', 'Weight'],
  ['recipes', 'Recipes'],
  ['history', 'History'],
  ['goals', 'Goals & settings'],
]

export function HealthPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth })
  const [tab, setTab] = useState<Tab>('today')

  if (health.isLoading) return <p className={styles.muted}>Loading…</p>
  if (health.isError || !health.data)
    return (
      <p className={styles.error}>Health couldn’t load. Please try again.</p>
    )
  const data = health.data
  if (!data.available) {
    return (
      <Card>
        <p className={styles.muted}>
          Health tracking is being set up. Please check back soon.
        </p>
      </Card>
    )
  }

  return (
    <div className={pageStyles.page} data-testid="health-page">
      <div>
        <h1 className={styles.cardTitle} style={{ fontSize: '1.6rem' }}>
          <HeartPulse aria-hidden /> Health
        </h1>
        <p className={pageStyles.sub}>
          Small steps, tracked kindly. Log it here or tell the Goblin.
        </p>
      </div>
      {!data.enabled ? (
        <HealthConsent />
      ) : (
        <>
          <div
            className={pageStyles.tabs}
            role="tablist"
            aria-label="Health sections"
            style={{ flexWrap: 'wrap' }}
          >
            {TABS.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? pageStyles.tabActive : pageStyles.tab}
                onClick={() => setTab(id)}
                data-testid={`health-tab-${id}`}
              >
                {label}
              </button>
            ))}
          </div>
          {data.notes.map((n) => (
            <p
              key={n.kind + n.text}
              className={styles.note}
              role="note"
              data-testid="health-note"
            >
              {n.text}
            </p>
          ))}
          {tab === 'today' && <Today s={data} />}
          {tab === 'weight' && <WeightView s={data} />}
          {tab === 'recipes' && (
            <div className={styles.grid}>
              <AnalyseRecipe />
              <MyRecipes />
            </div>
          )}
          {tab === 'history' && <HistoryView s={data} />}
          {tab === 'goals' && <HealthSettings profile={data.profile} />}
          <p className={styles.faint}>{DISCLAIMER}</p>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- today

function Bar({
  label,
  value,
  goal,
  unit,
  guide,
}: {
  label: string
  value: number | null
  goal: number | null
  unit: string
  guide?: boolean
}) {
  const v = value ?? 0
  const pct = goal ? Math.min(100, (v / goal) * 100) : 0
  return (
    <div data-testid={`bar-${label.toLowerCase().replace(/\W+/g, '-')}`}>
      <div className={styles.barLabel}>
        <span>{label}</span>
        <span className={styles.muted}>
          {round1(v)}
          {goal ? ` of ${goal}` : ''} {unit}
          {guide && goal ? ' suggested' : ''}
        </span>
      </div>
      {goal ? (
        <div
          className={styles.bar}
          role="progressbar"
          aria-label={label}
          aria-valuenow={round1(v)}
          aria-valuemax={goal}
        >
          <div
            className={`${styles.barFill} ${v > goal ? styles.barOver : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
    </div>
  )
}

function Today({ s }: { s: HealthSummary }) {
  return (
    <div className={styles.grid}>
      <SupplementsCard s={s} />
      <FoodCard s={s} />
      <ActivityCard s={s} />
      <HabitsCard s={s} />
    </div>
  )
}

function SupplementsCard({ s }: { s: HealthSummary }) {
  const take = useHealthAction(takeDose)
  const add = useHealthAction(addSupplement, () =>
    setForm({ name: '', dose: '', perDay: '1', caffeine: '' }),
  )
  const remove = useHealthAction(removeSupplement)
  const [form, setForm] = useState({
    name: '',
    dose: '',
    perDay: '1',
    caffeine: '',
  })
  // The add form stays open while someone adds several in a row; Remove buttons show while it's open.
  const [editing, setEditing] = useState(s.supplements.length === 0)
  return (
    <Card>
      <h2 className={styles.cardTitle}>Supplements</h2>
      {s.supplements.length === 0 ? (
        <p className={styles.muted}>
          Add the supplements you take, and tick them off each day (or tell the
          Goblin “took my multivitamin”).
        </p>
      ) : (
        <>
          <p className={styles.muted} data-testid="supplements-due">
            {s.supplementsDue
              ? `${s.supplementsDue} still to take today.`
              : 'All done for today. 👍'}
          </p>
          <ul className={styles.list}>
            {s.supplements.map((x) => (
              <li key={x.id} className={`${styles.item} ${styles.tick}`}>
                <span>
                  <strong>{x.name}</strong>
                  {x.dose ? (
                    <span className={styles.faint}> · {x.dose}</span>
                  ) : null}
                  <br />
                  <span
                    className={
                      x.taken >= x.dosesPerDay ? styles.done : styles.faint
                    }
                  >
                    {x.taken} of {x.dosesPerDay} today
                  </span>
                </span>
                {editing ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => remove.run(x.id)}
                    aria-label={`Stop tracking ${x.name}`}
                  >
                    Remove
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant={x.taken >= x.dosesPerDay ? 'secondary' : 'primary'}
                    onClick={() => take.run(x.id)}
                    aria-label={`Took ${x.name}`}
                    data-testid={`take-${x.name}`}
                  >
                    <Check size={16} aria-hidden /> Took it
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {s.caffeineMg > 0 && (
            <p className={styles.faint}>
              Caffeine logged today: about {s.caffeineMg} mg (a commonly cited
              guide is {CAFFEINE_GUIDE_MG} mg a day).
            </p>
          )}
        </>
      )}
      <details
        className={styles.details}
        open={editing}
        onToggle={(e) => setEditing(e.currentTarget.open)}
      >
        <summary>
          {s.supplements.length ? 'Add or remove' : 'Add a supplement'}
        </summary>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            add.run({
              name: form.name,
              dose: form.dose || null,
              dosesPerDay: Number(form.perDay) || 1,
              caffeineMg: form.caffeine ? Number(form.caffeine) : null,
            })
          }}
          style={{ display: 'grid', gap: 'var(--space-2)' }}
        >
          <Input
            label="Name"
            placeholder="e.g. Voost multivitamin"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            name="supp-name"
          />
          <div className={styles.row}>
            <Input
              className={styles.grow}
              label="Dose (optional)"
              placeholder="1 tablet"
              value={form.dose}
              onChange={(e) => setForm({ ...form, dose: e.target.value })}
              name="supp-dose"
            />
            <Input
              className={styles.small}
              label="Times a day"
              inputMode="numeric"
              value={form.perDay}
              onChange={(e) => setForm({ ...form, perDay: e.target.value })}
              name="supp-per-day"
            />
            <Input
              className={styles.small}
              label="Caffeine mg"
              inputMode="numeric"
              placeholder="from label"
              value={form.caffeine}
              onChange={(e) => setForm({ ...form, caffeine: e.target.value })}
              name="supp-caffeine"
            />
          </div>
          {add.error && <p className={styles.error}>{add.error}</p>}
          <div>
            <Button
              type="submit"
              size="sm"
              disabled={!form.name.trim() || add.busy}
              data-testid="supp-add"
            >
              Add supplement
            </Button>
          </div>
        </form>
      </details>
    </Card>
  )
}

function FoodCard({ s }: { s: HealthSummary }) {
  const recipes = useQuery({
    queryKey: ['health-recipes'],
    queryFn: fetchRecipes,
  })
  const log = useHealthAction(logMeal, () => setForm(blank()))
  const remove = useHealthAction(({ id }: { id: string }) =>
    deleteEntry('meal', id),
  )
  const blank = () => ({
    meal: guessMeal(),
    recipeId: '',
    servings: '1',
    description: '',
    numbers: false,
    values: {} as Partial<Record<keyof Nutrition, string>>,
  })
  const [form, setForm] = useState(blank)
  const goals = s.profile.macros
  const n = s.nutrition
  return (
    <Card>
      <h2 className={styles.cardTitle}>Food and drink</h2>
      {s.meals.length > 0 && (
        <ul className={styles.list} data-testid="meal-list">
          {s.meals.map((m) => (
            <li key={m.id} className={styles.item}>
              <span>
                <span className={styles.faint}>{mealLabel(m.meal)}</span>{' '}
                {m.servings !== 1 ? `${m.servings} × ` : ''}
                {m.description}
                {nutritionLine(m) ? (
                  <span className={styles.faint}> · {nutritionLine(m)}</span>
                ) : null}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${m.description}`}
                onClick={() => remove.run({ id: m.id })}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 'var(--space-3)' }}>
        <Bar
          label="Calories"
          value={n.calories}
          goal={goals.calories}
          unit="kcal"
        />
        <Bar
          label="Protein"
          value={n.proteinG}
          goal={goals.proteinG}
          unit="g"
        />
        <Bar label="Carbs" value={n.carbsG} goal={goals.carbsG} unit="g" />
        <Bar label="Fat" value={n.fatG} goal={goals.fatG} unit="g" />
        {n.sodiumMg != null && (
          <Bar
            label="Sodium"
            value={n.sodiumMg}
            goal={SODIUM_GUIDE_MG}
            unit="mg"
            guide
          />
        )}
        {n.uncounted > 0 && (
          <p className={styles.faint}>
            {n.uncounted} meal{n.uncounted === 1 ? '' : 's'} today without
            numbers aren’t counted.
          </p>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const values = Object.fromEntries(
            NUTRIENTS.filter((k) => form.values[k]?.trim()).map((k) => [
              k,
              Number(form.values[k]),
            ]),
          )
          log.run(
            form.recipeId
              ? {
                  meal: form.meal,
                  recipeId: form.recipeId,
                  servings: Number(form.servings) || 1,
                }
              : { meal: form.meal, description: form.description, ...values },
          )
        }}
        style={{
          display: 'grid',
          gap: 'var(--space-2)',
          marginTop: 'var(--space-3)',
        }}
        data-testid="meal-form"
      >
        <div className={styles.row}>
          <label className={`${styles.selectLabel} ${styles.small}`}>
            Meal
            <select
              className={styles.select}
              value={form.meal}
              onChange={(e) =>
                setForm({ ...form, meal: e.target.value as Meal })
              }
            >
              {(
                ['breakfast', 'lunch', 'dinner', 'snack', 'drink'] as Meal[]
              ).map((m) => (
                <option key={m} value={m}>
                  {mealLabel(m)}
                </option>
              ))}
            </select>
          </label>
          {(recipes.data?.recipes.length ?? 0) > 0 && (
            <label className={`${styles.selectLabel} ${styles.grow}`}>
              From my recipes
              <select
                className={styles.select}
                value={form.recipeId}
                onChange={(e) => setForm({ ...form, recipeId: e.target.value })}
                data-testid="meal-recipe"
              >
                <option value="">Something else</option>
                {recipes.data!.recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {form.recipeId ? (
          <Input
            label="Servings eaten"
            inputMode="decimal"
            value={form.servings}
            onChange={(e) => setForm({ ...form, servings: e.target.value })}
            name="meal-servings"
          />
        ) : (
          <>
            <Input
              label="What did you have?"
              placeholder="e.g. Chicken salad"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              name="meal-description"
            />
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={form.numbers}
                onChange={(e) =>
                  setForm({ ...form, numbers: e.target.checked })
                }
              />
              <span>Add calories and macros</span>
            </label>
            {form.numbers && (
              <div className={styles.row}>
                {NUTRIENTS.slice(0, 4).map((k) => (
                  <Input
                    key={k}
                    className={styles.small}
                    label={`${NUTRIENT_LABELS[k].label} (${NUTRIENT_LABELS[k].unit})`}
                    inputMode="decimal"
                    value={form.values[k] ?? ''}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        values: { ...form.values, [k]: e.target.value },
                      })
                    }
                    name={`meal-${k}`}
                  />
                ))}
              </div>
            )}
          </>
        )}
        {log.error && <p className={styles.error}>{log.error}</p>}
        <div>
          <Button
            type="submit"
            size="sm"
            disabled={log.busy || (!form.recipeId && !form.description.trim())}
            data-testid="meal-add"
          >
            Log it
          </Button>
        </div>
      </form>
    </Card>
  )
}

function guessMeal(): Meal {
  const h = new Date().getHours()
  return h < 10
    ? 'breakfast'
    : h < 14
      ? 'lunch'
      : h >= 17 && h < 21
        ? 'dinner'
        : 'snack'
}

const ACTIVITY_CHOICES: [string, string, Intensity][] = [
  ['walk', 'Walk', 'moderate'],
  ['run', 'Run', 'vigorous'],
  ['gym', 'Gym', 'moderate'],
  ['cycle', 'Cycle', 'moderate'],
  ['swim', 'Swim', 'vigorous'],
  ['yoga', 'Yoga or stretching', 'light'],
  ['exercise', 'Other exercise', 'moderate'],
]

function ActivityCard({ s }: { s: HealthSummary }) {
  const log = useHealthAction(logActivity, () => setMinutes(''))
  const logSteps = useHealthAction(logActivity, () => setSteps(''))
  const remove = useHealthAction(({ id }: { id: string }) =>
    deleteEntry('activity', id),
  )
  const [kind, setKind] = useState('walk')
  const [minutes, setMinutes] = useState('')
  const [steps, setSteps] = useState('')
  return (
    <Card>
      <h2 className={styles.cardTitle}>Moving</h2>
      <Bar
        label="This week"
        value={s.week.activityMinutes}
        goal={s.week.goalMinutes || null}
        unit="minutes"
      />
      {s.week.steps > 0 && (
        <p className={styles.faint}>
          {s.week.steps.toLocaleString()} steps this week.
        </p>
      )}
      {s.activities.length > 0 && (
        <ul className={styles.list} style={{ marginTop: 'var(--space-2)' }}>
          {s.activities.map((a) => (
            <li key={a.id} className={styles.item}>
              <span>
                {a.minutes
                  ? `${a.minutes} min ${a.kind}`
                  : `${a.steps?.toLocaleString()} steps`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${a.kind}`}
                onClick={() => remove.run({ id: a.id })}
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.row} style={{ marginTop: 'var(--space-3)' }}>
        <label className={`${styles.selectLabel} ${styles.grow}`}>
          Activity
          <select
            className={styles.select}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {ACTIVITY_CHOICES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <Input
          className={styles.small}
          label="Minutes"
          inputMode="numeric"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          name="activity-minutes"
        />
        <Button
          size="sm"
          disabled={!Number(minutes) || log.busy}
          onClick={() =>
            log.run({
              kind,
              minutes: Number(minutes),
              intensity: ACTIVITY_CHOICES.find((c) => c[0] === kind)![2],
            })
          }
          data-testid="activity-add"
        >
          Log
        </Button>
      </div>
      <div className={styles.row} style={{ marginTop: 'var(--space-2)' }}>
        <Input
          className={styles.grow}
          label="Or steps"
          inputMode="numeric"
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
          name="activity-steps"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={!Number(steps) || logSteps.busy}
          onClick={() =>
            logSteps.run({
              kind: 'steps',
              steps: Number(steps),
              intensity: 'light',
            })
          }
        >
          Log steps
        </Button>
      </div>
      {(log.error || logSteps.error) && (
        <p className={styles.error}>{log.error || logSteps.error}</p>
      )}
    </Card>
  )
}

function HabitsCard({ s }: { s: HealthSummary }) {
  const change = useHealthAction(
    ({
      habit,
      add,
      amount,
    }: {
      habit: (typeof HABITS)[number]
      add?: number
      amount?: number
    }) => changeHabit(habit, { add, amount }),
  )
  const [sleep, setSleep] = useState('')
  return (
    <Card>
      <h2 className={styles.cardTitle}>Daily habits</h2>
      <ul className={styles.list}>
        {(['water', 'veg', 'fruit'] as const).map((h) => (
          <li key={h} className={styles.item}>
            <span>
              <strong>{HABIT_LABELS[h].label}</strong>
              {s.streaks[h] > 1 ? (
                <span className={styles.faint}>
                  {' '}
                  · {s.streaks[h]}-day streak
                </span>
              ) : null}
            </span>
            <span className={styles.counter}>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`One less ${HABIT_LABELS[h].unit} of ${h}`}
                disabled={!s.habits[h]}
                onClick={() => change.run({ habit: h, add: -1 })}
              >
                <Minus size={16} aria-hidden />
              </Button>
              <span className={styles.counterValue} data-testid={`habit-${h}`}>
                {s.habits[h]} / {s.profile.targets[h]}
              </span>
              <Button
                size="sm"
                variant="secondary"
                aria-label={`One more ${HABIT_LABELS[h].unit} of ${h}`}
                onClick={() => change.run({ habit: h, add: 1 })}
                data-testid={`habit-${h}-add`}
              >
                <Plus size={16} aria-hidden />
              </Button>
            </span>
          </li>
        ))}
        <li className={styles.item}>
          <span>
            <strong>Sleep last night</strong>
            <span className={styles.faint}>
              {' '}
              · {s.habits.sleep ? `${s.habits.sleep} hours` : 'not logged'}
            </span>
          </span>
          <span className={styles.counter}>
            <label className={styles.srOnly} htmlFor="sleep-hours">
              Hours of sleep
            </label>
            <input
              id="sleep-hours"
              className={styles.select}
              style={{ width: '5rem' }}
              inputMode="decimal"
              placeholder="7.5"
              value={sleep}
              onChange={(e) => setSleep(e.target.value)}
            />
            <Button
              size="sm"
              variant="secondary"
              disabled={!Number(sleep)}
              onClick={() => (
                change.run({ habit: 'sleep', amount: Number(sleep) }),
                setSleep('')
              )}
            >
              Save
            </Button>
          </span>
        </li>
      </ul>
      {change.error && <p className={styles.error}>{change.error}</p>}
    </Card>
  )
}

// ---------------------------------------------------------------- weight

function WeightChart({ s }: { s: HealthSummary }) {
  const imperial = s.profile.units === 'imperial'
  const show = (kg: number) => (imperial ? lbFromKg(kg) : kg)
  const points = s.weight.weighIns.filter((w) => w.weightKg != null)
  if (points.length < 2)
    return (
      <p className={styles.muted}>
        Your trend line appears after a couple of weigh-ins. Once a week is
        plenty.
      </p>
    )
  const W = 320,
    H = 140,
    P = 10
  const t0 = Date.parse(points[0]!.day),
    t1 = Date.parse(points[points.length - 1]!.day) || t0 + 1
  const values = [
    ...points.map((p) => show(p.weightKg!)),
    ...(s.profile.goalWeightKg ? [show(s.profile.goalWeightKg)] : []),
  ]
  const lo = Math.min(...values) - 1,
    hi = Math.max(...values) + 1
  const x = (day: string) =>
    P + ((Date.parse(day) - t0) / Math.max(1, t1 - t0)) * (W - 2 * P)
  const y = (v: number) => H - P - ((v - lo) / (hi - lo)) * (H - 2 * P)
  const weekly = s.weight.weekly.filter(
    (w) => w.weekStart >= points[0]!.day.slice(0, 10) || true,
  )
  const line = weekly
    .map(
      (w, i) =>
        `${i ? 'L' : 'M'}${x(w.weekStart < points[0]!.day ? points[0]!.day : w.weekStart).toFixed(1)},${y(show(w.averageKg)).toFixed(1)}`,
    )
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={styles.chart}
      role="img"
      aria-label="Weight trend: dots are weigh-ins, the line is your weekly average"
      data-testid="weight-chart"
    >
      {s.profile.goalWeightKg && (
        <line
          className={styles.chartGoal}
          x1={P}
          x2={W - P}
          y1={y(show(s.profile.goalWeightKg))}
          y2={y(show(s.profile.goalWeightKg))}
        />
      )}
      {points.map((p) => (
        <circle
          key={p.day}
          className={styles.chartDot}
          cx={x(p.day)}
          cy={y(show(p.weightKg!))}
          r={3}
        />
      ))}
      {weekly.length > 1 && <path className={styles.chartLine} d={line} />}
    </svg>
  )
}

function WeightView({ s }: { s: HealthSummary }) {
  const imperial = s.profile.units === 'imperial'
  const hide = s.profile.hideNumbers
  const [weight, setWeight] = useState('')
  const [waist, setWaist] = useState('')
  const log = useHealthAction(logWeighIn, () => (setWeight(''), setWaist('')))
  const { latestKg, changeKg4Weeks } = s.weight
  const latestWeek = s.weight.weekly.at(-1)
  return (
    <div className={styles.grid}>
      <Card>
        <h2 className={styles.cardTitle}>Weight</h2>
        {latestWeek && !hide ? (
          <>
            <p className={styles.big} data-testid="weight-average">
              {formatWeight(latestWeek.averageKg, s.profile.units)}
            </p>
            <p className={styles.muted}>
              This week’s average.
              {changeKg4Weeks != null
                ? ` ${changeKg4Weeks < 0 ? 'Down' : changeKg4Weeks > 0 ? 'Up' : 'Steady'}${changeKg4Weeks ? ` ${Math.abs(changeKg4Weeks)} kg` : ''} over four weeks.`
                : ''}
              {s.profile.goalWeightKg && latestKg
                ? ` Goal: ${formatWeight(s.profile.goalWeightKg, s.profile.units)}.`
                : ''}
            </p>
          </>
        ) : (
          <p className={styles.muted}>
            {hide && changeKg4Weeks != null
              ? `Trending ${changeKg4Weeks < 0 ? 'down' : changeKg4Weeks > 0 ? 'up' : 'steady'} over four weeks.`
              : 'No weigh-ins yet.'}
          </p>
        )}
        {!hide && <WeightChart s={s} />}
        <p className={styles.faint}>
          Weight naturally moves a kilo or more day to day, so the weekly
          average is the number to watch.
        </p>
      </Card>
      <Card>
        <h2 className={styles.cardTitle}>Weigh in</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const w = Number(weight),
              wa = Number(waist)
            log.run({
              ...(w ? { weightKg: round1(imperial ? kgFromLb(w) : w) } : {}),
              ...(wa ? { waistCm: round1(imperial ? wa * 2.54 : wa) } : {}),
            })
          }}
          style={{ display: 'grid', gap: 'var(--space-2)' }}
        >
          <div className={styles.row}>
            <Input
              className={styles.grow}
              label={`Weight (${imperial ? 'lb' : 'kg'})`}
              inputMode="decimal"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              name="weigh-weight"
            />
            <Input
              className={styles.grow}
              label={`Waist (${imperial ? 'in' : 'cm'}, optional)`}
              inputMode="decimal"
              value={waist}
              onChange={(e) => setWaist(e.target.value)}
              name="weigh-waist"
            />
          </div>
          {log.error && <p className={styles.error}>{log.error}</p>}
          <div>
            <Button
              type="submit"
              disabled={log.busy || (!Number(weight) && !Number(waist))}
              data-testid="weigh-save"
            >
              Save today’s weigh-in
            </Button>
          </div>
        </form>
        <p className={styles.faint}>
          Same time of day, same scales, once a week is plenty. Or tell the
          Goblin: “I weighed 92.4 kilos”.
        </p>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- history

function HistoryView({ s }: { s: HealthSummary }) {
  const history = useQuery({
    queryKey: ['health-history'],
    queryFn: () => fetchHistory(14),
  })
  const removeMeal = useHealthAction(({ id }: { id: string }) =>
    deleteEntry('meal', id),
  )
  const removeActivity = useHealthAction(({ id }: { id: string }) =>
    deleteEntry('activity', id),
  )
  const removeDose = useHealthAction(({ id }: { id: string }) =>
    deleteEntry('dose', id),
  )
  const removeWeigh = useHealthAction(deleteWeighIn)
  if (!history.data) return <p className={styles.muted}>Loading…</p>
  const h = history.data
  const days = [
    ...new Set(
      [...h.weighIns, ...h.meals, ...h.activities, ...h.doses].map(
        (x) => x.day,
      ),
    ),
  ]
    .sort()
    .reverse()
  if (!days.length)
    return (
      <p className={styles.muted}>Nothing logged in the last two weeks yet.</p>
    )
  return (
    <div className={styles.grid}>
      {days.map((day) => (
        <Card key={day}>
          <h2 className={styles.cardTitle}>
            {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'short',
            })}
          </h2>
          <ul className={styles.list}>
            {h.weighIns
              .filter((w) => w.day === day)
              .map((w) => (
                <li key={w.id} className={styles.item}>
                  <span>
                    Weigh-in
                    {w.weightKg != null && !s.profile.hideNumbers
                      ? `: ${formatWeight(w.weightKg, s.profile.units)}`
                      : ''}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="Remove weigh-in"
                    onClick={() => removeWeigh.run(day)}
                  >
                    ×
                  </Button>
                </li>
              ))}
            {h.meals
              .filter((m) => m.day === day)
              .map((m) => (
                <li key={m.id} className={styles.item}>
                  <span>
                    <span className={styles.faint}>{mealLabel(m.meal)}</span>{' '}
                    {m.description}
                    {nutritionLine(m) ? (
                      <span className={styles.faint}>
                        {' '}
                        · {nutritionLine(m)}
                      </span>
                    ) : null}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${m.description}`}
                    onClick={() => removeMeal.run({ id: m.id })}
                  >
                    ×
                  </Button>
                </li>
              ))}
            {h.activities
              .filter((a) => a.day === day)
              .map((a) => (
                <li key={a.id} className={styles.item}>
                  <span>
                    {a.minutes
                      ? `${a.minutes} min ${a.kind}`
                      : `${a.steps?.toLocaleString()} steps`}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${a.kind}`}
                    onClick={() => removeActivity.run({ id: a.id })}
                  >
                    ×
                  </Button>
                </li>
              ))}
            {h.doses
              .filter((d) => d.day === day)
              .map((d) => (
                <li key={d.id} className={styles.item}>
                  <span>Took {d.name}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Remove ${d.name}`}
                    onClick={() => removeDose.run({ id: d.id })}
                  >
                    ×
                  </Button>
                </li>
              ))}
            {h.habits
              .filter((x) => x.day === day)
              .map((x) => (
                <li key={x.habit} className={styles.item}>
                  <span>
                    {HABIT_LABELS[x.habit].label}: {x.amount}{' '}
                    {HABIT_LABELS[x.habit].units}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}
