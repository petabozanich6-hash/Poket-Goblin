import { buildDailyBriefing } from '../../shared/magical/briefing'
import { isInQuietHours, localMinutes } from '../../shared/magical/quietHours'
import { buildRescuePlan } from '../../shared/magical/rescue'
import { rankTasks } from '../../shared/magical/prioritize'
import type { CapacityMode, CalendarEvent, Task } from '../../shared/types'
import { localDayBoundsUtc, todayLocalFromOffset } from './datetime'
import { newId } from './ids'
import { getDailyPlan } from './plan'
import { loadSettings } from './settings'
import { listTasksForUser, mapTask } from './tasks'

function mapEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    id: String(row.id),
    title: String(row.title),
    description: String(row.description ?? ''),
    location: String(row.location ?? ''),
    startsAt: String(row.startsAt),
    endsAt: String(row.endsAt),
    allDay: Boolean(row.allDay),
    timezone: String(row.timezone ?? 'UTC'),
    categoryId: (row.categoryId as string | null) ?? null,
    linkedTaskId: (row.linkedTaskId as string | null) ?? null,
    recurrenceRuleId: (row.recurrenceRuleId as string | null) ?? null,
    seriesId: (row.seriesId as string | null) ?? null,
    status: (row.status as CalendarEvent['status']) ?? 'scheduled',
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  }
}

export async function fetchBriefing(
  db: D1Database,
  userId: string,
  displayName: string,
  timezoneOffsetMinutes = 0,
) {
  const settings = await loadSettings(db, userId)
  const now = new Date()
  const todayLocal = todayLocalFromOffset(timezoneOffsetMinutes, now)
  const { startIso: dayStart, endIso: dayEnd } = localDayBoundsUtc(
    todayLocal,
    timezoneOffsetMinutes,
  )

  const events = await db
    .prepare(
      `SELECT id, title, description, location, starts_at as startsAt, ends_at as endsAt,
              all_day as allDay, timezone, category_id as categoryId,
              linked_task_id as linkedTaskId, recurrence_rule_id as recurrenceRuleId,
              series_id as seriesId, status, created_at as createdAt, updated_at as updatedAt
       FROM events
       WHERE user_id = ? AND status = 'scheduled'
         AND starts_at >= ? AND starts_at <= ?
       ORDER BY starts_at ASC`,
    )
    .bind(userId, dayStart, dayEnd)
    .all()

  const openTasks = await listTasksForUser(db, userId, {
    status: 'open',
    limit: 200,
  })
  const overdueTasks = openTasks.filter(
    (t) => t.dueDate && t.dueDate < todayLocal,
  )
  const dueTodayTasks = openTasks.filter((t) => t.dueDate === todayLocal)

  const plan =
    (await getDailyPlan(db, userId, todayLocal)) ??
    ({ tasks: [] as Task[] } as { tasks: Task[] })

  const nowIso = now.toISOString()
  const reminders = await db
    .prepare(
      `SELECT id, title, remind_at as remindAt, status, entity_type as entityType,
              entity_id as entityId, repeat_frequency as repeatFrequency,
              snoozed_until as snoozedUntil, created_at as createdAt, updated_at as updatedAt
       FROM reminders
       WHERE user_id = ? AND status IN ('pending', 'snoozed')
         AND (
           (status = 'pending' AND remind_at <= ?)
           OR (status = 'snoozed' AND snoozed_until IS NOT NULL AND snoozed_until <= ?)
         )
       ORDER BY remind_at ASC LIMIT 5`,
    )
    .bind(userId, nowIso, nowIso)
    .all()

  const pendingReview = await db
    .prepare(
      `SELECT COUNT(*) as count FROM review_items
       WHERE user_id = ? AND status = 'pending'`,
    )
    .bind(userId)
    .first<{ count: number }>()

  const unprocessed = await db
    .prepare(
      `SELECT COUNT(*) as count FROM capture_items
       WHERE user_id = ? AND status = 'suggested'`,
    )
    .bind(userId)
    .first<{ count: number }>()

  const briefing = buildDailyBriefing({
    displayName,
    capacityMode: settings.capacityMode,
    now,
    todayLocal,
    appointmentsToday: (events.results ?? []).map((e) =>
      mapEvent(e as Record<string, unknown>),
    ),
    overdueTasks,
    dueTodayTasks,
    planTasks: plan.tasks,
    dueReminders: (reminders.results ?? []).map((r) => ({
      ...(r as object),
      snoozedUntil:
        (r as { snoozedUntil?: string | null }).snoozedUntil ?? null,
    })) as never,
    pendingReview: pendingReview?.count ?? 0,
    unprocessedCaptures: unprocessed?.count ?? 0,
  })

  return { briefing, settings }
}

export async function fetchPriorities(
  db: D1Database,
  userId: string,
  timezoneOffsetMinutes = 0,
) {
  const settings = await loadSettings(db, userId)
  const todayLocal = todayLocalFromOffset(timezoneOffsetMinutes)
  const openTasks = await listTasksForUser(db, userId, {
    status: 'open',
    limit: 100,
  })
  const dayStart = `${todayLocal}T00:00:00.000Z`
  const dayEnd = `${todayLocal}T23:59:59.999Z`
  const appt = await db
    .prepare(
      `SELECT COUNT(*) as count FROM events
       WHERE user_id = ? AND status = 'scheduled'
         AND starts_at >= ? AND starts_at <= ?`,
    )
    .bind(userId, dayStart, dayEnd)
    .first<{ count: number }>()
  const busyDay = (appt?.count ?? 0) >= 2
  const ranked = rankTasks(
    openTasks,
    todayLocal,
    settings.capacityMode,
    busyDay,
  ).slice(0, 12)

  const byId = new Map(openTasks.map((t) => [t.id, t]))
  return {
    capacityMode: settings.capacityMode,
    busyDay,
    items: ranked.map((row) => ({
      task: byId.get(row.taskId)!,
      score: row.score,
      reasons: row.reasons,
    })),
  }
}

export async function proposeRescue(
  db: D1Database,
  userId: string,
  timezoneOffsetMinutes = 0,
) {
  const settings = await loadSettings(db, userId)
  const now = new Date()
  const todayLocal = todayLocalFromOffset(timezoneOffsetMinutes, now)
  const openTasks = await listTasksForUser(db, userId, {
    status: 'open',
    limit: 100,
  })
  const plan = await getDailyPlan(db, userId, todayLocal)
  const remaining = await db
    .prepare(
      `SELECT id, title, description, location, starts_at as startsAt, ends_at as endsAt,
              all_day as allDay, timezone, category_id as categoryId,
              linked_task_id as linkedTaskId, recurrence_rule_id as recurrenceRuleId,
              series_id as seriesId, status, created_at as createdAt, updated_at as updatedAt
       FROM events
       WHERE user_id = ? AND status = 'scheduled' AND starts_at >= ?
       ORDER BY starts_at ASC LIMIT 10`,
    )
    .bind(userId, now.toISOString())
    .all()

  const suggestion = buildRescuePlan({
    now,
    todayLocal,
    capacityMode: settings.capacityMode,
    openTasks,
    remainingAppointments: (remaining.results ?? []).map((e) =>
      mapEvent(e as Record<string, unknown>),
    ),
    planTaskIds: plan?.taskIds ?? [],
  })

  const id = newId('rescue')
  await db
    .prepare(
      `INSERT INTO rescue_plans
        (id, user_id, plan_date, summary, keep_task_ids_json, defer_task_ids_json, status)
       VALUES (?, ?, ?, ?, ?, ?, 'proposed')`,
    )
    .bind(
      id,
      userId,
      todayLocal,
      suggestion.summary,
      JSON.stringify(suggestion.keep.map((k) => k.task.id)),
      JSON.stringify(suggestion.defer.map((d) => d.task.id)),
    )
    .run()

  return { rescueId: id, suggestion }
}

export async function acceptRescue(
  db: D1Database,
  userId: string,
  rescueId: string,
  keepTaskIds: string[],
  capacityMode: CapacityMode,
) {
  const row = await db
    .prepare(
      `SELECT id, plan_date as planDate FROM rescue_plans
       WHERE id = ? AND user_id = ?`,
    )
    .bind(rescueId, userId)
    .first<{ id: string; planDate: string }>()
  if (!row) return null

  const planId = newId('plan')
  const existing = await db
    .prepare(`SELECT id FROM daily_plans WHERE user_id = ? AND plan_date = ?`)
    .bind(userId, row.planDate)
    .first<{ id: string }>()

  const id = existing?.id ?? planId
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO daily_plans (id, user_id, plan_date, capacity_mode)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(id, userId, row.planDate, capacityMode)
      .run()
  } else {
    await db
      .prepare(`UPDATE daily_plans SET capacity_mode = ? WHERE id = ?`)
      .bind(capacityMode, id)
      .run()
    await db
      .prepare(`DELETE FROM daily_plan_tasks WHERE plan_id = ?`)
      .bind(id)
      .run()
  }

  let order = 0
  for (const taskId of keepTaskIds) {
    const owned = await db
      .prepare(`SELECT id FROM tasks WHERE id = ? AND user_id = ?`)
      .bind(taskId, userId)
      .first()
    if (!owned) continue
    await db
      .prepare(
        `INSERT INTO daily_plan_tasks (plan_id, task_id, sort_order)
         VALUES (?, ?, ?)`,
      )
      .bind(id, taskId, order)
      .run()
    order += 1
  }

  await db
    .prepare(
      `UPDATE rescue_plans
       SET status = 'accepted', keep_task_ids_json = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
    )
    .bind(JSON.stringify(keepTaskIds), rescueId, userId)
    .run()

  return getDailyPlan(db, userId, row.planDate)
}

function nudgeFingerprint(kind: string, entityId: string | null, day: string) {
  return `${kind}:${entityId ?? 'none'}:${day}`
}

export async function syncNudges(
  db: D1Database,
  userId: string,
  timezoneOffsetMinutes = 0,
) {
  const settings = await loadSettings(db, userId)
  const now = new Date()
  const todayLocal = todayLocalFromOffset(timezoneOffsetMinutes, now)
  const quiet = isInQuietHours(
    localMinutes(now),
    settings.quietHoursStart,
    settings.quietHoursEnd,
    settings.quietHoursEnabled,
  )

  if (settings.nudgeFrequency === 'off' || quiet) {
    return {
      quiet,
      nudges: [] as unknown[],
      message: quiet
        ? 'Quiet hours — nudges can wait.'
        : 'Nudges are off in your preferences.',
    }
  }

  const limit =
    settings.nudgeFrequency === 'quiet'
      ? 1
      : settings.nudgeFrequency === 'chatty'
        ? 6
        : 3

  const candidates: Array<{
    kind: string
    entityType: string | null
    entityId: string | null
    title: string
    body: string
  }> = []

  const overdue = await listTasksForUser(db, userId, {
    status: 'open',
    limit: 50,
  })
  for (const task of overdue
    .filter((t) => t.dueDate && t.dueDate < todayLocal)
    .slice(0, 2)) {
    candidates.push({
      kind: 'overdue_task',
      entityType: 'task',
      entityId: task.id,
      title: task.title,
      body: 'Still here when you’re ready — no rush guilt.',
    })
  }

  const soon = await db
    .prepare(
      `SELECT id, title, starts_at as startsAt FROM events
       WHERE user_id = ? AND status = 'scheduled'
         AND starts_at >= ? AND starts_at <= ?
       ORDER BY starts_at ASC LIMIT 2`,
    )
    .bind(
      userId,
      now.toISOString(),
      new Date(now.getTime() + 4 * 3600_000).toISOString(),
    )
    .all<{ id: string; title: string; startsAt: string }>()

  for (const event of soon.results ?? []) {
    candidates.push({
      kind: 'upcoming_event',
      entityType: 'event',
      entityId: event.id,
      title: event.title,
      body: 'Appointment coming up in the next few hours.',
    })
  }

  const dueReminders = await db
    .prepare(
      `SELECT id, title FROM reminders
       WHERE user_id = ? AND status = 'pending' AND remind_at <= ?
       ORDER BY remind_at ASC LIMIT 2`,
    )
    .bind(userId, now.toISOString())
    .all<{ id: string; title: string }>()

  for (const reminder of dueReminders.results ?? []) {
    candidates.push({
      kind: 'reminder',
      entityType: 'reminder',
      entityId: reminder.id,
      title: reminder.title,
      body: 'Gentle reminder from your shelves.',
    })
  }

  if (settings.dailyBriefingEnabled && now.getHours() < 12) {
    candidates.push({
      kind: 'daily_briefing',
      entityType: null,
      entityId: null,
      title: 'Daily briefing ready',
      body: 'Peek at the den when you like — no urgency invented.',
    })
  }

  if (settings.eveningCheckinEnabled && now.getHours() >= 18) {
    candidates.push({
      kind: 'evening_checkin',
      entityType: null,
      entityId: null,
      title: 'Evening check-in',
      body: 'Anything still open that you want to park for tomorrow?',
    })
  }

  for (const candidate of candidates.slice(0, limit + 2)) {
    const fingerprint = nudgeFingerprint(
      candidate.kind,
      candidate.entityId,
      todayLocal,
    )
    await db
      .prepare(
        `INSERT OR IGNORE INTO nudge_log
          (id, user_id, kind, entity_type, entity_id, title, body, status, fingerprint)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      )
      .bind(
        newId('nudge'),
        userId,
        candidate.kind,
        candidate.entityType,
        candidate.entityId,
        candidate.title,
        candidate.body,
        fingerprint,
      )
      .run()
  }

  const rows = await db
    .prepare(
      `SELECT id, kind, entity_type as entityType, entity_id as entityId,
              title, body, status, snoozed_until as snoozedUntil,
              created_at as createdAt
       FROM nudge_log
       WHERE user_id = ?
         AND status IN ('pending', 'shown', 'snoozed')
         AND (snoozed_until IS NULL OR snoozed_until <= ?)
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(userId, now.toISOString(), limit)
    .all()

  return {
    quiet: false,
    nudges: (rows.results ?? []).map((r) => ({
      ...r,
      snoozedUntil:
        (r as { snoozedUntil?: string | null }).snoozedUntil ?? null,
    })),
    message: null as string | null,
  }
}

export async function maybeAwardAchievements(
  db: D1Database,
  userId: string,
  gamificationEnabled: boolean,
  completedQuestCount: number,
) {
  if (!gamificationEnabled) return []

  const awards: Array<{ code: string; title: string; detail: string }> = []
  if (completedQuestCount === 1) {
    awards.push({
      code: 'first_quest',
      title: 'First quest',
      detail: 'You completed your first task in the den.',
    })
  }
  if (completedQuestCount === 10) {
    awards.push({
      code: 'ten_quests',
      title: 'Ten little quests',
      detail: 'Ten completions — quiet progress counts.',
    })
  }
  if (completedQuestCount === 50) {
    awards.push({
      code: 'fifty_quests',
      title: 'Fifty quests',
      detail: 'A tidy pile of finished things.',
    })
  }

  const earned = []
  for (const award of awards) {
    const id = newId('ach')
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO achievements (id, user_id, code, title, detail)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(id, userId, award.code, award.title, award.detail)
      .run()
    if (result.meta.changes > 0) {
      earned.push({ id, ...award, earnedAt: new Date().toISOString() })
    }
  }
  return earned
}

/** Ensure a task row maps after raw select — re-export helper for routes. */
export { mapTask }
