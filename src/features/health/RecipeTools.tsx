import { useQuery } from '@tanstack/react-query'
import { Camera, Link2, PencilLine } from 'lucide-react'
import { useRef, useState } from 'react'

import { MEALS, type Meal, type Recipe } from '@shared/health'
import { NUTRIENTS, NUTRIENT_LABELS, type Nutrition } from '@shared/recipes'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'

import {
  fetchRecipes,
  logMeal,
  recipeFromImage,
  recipeFromLink,
  removeRecipe,
  saveRecipe,
  type RecipeDraft,
} from './healthApi'
import { nutritionLine } from './healthFormat'
import styles from './HealthPage.module.css'
import { useHealthAction } from './useHealthAction'

type Mode = 'link' | 'image' | 'type'
type Draft = {
  name: string
  servings: string
  sourceUrl: string | null
  values: Record<keyof Nutrition, string>
}

const toDraft = (d: RecipeDraft | null): Draft => ({
  name: d?.name ?? '',
  servings: d?.servings ? String(d.servings) : '',
  sourceUrl: d?.sourceUrl ?? null,
  values: Object.fromEntries(
    NUTRIENTS.map((k) => [k, d?.[k] != null ? String(d[k]) : '']),
  ) as Draft['values'],
})

/** Analyse a recipe from a link, a screenshot of its nutrition panel, or typed numbers; check; save. */
export function AnalyseRecipe({ onClose }: { onClose?: () => void }) {
  const [mode, setMode] = useState<Mode>('link')
  const [url, setUrl] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [aiOk, setAiOk] = useState(false)
  const [logAs, setLogAs] = useState<Meal | ''>('')
  const [servingsEaten, setServingsEaten] = useState('1')
  const fileRef = useRef<HTMLInputElement>(null)

  const fromLink = useHealthAction(
    recipeFromLink,
    (r) => (setDraft(toDraft(r.preview)), setWarnings([])),
  )
  const fromImage = useHealthAction(
    recipeFromImage,
    (r) => (setDraft(toDraft(r.preview)), setWarnings(r.warnings)),
  )
  const save = useHealthAction(
    async (d: Draft) => {
      const values = Object.fromEntries(
        NUTRIENTS.map((k) => [
          k,
          d.values[k].trim() === '' ? null : Number(d.values[k]),
        ]),
      ) as Nutrition
      const r = await saveRecipe({
        name: d.name.trim(),
        servings: d.servings ? Number(d.servings) : null,
        sourceUrl: d.sourceUrl,
        ...values,
      })
      if (logAs)
        await logMeal({
          meal: logAs,
          recipeId: r.id,
          servings: Number(servingsEaten) || 1,
        })
      return r
    },
    () => {
      setDraft(null)
      setUrl('')
      onClose?.()
    },
  )
  const busy = fromLink.busy || fromImage.busy || save.busy
  const error = fromLink.error || fromImage.error || save.error

  return (
    <Card>
      <h2 className={styles.cardTitle}>Analyse a recipe</h2>
      {!draft && (
        <>
          <div
            className={styles.row}
            role="tablist"
            aria-label="How to add the recipe"
          >
            {(
              [
                ['link', 'Recipe link', Link2],
                ['image', 'Screenshot', Camera],
                ['type', 'Type it in', PencilLine],
              ] as const
            ).map(([m, label, Icon]) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? 'primary' : 'secondary'}
                onClick={() => setMode(m)}
                role="tab"
                aria-selected={mode === m}
                data-testid={`analyse-${m}`}
              >
                <Icon size={16} aria-hidden /> {label}
              </Button>
            ))}
          </div>
          {mode === 'link' && (
            <div
              style={{
                display: 'grid',
                gap: 'var(--space-2)',
                marginTop: 'var(--space-3)',
              }}
            >
              <p className={styles.muted}>
                Paste a recipe link (Mob and most recipe sites publish their
                nutrition). No AI is used.
              </p>
              <Input
                label="Recipe link"
                type="url"
                placeholder="https://www.mob.co.uk/recipes/…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                name="recipe-url"
              />
              <div>
                <Button
                  disabled={!url.trim() || busy}
                  onClick={() => fromLink.run(url.trim())}
                  data-testid="analyse-link-go"
                >
                  {fromLink.busy ? 'Reading…' : 'Read the nutrition'}
                </Button>
              </div>
            </div>
          )}
          {mode === 'image' && (
            <div
              style={{
                display: 'grid',
                gap: 'var(--space-2)',
                marginTop: 'var(--space-3)',
              }}
            >
              <p className={styles.muted}>
                Take a screenshot of the recipe’s nutrition panel. To read it,
                the picture is sent to Cloudflare’s AI service (Workers AI),
                which only writes out the text it sees. Pocket Goblin then reads
                the numbers and shows them to you to check. It uses one of
                today’s AI requests.
              </p>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={aiOk}
                  onChange={(e) => setAiOk(e.target.checked)}
                  data-testid="analyse-image-ok"
                />
                <span>OK, read this picture with AI</span>
              </label>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className={styles.srOnly}
                aria-label="Nutrition screenshot"
                data-testid="analyse-image-file"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) fromImage.run(f)
                  e.target.value = ''
                }}
              />
              <div>
                <Button
                  disabled={!aiOk || busy}
                  onClick={() => fileRef.current?.click()}
                  data-testid="analyse-image-go"
                >
                  {fromImage.busy
                    ? 'Reading the picture…'
                    : 'Choose screenshot'}
                </Button>
              </div>
            </div>
          )}
          {mode === 'type' && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Button
                onClick={() => setDraft(toDraft(null))}
                data-testid="analyse-type-go"
              >
                Enter the numbers
              </Button>
            </div>
          )}
        </>
      )}

      {draft && (
        <form
          style={{ display: 'grid', gap: 'var(--space-3)' }}
          onSubmit={(e) => {
            e.preventDefault()
            if (!draft.name.trim())
              return save.setError('Give the recipe a name.')
            save.run(draft)
          }}
          data-testid="recipe-preview"
        >
          <p className={styles.muted}>
            Check the numbers (per serving) and fix anything that’s off.
          </p>
          {warnings.map((w) => (
            <p key={w} className={styles.note}>
              {w}
            </p>
          ))}
          <div className={styles.row}>
            <Input
              className={styles.grow}
              label="Recipe name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              name="recipe-name"
            />
            <Input
              className={styles.small}
              label="Serves"
              inputMode="numeric"
              value={draft.servings}
              onChange={(e) => setDraft({ ...draft, servings: e.target.value })}
              name="recipe-serves"
            />
          </div>
          <div className={styles.row}>
            {NUTRIENTS.map((k) => (
              <Input
                key={k}
                className={styles.small}
                label={`${NUTRIENT_LABELS[k].label} (${NUTRIENT_LABELS[k].unit})`}
                inputMode="decimal"
                value={draft.values[k]}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    values: { ...draft.values, [k]: e.target.value },
                  })
                }
                name={`recipe-${k}`}
              />
            ))}
          </div>
          <div className={styles.row}>
            <label className={`${styles.selectLabel} ${styles.grow}`}>
              Also log it now?
              <select
                className={styles.select}
                value={logAs}
                onChange={(e) => setLogAs(e.target.value as Meal | '')}
                data-testid="recipe-log-as"
              >
                <option value="">No, just save it</option>
                {MEALS.filter((m) => m !== 'drink').map((m) => (
                  <option key={m} value={m}>
                    Log for {m}
                  </option>
                ))}
              </select>
            </label>
            {logAs && (
              <Input
                className={styles.small}
                label="Servings eaten"
                inputMode="decimal"
                value={servingsEaten}
                onChange={(e) => setServingsEaten(e.target.value)}
                name="recipe-servings-eaten"
              />
            )}
          </div>
          {error && <p className={styles.error}>{error}</p>}
          <div className={styles.row}>
            <Button type="submit" disabled={busy} data-testid="recipe-save">
              Save recipe
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Start again
            </Button>
          </div>
        </form>
      )}
      {!draft && error && <p className={styles.error}>{error}</p>}
    </Card>
  )
}

export function MyRecipes() {
  const recipes = useQuery({
    queryKey: ['health-recipes'],
    queryFn: fetchRecipes,
  })
  const remove = useHealthAction(removeRecipe)
  const list: Recipe[] = recipes.data?.recipes ?? []
  return (
    <Card>
      <h2 className={styles.cardTitle}>My recipes</h2>
      {list.length === 0 ? (
        <p className={styles.muted}>
          Recipes you analyse are saved here, so next time it’s one tap (or “had
          the pork belly benedict for dinner”).
        </p>
      ) : (
        <ul className={styles.list} data-testid="recipe-list">
          {list.map((r) => (
            <li key={r.id} className={styles.item}>
              <span>
                <strong>{r.name}</strong>
                <br />
                <span className={styles.faint}>
                  {nutritionLine(r) || 'No numbers yet'} per serving
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${r.name}`}
                onClick={() => remove.run(r.id)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
