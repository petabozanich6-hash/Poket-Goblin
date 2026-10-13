import type { CapacityMode, Task, TaskPriority } from '../types'

export type PriorityReason = {
  taskId: string
  score: number
  reasons: string[]
}

export function scoreTaskWithReasons(
  task: Task,
  today: string,
  capacityMode: CapacityMode,
  busyDay: boolean,
): PriorityReason {
  let score = 0
  const reasons: string[] = []

  if (task.priority === 'high') {
    score += 30
    reasons.push('You marked it high priority.')
  } else if (task.priority === 'normal') {
    score += 15
  } else {
    score += 5
  }

  if (task.dueDate) {
    if (task.dueDate < today) {
      score += 45
      reasons.push('It’s past the due date you set.')
    } else if (task.dueDate === today) {
      score += 40
      reasons.push('It’s due today.')
    } else {
      const days =
        (new Date(`${task.dueDate}T12:00:00`).getTime() -
          new Date(`${today}T12:00:00`).getTime()) /
        86_400_000
      if (days <= 2) {
        score += 20
        reasons.push('It’s due in the next couple of days.')
      } else if (days <= 7) {
        score += 10
        reasons.push('It’s due this week.')
      }
    }
  }

  if (capacityMode === 'goblin' || busyDay) {
    const bump = Math.max(0, 8 - task.capacityCost * 2)
    score += bump
    if (bump > 0 && task.capacityCost <= 2) {
      reasons.push(
        busyDay
          ? 'It’s a lighter task on a busy calendar day.'
          : 'It’s a lighter task for Goblin Mode.',
      )
    }
  } else if (capacityMode === 'quest') {
    score += task.capacityCost
  } else {
    score += Math.max(0, 6 - task.capacityCost)
  }

  if (task.parentId) {
    score += 8
    reasons.push('It’s a small step of a larger task.')
  }

  if (reasons.length === 0) {
    reasons.push('A reasonable open item with no stronger signals.')
  }

  return { taskId: task.id, score, reasons }
}

export function rankTasks(
  tasks: Task[],
  today: string,
  capacityMode: CapacityMode,
  busyDay: boolean,
): PriorityReason[] {
  return [...tasks]
    .map((t) => scoreTaskWithReasons(t, today, capacityMode, busyDay))
    .sort((a, b) => b.score - a.score)
}

export function priorityLabel(priority: TaskPriority): string {
  return priority
}
