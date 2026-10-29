import type {
  ActivityEntry,
  Habit,
  HealthProfile,
  HealthSummary,
  Intensity,
  Meal,
  MealEntry,
  Recipe,
  Supplement,
  WeighIn,
} from '@shared/health'
import type { Nutrition } from '@shared/recipes'

import { api } from '@/lib/api'

export type HealthState =
  | { available: false; enabled: false }
  | { available: true; enabled: false }
  | ({ available: true } & HealthSummary)

const tz = () => new Date().getTimezoneOffset()

export const fetchHealth = () =>
  api.get<HealthState>(`/my-health?timezoneOffsetMinutes=${tz()}`)

export const enableHealth = () =>
  api.post<HealthState>('/my-health/enable', {
    consent: true,
    timezoneOffsetMinutes: tz(),
  })

export const deleteHealthData = () =>
  api.delete_with_body<{ ok: true }>('/my-health', { confirm: 'DELETE' })

export type ProfileChange = Partial<{
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
export const updateProfile = (change: ProfileChange) =>
  api.patch<{ profile: HealthProfile }>('/my-health/profile', change)

export const logWeighIn = (input: {
  weightKg?: number
  waistCm?: number
  day?: string
}) =>
  api.post<{ weighIn: WeighIn }>('/my-health/weigh-ins', {
    ...input,
    timezoneOffsetMinutes: tz(),
  })

export const deleteWeighIn = (day: string) =>
  api.delete<{ ok: true }>(`/my-health/weigh-ins/${day}`)

export const logMeal = (
  input: {
    meal: Meal
    description?: string
    recipeId?: string
    servings?: number
    caffeineMg?: number | null
    day?: string
  } & Partial<Nutrition>,
) =>
  api.post<{ id: string }>('/my-health/meals', {
    ...input,
    timezoneOffsetMinutes: tz(),
  })

export const logActivity = (input: {
  kind: string
  minutes?: number
  steps?: number
  intensity: Intensity
  day?: string
}) =>
  api.post<{ id: string }>('/my-health/activities', {
    ...input,
    timezoneOffsetMinutes: tz(),
  })

export const changeHabit = (
  habit: Habit,
  change: { add?: number; amount?: number },
) =>
  api.put<{ amount: number }>(`/my-health/habits/${habit}`, {
    ...change,
    timezoneOffsetMinutes: tz(),
  })

export const deleteEntry = (table: 'meal' | 'activity' | 'dose', id: string) =>
  api.delete<{ ok: true }>(`/my-health/entries/${table}/${id}`)

export type History = {
  from: string
  to: string
  weighIns: WeighIn[]
  meals: MealEntry[]
  activities: ActivityEntry[]
  habits: { day: string; habit: Habit; amount: number }[]
  doses: { id: string; day: string; name: string }[]
}
export const fetchHistory = (days = 14) =>
  api.get<History>(
    `/my-health/history?days=${days}&timezoneOffsetMinutes=${tz()}`,
  )

export const addSupplement = (input: {
  name: string
  dose?: string | null
  dosesPerDay: number
  caffeineMg?: number | null
}) => api.post<{ supplements: Supplement[] }>('/my-health/supplements', input)
export const removeSupplement = (id: string) =>
  api.delete<{ supplements: Supplement[] }>(`/my-health/supplements/${id}`)
export const takeDose = (id: string) =>
  api.post<{ id: string }>(`/my-health/supplements/${id}/doses`, {
    timezoneOffsetMinutes: tz(),
  })

export type RecipeDraft = {
  name: string | null
  servings: number | null
  sourceUrl: string | null
} & Nutrition
export const fetchRecipes = () =>
  api.get<{ recipes: Recipe[] }>('/my-health/recipes')
export const saveRecipe = (
  input: {
    name: string
    servings?: number | null
    sourceUrl?: string | null
  } & Partial<Nutrition>,
) => api.post<{ id: string; recipe: Recipe }>('/my-health/recipes', input)
export const removeRecipe = (id: string) =>
  api.delete<{ ok: true }>(`/my-health/recipes/${id}`)
export const recipeFromLink = (url: string) =>
  api.post<{ preview: RecipeDraft }>('/my-health/recipes/from-link', { url })
export const recipeFromImage = (file: File) => {
  const form = new FormData()
  form.append('image', file)
  return api.upload<{ preview: RecipeDraft; warnings: string[] }>(
    '/my-health/recipes/from-image',
    form,
  )
}
