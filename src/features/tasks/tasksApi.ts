import type { Category, Task, TaskPriority } from '@shared/types'

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

export function fetchCategories() {
  return api.get<{ categories: Category[] }>('/categories')
}
