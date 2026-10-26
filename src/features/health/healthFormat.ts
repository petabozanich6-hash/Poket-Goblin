import type { Meal } from '@shared/health'
import type { Nutrition } from '@shared/recipes'

export const mealLabel = (m: Meal) =>
  m === 'drink' ? 'Drink' : m.charAt(0).toUpperCase() + m.slice(1)

/** Per-serving numbers in one line, e.g. "1071 kcal · 30 g protein · 51 g carbs · 83 g fat". */
export function nutritionLine(n: Partial<Nutrition>): string {
  const parts = [
    n.calories != null ? `${n.calories} kcal` : null,
    n.proteinG != null ? `${n.proteinG} g protein` : null,
    n.carbsG != null ? `${n.carbsG} g carbs` : null,
    n.fatG != null ? `${n.fatG} g fat` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}
