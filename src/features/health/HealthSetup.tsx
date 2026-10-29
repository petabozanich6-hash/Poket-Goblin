import { useState } from 'react'

import {
  DISCLAIMER,
  MACRO_PRESETS,
  MIN_CALORIE_GOAL,
  kgFromLb,
  lbFromKg,
  macrosFor,
  round1,
  suggestCalories,
  type CalorieInput,
  type HealthProfile,
} from '@shared/health'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'

import { deleteHealthData, enableHealth, updateProfile } from './healthApi'
import styles from './HealthPage.module.css'
import { useHealthAction } from './useHealthAction'

/** Turning Health on is an explicit, informed yes (health details are sensitive information). */
export function HealthConsent() {
  const [agreed, setAgreed] = useState(false)
  const turnOn = useHealthAction(enableHealth)
  return (
    <Card>
      <div className={styles.consent} data-testid="health-consent">
        <h2 className={styles.cardTitle}>
          Keep track of your health with the Goblin
        </h2>
        <p className={styles.muted}>
          Log your weight, food and drinks (with macros if you like), exercise,
          water, sleep and supplements. Type it here or just tell the Goblin:
          “had the pork belly benedict for dinner”, “walked 30 minutes”, “took
          my multivitamin”.
        </p>
        <ul className={styles.muted}>
          <li>
            Your health details stay private in your account. They’re never
            sold, shared or used for advertising.
          </li>
          <li>
            They’re never sent to an AI. The only exception is a nutrition-panel
            screenshot you choose to have read, and you’ll be told before that
            happens.
          </li>
          <li>
            You can download them with your data, or delete them all at any
            time.
          </li>
          <li>{DISCLAIMER}</li>
        </ul>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            data-testid="health-consent-check"
          />
          <span>
            I understand, and I want Pocket Goblin to keep my health details.
          </span>
        </label>
        {turnOn.error && <p className={styles.error}>{turnOn.error}</p>}
        <div>
          <Button
            disabled={!agreed || turnOn.busy}
            onClick={() => turnOn.run(undefined)}
            data-testid="health-enable"
          >
            Turn on Health
          </Button>
        </div>
      </div>
    </Card>
  )
}

const num = (v: string) => (v.trim() === '' ? null : Number(v))

/** Goals: macros (presets or your own numbers), activity, habits, weight, units, privacy. */
export function HealthSettings({ profile }: { profile: HealthProfile }) {
  const imperial = profile.units === 'imperial'
  const save = useHealthAction(updateProfile, () => setSaved(true))
  const wipe = useHealthAction(deleteHealthData)
  const [saved, setSaved] = useState(false)
  const [calories, setCalories] = useState(
    profile.macros.calories?.toString() ?? '',
  )
  const [protein, setProtein] = useState(
    profile.macros.proteinG?.toString() ?? '',
  )
  const [carbs, setCarbs] = useState(profile.macros.carbsG?.toString() ?? '')
  const [fat, setFat] = useState(profile.macros.fatG?.toString() ?? '')
  const [goalWeight, setGoalWeight] = useState(
    profile.goalWeightKg != null
      ? String(
          round1(
            imperial ? lbFromKg(profile.goalWeightKg) : profile.goalWeightKg,
          ),
        )
      : '',
  )
  const [activity, setActivity] = useState(
    String(profile.weeklyActivityMinutes),
  )
  const [targets, setTargets] = useState({ ...profile.targets })
  const [confirmWipe, setConfirmWipe] = useState('')
  const [calc, setCalc] = useState<
    Omit<CalorieInput, 'weightKg' | 'heightCm' | 'age'> & {
      weight: string
      height: string
      age: string
    }
  >({
    weight: '',
    height: '',
    age: '',
    sex: 'unspecified',
    activity: 'light',
  })

  const applyPreset = (id: string) => {
    const p = MACRO_PRESETS.find((x) => x.id === id)!
    const c = Number(calories)
    if (!(c >= MIN_CALORIE_GOAL))
      return save.setError(
        `Set a daily calorie goal of at least ${MIN_CALORIE_GOAL.toLocaleString()} first.`,
      )
    const m = macrosFor(c, p)
    setProtein(String(m.proteinG))
    setCarbs(String(m.carbsG))
    setFat(String(m.fatG))
  }

  const suggestion = (() => {
    const w = Number(calc.weight)
    return suggestCalories({
      ...calc,
      weightKg: imperial ? kgFromLb(w) : w,
      heightCm: Number(calc.height),
      age: Number(calc.age),
    })
  })()

  const submit = () => {
    setSaved(false)
    const gw = num(goalWeight)
    save.run({
      dailyCalorieGoal: num(calories),
      proteinGoalG: num(protein),
      carbsGoalG: num(carbs),
      fatGoalG: num(fat),
      goalWeightKg: gw == null ? null : round1(imperial ? kgFromLb(gw) : gw),
      weeklyActivityMinutes: Number(activity) || 0,
      ...targets,
    })
  }

  return (
    <div className={styles.grid}>
      <Card>
        <h2 className={styles.cardTitle}>Macros</h2>
        <p className={styles.muted}>
          A daily target for calories, protein, carbs and fat. Pick a starting
          point and adjust it, or leave it blank and just log what you eat.
        </p>
        <div className={styles.row}>
          <Input
            className={styles.grow}
            label="Calories (kcal)"
            inputMode="numeric"
            value={calories}
            onChange={(e) => setCalories(e.target.value)}
            name="goal-calories"
          />
        </div>
        <p className={styles.faint}>
          Not below {MIN_CALORIE_GOAL.toLocaleString()}. A lower target is
          something to plan with your doctor or a dietitian.
        </p>
        <div
          className={styles.presets}
          role="group"
          aria-label="Macro starting points"
        >
          {MACRO_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={styles.preset}
              onClick={() => applyPreset(p.id)}
              data-testid={`preset-${p.id}`}
            >
              <strong>{p.label}</strong>
              <br />
              <span className={styles.faint}>
                {p.carbs}% carbs · {p.protein}% protein · {p.fat}% fat.{' '}
                {p.plain}
              </span>
            </button>
          ))}
        </div>
        <div className={styles.row}>
          <Input
            className={styles.small}
            label="Protein (g)"
            inputMode="numeric"
            value={protein}
            onChange={(e) => setProtein(e.target.value)}
            name="goal-protein"
          />
          <Input
            className={styles.small}
            label="Carbs (g)"
            inputMode="numeric"
            value={carbs}
            onChange={(e) => setCarbs(e.target.value)}
            name="goal-carbs"
          />
          <Input
            className={styles.small}
            label="Fat (g)"
            inputMode="numeric"
            value={fat}
            onChange={(e) => setFat(e.target.value)}
            name="goal-fat"
          />
        </div>
        <details className={styles.details}>
          <summary>Help me pick a calorie number</summary>
          <p className={styles.faint}>
            A rough starting estimate (the Mifflin–St Jeor formula), worked out
            on this device. These details aren’t saved.
          </p>
          <div className={styles.row}>
            <Input
              className={styles.small}
              label={`Weight (${imperial ? 'lb' : 'kg'})`}
              inputMode="decimal"
              value={calc.weight}
              onChange={(e) => setCalc({ ...calc, weight: e.target.value })}
              name="calc-weight"
            />
            <Input
              className={styles.small}
              label="Height (cm)"
              inputMode="numeric"
              value={calc.height}
              onChange={(e) => setCalc({ ...calc, height: e.target.value })}
              name="calc-height"
            />
            <Input
              className={styles.small}
              label="Age"
              inputMode="numeric"
              value={calc.age}
              onChange={(e) => setCalc({ ...calc, age: e.target.value })}
              name="calc-age"
            />
          </div>
          <div className={styles.row}>
            <label className={`${styles.selectLabel} ${styles.grow}`}>
              Body
              <select
                className={styles.select}
                value={calc.sex}
                onChange={(e) =>
                  setCalc({
                    ...calc,
                    sex: e.target.value as CalorieInput['sex'],
                  })
                }
              >
                <option value="unspecified">Prefer not to say</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </select>
            </label>
            <label className={`${styles.selectLabel} ${styles.grow}`}>
              How active
              <select
                className={styles.select}
                value={calc.activity}
                onChange={(e) =>
                  setCalc({
                    ...calc,
                    activity: e.target.value as CalorieInput['activity'],
                  })
                }
              >
                <option value="little">Mostly sitting</option>
                <option value="light">Light exercise 1–3 days a week</option>
                <option value="moderate">Moderate exercise 3–5 days</option>
                <option value="very">Hard exercise 6–7 days</option>
              </select>
            </label>
          </div>
          {suggestion && (
            <p className={styles.note} data-testid="calorie-suggestion">
              About {suggestion.maintain.toLocaleString()} kcal a day keeps your
              weight steady. Around{' '}
              <strong>{suggestion.lose.toLocaleString()} kcal</strong> would
              lose roughly 0.5 kg a week
              {suggestion.floored
                ? ` (kept at the ${MIN_CALORIE_GOAL.toLocaleString()} minimum)`
                : ''}
              .{' '}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setCalories(String(suggestion.lose))}
              >
                Use {suggestion.lose.toLocaleString()}
              </Button>
            </p>
          )}
        </details>
      </Card>

      <Card>
        <h2 className={styles.cardTitle}>Goals</h2>
        <div className={styles.row}>
          <Input
            className={styles.grow}
            label={`Goal weight (${imperial ? 'lb' : 'kg'}, optional)`}
            inputMode="decimal"
            value={goalWeight}
            onChange={(e) => setGoalWeight(e.target.value)}
            name="goal-weight"
          />
          <Input
            className={styles.grow}
            label="Active minutes a week"
            inputMode="numeric"
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
            name="goal-activity"
          />
        </div>
        <p className={styles.faint}>
          Australia’s guidelines suggest 150–300 minutes of moderate activity a
          week.
        </p>
        <div className={styles.row}>
          <Input
            className={styles.small}
            label="Water (glasses)"
            inputMode="numeric"
            value={String(targets.water)}
            onChange={(e) =>
              setTargets({ ...targets, water: Number(e.target.value) || 0 })
            }
            name="goal-water"
          />
          <Input
            className={styles.small}
            label="Veg (serves)"
            inputMode="numeric"
            value={String(targets.veg)}
            onChange={(e) =>
              setTargets({ ...targets, veg: Number(e.target.value) || 0 })
            }
            name="goal-veg"
          />
          <Input
            className={styles.small}
            label="Fruit (serves)"
            inputMode="numeric"
            value={String(targets.fruit)}
            onChange={(e) =>
              setTargets({ ...targets, fruit: Number(e.target.value) || 0 })
            }
            name="goal-fruit"
          />
          <Input
            className={styles.small}
            label="Sleep (hours)"
            inputMode="decimal"
            value={String(targets.sleep)}
            onChange={(e) =>
              setTargets({ ...targets, sleep: Number(e.target.value) || 0 })
            }
            name="goal-sleep"
          />
        </div>
        {save.error && <p className={styles.error}>{save.error}</p>}
        {saved && !save.error && (
          <p className={styles.done} data-testid="health-goals-saved">
            Saved.
          </p>
        )}
        <Button
          onClick={submit}
          disabled={save.busy}
          data-testid="health-save-goals"
        >
          Save goals
        </Button>
      </Card>

      <Card>
        <h2 className={styles.cardTitle}>Display and privacy</h2>
        <label className={styles.selectLabel}>
          Units
          <select
            className={styles.select}
            value={profile.units}
            onChange={(e) =>
              save.run({ units: e.target.value as 'metric' | 'imperial' })
            }
          >
            <option value="metric">Kilograms and centimetres</option>
            <option value="imperial">Pounds and inches</option>
          </select>
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={profile.hideNumbers}
            onChange={(e) => save.run({ hideNumbers: e.target.checked })}
          />
          <span>Hide weight numbers and show trends only</span>
        </label>
        <details className={styles.details}>
          <summary>Delete my health data</summary>
          <p className={styles.muted}>
            Removes every weigh-in, meal, recipe, activity, habit and
            supplement, and turns Health off. The rest of your account stays.
          </p>
          <Input
            label="Type DELETE to confirm"
            value={confirmWipe}
            onChange={(e) => setConfirmWipe(e.target.value)}
            name="health-delete-confirm"
          />
          {wipe.error && <p className={styles.error}>{wipe.error}</p>}
          <Button
            variant="danger"
            disabled={confirmWipe.trim() !== 'DELETE' || wipe.busy}
            onClick={() => wipe.run(undefined)}
            data-testid="health-delete"
          >
            Delete my health data
          </Button>
        </details>
      </Card>
    </div>
  )
}
