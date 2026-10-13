import type { CaptureItemKind, Confidence, TaskPriority } from '../types'
import type { GoblinSuggestion } from './types'

const KINDS = new Set([
  'task',
  'reminder',
  'appointment',
  'note',
  'shopping',
  'follow_up',
  'breakdown_step',
  'link',
])

const CONFIDENCE = new Set<Confidence>(['low', 'medium', 'high'])
const PRIORITIES = new Set<TaskPriority>(['low', 'normal', 'high'])

function asString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

/** Reject malformed AI/provider payloads before they touch user data. */
export function validateSuggestions(raw: unknown): GoblinSuggestion[] {
  if (!Array.isArray(raw)) return []
  const out: GoblinSuggestion[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const type = asString(row.type, 40)
    const title = asString(row.title, 200)
    if (!type || !title || !KINDS.has(type)) continue

    const confidence = (asString(row.confidence, 20) ?? 'medium') as Confidence
    if (!CONFIDENCE.has(confidence)) continue

    let priority: TaskPriority | null = null
    if (
      typeof row.priority === 'string' &&
      PRIORITIES.has(row.priority as TaskPriority)
    ) {
      priority = row.priority as TaskPriority
    }

    const dueDate =
      typeof row.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.dueDate)
        ? row.dueDate
        : null
    const startTime =
      typeof row.startTime === 'string' && /^\d{2}:\d{2}$/.test(row.startTime)
        ? row.startTime
        : null

    out.push({
      id:
        asString(row.id, 80) ??
        `sug_${out.length}_${title.slice(0, 12).replace(/\s+/g, '_')}`,
      type: type as GoblinSuggestion['type'],
      title,
      details: asString(row.details, 2000) ?? '',
      dueDate,
      startTime,
      recurrenceFrequency:
        typeof row.recurrenceFrequency === 'string'
          ? (row.recurrenceFrequency as GoblinSuggestion['recurrenceFrequency'])
          : null,
      categorySlug: asString(row.categorySlug, 40),
      priority,
      capacityCost:
        typeof row.capacityCost === 'number' &&
        row.capacityCost >= 1 &&
        row.capacityCost <= 5
          ? Math.round(row.capacityCost)
          : null,
      confidence,
      uncertain: Boolean(row.uncertain),
      missingInformation: Array.isArray(row.missingInformation)
        ? row.missingInformation
            .filter((v): v is string => typeof v === 'string')
            .slice(0, 8)
        : [],
      proposedAction: asString(row.proposedAction, 200) ?? `Create ${type}`,
      sourceReference: asString(row.sourceReference, 500) ?? '',
      parentSuggestionId: asString(row.parentSuggestionId, 80),
    })
  }
  return out
}

export function isCaptureKind(type: string): type is CaptureItemKind {
  return [
    'task',
    'reminder',
    'appointment',
    'note',
    'shopping',
    'follow_up',
  ].includes(type)
}
