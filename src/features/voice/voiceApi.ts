import type { GoblinExpression, GoblinProfile } from '@shared/goblin/profile'

import type { GoblinResponse } from '@/features/goblin/goblinApi'
import { api } from '@/lib/api'

export type ConverseResponse = GoblinResponse & {
  reply: string
  heard: string
  addressed: boolean
  expressionsUsed: string[]
  answers: { title: string; lines: string[] }[]
  replayed?: boolean
}

export function converse(input: {
  text: string
  requestId: string
  source: 'voice' | 'text' | 'offline'
  capturedAt?: string
  timezoneOffsetMinutes?: number
}) {
  return api.post<ConverseResponse>('/goblin/converse', {
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    ...input,
  })
}

export type ProfileResponse = {
  profile: GoblinProfile
  expressions: GoblinExpression[]
}

export const fetchGoblinProfile = () =>
  api.get<ProfileResponse>('/goblin/profile')

export const saveGoblinProfile = (
  patch: Partial<Omit<GoblinProfile, 'speechNoticeAt'>> & {
    speechNoticeAccepted?: boolean
  },
) => api.patch<{ profile: GoblinProfile }>('/goblin/profile', patch)

export const resetGoblinProfile = () =>
  api.delete<ProfileResponse>('/goblin/profile')

export const addExpression = (phrase: string, meaning: string) =>
  api.post<{ expression: GoblinExpression }>('/goblin/expressions', {
    phrase,
    meaning,
  })

export const updateExpression = (id: string, phrase: string, meaning: string) =>
  api.patch<{ ok: boolean }>(`/goblin/expressions/${encodeURIComponent(id)}`, {
    phrase,
    meaning,
  })

export const deleteExpression = (id: string) =>
  api.delete<{ ok: boolean }>(`/goblin/expressions/${encodeURIComponent(id)}`)

export const GOBLIN_PROFILE_KEY = ['goblin-profile']
