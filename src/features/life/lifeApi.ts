import type {
  CalendarEvent,
  Capture,
  DenSummary,
  Note,
  Reminder,
  SearchResultGroup,
  ShoppingList,
  TaskHistoryEntry,
} from '@shared/types'

import { api } from '@/lib/api'

export function fetchEvents(from?: string, to?: string) {
  const params = new URLSearchParams()
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  const q = params.toString()
  return api.get<{ events: CalendarEvent[] }>(`/events${q ? `?${q}` : ''}`)
}

export function createEvent(input: {
  title: string
  date: string
  startTime?: string | null
  endTime?: string | null
  allDay?: boolean
  description?: string
  location?: string
}) {
  return api.post<{ event: CalendarEvent }>('/events', {
    ...input,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  })
}

export function deleteEvent(id: string) {
  return api.delete<{ ok: boolean }>(`/events/${id}`)
}

export function fetchReminders(status = 'pending') {
  return api.get<{ reminders: Reminder[] }>(`/reminders?status=${status}`)
}

export function fetchDueReminders() {
  return api.get<{ reminders: Reminder[] }>('/reminders/due')
}

export function createReminder(input: {
  title: string
  remindAt: string
  entityType?: string
  entityId?: string
}) {
  return api.post<{ reminder: Reminder }>('/reminders', {
    ...input,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  })
}

export function snoozeReminder(id: string, minutes = 60) {
  return api.post<{ reminder: Reminder }>(`/reminders/${id}/snooze`, {
    minutes,
  })
}

export function dismissReminder(id: string) {
  return api.post<{ ok: boolean }>(`/reminders/${id}/dismiss`)
}

export function completeReminder(id: string) {
  return api.post<{ ok: boolean }>(`/reminders/${id}/complete`)
}

export function fetchNotes(q?: string) {
  const query = q ? `?q=${encodeURIComponent(q)}` : ''
  return api.get<{ notes: Note[] }>(`/notes${query}`)
}

export function createNote(input: {
  title: string
  body?: string
  categorySlug?: string
  pinned?: boolean
}) {
  return api.post<{ note: Note }>('/notes', input)
}

export function updateNote(
  id: string,
  input: Partial<{ title: string; body: string; pinned: boolean }>,
) {
  return api.patch<{ note: Note }>(`/notes/${id}`, input)
}

export function deleteNote(id: string) {
  return api.delete<{ ok: boolean }>(`/notes/${id}`)
}

export function fetchShopping() {
  return api.get<{ lists: ShoppingList[] }>('/shopping')
}

export function addShoppingItem(input: {
  name: string
  listId?: string
  quantity?: string
}) {
  return api.post<{ list: ShoppingList; itemId: string }>(
    '/shopping/items',
    input,
  )
}

export function updateShoppingItem(
  id: string,
  input: Partial<{
    name: string
    checked: boolean
    quantity: string
    sortOrder: number
  }>,
) {
  return api.patch<{ list: ShoppingList }>(`/shopping/items/${id}`, input)
}

export function deleteShoppingItem(id: string) {
  return api.delete<{ list: ShoppingList }>(`/shopping/items/${id}`)
}

export function searchAll(q: string) {
  return api.get<{
    groups: SearchResultGroup[]
    suggestions: string[]
    recent?: string[]
  }>(`/search?q=${encodeURIComponent(q)}`)
}

export function fetchTaskHistory() {
  return api.get<{
    entries: TaskHistoryEntry[]
    completedTasks: Array<{
      id: string
      title: string
      completedAt: string | null
      skipped: number
    }>
  }>('/history/tasks')
}

export function fetchDenSummary() {
  return api.get<{ summary: DenSummary }>('/dashboard/den')
}

export function updateCaptureItem(
  captureId: string,
  itemId: string,
  input: Partial<{
    kind: string
    title: string
    dueDate: string | null
    startTime: string | null
    categorySlug: string | null
  }>,
) {
  return api.patch<{ capture: Capture }>(
    `/captures/${captureId}/items/${itemId}`,
    input,
  )
}
