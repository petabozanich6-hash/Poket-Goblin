import type {
  CaptureDuplicateRef,
  CaptureItemKind,
  CapacityMode,
  Confidence,
  RecurrenceFrequency,
  TaskPriority,
} from '../types'

/** Validated goblin suggestion — never applied until the user confirms. */
export type GoblinSuggestion = {
  id: string
  type: CaptureItemKind | 'breakdown_step' | 'follow_up' | 'link'
  title: string
  details: string
  dueDate: string | null
  startTime: string | null
  recurrenceFrequency: RecurrenceFrequency | null
  categorySlug: string | null
  priority: TaskPriority | null
  capacityCost: number | null
  confidence: Confidence
  uncertain: boolean
  missingInformation: string[]
  proposedAction: string
  sourceReference: string
  parentSuggestionId: string | null
  /** An open task/shopping item the user already has with the same title. */
  possibleDuplicateOf?: ExistingItemRef | null
}

export type ExistingItemRef = CaptureDuplicateRef

export type IntelligenceMode = 'rules' | 'ai' | 'ai_unavailable'

export type IntelligenceResult = {
  mode: IntelligenceMode
  provider: string
  suggestions: GoblinSuggestion[]
  summary: string
  warnings: string[]
  /** True only when a paid AI provider was actually called. */
  aiCalled?: boolean
}

export type BreakdownLevel = 'tiny' | 'normal' | 'detailed'

export type BreakdownResult = {
  mode: IntelligenceMode
  provider: string
  originalTitle: string
  level: BreakdownLevel
  steps: GoblinSuggestion[]
  warnings: string[]
  /** True only when a model was actually called (counts toward the AI allowance). */
  aiCalled?: boolean
}

export type AssistantAction = {
  id: string
  label: string
  kind:
    | 'open_plan'
    | 'open_capture'
    | 'open_calendar'
    | 'open_tasks'
    | 'open_life'
    | 'open_find'
    | 'propose_breakdown'
    | 'propose_follow_up'
    | 'add_to_plan'
  payload?: Record<string, string>
}

export type AssistantReply = {
  mode: IntelligenceMode
  provider: string
  message: string
  actions: AssistantAction[]
  groundedFacts: string[]
  warnings: string[]
  /** True only when a model was actually called (counts toward the AI allowance). */
  aiCalled?: boolean
}

export type PlanningAdvice = {
  mode: IntelligenceMode
  capacityMode: CapacityMode
  recommendedTaskIds: string[]
  rationale: string[]
  warnings: string[]
}

export type AiProviderName = 'none' | 'openai_compatible'
