import type {
  AssistantAction,
  AssistantReply,
} from '../../../shared/intelligence'
import type { Env } from '../../env'
import { resolveProvider } from './provider'

type GroundedContext = {
  capacityMode: string
  openTaskTitles: string[]
  overdueTitles: string[]
  todayPlanTitles: string[]
  upcomingEventTitles: string[]
  dueReminderTitles: string[]
  shoppingTitles: string[]
  noteTitles: string[]
  recentCaptureSnippets: string[]
}

export async function loadGroundedContext(
  db: D1Database,
  userId: string,
): Promise<GroundedContext> {
  const today = new Date().toISOString().slice(0, 10)
  const settings = await db
    .prepare(
      `SELECT capacity_mode as capacityMode FROM user_settings WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ capacityMode: string }>()

  const openTasks = await db
    .prepare(
      `SELECT title, due_date as dueDate FROM tasks
       WHERE user_id = ? AND status = 'open'
       ORDER BY updated_at DESC LIMIT 20`,
    )
    .bind(userId)
    .all<{ title: string; dueDate: string | null }>()

  const plan = await db
    .prepare(
      `SELECT t.title FROM daily_plans p
       JOIN daily_plan_tasks pt ON pt.plan_id = p.id
       JOIN tasks t ON t.id = pt.task_id
       WHERE p.user_id = ? AND p.plan_date = ?
       ORDER BY pt.sort_order ASC LIMIT 12`,
    )
    .bind(userId, today)
    .all<{ title: string }>()

  const events = await db
    .prepare(
      `SELECT title FROM events
       WHERE user_id = ? AND status = 'scheduled' AND starts_at >= ?
       ORDER BY starts_at ASC LIMIT 8`,
    )
    .bind(userId, new Date().toISOString())
    .all<{ title: string }>()

  const reminders = await db
    .prepare(
      `SELECT title FROM reminders
       WHERE user_id = ? AND status IN ('pending', 'snoozed')
       ORDER BY remind_at ASC LIMIT 8`,
    )
    .bind(userId)
    .all<{ title: string }>()

  const shopping = await db
    .prepare(
      `SELECT name as title FROM shopping_items
       WHERE user_id = ? AND checked = 0
       ORDER BY updated_at DESC LIMIT 10`,
    )
    .bind(userId)
    .all<{ title: string }>()

  const notes = await db
    .prepare(
      `SELECT title FROM notes WHERE user_id = ?
       ORDER BY pinned DESC, updated_at DESC LIMIT 8`,
    )
    .bind(userId)
    .all<{ title: string }>()

  const captures = await db
    .prepare(
      `SELECT raw_text as rawText FROM captures WHERE user_id = ?
       ORDER BY created_at DESC LIMIT 5`,
    )
    .bind(userId)
    .all<{ rawText: string }>()

  const open = openTasks.results ?? []
  return {
    capacityMode: settings?.capacityMode ?? 'steady',
    openTaskTitles: open.map((t) => t.title),
    overdueTitles: open
      .filter((t) => t.dueDate && t.dueDate < today)
      .map((t) => t.title),
    todayPlanTitles: (plan.results ?? []).map((t) => t.title),
    upcomingEventTitles: (events.results ?? []).map((t) => t.title),
    dueReminderTitles: (reminders.results ?? []).map((t) => t.title),
    shoppingTitles: (shopping.results ?? []).map((t) => t.title),
    noteTitles: (notes.results ?? []).map((t) => t.title),
    recentCaptureSnippets: (captures.results ?? []).map((c) =>
      c.rawText.slice(0, 120),
    ),
  }
}

function bullets(items: string[], empty: string): string {
  if (items.length === 0) return empty
  return items.map((item) => `• ${item}`).join('\n')
}

/**
 * Grounded assistant — answers only from stored user data.
 * Never invents tasks, appointments, or prior conversations.
 */
export async function answerAssistant(
  env: Env,
  db: D1Database,
  userId: string,
  question: string,
): Promise<AssistantReply> {
  const provider = resolveProvider(env)
  const ctx = await loadGroundedContext(db, userId)
  const q = question.toLowerCase()
  const actions: AssistantAction[] = []
  const groundedFacts: string[] = []
  const warnings: string[] = [
    provider.configured
      ? 'Assistant replies are grounded in your stored data (rule router). External AI chat is not enabled for free-form answers yet.'
      : 'Running on the labelled rule-based goblin brain (no AI credentials configured).',
  ]

  let message = ''

  if (/\b(today|do today|focus|first|priorit)\b/.test(q)) {
    groundedFacts.push(`Capacity mode: ${ctx.capacityMode}`)
    groundedFacts.push(...ctx.todayPlanTitles.map((t) => `Plan: ${t}`))
    groundedFacts.push(...ctx.overdueTitles.map((t) => `Overdue: ${t}`))
    message = [
      `You're in ${ctx.capacityMode} mode.`,
      '',
      'Today’s plan:',
      bullets(
        ctx.todayPlanTitles,
        'No plan items yet — visit Plan to shape a gentle day.',
      ),
      '',
      'Overdue (no punishment — just visibility):',
      bullets(ctx.overdueTitles, 'Nothing overdue.'),
      '',
      ctx.todayPlanTitles[0]
        ? `If you want a starting point: begin with “${ctx.todayPlanTitles[0]}”.`
        : ctx.openTaskTitles[0]
          ? `If you want a starting point: “${ctx.openTaskTitles[0]}”.`
          : 'Your task shelf is quiet.',
    ].join('\n')
    actions.push(
      { id: 'open_plan', label: 'Open plan', kind: 'open_plan' },
      {
        id: 'add_to_plan',
        label: 'Rebuild today’s plan',
        kind: 'add_to_plan',
      },
    )
  } else if (/\b(forget|forgetting|missing|reminders?)\b/.test(q)) {
    groundedFacts.push(...ctx.dueReminderTitles.map((t) => `Reminder: ${t}`))
    groundedFacts.push(...ctx.shoppingTitles.map((t) => `Shopping: ${t}`))
    message = [
      'Here’s what your shelves still hold:',
      '',
      'Reminders:',
      bullets(ctx.dueReminderTitles, 'No pending reminders.'),
      '',
      'Shopping:',
      bullets(ctx.shoppingTitles, 'Shopping list is clear.'),
      '',
      'Open tasks sample:',
      bullets(ctx.openTaskTitles.slice(0, 6), 'No open tasks.'),
    ].join('\n')
    actions.push(
      { id: 'open_life', label: 'Open Life shelves', kind: 'open_life' },
      { id: 'open_tasks', label: 'Open tasks', kind: 'open_tasks' },
    )
  } else if (/\b(appointment|calendar|coming up|this week)\b/.test(q)) {
    groundedFacts.push(...ctx.upcomingEventTitles.map((t) => `Event: ${t}`))
    message = [
      'Upcoming appointments on your calendar:',
      bullets(ctx.upcomingEventTitles, 'No upcoming appointments stored.'),
      '',
      'I only report what is saved — I will not invent events.',
    ].join('\n')
    actions.push({
      id: 'open_calendar',
      label: 'Open calendar',
      kind: 'open_calendar',
    })
  } else if (
    /\bbreak\s*down\b|\bhelp me (start|begin|organise|organize)\b/.test(q)
  ) {
    const topic =
      question
        .replace(/^.*?\b(break\s*down|organise|organize)\b/i, '')
        .trim() || 'this task'
    message = `I can suggest smaller steps for “${topic}”. Nothing is created until you accept them.`
    actions.push({
      id: 'propose_breakdown',
      label: 'Suggest steps',
      kind: 'propose_breakdown',
      payload: { title: topic },
    })
  } else if (/\b(wrote|note|electric|bill|search|find)\b/.test(q)) {
    const hay = [
      ...ctx.noteTitles,
      ...ctx.recentCaptureSnippets,
      ...ctx.openTaskTitles,
    ]
    const needle = q.match(/\b(electric\w*|bill|wifi|dentist|rent)\b/)?.[1]
    const hits = needle
      ? hay.filter((line) => line.toLowerCase().includes(needle))
      : []
    groundedFacts.push(...hits.map((h) => `Match: ${h}`))
    message = hits.length
      ? `I found related notes on your shelves:\n${bullets(hits, '')}`
      : 'I could not find a matching note, task, or capture in your stored data.'
    actions.push({ id: 'open_find', label: 'Open Find', kind: 'open_find' })
  } else if (/\borganise this week|organize this week|this week\b/.test(q)) {
    message = [
      'Week-shaped view from your data:',
      '',
      'Appointments:',
      bullets(ctx.upcomingEventTitles, 'None stored.'),
      '',
      'Open tasks:',
      bullets(ctx.openTaskTitles.slice(0, 8), 'None.'),
      '',
      'Want me to rebuild today’s plan around your capacity mode?',
    ].join('\n')
    actions.push(
      { id: 'open_plan', label: 'Open plan', kind: 'open_plan' },
      { id: 'open_calendar', label: 'Open calendar', kind: 'open_calendar' },
    )
  } else {
    message = [
      "I can help with your real shelves — today's plan, appointments, reminders, shopping, notes, and breaking down a stuck task.",
      '',
      'Try: “What do I need to do today?” or “Break down sorting my taxes.”',
      '',
      'I will not invent commitments that are not in your data.',
    ].join('\n')
    actions.push(
      { id: 'open_capture', label: 'Brain dump', kind: 'open_capture' },
      { id: 'open_plan', label: 'Open plan', kind: 'open_plan' },
    )
  }

  return {
    mode: provider.configured ? 'ai_unavailable' : 'rules',
    provider: provider.configured
      ? 'grounded_rules (AI chat not enabled)'
      : 'rules',
    message,
    actions,
    groundedFacts,
    warnings,
  }
}
