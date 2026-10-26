import { describe, expect, it } from 'vitest'

import { nutritionFromText, panelIsPer100g, recipeFromHtml, scaleNutrition } from './recipes'

// The Mob "Pork Belly Benedict With Gochujang Hollandaise" nutrition panel, as transcribed from a screenshot.
const MOB_PANEL = `Pork Belly Bened
Ingredients Method Nutrition
Nutritional information per serving:
Calories
1071 kcal
Protein
30 g
Fat 83g
Saturated Fat 36g
Carbohydrates 51g
Sugars 14g
Dietary Fibre 4g
Sodium 1870mg
Start cooking`

describe('nutrition panel text', () => {
  it('reads a recipe app panel exactly, including values on the next line', () => {
    expect(nutritionFromText(MOB_PANEL)).toEqual({
      calories: 1071, proteinG: 30, fatG: 83, satFatG: 36, carbsG: 51, sugarsG: 14, fibreG: 4, sodiumMg: 1870,
    })
    expect(panelIsPer100g(MOB_PANEL)).toBe(false)
  })

  it('handles kilojoules, grams of sodium and missing values without guessing', () => {
    const n = nutritionFromText('Energy 2000 kJ\nProtein 12.5g\nSodium 1.2 g')
    expect(n).toMatchObject({ calories: 478, proteinG: 12.5, sodiumMg: 1200, fatG: null, carbsG: null })
    expect(panelIsPer100g('Average quantity per 100 g')).toBe(true)
  })

  it('scales to the servings eaten', () => {
    const half = scaleNutrition(nutritionFromText(MOB_PANEL), 0.5)
    expect(half).toMatchObject({ calories: 536, proteinG: 15, fatG: 41.5, sodiumMg: 935 })
  })
})

describe('recipe links (schema.org structured data)', () => {
  const page = (ld: unknown) => `<html><head><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body>…</body></html>`

  it('reads name, servings and per-serving nutrition from a Recipe, including inside @graph', () => {
    const html = page({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebPage', name: 'x' },
        {
          '@type': 'Recipe',
          name: 'Pork Belly Benedict With Gochujang Hollandaise',
          recipeYield: '4 servings',
          nutrition: { '@type': 'NutritionInformation', calories: '1071 kcal', proteinContent: '30 g', fatContent: '83 g', saturatedFatContent: '36 g', carbohydrateContent: '51 g', sugarContent: '14 g', fiberContent: '4 g', sodiumContent: '1870 mg' },
        },
      ],
    })
    expect(recipeFromHtml(html)).toEqual({
      name: 'Pork Belly Benedict With Gochujang Hollandaise',
      servings: 4,
      perServing: true,
      nutrition: { calories: 1071, proteinG: 30, fatG: 83, satFatG: 36, carbsG: 51, sugarsG: 14, fibreG: 4, sodiumMg: 1870 },
    })
  })

  it('returns null for pages without a recipe, and ignores broken blocks', () => {
    expect(recipeFromHtml('<script type="application/ld+json">{oops</script>')).toBeNull()
    expect(recipeFromHtml(page({ '@type': 'Article', name: 'Not food' }))).toBeNull()
  })
})
