import type {
  AssistantReply,
  BreakdownLevel,
  BreakdownResult,
  IntelligenceResult,
} from '@shared/intelligence'

import { api } from '@/lib/api'

export type IntelligenceStatus = {
  provider: string
  aiConfigured: boolean
  model: string | null
  dailyLimit: number
  usedToday: number
  modeLabel: string
}

export function fetchIntelligenceStatus() {
  return api.get<IntelligenceStatus>('/intelligence/status')
}

export function interpretText(text: string) {
  return api.post<{ result: IntelligenceResult }>('/intelligence/interpret', {
    text,
  })
}

export function breakdownTask(title: string, level: BreakdownLevel = 'normal') {
  return api.post<{ result: BreakdownResult }>('/intelligence/breakdown', {
    title,
    level,
  })
}

export function acceptBreakdown(
  parentTitle: string,
  steps: { title: string }[],
) {
  return api.post<{ parentId: string; tasks: { id: string; title: string }[] }>(
    '/intelligence/breakdown/accept',
    { parentTitle, steps },
  )
}

export function askAssistant(question: string) {
  return api.post<{ reply: AssistantReply }>('/intelligence/assist', {
    question,
  })
}

export function fetchMemories() {
  return api.get<{
    memories: {
      id: string
      key: string
      value: string
      source: string
      createdAt: string
      updatedAt: string
    }[]
  }>('/intelligence/memory')
}

export function saveMemory(key: string, value: string) {
  return api.post<{ memory: { id: string; key: string; value: string } }>(
    '/intelligence/memory',
    { key, value },
  )
}

export function deleteMemory(id: string) {
  return api.delete<{ ok: boolean }>(`/intelligence/memory/${id}`)
}

export function acceptFollowUp(title: string, remindAt: string) {
  return api.post<{ reminderId: string }>('/intelligence/follow-up/accept', {
    title,
    remindAt,
  })
}
