export type CapacityMode = 'goblin' | 'steady' | 'quest'
export type ThemePreference = 'light' | 'dark' | 'system'
export type TaskStatus = 'open' | 'completed' | 'cancelled'
export type TaskPriority = 'low' | 'normal' | 'high'
export type CaptureItemKind =
  'task' | 'reminder' | 'appointment' | 'note' | 'shopping' | 'follow_up'
export type Confidence = 'low' | 'medium' | 'high'
export type RecurrenceFrequency =
  'daily' | 'weekly' | 'fortnightly' | 'monthly' | 'yearly' | 'custom'
export type ReminderStatus = 'pending' | 'snoozed' | 'dismissed' | 'completed'
export type ReminderEntityType =
  'task' | 'event' | 'bill' | 'follow_up' | 'general'

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
  recurrenceRuleId: string | null
  seriesId: string | null
  occurrenceDate: string | null
  skipped: boolean
  createdAt: string
  updatedAt: string
}

export type RecurrenceRule = {
  id: string
  frequency: RecurrenceFrequency
  intervalValue: number
  byWeekday: number[] | null
  dayOfMonth: number | null
  startsOn: string
  endsOn: string | null
  paused: boolean
}

export type CalendarEvent = {
  id: string
  title: string
  description: string
  location: string
  startsAt: string
  endsAt: string
  allDay: boolean
  timezone: string
  categoryId: string | null
  linkedTaskId: string | null
  recurrenceRuleId: string | null
  seriesId: string | null
  status: 'scheduled' | 'cancelled'
  createdAt: string
  updatedAt: string
}

export type Reminder = {
  id: string
  title: string
  remindAt: string
  status: ReminderStatus
  entityType: ReminderEntityType
  entityId: string | null
  repeatFrequency: 'none' | 'daily' | 'weekly' | 'fortnightly' | 'monthly'
  snoozedUntil: string | null
  createdAt: string
  updatedAt: string
}

export type Note = {
  id: string
  title: string
  body: string
  categoryId: string | null
  categorySlug: string | null
  categoryName: string | null
  pinned: boolean
  linkedTaskId: string | null
  linkedEventId: string | null
  createdAt: string
  updatedAt: string
}

export type ShoppingList = {
  id: string
  name: string
  isDefault: boolean
  createdAt: string
  items: ShoppingItem[]
}

export type ShoppingItem = {
  id: string
  listId: string
  name: string
  quantity: string
  notes: string
  checked: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type TaskHistoryEntry = {
  id: string
  taskId: string
  taskTitle: string | null
  action: string
  detail: string
  createdAt: string
}

export type SearchResultGroup = {
  type:
    'task' | 'note' | 'event' | 'shopping' | 'capture' | 'document' | 'reminder'
  label: string
  items: Array<{
    id: string
    title: string
    subtitle?: string
    href: string
  }>
}

export type NudgeFrequency = 'off' | 'quiet' | 'normal' | 'chatty'
export type PlanningApproach = 'minimal' | 'balanced' | 'ambitious'
export type GoblinFrequency = 'quiet' | 'normal' | 'chatty'

export type CaptureItem = {
  id: string
  kind: CaptureItemKind
  title: string
  dueDate: string | null
  startTime: string | null
  recurrenceFrequency: RecurrenceFrequency | null
  categorySlug: string | null
  confidence: Confidence
  uncertain: boolean
  status: 'suggested' | 'accepted' | 'rejected'
  createdTaskId: string | null
  createdEventId: string | null
  createdNoteId: string | null
  createdShoppingItemId: string | null
  createdReminderId: string | null
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
  quietHoursEnabled: boolean
  quietHoursStart: string
  quietHoursEnd: string
  nudgeFrequency: NudgeFrequency
  dailyBriefingEnabled: boolean
  eveningCheckinEnabled: boolean
  reducedMotion: boolean
  planningApproach: PlanningApproach
  goblinFrequency: GoblinFrequency
  completedQuestCount: number
}

export type Achievement = {
  id: string
  code: string
  title: string
  detail: string
  earnedAt: string
}

export type InAppNudge = {
  id: string
  kind: string
  entityType: string | null
  entityId: string | null
  title: string
  body: string
  status: 'pending' | 'shown' | 'snoozed' | 'dismissed' | 'acted'
  snoozedUntil: string | null
  createdAt: string
}

export type DailyPlan = {
  id: string
  planDate: string
  capacityMode: CapacityMode
  taskIds: string[]
  tasks: Task[]
  suggestedCapacity: number
}

export type DenSummary = {
  upcomingEvents: CalendarEvent[]
  dueReminders: Reminder[]
  shoppingNeedsAttention: ShoppingItem[]
  pinnedNotes: Note[]
  unprocessedCaptures: number
  pendingReview: number
  recentDocuments: { id: string; displayName: string; status: string }[]
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
