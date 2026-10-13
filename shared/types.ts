export type CapacityMode = 'goblin' | 'steady' | 'quest'
export type ThemePreference = 'light' | 'dark' | 'system'
export type TaskStatus = 'open' | 'completed' | 'cancelled'
export type TaskPriority = 'low' | 'normal' | 'high'
export type CaptureItemKind =
  'task' | 'reminder' | 'appointment' | 'note' | 'shopping' | 'follow_up'
export type Confidence = 'low' | 'medium' | 'high'

export type Category = {
  id: string
  slug: string
  name: string
  sortOrder: number
  isBuiltin: boolean
}

export type Task = {
  id: string
  categoryId: string | null
  categorySlug: string | null
  categoryName: string | null
  title: string
  notes: string
  status: TaskStatus
  priority: TaskPriority
  dueDate: string | null
  capacityCost: number
  parentId: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type CaptureItem = {
  id: string
  kind: CaptureItemKind
  title: string
  dueDate: string | null
  categorySlug: string | null
  confidence: Confidence
  uncertain: boolean
  status: 'suggested' | 'accepted' | 'rejected'
  createdTaskId: string | null
}

export type Capture = {
  id: string
  rawText: string
  status: 'pending' | 'reviewed' | 'dismissed'
  createdAt: string
  items: CaptureItem[]
}

export type User = {
  id: string
  email: string
  displayName: string
  createdAt: string
}

export type UserSettings = {
  capacityMode: CapacityMode
  theme: ThemePreference
  gamificationEnabled: boolean
}

export type DailyPlan = {
  id: string
  planDate: string
  capacityMode: CapacityMode
  taskIds: string[]
  tasks: Task[]
  suggestedCapacity: number
}

export const CAPACITY_LIMITS: Record<CapacityMode, number> = {
  goblin: 2,
  steady: 5,
  quest: 8,
}

export const CAPACITY_LABELS: Record<CapacityMode, string> = {
  goblin: 'Goblin Mode',
  steady: 'Steady Mode',
  quest: 'Quest Mode',
}

export const CAPACITY_HINTS: Record<CapacityMode, string> = {
  goblin: 'Very limited energy — keep it tiny and kind.',
  steady: 'A normal day — a handful of meaningful things.',
  quest: 'Higher capacity — room for a bigger push.',
}
