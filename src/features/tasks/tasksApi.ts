import type {
  Category,
  RecurrenceFrequency,
  Task,
  TaskPriority,
} from '@shared/types'

import { api } from '@/lib/api'

export function fetchTasks(status: 'open' | 'completed' | 'all' = 'open') {
  return api.get<{ tasks: Task[] }>(`/tasks?status=${status}`)
}

export function createTask(input: {
  title: string
  notes?: string
  priority?: TaskPriority
  dueDate?: string | null
  categoryId?: string | null
  categorySlug?: string | null
  capacityCost?: number
  recurrenceFrequency?: RecurrenceFrequency | null
}) {
  return api.post<{ task: Task }>('/tasks', input)
}

export function updateTask(
  id: string,
  input: Partial<{
    title: string
    notes: string
    priority: TaskPriority
    dueDate: string | null
    categoryId: string | null
    categorySlug: string | null
    capacityCost: number
    status: 'open' | 'completed' | 'cancelled'
  }>,
) {
  return api.patch<{ task: Task }>(`/tasks/${id}`, input)
}

export function deleteTask(id: string) {
  return api.delete<{ ok: boolean }>(`/tasks/${id}`)
}

export function skipTaskOccurrence(id: string) {
  return api.post<{ ok: boolean }>(`/tasks/${id}/skip`)
}

export function pauseTaskSeries(id: string) {
  return api.post<{ ok: boolean }>(`/tasks/${id}/pause-series`)
}

export function stopTaskSeries(id: string) {
  return api.post<{ ok: boolean }>(`/tasks/${id}/stop-series`)
}

export function fetchCategories() {
  return api.get<{ categories: Category[] }>('/categories')
}
