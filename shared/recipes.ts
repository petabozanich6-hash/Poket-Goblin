/**
 * Reading a recipe's nutrition, per serving, without guessing:
 * - from a recipe web page's own structured data (schema.org Recipe / NutritionInformation, which most
 *   recipe sites publish for search engines), or
 * - from the text of a nutrition panel (typed, pasted, or transcribed from a screenshot).
 * Anything that isn't clearly stated is left empty rather than estimated.
 */

export type Nutrition = {
  calories: number | null
  proteinG: number | null
  carbsG: number | null
  fatG: number | null
  satFatG: number | null
  sugarsG: number | null
  fibreG: number | null
  sodiumMg: number | null
}

export const NUTRIENTS: (keyof Nutrition)[] = ['calories', 'proteinG', 'carbsG', 'fatG', 'satFatG', 'sugarsG', 'fibreG', 'sodiumMg']

export const NUTRIENT_LABELS: Record<keyof Nutrition, { label: string; unit: string; max: number }> = {
  calories: { label: 'Calories', unit: 'kcal', max: 10000 },
  proteinG: { label: 'Protein', unit: 'g', max: 1000 },
  carbsG: { label: 'Carbs', unit: 'g', max: 1000 },
  fatG: { label: 'Fat', unit: 'g', max: 1000 },
  satFatG: { label: 'Saturated fat', unit: 'g', max: 1000 },
  sugarsG: { label: 'Sugars', unit: 'g', max: 1000 },
  fibreG: { label: 'Fibre', unit: 'g', max: 1000 },
  sodiumMg: { label: 'Sodium', unit: 'mg', max: 50000 },
}

export const emptyNutrition = (): Nutrition => ({
  calories: null, proteinG: null, carbsG: null, fatG: null, satFatG: null, sugarsG: null, fibreG: null, sodiumMg: null,
})

export const hasNutrition = (n: Nutrition) => NUTRIENTS.some((k) => n[k] != null)

/** Totals for `servings` servings, rounded sensibly; empty stays empty. */
export function scaleNutrition(n: Nutrition, servings: number): Nutrition {
  const out = emptyNutrition()
  for (const k of NUTRIENTS) {
    const v = n[k]
    out[k] = v == null ? null : k === 'calories' || k === 'sodiumMg' ? Math.round(v * servings) : Math.round(v * servings * 10) / 10
  }
  return out
}

const KJ_PER_KCAL = 4.184

/** A number with an optional unit: "1071 kcal", "4480 kJ", "30 g", "1.87 g" (sodium), "1870mg". */
function amount(raw: unknown, want: 'kcal' | 'g' | 'mg'): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw >= 0 ? raw : null
  if (typeof raw !== 'string') return null
  const m = raw.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(kcal|cal(?:ories)?|kj|kilojoules?|mg|milligrams?|g|grams?)?/i)
  if (!m) return null
  const v = Number(m[1])
  const unit = (m[2] ?? '').toLowerCase()
  if (want === 'kcal') return /^kj|^kilojoule/.test(unit) ? Math.round(v / KJ_PER_KCAL) : v
  if (want === 'mg') return unit.startsWith('g') ? v * 1000 : v
  return unit.startsWith('mg') || unit.startsWith('milligram') ? v / 1000 : v
}

const inRange = (v: number | null, k: keyof Nutrition) => (v != null && v >= 0 && v <= NUTRIENT_LABELS[k].max ? v : null)

// ---------------------------------------------------------------- structured data (recipe links)

function* jsonLdBlocks(html: string): Generator<unknown> {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    try {
      yield JSON.parse(m[1]!.trim())
    } catch {
      // A broken block is skipped; others on the page may still be fine.
    }
  }
}

function findRecipe(node: unknown, depth = 0): Record<string, unknown> | null {
  if (!node || typeof node !== 'object' || depth > 6) return null
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n, depth + 1)
      if (r) return r
    }
    return null
  }
  const o = node as Record<string, unknown>
  const type = o['@type']
  if (type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'))) return o
  for (const key of ['@graph', 'mainEntity', 'itemListElement']) {
    const r = findRecipe(o[key], depth + 1)
    if (r) return r
  }
  return null
}

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()

export type RecipeImport = { name: string | null; servings: number | null; nutrition: Nutrition; perServing: boolean }

/** The recipe on a page, from its schema.org structured data. Null when the page doesn't publish one. */
export function recipeFromHtml(html: string): RecipeImport | null {
  for (const block of jsonLdBlocks(html)) {
    const recipe = findRecipe(block)
    if (!recipe) continue
    const n = (recipe.nutrition ?? {}) as Record<string, unknown>
    const nutrition: Nutrition = {
      calories: inRange(amount(n.calories, 'kcal'), 'calories'),
      proteinG: inRange(amount(n.proteinContent, 'g'), 'proteinG'),
      carbsG: inRange(amount(n.carbohydrateContent, 'g'), 'carbsG'),
      fatG: inRange(amount(n.fatContent, 'g'), 'fatG'),
      satFatG: inRange(amount(n.saturatedFatContent, 'g'), 'satFatG'),
      sugarsG: inRange(amount(n.sugarContent, 'g'), 'sugarsG'),
      fibreG: inRange(amount(n.fiberContent, 'g'), 'fibreG'),
      sodiumMg: inRange(amount(n.sodiumContent, 'mg'), 'sodiumMg'),
    }
    const yieldRaw = Array.isArray(recipe.recipeYield) ? recipe.recipeYield[0] : recipe.recipeYield
    const servings = typeof yieldRaw === 'number' ? yieldRaw : Number(String(yieldRaw ?? '').match(/\d+/)?.[0] ?? NaN)
    // schema.org nutrition is per serving unless servingSize says otherwise; most recipe sites follow that.
    return {
      name: typeof recipe.name === 'string' ? decode(recipe.name).slice(0, 120) : null,
      servings: Number.isFinite(servings) && servings > 0 && servings <= 100 ? servings : null,
      nutrition,
      perServing: true,
    }
  }
  return null
}

// ---------------------------------------------------------------- nutrition panel text (screenshots)

const PANEL: [keyof Nutrition, RegExp, 'kcal' | 'g' | 'mg'][] = [
  ['satFatG', /saturated(?:\s+fat)?[^\d\n]{0,20}(\d[\d,.]*\s*(?:mg|g)?)/i, 'g'],
  ['sugarsG', /sugars?[^\d\n]{0,20}(\d[\d,.]*\s*(?:mg|g)?)/i, 'g'],
  ['fibreG', /(?:dietary\s+)?fib(?:re|er)[^\d\n]{0,20}(\d[\d,.]*\s*(?:mg|g)?)/i, 'g'],
  ['sodiumMg', /sodium[^\d\n]{0,20}(\d[\d,.]*\s*(?:mg|g)?)/i, 'mg'],
  ['proteinG', /protein[^\d\n]{0,20}(\d[\d,.]*\s*(?:mg|g)?)/i, 'g'],
  ['carbsG', /carb(?:ohydrate)?s?(?:\s*\(total\))?[^\d\n]{0,20}(\d[\d,.]*\s*(?:mg|g)?)/i, 'g'],
  // "Fat" but not "Saturated fat" / "Trans fat".
  ['fatG', /(?:^|\n|total\s+)fat(?:\s*,?\s*total)?[^\d\n]{0,20}(\d[\d,.]*\s*(?:mg|g)?)/i, 'g'],
]

/**
 * Reads a nutrition panel's text, e.g. "Calories 1071 kcal / Protein 30 g / Fat 83g / Saturated Fat 36g ...".
 * Values on the next line after their label (as screenshots are often transcribed) are understood too.
 */
export function nutritionFromText(raw: string): Nutrition {
  // Join "Label\nvalue" pairs so each nutrient sits on one line.
  const text = raw.replace(/\r/g, '').replace(/([A-Za-z)])[ \t]*\n[ \t]*(\d)/g, '$1 $2')
  const out = emptyNutrition()
  const energy =
    text.match(/(?:calories|energy)[^\d\n]{0,20}(\d[\d,.]*\s*(?:kcal|cal|kj)?)/i) ?? text.match(/(\d[\d,.]*\s*kcal)/i)
  out.calories = inRange(energy ? amount(energy[1], 'kcal') : null, 'calories')
  if (out.calories != null) out.calories = Math.round(out.calories)
  for (const [key, re, unit] of PANEL) {
    const m = text.match(re)
    out[key] = inRange(m ? amount(m[1], unit) : null, key)
  }
  return out
}

/** "per serving" vs a whole recipe: a panel that says "per 100 g" is not a serving. */
export function panelIsPer100g(text: string): boolean {
  return /per\s*100\s*(?:g|ml)/i.test(text) && !/per\s+serv(?:ing|e)/i.test(text)
}
