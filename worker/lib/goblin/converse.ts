/**
 * Talking to the Goblin (voice or typed): one turn of conversation.
 *
 * 1. Strip how the person addressed their Goblin ("Oi Gobbo, …").
 * 2. Apply their own taught expressions (interpretation only).
 * 3. Answer conversational requests from their real records (overview,
 *    "what can wait", "move them", undo, yes/no).
 * 4. Hand everything else to the existing action engine (act.ts), which
 *    adds, ticks off, reminds and schedules — with Undo, and with a yes
 *    first for anything consequential or bulk.
 * 5. Compose one short reply in the voice the person chose.
 *
 * The transcript is not stored. Only record ids are kept, briefly, so a
 * follow-up like "move them" knows what "them" means.
 */
import {
  bareItem,
  classifyConversation,
  applyExpressions,
  looksLikeShopping,
  type Conversational,
  type DayRange,
} from '../../../shared/goblin/conversation'
import { normaliseAddress } from '../../../shared/goblin/address'
import { parseOperation, splitClauses } from '../../../shared/goblin/language'
import { styleReply, type ReplyPart, type ReplyTopic } from '../../../shared/goblin/voiceStyle'
import { localDateTimeToIso } from '../datetime'
import { newId } from '../ids'
import { ensureDefaultShoppingList } from '../shopping'
import {
  act,
  actOnText,
  choices,
  confirmAction,
  dayLabel,
  declineAction,
  undoAction,
  wallClockDate,
  type ActResponse,
  type ActResult,
  type Ctx,
} from './act'
import { listExpressions, loadProfile } from './profile'

export type Answer = { title: string; lines: string[] }

export type ConverseResponse = ActResponse & {
  /** The reply to show and (if enabled) speak, in the chosen style. */
  reply: string
  /** The request as understood, after names and politeness were removed. */
  heard: string
  addressed: boolean
  expressionsUsed: string[]
  /** Structured answers (schedule overviews and the like) for display. */
  answers: Answer[]
  /** Leftover clauses the client sends to the existing review flow. */
}

export type ConverseInput = {
  text: string
  offset: number
  now?: Date
  /**
   * False for thoughts captured offline and synced later: "yes", "undo" and
   * "move them" only make sense in the moment, so they never act late.
   */
  live: boolean
}

const CONTEXT_MINUTES = 10

type TaskRow = {
  id: string
  title: string
  dueDate: string | null
  priority: 'low' | 'normal' | 'high'
  linked: number
}
type EventRow = { id: string; title: string; startsAt: string; allDay: number; endsAt: string }

// Words that suggest a real deadline or someone else depends on it.
const FIXED_FEEL =
  /\b(pay|bill|rent|mortgage|tax|fine|deadline|submit|hand in|exam|test|interview|appointment|renew|court|visa|passport|invoice|payroll|school run|pick up|collect|meds|medication|prescription)\b/i

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`
}

function joinNames(names: string[], max = 4): string {
  const shown = names.slice(0, max)
  const extra = names.length - shown.length
  const list =
    shown.length <= 1
      ? shown.join('')
      : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
  return extra > 0 ? `${list} and ${extra} more` : list
}

function localHour(iso: string, offset: number): number {
  return new Date(new Date(iso).getTime() - offset * 60_000).getUTCHours()
}

function inPart(e: EventRow, range: DayRange, offset: number): boolean {
  if (!range.part || e.allDay) return true
  const h = localHour(e.startsAt, offset)
  if (range.part === 'morning') return h < 12
  if (range.part === 'afternoon') return h >= 12 && h < 17
  return h >= 17
}

function nextDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function shortDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}

// ------------------------------------------------------------ data access

async function eventsIn(ctx: Ctx, range: DayRange): Promise<EventRow[]> {
  const from = localDateTimeToIso(range.from, '00:00', false, ctx.offset)
  const to = localDateTimeToIso(range.to, '00:00', false, ctx.offset)
  const rows = await ctx.db
    .prepare(
      `SELECT id, title, starts_at as startsAt, ends_at as endsAt, all_day as allDay FROM events
       WHERE user_id = ? AND status = 'scheduled' AND starts_at >= ? AND starts_at < ?
       ORDER BY starts_at ASC LIMIT 50`,
    )
    .bind(ctx.userId, from, to)
    .all<EventRow>()
  return (rows.results ?? []).filter((e) => inPart(e, range, ctx.offset))
}

async function openTasks(ctx: Ctx, where: string, ...args: unknown[]): Promise<TaskRow[]> {
  const rows = await ctx.db
    .prepare(
      `SELECT t.id, t.title, t.due_date as dueDate, t.priority,
              EXISTS (SELECT 1 FROM events e WHERE e.user_id = t.user_id AND e.linked_task_id = t.id
                      AND e.status = 'scheduled') as linked
       FROM tasks t
       WHERE t.user_id = ? AND t.status = 'open' AND t.parent_id IS NULL AND ${where}
       ORDER BY t.due_date ASC, t.created_at ASC LIMIT 50`,
    )
    .bind(ctx.userId, ...args)
    .all<TaskRow>()
  return rows.results ?? []
}

function todayOf(ctx: Ctx): string {
  return new Date(ctx.now.getTime() - ctx.offset * 60_000).toISOString().slice(0, 10)
}

function eventLine(e: EventRow, ctx: Ctx): string {
  return `${e.title} — ${dayLabel(e.startsAt, ctx.offset, !e.allDay)}`
}

function eventShort(e: EventRow, ctx: Ctx, multiDay: boolean): string {
  if (multiDay) return `${e.title} (${dayLabel(e.startsAt, ctx.offset, !e.allDay)})`
  if (e.allDay) return e.title
  const local = new Date(new Date(e.startsAt).getTime() - ctx.offset * 60_000)
  const time = local.toLocaleTimeString('en', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  })
  return `${e.title} at ${time}`
}

function overlaps(events: EventRow[]): [EventRow, EventRow] | null {
  const timed = events.filter((e) => !e.allDay)
  for (let i = 0; i < timed.length; i += 1)
    for (let j = i + 1; j < timed.length; j += 1) {
      const a = timed[i]!
      const b = timed[j]!
      if (a.startsAt < b.endsAt && b.startsAt < a.endsAt) return [a, b]
    }
  return null
}

// --------------------------------------------------------------- context

type ContextRow = { topic: string; refs: { id: string; title: string }[]; to: string | null }

async function setContext(ctx: Ctx, topic: string, refs: { id: string; title: string }[], to: string | null) {
  await ctx.db
    .prepare(
      `INSERT INTO goblin_context (user_id, topic, refs_json, expires_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET topic = excluded.topic, refs_json = excluded.refs_json,
         expires_at = excluded.expires_at`,
    )
    .bind(
      ctx.userId,
      topic,
      JSON.stringify({ refs, to }),
      new Date(ctx.now.getTime() + CONTEXT_MINUTES * 60_000).toISOString(),
    )
    .run()
}

async function getContext(ctx: Ctx): Promise<ContextRow | null> {
  const row = await ctx.db
    .prepare(
      `SELECT topic, refs_json as refs FROM goblin_context WHERE user_id = ? AND expires_at > ?`,
    )
    .bind(ctx.userId, ctx.now.toISOString())
    .first<{ topic: string; refs: string }>()
  if (!row) return null
  try {
    const parsed = JSON.parse(row.refs) as { refs?: { id: string; title: string }[]; to?: string | null }
    return { topic: row.topic, refs: parsed.refs ?? [], to: parsed.to ?? null }
  } catch {
    return null
  }
}

async function clearContext(ctx: Ctx) {
  await ctx.db.prepare(`DELETE FROM goblin_context WHERE user_id = ?`).bind(ctx.userId).run()
}

// -------------------------------------------------------------- handlers

type Turn = {
  results: ActResult[]
  parts: ReplyPart[]
  answers: Answer[]
}

async function overview(ctx: Ctx, range: DayRange, turn: Turn) {
  const today = todayOf(ctx)
  const multiDay = nextDay(range.from) !== range.to
  const [events, due, overdue] = await Promise.all([
    eventsIn(ctx, range),
    openTasks(ctx, 't.due_date >= ? AND t.due_date < ?', range.from, range.to),
    range.from <= today ? openTasks(ctx, 't.due_date < ?', today) : Promise.resolve([]),
  ])
  const label = range.label.charAt(0).toUpperCase() + range.label.slice(1)
  const lines = [
    ...events.map((e) => `📅 ${eventLine(e, ctx)}`),
    ...due.map((t) => `✅ ${t.title}${multiDay && t.dueDate ? ` (${shortDate(t.dueDate)})` : ''}${t.priority === 'high' ? ' — high priority' : ''}`),
    ...overdue.map((t) => `⏰ ${t.title} — was due ${shortDate(t.dueDate!)}`),
  ]
  if (events.length === 0 && due.length === 0 && overdue.length === 0) {
    turn.parts.push({
      tone: 'info',
      topic: 'overview',
      text: `Nothing on your calendar or task list ${range.label}.`,
    })
    return
  }
  const counts: string[] = []
  if (events.length) counts.push(plural(events.length, 'appointment'))
  if (due.length) counts.push(plural(due.length, 'task'))
  const what = counts.length ? counts.join(' and ') : 'nothing scheduled'
  const detail: string[] = []
  if (events.length) detail.push(joinNames(events.map((e) => eventShort(e, ctx, multiDay)), 3))
  if (due.length) detail.push(joinNames(due.map((t) => t.title), 3))
  const overdueText = overdue.length ? ` ${plural(overdue.length, 'thing')} overdue too.` : ''
  const clash = overlaps(events)
  const clashText = clash ? ` Heads up: ${clash[0].title} and ${clash[1].title} overlap.` : ''
  turn.parts.push({
    tone: 'info',
    topic: 'overview',
    brief: `${label}: ${what}.${overdueText}${clashText}`,
    text: `${label}: ${what}${detail.length ? ` — ${detail.join('; ')}` : ''}.${overdueText}${clashText}`,
  })
  turn.answers.push({ title: label, lines })
}

async function availability(ctx: Ctx, range: DayRange, turn: Turn) {
  const events = await eventsIn(ctx, range)
  const multiDay = nextDay(range.from) !== range.to
  if (events.length === 0) {
    turn.parts.push({
      tone: 'info',
      topic: 'overview',
      text: `Nothing in your calendar ${range.label} — looks free.`,
    })
    return
  }
  turn.parts.push({
    tone: 'info',
    topic: 'overview',
    text: `Not completely — ${range.label} you have ${joinNames(events.map((e) => eventShort(e, ctx, multiDay)))}.`,
  })
  turn.answers.push({
    title: range.label.charAt(0).toUpperCase() + range.label.slice(1),
    lines: events.map((e) => `📅 ${eventLine(e, ctx)}`),
  })
}

async function overdueTasks(ctx: Ctx, turn: Turn) {
  const tasks = await openTasks(ctx, 't.due_date < ?', todayOf(ctx))
  if (tasks.length === 0) {
    turn.parts.push({ tone: 'info', topic: 'overview', text: 'Nothing overdue. Not a thing.' })
    return
  }
  turn.parts.push({
    tone: 'info',
    topic: 'none',
    brief:
      tasks.length <= 3
        ? `Overdue: ${joinNames(tasks.map((t) => t.title))}. Still here when you’re ready.`
        : `${plural(tasks.length, 'thing')} slipped past their dates — still here when you’re ready.`,
    text: `${plural(tasks.length, 'thing')} slipped past ${tasks.length === 1 ? 'its' : 'their'} date: ${joinNames(tasks.map((t) => t.title))}. Still here when you’re ready.`,
  })
  turn.answers.push({
    title: 'Overdue',
    lines: tasks.map((t) => `⏰ ${t.title} — was due ${shortDate(t.dueDate!)}`),
  })
}

function isFixedTask(t: TaskRow): string | null {
  if (t.priority === 'high') return 'high priority'
  if (t.linked) return 'tied to an appointment'
  if (FIXED_FEEL.test(t.title)) return 'looks like a deadline'
  return null
}

async function focus(ctx: Ctx, turn: Turn) {
  const today = todayOf(ctx)
  const range: DayRange = { from: today, to: nextDay(today), label: 'today' }
  const [events, due, overdue, important] = await Promise.all([
    eventsIn(ctx, range),
    openTasks(ctx, 't.due_date = ?', today),
    openTasks(ctx, 't.due_date < ?', today),
    openTasks(ctx, "t.priority = 'high' AND (t.due_date IS NULL OR t.due_date > ?)", today),
  ])
  const essentials: string[] = [
    ...events.map((e) => eventShort(e, ctx, false)),
    ...overdue.filter((t) => isFixedTask(t)).map((t) => `${t.title} (overdue)`),
    ...due.filter((t) => isFixedTask(t)).map((t) => t.title),
    ...important.slice(0, 2).map((t) => t.title),
  ]
  const top = essentials.slice(0, 3)
  if (top.length === 0) {
    const fallback = due[0] ?? overdue[0]
    turn.parts.push({
      tone: 'info',
      topic: 'none',
      text: fallback
        ? `Nothing is truly urgent. If you want one thing: ${fallback.title}.`
        : 'Nothing urgent at all. Rest is allowed.',
    })
    return
  }
  const rest = due.length + overdue.length + events.length - top.length
  turn.parts.push({
    tone: 'info',
    topic: 'none',
    text: `What actually matters: ${joinNames(top)}.${rest > 0 ? ' The rest can wait.' : ''}`,
  })
  turn.answers.push({ title: 'What matters', lines: top.map((t) => `⭐ ${t}`) })
}

async function flexible(ctx: Ctx, range: DayRange, propose: boolean, turn: Turn) {
  const today = todayOf(ctx)
  const [events, due] = await Promise.all([
    eventsIn(ctx, range),
    openTasks(ctx, 't.due_date >= ? AND t.due_date < ?', range.from < today ? today : range.from, range.to),
  ])
  const movable = due.filter((t) => !isFixedTask(t))
  const kept = due.filter((t) => isFixedTask(t))
  const to = nextDay(range.to > range.from ? new Date(new Date(`${range.to}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10) : range.from)
  const keptNotes = [
    ...kept.map((t) => `${t.title} (${isFixedTask(t)})`),
    ...events.map((e) => `${eventShort(e, ctx, false)} (appointment)`),
  ]
  turn.answers.push({
    title: `${range.label.charAt(0).toUpperCase() + range.label.slice(1)}: what can wait`,
    lines: [
      ...movable.map((t) => `↪️ ${t.title} — can move`),
      ...keptNotes.map((k) => `📌 ${k} — staying put`),
    ],
  })
  if (movable.length === 0) {
    turn.parts.push({
      tone: 'info',
      topic: 'none',
      text: due.length
        ? `Nothing looks safe to move — ${joinNames(keptNotes)}.`
        : `There are no tasks dated ${range.label}, so nothing needs moving.`,
    })
    await clearContext(ctx)
    return
  }
  await setContext(
    ctx,
    'flexible',
    movable.map((t) => ({ id: t.id, title: t.title })),
    to,
  )
  const names = joinNames(movable.map((t) => t.title))
  const keepText = keptNotes.length ? ` I’d keep ${joinNames(keptNotes, 3)}.` : ''
  if (!propose) {
    turn.parts.push({
      tone: 'info',
      topic: 'task',
      brief: `${plural(movable.length, 'task')} can safely become Tomorrow You’s problem: ${names}.`,
      text: `${plural(movable.length, 'task')} look flexible: ${names}.${keepText} Say “move them” and I’ll shift ${movable.length === 1 ? 'it' : 'them'} to ${shortDate(to)}.`,
    })
    return
  }
  await proposeMove(ctx, movable, to, turn)
}

async function proposeMove(
  ctx: Ctx,
  tasks: { id: string; title: string; dueDate: string | null }[],
  to: string,
  turn: Turn,
) {
  const result = await act(
    ctx,
    {
      kind: 'tasks_reschedule',
      items: tasks.map((t) => ({ id: t.id, title: t.title, before: t.dueDate, after: to })),
    },
    `move ${joinNames(tasks.map((t) => t.title), 6)} to ${shortDate(to)}.`,
    'propose',
  )
  turn.results.push(result)
  turn.parts.push({ tone: 'ask', topic: 'task', text: result.message })
  await clearContext(ctx)
}

async function deferRefs(ctx: Ctx, toDate: string | null, single: boolean, turn: Turn) {
  const context = await getContext(ctx)
  if (!context || context.topic !== 'flexible' || context.refs.length === 0) {
    turn.parts.push({
      tone: 'ask',
      topic: 'none',
      text: 'Move which ones? Ask me what can wait and I’ll suggest some.',
    })
    return
  }
  // Re-read the records: only still-open tasks that belong to this person.
  const ids = context.refs.map((r) => r.id)
  const rows = await openTasks(ctx, `t.id IN (${ids.map(() => '?').join(', ')})`, ...ids)
  if (rows.length === 0) {
    await clearContext(ctx)
    turn.parts.push({ tone: 'info', topic: 'none', text: 'Those are already sorted — nothing left to move.' })
    return
  }
  const to = toDate ?? context.to ?? nextDay(todayOf(ctx))
  if (single && rows.length > 1) {
    const result = await choices(
      ctx,
      'Which one should I move?',
      rows.map((t) => ({
        label: t.title,
        message: `Moved “${t.title}” to ${shortDate(to)}.`,
        plan: {
          kind: 'tasks_reschedule',
          items: [{ id: t.id, title: t.title, before: t.dueDate, after: to }],
        },
      })),
    )
    turn.results.push(result)
    turn.parts.push({ tone: 'ask', topic: 'none', text: result.message })
    return
  }
  await proposeMove(ctx, rows, to, turn)
}

type PendingRow = { id: string; groupId: string; message: string }

async function latestProposal(ctx: Ctx): Promise<{ row: PendingRow; count: number } | null> {
  const row = await ctx.db
    .prepare(
      `SELECT id, group_id as groupId, message FROM goblin_actions
       WHERE user_id = ? AND status = 'proposed' AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(ctx.userId, new Date(ctx.now.getTime() - CONTEXT_MINUTES * 60_000).toISOString())
    .first<PendingRow>()
  if (!row) return null
  const count = await ctx.db
    .prepare(
      `SELECT COUNT(*) as n FROM goblin_actions WHERE user_id = ? AND group_id = ? AND status = 'proposed'`,
    )
    .bind(ctx.userId, row.groupId)
    .first<{ n: number }>()
  return { row, count: count?.n ?? 1 }
}

async function affirm(ctx: Ctx, turn: Turn) {
  const pending = await latestProposal(ctx)
  if (!pending) {
    turn.parts.push({ tone: 'info', topic: 'none', text: 'Nothing is waiting for a yes right now.' })
    return
  }
  if (pending.count > 1) {
    turn.parts.push({
      tone: 'ask',
      topic: 'none',
      text: 'Which one? Tap it, or tell me its name.',
    })
    return
  }
  const res = await confirmAction(ctx.db, ctx.userId, pending.row.id)
  if (!res.ok) {
    turn.parts.push({ tone: 'info', topic: 'none', text: res.error })
    return
  }
  turn.results.push({ kind: 'done', actionId: res.actionId, message: res.message, undoable: true })
  turn.parts.push({ tone: 'done', topic: 'task', text: res.message })
}

async function deny(ctx: Ctx, turn: Turn) {
  const pending = await latestProposal(ctx)
  if (!pending) {
    turn.parts.push({ tone: 'info', topic: 'none', text: 'Okay.' })
    return
  }
  await declineAction(ctx.db, ctx.userId, pending.row.id)
  turn.parts.push({ tone: 'info', topic: 'none', text: 'Okay, left as it was.' })
}

async function undoLast(ctx: Ctx, turn: Turn) {
  const latest = await ctx.db
    .prepare(
      `SELECT group_id as groupId FROM goblin_actions
       WHERE user_id = ? AND status = 'done' AND updated_at >= ?
       ORDER BY updated_at DESC, created_at DESC LIMIT 1`,
    )
    .bind(ctx.userId, new Date(ctx.now.getTime() - 15 * 60_000).toISOString())
    .first<{ groupId: string }>()
  if (!latest) {
    turn.parts.push({ tone: 'info', topic: 'none', text: 'Nothing recent to undo.' })
    return
  }
  const rows = await ctx.db
    .prepare(
      `SELECT id, message FROM goblin_actions WHERE user_id = ? AND group_id = ? AND status = 'done'`,
    )
    .bind(ctx.userId, latest.groupId)
    .all<{ id: string; message: string }>()
  const undone: string[] = []
  for (const row of rows.results ?? []) {
    const res = await undoAction(ctx.db, ctx.userId, row.id)
    if (res.ok) undone.push(row.message.replace(/[\s👹↩️]+$/u, ''))
  }
  turn.parts.push({
    tone: 'done',
    topic: 'undo',
    text: undone.length
      ? `Undone: ${undone.join(' ')}`.replace(/\.?$/, '.')
      : 'That was already undone.',
    brief: undone.length ? 'Undone.' : 'That was already undone.',
  })
}

async function bare(ctx: Ctx, item: string, shoppingContext: boolean, turn: Turn): Promise<ActResponse | null> {
  if (looksLikeShopping(item) || shoppingContext) {
    return actOnText(ctx.db, ctx.userId, `add ${item} to my shopping list`, ctx.offset, ctx.now)
  }
  const name = item.charAt(0).toUpperCase() + item.slice(1)
  const listId = await ensureDefaultShoppingList(ctx.db, ctx.userId)
  const result = await choices(ctx, `What should I do with “${name}”?`, [
    {
      label: 'Shopping list',
      message: `${name} added to your shopping list.`,
      plan: { kind: 'shopping_insert', listId, name, quantity: '' },
    },
    {
      label: 'Add as a task',
      message: `Added “${name}” to your tasks.`,
      plan: { kind: 'task_insert', title: name, dueDate: null },
    },
  ])
  turn.results.push(result)
  turn.parts.push({ tone: 'ask', topic: 'none', text: result.message })
  return null
}

// ----------------------------------------------------------------- reply

function topicOf(result: ActResult): ReplyTopic {
  const t = 'topic' in result ? result.topic : undefined
  if (t === 'shopping') return 'shopping'
  if (t === 'task' || t === 'tasks') return 'task'
  if (t === 'reminder') return 'reminder'
  if (t === 'event') return 'event'
  return 'none'
}

function briefOf(message: string): string {
  return message
    .replace(/ to your shopping list\./, ' added.')
    .replace(/ added added\./, ' added.')
    .replace(/ crossed off your list!?/, ' crossed off.')
    .replace(/ to your tasks(?= for|\.)/, '')
    .replace(/[\s👹👍🌿↩️]+$/u, '')
}

function partsFromResults(results: ActResult[]): ReplyPart[] {
  return results.map((r) => {
    if (r.kind === 'done') {
      const topic = topicOf(r)
      return {
        tone: 'done',
        topic,
        text: r.message,
        brief: briefOf(r.message),
        ...(r.subject ? { items: [r.subject] } : {}),
      }
    }
    if (r.kind === 'info') return { tone: 'info', topic: 'none', text: r.message }
    return { tone: 'ask', topic: 'none', text: r.message }
  })
}

// ------------------------------------------------------------------ main

export async function converse(
  db: D1Database,
  userId: string,
  input: ConverseInput,
): Promise<ConverseResponse> {
  const now = input.now ?? new Date()
  const [profile, expressions] = await Promise.all([
    loadProfile(db, userId),
    listExpressions(db, userId),
  ])
  const names = [profile.name, ...profile.aliases]
  const first = normaliseAddress(input.text, names)
  const taught = applyExpressions(first.text, expressions)
  const heard = taught.used.length ? normaliseAddress(taught.text, names).text : first.text

  const response: ConverseResponse = {
    results: [],
    questions: [],
    capture: [],
    overwhelm: false,
    reply: '',
    heard,
    addressed: first.addressed,
    expressionsUsed: taught.used,
    answers: [],
  }
  if (!heard) {
    response.reply = styleReply(
      [{ tone: 'ask', topic: 'none', text: 'Yes? I’m listening.' }],
      profile,
    )
    return response
  }

  const autonomy = await db
    .prepare(`SELECT goblin_autonomy as autonomy FROM user_settings WHERE user_id = ?`)
    .bind(userId)
    .first<{ autonomy: 'auto' | 'ask' }>()
  const ctx: Ctx = {
    db,
    userId,
    offset: input.offset,
    now,
    wallClock: wallClockDate(now, input.offset),
    autonomy: autonomy?.autonomy ?? 'auto',
    groupId: newId('ggrp'),
    lastTitle: null,
  }
  const turn: Turn = { results: [], parts: [], answers: [] }
  const context = input.live ? await getContext(ctx) : null
  let shoppingContext = context?.topic === 'shopping'
  const leftovers: string[] = []
  const delegated: ActResponse[] = []

  for (const clause of splitClauses(heard)) {
    const conversational: Conversational | null = classifyConversation(clause, ctx.wallClock)
    if (conversational) {
      const contextual = ['affirm', 'deny', 'undo', 'defer_refs'].includes(conversational.kind)
      if (contextual && !input.live) {
        turn.parts.push({
          tone: 'info',
          topic: 'none',
          text: `“${clause}” was saved while offline, so I left things as they were.`,
        })
        continue
      }
      switch (conversational.kind) {
        case 'overview':
          await overview(ctx, conversational.range, turn)
          break
        case 'availability':
          await availability(ctx, conversational.range, turn)
          break
        case 'overdue':
          await overdueTasks(ctx, turn)
          break
        case 'focus':
          await focus(ctx, turn)
          break
        case 'flexible':
          await flexible(ctx, conversational.range, conversational.propose, turn)
          break
        case 'defer_refs':
          await deferRefs(ctx, conversational.toDate, conversational.single, turn)
          break
        case 'undo':
          await undoLast(ctx, turn)
          break
        case 'affirm':
          await affirm(ctx, turn)
          break
        case 'deny':
          await deny(ctx, turn)
          break
      }
      continue
    }
    const op = parseOperation(clause, ctx.wallClock)
    const item = op.op === 'capture' ? bareItem(clause) : null
    if (item) {
      const handled = await bare(ctx, item, shoppingContext, turn)
      if (handled) delegated.push(handled)
      continue
    }
    leftovers.push(clause)
  }

  if (leftovers.length) {
    delegated.push(await actOnText(db, userId, leftovers.join('\n'), input.offset, now))
  }

  // Results and replies in the order they were said is close enough: the
  // conversational answers first, then record changes.
  for (const part of delegated) {
    turn.results.push(...part.results)
    turn.parts.push(...partsFromResults(part.results))
    response.questions.push(...part.questions)
    response.capture.push(...part.capture)
    response.overwhelm ||= part.overwhelm
  }
  response.results = turn.results
  response.answers = turn.answers

  if (response.overwhelm)
    turn.parts.unshift({
      tone: 'care',
      topic: 'none',
      text: 'That’s a lot to carry. Let’s make today smaller — you don’t have to do everything.',
    })
  if (response.capture.length)
    turn.parts.push({
      tone: 'info',
      topic: 'none',
      text: 'I’ve kept the rest safe for you to check.',
      brief: 'The rest is saved for you to check.',
    })

  if (input.live) {
    const shopped = turn.results.some((r) => r.kind === 'done' && r.topic === 'shopping')
    if (shopped) {
      shoppingContext = true
      await setContext(ctx, 'shopping', [], null)
    }
  }

  response.reply = styleReply(turn.parts, profile, heard)
  return response
}

export const __test = { briefOf }
