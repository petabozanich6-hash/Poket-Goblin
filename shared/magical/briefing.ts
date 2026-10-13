import { greetingForHour } from './personality'
import type { CapacityMode, CalendarEvent, Reminder, Task } from '../types'

export type BriefingAction = {
  id: string
  label: string
  href: string
}

export type BriefingFact = {
  kind: 'appointment' | 'deadline' | 'overdue' | 'reminder' | 'review' | 'plan'
  label: string
  entityId?: string
}

export type DailyBriefing = {
  mode: 'rules'
  greeting: string
  headline: string
  body: string
  facts: BriefingFact[]
  actions: BriefingAction[]
  focusTaskId: string | null
  pendingReview: number
  capacityMode: CapacityMode
}

export type BriefingInput = {
  displayName: string
  capacityMode: CapacityMode
  now?: Date
  todayLocal: string
  appointmentsToday: CalendarEvent[]
  overdueTasks: Task[]
  dueTodayTasks: Task[]
  planTasks: Task[]
  dueReminders: Reminder[]
  pendingReview: number
  unprocessedCaptures: number
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export function buildDailyBriefing(input: BriefingInput): DailyBriefing {
  const now = input.now ?? new Date()
  const greeting = greetingForHour(now.getHours(), input.displayName)
  const facts: BriefingFact[] = []
  const actions: BriefingAction[] = []

  for (const event of input.appointmentsToday.slice(0, 3)) {
    const time = event.allDay ? 'all day' : formatTime(event.startsAt)
    facts.push({
      kind: 'appointment',
      label: time ? `${event.title} at ${time}` : event.title,
      entityId: event.id,
    })
  }

  for (const task of input.overdueTasks.slice(0, 3)) {
    facts.push({
      kind: 'overdue',
      label: `${task.title} (still open)`,
      entityId: task.id,
    })
  }

  for (const task of input.dueTodayTasks.slice(0, 3)) {
    facts.push({
      kind: 'deadline',
      label: `${task.title} due today`,
      entityId: task.id,
    })
  }

  for (const reminder of input.dueReminders.slice(0, 2)) {
    facts.push({
      kind: 'reminder',
      label: reminder.title,
      entityId: reminder.id,
    })
  }

  if (input.pendingReview > 0) {
    facts.push({
      kind: 'review',
      label:
        input.pendingReview === 1
          ? '1 item waiting in Inbox'
          : `${input.pendingReview} items waiting in Inbox`,
    })
  }

  const apptCount = input.appointmentsToday.length
  const attention =
    input.overdueTasks.length +
    input.dueTodayTasks.length +
    input.dueReminders.length
  const questCount = input.planTasks.length
  const focus =
    input.overdueTasks[0] ??
    input.dueTodayTasks[0] ??
    input.planTasks[0] ??
    null

  const parts: string[] = []
  if (apptCount === 1) {
    const first = input.appointmentsToday[0]!
    const time = first.allDay ? 'today' : `at ${formatTime(first.startsAt)}`
    parts.push(`you’ve got an appointment ${time}`)
  } else if (apptCount > 1) {
    parts.push(`you’ve got ${apptCount} appointments today`)
  }

  if (attention === 1) {
    parts.push('one thing that needs attention')
  } else if (attention > 1) {
    parts.push(`${attention} things that need attention`)
  }

  if (questCount > 0 && attention === 0 && apptCount === 0) {
    parts.push(
      questCount === 1
        ? 'one gentle quest on the plan'
        : `${questCount} little quests on the plan if you’re up for them`,
    )
  } else if (questCount > 0 && parts.length > 0) {
    parts.push(
      questCount === 1
        ? 'a quest we can tackle if you’re feeling up to it'
        : 'a few little quests we can tackle if you’re feeling up to it',
    )
  }

  if (input.pendingReview > 0) {
    parts.push('something waiting in Inbox when you have a moment')
  }

  let body: string
  if (parts.length === 0) {
    body =
      'Nothing urgent on the shelves right now. Capture a thought anytime — I’ll sort it.'
  } else if (parts.length === 1) {
    body = `${parts[0]![0]!.toUpperCase()}${parts[0]!.slice(1)}.`
  } else if (parts.length === 2) {
    body = `${parts[0]![0]!.toUpperCase()}${parts[0]!.slice(1)}, and ${parts[1]}.`
  } else {
    const last = parts[parts.length - 1]
    body = `${parts[0]![0]!.toUpperCase()}${parts[0]!.slice(1)}, ${parts
      .slice(1, -1)
      .join(', ')}, and ${last}.`
  }

  const headline =
    attention > 0 || apptCount > 0
      ? 'Here’s what matters today'
      : 'A calm day so far'

  if (focus) {
    actions.push({
      id: 'focus',
      label: 'Start with this',
      href: '/tasks',
    })
  }
  if (input.pendingReview > 0 || input.unprocessedCaptures > 0) {
    actions.push({ id: 'inbox', label: 'Open Inbox', href: '/inbox' })
  }
  actions.push({
    id: 'overwhelm',
    label: "I'm overwhelmed",
    href: '/den?mode=calm',
  })
  actions.push({ id: 'rescue', label: 'Rescue my day', href: '/den?rescue=1' })

  return {
    mode: 'rules',
    greeting,
    headline,
    body,
    facts,
    actions,
    focusTaskId: focus?.id ?? null,
    pendingReview: input.pendingReview,
    capacityMode: input.capacityMode,
  }
}
