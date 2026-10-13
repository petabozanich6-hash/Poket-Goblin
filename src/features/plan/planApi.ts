import type { CapacityMode, DailyPlan } from '@shared/types'

import { api } from '@/lib/api'

export function fetchTodayPlan() {
  return api.get<{ plan: DailyPlan }>('/plan/today')
}

export function rebuildTodayPlan(capacityMode: CapacityMode) {
  return api.post<{ plan: DailyPlan }>('/plan/today', { capacityMode })
}
