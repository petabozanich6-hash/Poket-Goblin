/**
 * Turns existing document-generated task suggestions into estimated sessions.
 * No writes happen here. Inferred durations are deliberately marked so the
 * approval screen can explain that the document didn't supply them.
 */
import type { DocumentSuggestion } from './understand'
import {
  recommendPathway,
  type DayAvailability,
  type PathwayResult,
  type PathwayStep,
} from './pathwayScheduler'

export type PathwayPreview = PathwayResult & {
  estimates: Array<{ stepId: string; minutes: number; inferred: true }>
  unschedulable: DocumentSuggestion[]
}

function estimateMinutes(title: string): number {
  if (/\b(draft|write|research|revise|practice|investigat)/i.test(title)) {
    return 120
  }
  if (/\b(read|review|gather|prepare|outline|plan)/i.test(title)) {
    return 60
  }
  if (/\b(submit|upload|send|check|proofread)/i.test(title)) {
    return 30
  }
  return 45
}

export function previewDocumentPathway(
  documentId: string,
  suggestions: DocumentSuggestion[],
  availability: DayAvailability[],
  completedStepIds: readonly string[] = [],
): PathwayPreview {
  const eligible = suggestions.filter(
    (item) => item.type === 'task' && item.group,
  )
  const unschedulable = eligible.filter(
    (item) => !item.dueDate || item.uncertain,
  )
  const usable = eligible.filter(
    (item) => item.dueDate && !item.uncertain,
  )
  const steps: PathwayStep[] = usable.map((item, index) => ({
    id: `${documentId}:${index}:${item.title}`,
    goalId: `${documentId}:${item.group}`,
    title: item.title,
    deadline: item.dueDate!,
    minutes: estimateMinutes(item.title),
    priority: item.priority === 'high' ? 1 : 0,
  }))

  const orderedByGoal = new Map<string, PathwayStep[]>()
  for (const step of steps) {
    const list = orderedByGoal.get(step.goalId) ?? []
    if (list.length > 0) {
      step.dependsOn = [list[list.length - 1]!.id]
    }
    list.push(step)
    orderedByGoal.set(step.goalId, list)
  }

  const result = recommendPathway(steps, availability, {
    completedStepIds,
  })
  return {
    ...result,
    estimates: steps.map((step) => ({
      stepId: step.id,
      minutes: step.minutes,
      inferred: true as const,
    })),
    unschedulable,
  }
}
