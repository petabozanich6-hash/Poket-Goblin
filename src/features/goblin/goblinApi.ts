import { api } from '@/lib/api'

export type GoblinResult =
  | { kind: 'done'; actionId: string; message: string; undoable: boolean }
  | { kind: 'confirm'; actionId: string; message: string }
  | {
      kind: 'clarify'
      message: string
      options: { actionId: string; label: string }[]
    }
  | { kind: 'info'; message: string }

export type GoblinResponse = {
  results: GoblinResult[]
  questions: string[]
  capture: string[]
  overwhelm: boolean
}

export function goblinAct(text: string) {
  return api.post<GoblinResponse>('/goblin/act', {
    text,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  })
}

export const undoGoblinAction = (id: string) =>
  api.post<{ message: string }>(
    `/goblin/actions/${encodeURIComponent(id)}/undo`,
    {},
  )
export const confirmGoblinAction = (id: string) =>
  api.post<{ message: string }>(
    `/goblin/actions/${encodeURIComponent(id)}/confirm`,
    {},
  )
export const declineGoblinAction = (id: string) =>
  api.post<{ ok: boolean }>(
    `/goblin/actions/${encodeURIComponent(id)}/decline`,
    {},
  )

/** Everything the Goblin's actions can touch, for refreshing views. */
export const GOBLIN_QUERY_KEYS = [
  'shopping',
  'tasks',
  'plan',
  'priorities',
  'den-summary',
  'events',
  'reminders',
  'notes',
  'history',
  'briefing',
  'search',
]
