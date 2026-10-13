import type { Achievement, DailyPlan, InAppNudge, Task } from '@shared/types'
import type { DailyBriefing, RescueSuggestion } from '@shared/magical'

import { api } from '@/lib/api'

function tz() {
  return new Date().getTimezoneOffset()
}

export function fetchBriefing() {
  return api.get<{ briefing: DailyBriefing }>(`/magical/briefing?tz=${tz()}`)
}

export function fetchPriorities() {
  return api.get<{
    capacityMode: string
    busyDay: boolean
    items: Array<{ task: Task; score: number; reasons: string[] }>
  }>(`/magical/priorities?tz=${tz()}`)
}

export function proposeRescue() {
  return api.post<{ rescueId: string; suggestion: RescueSuggestion }>(
    '/magical/rescue',
    { timezoneOffsetMinutes: tz() },
  )
}

export function acceptRescue(rescueId: string, keepTaskIds: string[]) {
  return api.post<{ plan: DailyPlan }>('/magical/rescue/accept', {
    rescueId,
    keepTaskIds,
  })
}

export function dismissRescue(rescueId: string) {
  return api.post<{ ok: boolean }>('/magical/rescue/dismiss', { rescueId })
}

export function fetchNudges() {
  return api.get<{
    quiet: boolean
    nudges: InAppNudge[]
    message: string | null
  }>(`/magical/nudges?tz=${tz()}`)
}

export function snoozeNudge(id: string, minutes = 60) {
  return api.post<{ ok: boolean }>(`/magical/nudges/${id}/snooze`, { minutes })
}

export function dismissNudge(id: string) {
  return api.post<{ ok: boolean }>(`/magical/nudges/${id}/dismiss`)
}

export function fetchTinySteps(title: string, current?: string) {
  return api.post<{
    mode: 'rules'
    title: string
    steps: Array<{ id: string; title: string }>
    note: string
  }>('/magical/tiny-step', { title, current })
}

export function acceptTinyStep(parentId: string, title: string) {
  return api.post<{ task: { id: string; title: string; parentId: string } }>(
    '/magical/tiny-step/accept',
    { parentId, title },
  )
}

export function fetchAchievements() {
  return api.get<{
    enabled: boolean
    achievements: Achievement[]
    completedQuestCount: number
  }>('/magical/achievements')
}
