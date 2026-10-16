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
  deadlines: Array<{ stepId: string; deadline: string }>
  stepOrders: Array<{ stepId: string; order: number }>
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
  const groupOrder = new Map<string, number>()
  const usable = eligible
    .filter((item) => item.dueDate && !item.uncertain)
    .map((item, originalIndex) => {
      const group = item.group!
      if (!groupOrder.has(group)) groupOrder.set(group, groupOrder.size)
      return { item, originalIndex }
    })
    .sort((a, b) => {
      if (a.item.group !== b.item.group)
        return (
          (groupOrder.get(a.item.group!) ?? 0) -
          (groupOrder.get(b.item.group!) ?? 0)
        )
      const aStep = Number(a.item.step?.split('/')[0])
      const bStep = Number(b.item.step?.split('/')[0])
      if (Number.isFinite(aStep) && Number.isFinite(bStep))
        return aStep - bStep || a.originalIndex - b.originalIndex
      return a.originalIndex - b.originalIndex
    })
  const steps: PathwayStep[] = usable.map(({ item, originalIndex }) => ({
    id: `${documentId}:${originalIndex}:${item.title}`,
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
    deadlines: steps.map((step) => ({
      stepId: step.id,
      deadline: step.deadline,
    })),
    stepOrders: steps.map((step, order) => ({ stepId: step.id, order })),
    estimates: steps.map((step) => ({
      stepId: step.id,
      minutes: step.minutes,
      inferred: true as const,
    })),
    unschedulable,
  }
}
