/**
 * The action-taking Goblin.
 *
 * For each clause the person said, decide against *their own records* what
 * to do, then either:
 * - do it now (safe, explicit, reversible, unambiguous) and offer Undo,
 * - propose it and ask for a yes (consequential, or autonomy = 'ask'),
 * - ask one question (several possible matches, or missing details),
 * - answer (questions about their records), or
 * - hand it on to the existing brain-dump review (anything unrecognised).
 *
 * Every change is recorded in goblin_actions with the state before and after,
 * which is what makes Undo real.
 */
import {
  parseUtterance,
  type Operation,
  type ShoppingEntry,
} from '../../../shared/goblin/language'
import {
  bestMatch,
  similarity,
  type Candidate,
} from '../../../shared/goblin/match'
import { addHoursIso, localDateTimeToIso } from '../datetime'
import { recordTaskHistory } from '../history'
import { newId } from '../ids'
import { ensureDefaultShoppingList } from '../shopping'

// ------------------------------------------------------------------ types

export type Plan =
  | { kind: 'shopping_insert'; listId: string; name: string; quantity: string }
  | {
      kind: 'shopping_update'
      id: string
      before: ShoppingState
      after: ShoppingState
    }
  | { kind: 'task_insert'; title: string; dueDate: string | null }
  | { kind: 'task_update'; id: string; before: TaskState; after: TaskState }
  | { kind: 'reminder_insert'; title: string; remindAt: string }
  | {
      kind: 'reminder_update'
      id: string
      before: { status: string }
      after: { status: string }
    }
  | {
      kind: 'event_insert'
      title: string
      startsAt: string
      endsAt: string
      allDay: boolean
    }
  | { kind: 'event_update'; id: string; before: EventState; after: EventState }

type ShoppingState = {
  checked: number
  checkedAt: string | null
  removedAt: string | null
  quantity: string
}
type TaskState = { status: string; completedAt: string | null }
type EventState = {
  startsAt: string
  endsAt: string
  allDay: number
  status: string
}

export type ActResult =
  | { kind: 'done'; actionId: string; message: string; undoable: boolean }
  | { kind: 'confirm'; actionId: string; message: string }
  | {
      kind: 'clarify'
      message: string
      options: { actionId: string; label: string }[]
    }
  | { kind: 'info'; message: string }

export type ActResponse = {
  results: ActResult[]
  /** Clauses for the existing engines: Ask, overwhelm help, brain-dump review. */
  questions: string[]
  capture: string[]
  overwhelm: boolean
}

type Ctx = {
  db: D1Database
  userId: string
  offset: number
  now: Date
  /** The user's local date as a Date whose local fields are their wall clock (noon). */
  wallClock: Date
  autonomy: 'auto' | 'ask'
  groupId: string
  lastTitle: string | null
}

type ShoppingRow = Candidate & {
  quantity: string
  checked: number
  checkedAt: string | null
}
type TaskRow = Candidate & { status: string; completedAt: string | null }
type ReminderRow = Candidate & { remindAt: string }
type EventRow = Candidate & { startsAt: string; endsAt: string; allDay: number }

// ---------------------------------------------------------------- helpers

function wallClockDate(now: Date, offset: number): Date {
  const shifted = new Date(now.getTime() - offset * 60_000)
  return new Date(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    12,
    0,
    0,
  )
}

function cap(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

function itemLabel(entry: ShoppingEntry): string {
  return entry.quantity ? `${entry.quantity} ${entry.name}` : entry.name
}

function dayLabel(iso: string, offset: number, withTime: boolean): string {
  const local = new Date(new Date(iso).getTime() - offset * 60_000)
  const day = local.toLocaleDateString('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
  if (!withTime) return day
  return `${day} at ${local.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}`
}

function eventWhen(e: { startsAt: string; allDay: number }, offset: number) {
  return dayLabel(e.startsAt, offset, !e.allDay)
}

// ---------------------------------------------------------------- loading

async function loadShopping(ctx: Ctx) {
  const rows = await ctx.db
    .prepare(
      `SELECT id, name as title, quantity, checked, checked_at as checkedAt
       FROM shopping_items
       WHERE user_id = ? AND removed_at IS NULL
         AND (checked = 0 OR checked_at >= ?)`,
    )
    .bind(
      ctx.userId,
      new Date(ctx.now.getTime() - 14 * 86_400_000).toISOString(),
    )
    .all<Omit<ShoppingRow, 'type'>>()
  const all = (rows.results ?? []).map((r) => ({
    ...r,
    type: 'shopping' as const,
  }))
  return {
    active: all.filter((r) => !r.checked),
    bought: all.filter((r) => r.checked),
  }
}

async function loadTasks(ctx: Ctx) {
  const rows = await ctx.db
    .prepare(
      `SELECT id, title, status, completed_at as completedAt FROM tasks
       WHERE user_id = ? AND (status = 'open' OR (status = 'completed' AND completed_at >= ?))
       ORDER BY created_at DESC LIMIT 300`,
    )
    .bind(
      ctx.userId,
      new Date(ctx.now.getTime() - 14 * 86_400_000).toISOString(),
    )
    .all<Omit<TaskRow, 'type'>>()
  const all = (rows.results ?? []).map((r) => ({ ...r, type: 'task' as const }))
  return {
    open: all.filter((r) => r.status === 'open'),
    done: all.filter((r) => r.status === 'completed'),
  }
}

async function loadReminders(ctx: Ctx): Promise<ReminderRow[]> {
  const rows = await ctx.db
    .prepare(
      `SELECT id, title, remind_at as remindAt FROM reminders
       WHERE user_id = ? AND status IN ('pending', 'snoozed') LIMIT 200`,
    )
    .bind(ctx.userId)
    .all<Omit<ReminderRow, 'type'>>()
  return (rows.results ?? []).map((r) => ({ ...r, type: 'reminder' }))
}

async function loadEvents(
  ctx: Ctx,
  fromDays = -1,
  toDays = 120,
): Promise<EventRow[]> {
  const rows = await ctx.db
    .prepare(
      `SELECT id, title, starts_at as startsAt, ends_at as endsAt, all_day as allDay FROM events
       WHERE user_id = ? AND status = 'scheduled' AND starts_at >= ? AND starts_at <= ?
       ORDER BY starts_at ASC LIMIT 200`,
    )
    .bind(
      ctx.userId,
      new Date(ctx.now.getTime() + fromDays * 86_400_000).toISOString(),
      new Date(ctx.now.getTime() + toDays * 86_400_000).toISOString(),
    )
    .all<Omit<EventRow, 'type'>>()
  return (rows.results ?? []).map((r) => ({ ...r, type: 'event' }))
}

// ------------------------------------------------------------ applying

/** Carry out a plan. Returns the id of the record it touched. */
async function applyPlan(
  db: D1Database,
  userId: string,
  plan: Plan,
  now: string,
): Promise<string> {
  switch (plan.kind) {
    case 'shopping_insert': {
      const id = newId('sitem')
      const max = await db
        .prepare(
          `SELECT COALESCE(MAX(sort_order), 0) as m FROM shopping_items WHERE list_id = ? AND user_id = ?`,
        )
        .bind(plan.listId, userId)
        .first<{ m: number }>()
      await db
        .prepare(
          `INSERT INTO shopping_items (id, list_id, user_id, name, quantity, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          plan.listId,
          userId,
          plan.name,
          plan.quantity,
          (max?.m ?? 0) + 1,
        )
        .run()
      return id
    }
    case 'shopping_update':
      await db
        .prepare(
          `UPDATE shopping_items SET checked = ?, checked_at = ?, removed_at = ?, quantity = ?,
             updated_at = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(
          plan.after.checked,
          plan.after.checkedAt,
          plan.after.removedAt,
          plan.after.quantity,
          now,
          plan.id,
          userId,
        )
        .run()
      return plan.id
    case 'task_insert': {
      const id = newId('task')
      await db
        .prepare(
          `INSERT INTO tasks (id, user_id, title, due_date, capacity_cost) VALUES (?, ?, ?, ?, 2)`,
        )
        .bind(id, userId, plan.title, plan.dueDate)
        .run()
      await recordTaskHistory(db, userId, id, 'created', 'Told the Goblin')
      return id
    }
    case 'task_update':
      await db
        .prepare(
          `UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(plan.after.status, plan.after.completedAt, now, plan.id, userId)
        .run()
      await recordTaskHistory(
        db,
        userId,
        plan.id,
        plan.after.status === 'open' ? 'reopened' : plan.after.status,
        'Told the Goblin',
      )
      return plan.id
    case 'reminder_insert': {
      const id = newId('rem')
      await db
        .prepare(
          `INSERT INTO reminders (id, user_id, title, remind_at) VALUES (?, ?, ?, ?)`,
        )
        .bind(id, userId, plan.title, plan.remindAt)
        .run()
      return id
    }
    case 'reminder_update':
      await db
        .prepare(
          `UPDATE reminders SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(plan.after.status, now, plan.id, userId)
        .run()
      return plan.id
    case 'event_insert': {
      const id = newId('evt')
      await db
        .prepare(
          `INSERT INTO events (id, user_id, title, starts_at, ends_at, all_day) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          userId,
          plan.title,
          plan.startsAt,
          plan.endsAt,
          plan.allDay ? 1 : 0,
        )
        .run()
      return id
    }
    case 'event_update':
      await db
        .prepare(
          `UPDATE events SET starts_at = ?, ends_at = ?, all_day = ?, status = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        )
        .bind(
          plan.after.startsAt,
          plan.after.endsAt,
          plan.after.allDay,
          plan.after.status,
          now,
          plan.id,
          userId,
        )
        .run()
      return plan.id
  }
}

/** Reverse a plan that was carried out on `targetId`. */
export async function revertPlan(
  db: D1Database,
  userId: string,
  plan: Plan,
  targetId: string,
  now: string,
) {
  switch (plan.kind) {
    case 'shopping_insert':
      await db
        .prepare(
          `UPDATE shopping_items SET removed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(now, now, targetId, userId)
        .run()
      return
    case 'shopping_update':
      await applyPlan(db, userId, { ...plan, after: plan.before }, now)
      return
    case 'task_insert':
      await db
        .prepare(
          `UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(now, targetId, userId)
        .run()
      return
    case 'task_update':
      await applyPlan(db, userId, { ...plan, after: plan.before }, now)
      return
    case 'reminder_insert':
      await db
        .prepare(
          `UPDATE reminders SET status = 'dismissed', updated_at = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(now, targetId, userId)
        .run()
      return
    case 'reminder_update':
      await applyPlan(db, userId, { ...plan, after: plan.before }, now)
      return
    case 'event_insert':
      await db
        .prepare(
          `UPDATE events SET status = 'cancelled', updated_at = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(now, targetId, userId)
        .run()
      return
    case 'event_update':
      await applyPlan(db, userId, { ...plan, after: plan.before }, now)
  }
}

function targetType(plan: Plan): string {
  return plan.kind.split('_')[0]!
}

/** Record and (unless it needs a yes) carry out a plan. */
async function act(
  ctx: Ctx,
  plan: Plan,
  message: string,
  mode: 'do' | 'propose' = 'do',
): Promise<ActResult> {
  const actionId = newId('gact')
  const now = new Date().toISOString()
  const propose = mode === 'propose' || ctx.autonomy === 'ask'
  let target: string | null = 'id' in plan ? plan.id : null
  if (!propose) target = await applyPlan(ctx.db, ctx.userId, plan, now)
  await ctx.db
    .prepare(
      `INSERT INTO goblin_actions (id, user_id, group_id, kind, target_type, target_id, status, message, after_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      actionId,
      ctx.userId,
      ctx.groupId,
      plan.kind,
      targetType(plan),
      target,
      propose ? 'proposed' : 'done',
      message,
      JSON.stringify(plan),
    )
    .run()
  return propose
    ? {
        kind: 'confirm',
        actionId,
        message: message.replace(/\.$/, '?').replace(/^/, 'Shall I: '),
      }
    : { kind: 'done', actionId, message, undoable: true }
}

/** Store alternatives for a one-question clarification. */
async function choices(
  ctx: Ctx,
  question: string,
  options: { plan: Plan; label: string; message: string }[],
): Promise<ActResult> {
  const out: { actionId: string; label: string }[] = []
  for (const option of options) {
    const actionId = newId('gact')
    await ctx.db
      .prepare(
        `INSERT INTO goblin_actions (id, user_id, group_id, kind, target_type, target_id, status, message, after_json)
         VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
      )
      .bind(
        actionId,
        ctx.userId,
        `${ctx.groupId}:${question.slice(0, 20)}`,
        option.plan.kind,
        targetType(option.plan),
        'id' in option.plan ? option.plan.id : null,
        option.message,
        JSON.stringify(option.plan),
      )
      .run()
    out.push({ actionId, label: option.label })
  }
  return { kind: 'clarify', message: question, options: out }
}

// -------------------------------------------------------------- operations

async function shoppingAdd(
  ctx: Ctx,
  items: ShoppingEntry[],
): Promise<ActResult[]> {
  const { active } = await loadShopping(ctx)
  const results: ActResult[] = []
  const listId = await ensureDefaultShoppingList(ctx.db, ctx.userId)
  const added: string[] = []
  for (const entry of items) {
    const existing = active.find(
      (row) =>
        similarity(entry.name, row.title) >= 0.85 &&
        similarity(row.title, entry.name) >= 0.85,
    )
    if (existing) {
      if (entry.quantity && entry.quantity !== existing.quantity) {
        results.push(
          await act(
            ctx,
            {
              kind: 'shopping_update',
              id: existing.id,
              before: {
                checked: 0,
                checkedAt: null,
                removedAt: null,
                quantity: existing.quantity,
              },
              after: {
                checked: 0,
                checkedAt: null,
                removedAt: null,
                quantity: entry.quantity,
              },
            },
            `Updated ${existing.title} to ${entry.quantity}.`,
          ),
        )
      } else {
        results.push({
          kind: 'info',
          message: `${cap(existing.title)} is already on your list.`,
        })
      }
      continue
    }
    const name = cap(entry.name)
    const result = await act(
      ctx,
      { kind: 'shopping_insert', listId, name, quantity: entry.quantity },
      `${cap(itemLabel({ ...entry, name }))} added to your shopping list.`,
    )
    results.push(result)
    added.push(name)
  }
  return results
}

async function complete(
  ctx: Ctx,
  target: string,
  domain: 'shopping' | 'task' | 'event' | 'any',
): Promise<ActResult> {
  const now = new Date().toISOString()
  const shopping =
    domain === 'shopping' || domain === 'any'
      ? await loadShopping(ctx)
      : { active: [], bought: [] }
  const tasks =
    domain === 'task' || domain === 'any' || domain === 'shopping'
      ? await loadTasks(ctx)
      : { open: [], done: [] }
  const reminders =
    domain === 'task' || domain === 'any' ? await loadReminders(ctx) : []
  const candidates: Candidate[] = [
    ...shopping.active,
    ...tasks.open,
    ...reminders,
  ]
  if (domain === 'event') {
    const events = await loadEvents(ctx, -14, 1)
    const m = bestMatch(target, events)
    return m.kind === 'none'
      ? { kind: 'info', message: 'Glad that’s done! 👹' }
      : {
          kind: 'info',
          message: `Glad ${m.kind === 'one' ? m.match.title : 'that'} is done! 👹`,
        }
  }
  const match = bestMatch(target, candidates)
  if (match.kind === 'many') {
    return choices(
      ctx,
      `I found a few things that could be “${target}”. Which one did you finish?`,
      match.matches.map((c) => ({
        label: c.title,
        message: `Done: ${c.title}.`,
        plan: completionPlan(c, shopping.active, tasks.open, now),
      })),
    )
  }
  if (match.kind === 'one') {
    const c = match.match
    const msg =
      c.type === 'shopping'
        ? `${cap(c.title)} crossed off your list! 👹`
        : c.type === 'reminder'
          ? `Reminder “${c.title}” done. 👹`
          : `Excellent — “${c.title}” is done! 👹`
    return act(ctx, completionPlan(c, shopping.active, tasks.open, now), msg)
  }
  // Already done? Then say so instead of doing it twice.
  const already = bestMatch(target, [...shopping.bought, ...tasks.done])
  if (already.kind !== 'none') {
    const title = already.kind === 'one' ? already.match.title : target
    return {
      kind: 'info',
      message: `${cap(title)} was already crossed off. 👍`,
    }
  }
  return {
    kind: 'info',
    message:
      domain === 'shopping'
        ? `Got it! I couldn’t find ${target} on your list, so there’s nothing to cross off.`
        : `Nice work! I couldn’t find “${target}” on your lists, so there’s nothing to tick off.`,
  }
}

function completionPlan(
  c: Candidate,
  shopping: ShoppingRow[],
  tasks: TaskRow[],
  now: string,
): Plan {
  if (c.type === 'shopping') {
    const row = shopping.find((s) => s.id === c.id)!
    return {
      kind: 'shopping_update',
      id: c.id,
      before: {
        checked: 0,
        checkedAt: null,
        removedAt: null,
        quantity: row.quantity,
      },
      after: {
        checked: 1,
        checkedAt: now,
        removedAt: null,
        quantity: row.quantity,
      },
    }
  }
  if (c.type === 'reminder') {
    return {
      kind: 'reminder_update',
      id: c.id,
      before: { status: 'pending' },
      after: { status: 'completed' },
    }
  }
  const row = tasks.find((t) => t.id === c.id)
  return {
    kind: 'task_update',
    id: c.id,
    before: { status: 'open', completedAt: row?.completedAt ?? null },
    after: { status: 'completed', completedAt: now },
  }
}

async function cancel(ctx: Ctx, target: string): Promise<ActResult> {
  const now = new Date().toISOString()
  const shopping = await loadShopping(ctx)
  const tasks = await loadTasks(ctx)
  const reminders = await loadReminders(ctx)
  const events = await loadEvents(ctx, 0, 120)
  const match = bestMatch(target, [
    ...shopping.active,
    ...tasks.open,
    ...reminders,
    ...events,
  ])
  if (match.kind === 'none') {
    return {
      kind: 'info',
      message: `I couldn’t find ${target} on your lists — nothing to remove.`,
    }
  }
  const planFor = (
    c: Candidate,
  ): { plan: Plan; message: string; consequential: boolean } => {
    if (c.type === 'shopping') {
      const row = shopping.active.find((s) => s.id === c.id)!
      return {
        plan: {
          kind: 'shopping_update',
          id: c.id,
          before: {
            checked: 0,
            checkedAt: null,
            removedAt: null,
            quantity: row.quantity,
          },
          after: {
            checked: 0,
            checkedAt: null,
            removedAt: now,
            quantity: row.quantity,
          },
        },
        message: `${cap(c.title)} is off your shopping list.`,
        consequential: false,
      }
    }
    if (c.type === 'reminder') {
      return {
        plan: {
          kind: 'reminder_update',
          id: c.id,
          before: { status: 'pending' },
          after: { status: 'dismissed' },
        },
        message: `Reminder “${c.title}” cancelled.`,
        consequential: false,
      }
    }
    if (c.type === 'event') {
      const e = events.find((x) => x.id === c.id)!
      return {
        plan: {
          kind: 'event_update',
          id: c.id,
          before: {
            startsAt: e.startsAt,
            endsAt: e.endsAt,
            allDay: e.allDay,
            status: 'scheduled',
          },
          after: {
            startsAt: e.startsAt,
            endsAt: e.endsAt,
            allDay: e.allDay,
            status: 'cancelled',
          },
        },
        message: `remove “${c.title}” (${eventWhen(e, ctx.offset)}) from your calendar.`,
        consequential: true,
      }
    }
    return {
      plan: {
        kind: 'task_update',
        id: c.id,
        before: { status: 'open', completedAt: null },
        after: { status: 'cancelled', completedAt: null },
      },
      message: `“${c.title}” taken off your tasks.`,
      consequential: false,
    }
  }
  if (match.kind === 'many') {
    return choices(
      ctx,
      `Which one should I remove?`,
      match.matches.map((c) => ({ label: c.title, ...planFor(c) })),
    )
  }
  const { plan, message, consequential } = planFor(match.match)
  return act(ctx, plan, message, consequential ? 'propose' : 'do')
}

async function notYet(ctx: Ctx, target: string): Promise<ActResult> {
  const shopping = await loadShopping(ctx)
  const tasks = await loadTasks(ctx)
  const match = bestMatch(target, [...shopping.active, ...tasks.open])
  if (match.kind === 'one') {
    return {
      kind: 'info',
      message:
        match.match.type === 'shopping'
          ? `No worries — ${match.match.title} is still on your list.`
          : `No worries — “${match.match.title}” is still on your list.`,
    }
  }
  if (match.kind === 'many')
    return {
      kind: 'info',
      message: `No worries — those are still on your list.`,
    }
  return {
    kind: 'info',
    message: `Okay. ${cap(target)} isn’t on your lists — say “I need ${target}” if you want it added.`,
  }
}

async function addTask(
  ctx: Ctx,
  title: string,
  dueDate: string | null,
): Promise<ActResult> {
  const { open } = await loadTasks(ctx)
  const existing = open.find((t) => similarity(title, t.title) >= 0.85)
  if (existing)
    return {
      kind: 'info',
      message: `“${existing.title}” is already on your list.`,
    }
  return act(
    ctx,
    { kind: 'task_insert', title: cap(title), dueDate },
    `Added “${cap(title)}” to your tasks${dueDate ? ` for ${dayLabel(localDateTimeToIso(dueDate, null, true, ctx.offset), ctx.offset, false)}` : ''}.`,
  )
}

async function addReminder(
  ctx: Ctx,
  subject: string | null,
  date: string | null,
  time: string | null,
): Promise<ActResult> {
  const title = cap(subject ?? ctx.lastTitle ?? '')
  if (!title)
    return { kind: 'info', message: 'What should I remind you about?' }
  if (!date)
    return {
      kind: 'info',
      message: `When should I remind you to ${title.toLowerCase()}? Try “tomorrow” or “on Friday at 9”.`,
    }
  const remindAt = localDateTimeToIso(date, time ?? '09:00', false, ctx.offset)
  const reminders = await loadReminders(ctx)
  if (
    reminders.some(
      (r) =>
        similarity(title, r.title) >= 0.85 &&
        r.remindAt.slice(0, 10) === remindAt.slice(0, 10),
    )
  ) {
    return { kind: 'info', message: `You already have that reminder. 👍` }
  }
  return act(
    ctx,
    { kind: 'reminder_insert', title, remindAt },
    `I’ll remind you to ${title.toLowerCase()} ${dayLabel(remindAt, ctx.offset, true)}.`,
  )
}

async function addEvent(
  ctx: Ctx,
  title: string,
  date: string | null,
  time: string | null,
): Promise<ActResult> {
  if (!date)
    return {
      kind: 'info',
      message: `When is “${title}”? Tell me the day (and time, if you know it).`,
    }
  const startsAt = localDateTimeToIso(date, time, !time, ctx.offset)
  const events = await loadEvents(ctx, -1, 400)
  if (
    events.some(
      (e) =>
        similarity(title, e.title) >= 0.85 &&
        e.startsAt.slice(0, 10) === startsAt.slice(0, 10),
    )
  ) {
    return {
      kind: 'info',
      message: `“${title}” is already in your calendar. 👍`,
    }
  }
  return act(
    ctx,
    {
      kind: 'event_insert',
      title,
      startsAt,
      endsAt: addHoursIso(startsAt, time ? 1 : 24),
      allDay: !time,
    },
    `Added “${title}” to your calendar: ${dayLabel(startsAt, ctx.offset, Boolean(time))}${time ? '' : ' (tell me the time if you know it)'}.`,
  )
}

async function moveEvent(
  ctx: Ctx,
  target: string,
  date: string | null,
  time: string | null,
): Promise<ActResult> {
  if (!date && !time)
    return { kind: 'info', message: 'When should I move it to?' }
  const events = await loadEvents(ctx, 0, 400)
  const match = bestMatch(target, events)
  if (match.kind === 'none')
    return {
      kind: 'info',
      message: `I can’t see “${target}” in your calendar.`,
    }
  const planFor = (
    e: EventRow,
  ): { plan: Plan; label: string; message: string } => {
    const local = new Date(new Date(e.startsAt).getTime() - ctx.offset * 60_000)
    const keepDate = local.toISOString().slice(0, 10)
    const keepTime = e.allDay ? null : local.toISOString().slice(11, 16)
    const newTime = time ?? keepTime
    const startsAt = localDateTimeToIso(
      date ?? keepDate,
      newTime,
      !newTime,
      ctx.offset,
    )
    return {
      plan: {
        kind: 'event_update',
        id: e.id,
        before: {
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          allDay: e.allDay,
          status: 'scheduled',
        },
        after: {
          startsAt,
          endsAt: addHoursIso(startsAt, newTime ? 1 : 24),
          allDay: newTime ? 0 : 1,
          status: 'scheduled',
        },
      },
      label: `${e.title} (${eventWhen(e, ctx.offset)})`,
      message: `move “${e.title}” from ${eventWhen(e, ctx.offset)} to ${dayLabel(startsAt, ctx.offset, Boolean(newTime))}.`,
    }
  }
  if (match.kind === 'many') {
    return choices(
      ctx,
      `I found ${match.matches.length} that could be “${target}”. Which one should I move?`,
      match.matches.map((c) => planFor(c as EventRow)),
    )
  }
  const { plan, message } = planFor(match.match)
  // Changing an appointment matters: always ask first.
  return act(ctx, plan, message, 'propose')
}

async function queryDone(
  ctx: Ctx,
  target: string,
  domain: 'shopping' | 'task',
): Promise<ActResult> {
  if (domain === 'shopping') {
    const { active, bought } = await loadShopping(ctx)
    const stillNeeded = bestMatch(target, active)
    if (stillNeeded.kind !== 'none')
      return {
        kind: 'info',
        message: `Not yet — ${target} is still on your shopping list.`,
      }
    const done = bestMatch(target, bought)
    if (done.kind === 'one' && done.match.checkedAt) {
      return {
        kind: 'info',
        message: `Yes! You crossed ${done.match.title} off ${dayLabel(done.match.checkedAt, ctx.offset, false)}.`,
      }
    }
    return {
      kind: 'info',
      message: `${cap(target)} isn’t on your shopping list, so I don’t have a record of buying it.`,
    }
  }
  const { open, done } = await loadTasks(ctx)
  const pending = bestMatch(target, open)
  if (pending.kind !== 'none')
    return { kind: 'info', message: `Not yet — it’s still on your tasks.` }
  const finished = bestMatch(target, done)
  if (finished.kind === 'one' && finished.match.completedAt) {
    return {
      kind: 'info',
      message: `Yes — “${finished.match.title}” was done ${dayLabel(finished.match.completedAt, ctx.offset, false)}.`,
    }
  }
  return { kind: 'info', message: `I don’t have a record of that.` }
}

async function queryEvent(ctx: Ctx, target: string): Promise<ActResult> {
  const events = await loadEvents(ctx, 0, 400)
  const generic = /^(appointment|appointments|meeting|meetings)$/.test(
    target.trim(),
  )
  const matches = generic
    ? events
    : events.filter((e) => similarity(target, e.title) >= 0.6)
  if (matches.length === 0)
    return { kind: 'info', message: `I can’t see a ${target} coming up.` }
  if (matches.length === 1) {
    const e = matches[0]!
    return {
      kind: 'info',
      message: `${cap(e.title)} is ${eventWhen(e, ctx.offset)}.`,
    }
  }
  return {
    kind: 'info',
    message: `Coming up: ${matches
      .slice(0, 4)
      .map((e) => `${e.title} — ${eventWhen(e, ctx.offset)}`)
      .join('; ')}.`,
  }
}

async function queryCalendar(
  ctx: Ctx,
  range: 'today' | 'tomorrow' | 'this_week' | 'next_week',
): Promise<ActResult> {
  const local = new Date(ctx.now.getTime() - ctx.offset * 60_000)
  const startOfToday = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) +
      ctx.offset * 60_000,
  )
  const day = 86_400_000
  const weekday = (local.getUTCDay() + 6) % 7 // Monday = 0
  const [from, to] =
    range === 'today'
      ? [startOfToday.getTime(), startOfToday.getTime() + day]
      : range === 'tomorrow'
        ? [startOfToday.getTime() + day, startOfToday.getTime() + 2 * day]
        : range === 'this_week'
          ? [
              startOfToday.getTime(),
              startOfToday.getTime() + (7 - weekday) * day,
            ]
          : [
              startOfToday.getTime() + (7 - weekday) * day,
              startOfToday.getTime() + (14 - weekday) * day,
            ]
  const events = (await loadEvents(ctx, -1, 30)).filter((e) => {
    const t = new Date(e.startsAt).getTime()
    return t >= from && t < to
  })
  const label = range.replace('_', ' ')
  if (events.length === 0)
    return { kind: 'info', message: `Nothing on your calendar ${label}. 🌿` }
  return {
    kind: 'info',
    message: `${cap(label)}: ${events.map((e) => `${e.title} — ${eventWhen(e, ctx.offset)}`).join('; ')}.`,
  }
}

// -------------------------------------------------------------------- main

export async function actOnText(
  db: D1Database,
  userId: string,
  text: string,
  offset: number,
  now: Date = new Date(),
): Promise<ActResponse> {
  const settings = await db
    .prepare(
      `SELECT goblin_autonomy as autonomy FROM user_settings WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ autonomy: 'auto' | 'ask' }>()
  const last = await db
    .prepare(
      `SELECT after_json as plan FROM goblin_actions WHERE user_id = ? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(userId, new Date(now.getTime() - 15 * 60_000).toISOString())
    .first<{ plan: string }>()
  let lastTitle: string | null = null
  if (last?.plan) {
    try {
      const plan = JSON.parse(last.plan) as Plan & {
        title?: string
        name?: string
      }
      lastTitle = plan.title ?? plan.name ?? null
      if (!lastTitle && 'id' in plan) {
        const row = await db
          .prepare(
            `SELECT title FROM tasks WHERE id = ?1 AND user_id = ?2
             UNION ALL SELECT name FROM shopping_items WHERE id = ?1 AND user_id = ?2
             UNION ALL SELECT title FROM reminders WHERE id = ?1 AND user_id = ?2`,
          )
          .bind(plan.id, userId)
          .first<{ title: string }>()
        lastTitle = row?.title ?? null
      }
    } catch {
      lastTitle = null
    }
  }

  const ctx: Ctx = {
    db,
    userId,
    offset,
    now,
    wallClock: wallClockDate(now, offset),
    autonomy: settings?.autonomy ?? 'auto',
    groupId: newId('ggrp'),
    lastTitle,
  }

  const response: ActResponse = {
    results: [],
    questions: [],
    capture: [],
    overwhelm: false,
  }
  const operations: Operation[] = parseUtterance(text, ctx.wallClock)
  for (const op of operations) {
    switch (op.op) {
      case 'shopping_add':
        response.results.push(...(await shoppingAdd(ctx, op.items)))
        break
      case 'complete':
        response.results.push(await complete(ctx, op.target, op.domain))
        ctx.lastTitle = op.target
        break
      case 'cancel':
        response.results.push(await cancel(ctx, op.target))
        break
      case 'not_yet':
        response.results.push(await notYet(ctx, op.target))
        break
      case 'task_add':
        response.results.push(await addTask(ctx, op.title, op.dueDate))
        ctx.lastTitle = op.title
        break
      case 'reminder_add':
        response.results.push(
          await addReminder(ctx, op.subject, op.date, op.time),
        )
        break
      case 'event_add':
        response.results.push(await addEvent(ctx, op.title, op.date, op.time))
        break
      case 'event_move':
        response.results.push(await moveEvent(ctx, op.target, op.date, op.time))
        break
      case 'query_done':
        response.results.push(await queryDone(ctx, op.target, op.domain))
        break
      case 'query_event':
        response.results.push(await queryEvent(ctx, op.target))
        break
      case 'query_calendar':
        response.results.push(await queryCalendar(ctx, op.range))
        break
      case 'question':
        response.questions.push(op.clause)
        break
      case 'overwhelm':
        response.overwhelm = true
        break
      case 'capture':
        response.capture.push(op.clause)
    }
  }
  return response
}

// ------------------------------------------------------------- undo/confirm

type ActionRow = {
  id: string
  status: string
  kind: string
  targetId: string | null
  plan: string
  groupId: string
  message: string
}

async function loadAction(
  db: D1Database,
  userId: string,
  id: string,
): Promise<ActionRow | null> {
  return db
    .prepare(
      `SELECT id, status, kind, target_id as targetId, after_json as plan, group_id as groupId, message
       FROM goblin_actions WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first<ActionRow>()
}

export async function undoAction(db: D1Database, userId: string, id: string) {
  const row = await loadAction(db, userId, id)
  if (!row || row.status !== 'done' || !row.targetId)
    return { ok: false as const, error: 'Nothing to undo.' }
  const now = new Date().toISOString()
  await revertPlan(db, userId, JSON.parse(row.plan) as Plan, row.targetId, now)
  await db
    .prepare(
      `UPDATE goblin_actions SET status = 'undone', updated_at = ? WHERE id = ? AND user_id = ?`,
    )
    .bind(now, id, userId)
    .run()
  return { ok: true as const, message: 'Undone. ↩️' }
}

export async function confirmAction(
  db: D1Database,
  userId: string,
  id: string,
) {
  const row = await loadAction(db, userId, id)
  if (!row || row.status !== 'proposed')
    return { ok: false as const, error: 'That’s already been handled.' }
  const now = new Date().toISOString()
  const claimed = await db
    .prepare(
      `UPDATE goblin_actions SET status = 'done', updated_at = ? WHERE id = ? AND user_id = ? AND status = 'proposed'`,
    )
    .bind(now, id, userId)
    .run()
  if (!claimed.meta.changes)
    return { ok: false as const, error: 'That’s already been handled.' }
  const targetId = await applyPlan(
    db,
    userId,
    JSON.parse(row.plan) as Plan,
    now,
  )
  await db
    .prepare(
      `UPDATE goblin_actions SET target_id = ? WHERE id = ? AND user_id = ?`,
    )
    .bind(targetId, id, userId)
    .run()
  // Choosing one option of a clarification declines the others.
  await db
    .prepare(
      `UPDATE goblin_actions SET status = 'declined', updated_at = ?
       WHERE user_id = ? AND group_id = ? AND status = 'proposed' AND id != ?`,
    )
    .bind(now, userId, row.groupId, id)
    .run()
  const message = row.message
    .replace(/^(\w)/, (m) => m.toUpperCase())
    .replace(/^Done: /, '')
  return {
    ok: true as const,
    actionId: id,
    message: `Done — ${message.charAt(0).toLowerCase()}${message.slice(1)}`,
  }
}

export async function declineAction(
  db: D1Database,
  userId: string,
  id: string,
) {
  const row = await loadAction(db, userId, id)
  if (!row || row.status !== 'proposed')
    return { ok: false as const, error: 'That’s already been handled.' }
  await db
    .prepare(
      `UPDATE goblin_actions SET status = 'declined', updated_at = ?
       WHERE user_id = ? AND group_id = ? AND status = 'proposed'`,
    )
    .bind(new Date().toISOString(), userId, row.groupId)
    .run()
  return { ok: true as const }
}
