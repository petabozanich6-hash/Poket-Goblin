import { Hono } from 'hono'

import { generateOccurrences } from '../../shared/recurrence'
import { isCaptureKind } from '../../shared/intelligence'
import type { CaptureItemKind, RecurrenceFrequency } from '../../shared/types'
import type { Env } from '../env'
import {
  addHoursIso,
  localDateTimeToIso,
  readOffsetMinutes,
} from '../lib/datetime'
import { interpretIntelligence } from '../lib/intelligence/provider'
import { assertUnderLimit, recordUsage } from '../lib/intelligence/usage'
import { newId } from '../lib/ids'
import { recordTaskHistory } from '../lib/history'
import type { AuthUser } from '../lib/session'
import { ensureDefaultShoppingList } from '../lib/shopping'
import { getTaskForUser, resolveCategoryId } from '../lib/tasks'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const captureRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

async function loadCapture(db: D1Database, userId: string, captureId: string) {
  const capture = await db
    .prepare(
      `SELECT id, raw_text as rawText, status, created_at as createdAt
       FROM captures WHERE id = ? AND user_id = ?`,
    )
    .bind(captureId, userId)
    .first<{
      id: string
      rawText: string
      status: 'pending' | 'reviewed' | 'dismissed'
      createdAt: string
    }>()
  if (!capture) return null

  const items = await db
    .prepare(
      `SELECT id, kind, title, due_date as dueDate, start_time as startTime,
              recurrence_frequency as recurrenceFrequency,
              category_slug as categorySlug, confidence, uncertain, status,
              created_task_id as createdTaskId,
              created_event_id as createdEventId,
              created_note_id as createdNoteId,
              created_shopping_item_id as createdShoppingItemId,
              created_reminder_id as createdReminderId
       FROM capture_items WHERE capture_id = ? AND user_id = ?
       ORDER BY created_at ASC`,
    )
    .bind(captureId, userId)
    .all()

  return {
    ...capture,
    items: (items.results ?? []).map((item) => ({
      id: item.id as string,
      kind: item.kind as CaptureItemKind,
      title: item.title as string,
      dueDate: (item.dueDate as string) ?? null,
      startTime: (item.startTime as string) ?? null,
      recurrenceFrequency:
        (item.recurrenceFrequency as RecurrenceFrequency) ?? null,
      categorySlug: (item.categorySlug as string) ?? null,
      confidence: item.confidence as string,
      uncertain: Boolean(item.uncertain),
      status: item.status as string,
      createdTaskId: (item.createdTaskId as string) ?? null,
      createdEventId: (item.createdEventId as string) ?? null,
      createdNoteId: (item.createdNoteId as string) ?? null,
      createdShoppingItemId: (item.createdShoppingItemId as string) ?? null,
      createdReminderId: (item.createdReminderId as string) ?? null,
    })),
  }
}

async function maybeMarkReviewed(
  db: D1Database,
  userId: string,
  captureId: string,
) {
  const remaining = await db
    .prepare(
      `SELECT COUNT(*) as count FROM capture_items
       WHERE capture_id = ? AND status = 'suggested'`,
    )
    .bind(captureId)
    .first<{ count: number }>()
  if ((remaining?.count ?? 0) === 0) {
    await db
      .prepare(
        `UPDATE captures SET status = 'reviewed' WHERE id = ? AND user_id = ?`,
      )
      .bind(captureId, userId)
      .run()
  }
}

captureRoutes.get('/', async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT id FROM captures WHERE user_id = ?
     ORDER BY created_at DESC LIMIT 20`,
  )
    .bind(user.id)
    .all<{ id: string }>()

  const captures = []
  for (const row of rows.results ?? []) {
    const capture = await loadCapture(c.env.DB, user.id, row.id)
    if (capture) captures.push(capture)
  }
  return c.json({ captures })
})

captureRoutes.post('/', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const rawText = asString(body?.text, 4000)
  if (!rawText) return c.json({ error: 'Capture text is required' }, 400)

  const gate = await assertUnderLimit(c.env.DB, c.env, user.id)
  if (!gate.ok) return c.json({ error: gate.error }, 429)

  const intelligence = await interpretIntelligence(c.env, rawText)
  await recordUsage(c.env.DB, user.id, intelligence.provider)

  let suggestions = intelligence.suggestions.filter((s) =>
    isCaptureKind(s.type),
  )
  const warnings = [...(intelligence.warnings ?? [])]

  // Never discard the user's thought — park as an uncertain note for review.
  if (suggestions.length === 0) {
    suggestions = [
      {
        id: 'fallback_note',
        type: 'note',
        title: rawText.slice(0, 120),
        details: rawText,
        dueDate: null,
        startTime: null,
        recurrenceFrequency: null,
        categorySlug: 'other',
        priority: 'normal',
        capacityCost: 1,
        confidence: 'low',
        uncertain: true,
        missingInformation: ['Could not confidently structure this dump'],
        proposedAction: 'Save as a note for later sorting',
        sourceReference: rawText.slice(0, 80),
        parentSuggestionId: null,
      },
    ]
    warnings.push(
      'Could not confidently structure this dump — saved as a note so nothing is lost.',
    )
  }

  const captureId = newId('cap')
  await c.env.DB.prepare(
    `INSERT INTO captures (id, user_id, raw_text) VALUES (?, ?, ?)`,
  )
    .bind(captureId, user.id, rawText)
    .run()

  for (const suggestion of suggestions) {
    const itemId = newId('citem')
    await c.env.DB.prepare(
      `INSERT INTO capture_items
        (id, capture_id, user_id, kind, title, due_date, start_time,
         recurrence_frequency, category_slug, confidence, uncertain)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        itemId,
        captureId,
        user.id,
        suggestion.type,
        suggestion.title,
        suggestion.dueDate,
        suggestion.startTime,
        suggestion.recurrenceFrequency,
        suggestion.categorySlug,
        suggestion.confidence,
        suggestion.uncertain ? 1 : 0,
      )
      .run()

    // Unified inbox — avoid forcing users to hunt across shelves
    await c.env.DB.prepare(
      `INSERT INTO review_items
        (id, user_id, source_type, source_id, title, summary, suggestion_type,
         payload_json, uncertain)
       VALUES (?, ?, 'capture', ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        newId('rev'),
        user.id,
        itemId,
        suggestion.title,
        rawText.slice(0, 200),
        suggestion.type,
        JSON.stringify(suggestion),
        suggestion.uncertain ? 1 : 0,
      )
      .run()
  }

  const capture = await loadCapture(c.env.DB, user.id, captureId)
  return c.json(
    {
      capture,
      intelligence: {
        mode: intelligence.mode,
        provider: intelligence.provider,
        summary: intelligence.summary,
        warnings,
      },
    },
    201,
  )
})

captureRoutes.patch('/:captureId/items/:itemId', async (c) => {
  const user = c.get('user')
  const captureId = c.req.param('captureId')
  const itemId = c.req.param('itemId')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null

  const existing = await c.env.DB.prepare(
    `SELECT id FROM capture_items
     WHERE id = ? AND capture_id = ? AND user_id = ? AND status = 'suggested'`,
  )
    .bind(itemId, captureId, user.id)
    .first()
  if (!existing) return c.json({ error: 'Suggestion not found' }, 404)

  const kind = asString(body?.kind, 40)
  const title = asString(body?.title, 200)
  if (
    kind &&
    ![
      'task',
      'reminder',
      'appointment',
      'note',
      'shopping',
      'follow_up',
    ].includes(kind)
  ) {
    return c.json({ error: 'Invalid kind' }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE capture_items SET
      kind = COALESCE(?, kind),
      title = COALESCE(?, title),
      due_date = CASE WHEN ? = 1 THEN ? ELSE due_date END,
      start_time = CASE WHEN ? = 1 THEN ? ELSE start_time END,
      category_slug = COALESCE(?, category_slug)
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      kind,
      title,
      body && 'dueDate' in body ? 1 : 0,
      typeof body?.dueDate === 'string' ? body.dueDate : null,
      body && 'startTime' in body ? 1 : 0,
      typeof body?.startTime === 'string' ? body.startTime : null,
      typeof body?.categorySlug === 'string' ? body.categorySlug : null,
      itemId,
      user.id,
    )
    .run()

  const capture = await loadCapture(c.env.DB, user.id, captureId)
  return c.json({ capture })
})

captureRoutes.post('/:captureId/items/:itemId/accept', async (c) => {
  const user = c.get('user')
  const captureId = c.req.param('captureId')
  const itemId = c.req.param('itemId')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null

  const item = await c.env.DB.prepare(
    `SELECT id, kind, title, due_date as dueDate, start_time as startTime,
            recurrence_frequency as recurrenceFrequency,
            category_slug as categorySlug, status
     FROM capture_items
     WHERE id = ? AND capture_id = ? AND user_id = ?`,
  )
    .bind(itemId, captureId, user.id)
    .first<{
      id: string
      kind: CaptureItemKind
      title: string
      dueDate: string | null
      startTime: string | null
      recurrenceFrequency: RecurrenceFrequency | null
      categorySlug: string | null
      status: string
    }>()

  if (!item) return c.json({ error: 'Suggestion not found' }, 404)
  if (item.status === 'accepted') {
    return c.json({ error: 'Already accepted' }, 409)
  }

  const categoryId = await resolveCategoryId(
    c.env.DB,
    user.id,
    null,
    item.categorySlug,
  )

  let createdTaskId: string | null = null
  let createdEventId: string | null = null
  let createdNoteId: string | null = null
  let createdShoppingItemId: string | null = null
  let createdReminderId: string | null = null

  if (item.kind === 'shopping') {
    const listId = await ensureDefaultShoppingList(c.env.DB, user.id)
    createdShoppingItemId = newId('sitem')
    await c.env.DB.prepare(
      `INSERT INTO shopping_items (id, list_id, user_id, name, sort_order)
       VALUES (?, ?, ?, ?, 0)`,
    )
      .bind(createdShoppingItemId, listId, user.id, item.title)
      .run()
  } else if (item.kind === 'note') {
    createdNoteId = newId('note')
    await c.env.DB.prepare(
      `INSERT INTO notes (id, user_id, title, body, category_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(createdNoteId, user.id, item.title, item.title, categoryId)
      .run()
  } else if (item.kind === 'appointment') {
    if (!item.dueDate) {
      return c.json(
        { error: 'Confirm a date before accepting this appointment' },
        400,
      )
    }
    const offset = readOffsetMinutes(body)
    createdEventId = newId('evt')
    const startsAt = localDateTimeToIso(
      item.dueDate,
      item.startTime,
      !item.startTime,
      offset,
    )
    const endsAt = addHoursIso(startsAt, item.startTime ? 1 : 24)
    await c.env.DB.prepare(
      `INSERT INTO events
        (id, user_id, title, starts_at, ends_at, all_day, category_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        createdEventId,
        user.id,
        item.title,
        startsAt,
        endsAt,
        item.startTime ? 0 : 1,
        categoryId,
      )
      .run()
  } else if (item.kind === 'reminder') {
    if (!item.dueDate) {
      return c.json(
        { error: 'Confirm a date before accepting this reminder' },
        400,
      )
    }
    createdReminderId = newId('rem')
    const remindAt = localDateTimeToIso(
      item.dueDate,
      item.startTime ?? '09:00',
      false,
      readOffsetMinutes(body),
    )
    await c.env.DB.prepare(
      `INSERT INTO reminders (id, user_id, title, remind_at, entity_type)
       VALUES (?, ?, ?, ?, 'general')`,
    )
      .bind(createdReminderId, user.id, item.title, remindAt)
      .run()

    // Also create a linked open task for follow-through
    createdTaskId = newId('task')
    await c.env.DB.prepare(
      `INSERT INTO tasks
        (id, user_id, category_id, title, notes, priority, due_date, capacity_cost)
       VALUES (?, ?, ?, ?, ?, 'normal', ?, 1)`,
    )
      .bind(
        createdTaskId,
        user.id,
        categoryId,
        item.title,
        'From reminder capture',
        item.dueDate,
      )
      .run()
    await c.env.DB.prepare(
      `UPDATE reminders SET entity_type = 'task', entity_id = ? WHERE id = ?`,
    )
      .bind(createdTaskId, createdReminderId)
      .run()
    await recordTaskHistory(
      c.env.DB,
      user.id,
      createdTaskId,
      'created',
      'From capture reminder',
    )
  } else {
    // task / follow_up
    let recurrenceRuleId: string | null = null
    let seriesId: string | null = null
    if (item.recurrenceFrequency) {
      const startsOn = item.dueDate ?? new Date().toISOString().slice(0, 10)
      recurrenceRuleId = newId('rrule')
      seriesId = newId('series')
      await c.env.DB.prepare(
        `INSERT INTO recurrence_rules
          (id, user_id, frequency, interval_value, starts_on)
         VALUES (?, ?, ?, 1, ?)`,
      )
        .bind(recurrenceRuleId, user.id, item.recurrenceFrequency, startsOn)
        .run()

      const occurrences = generateOccurrences(
        {
          frequency: item.recurrenceFrequency,
          startsOn,
        },
        4,
      )
      for (const occurrence of occurrences) {
        const taskId = newId('task')
        if (!createdTaskId) createdTaskId = taskId
        await c.env.DB.prepare(
          `INSERT INTO tasks
            (id, user_id, category_id, title, notes, priority, due_date,
             capacity_cost, recurrence_rule_id, series_id, occurrence_date)
           VALUES (?, ?, ?, ?, ?, 'normal', ?, 1, ?, ?, ?)`,
        )
          .bind(
            taskId,
            user.id,
            categoryId,
            item.title,
            `Recurring (${item.recurrenceFrequency})`,
            occurrence,
            recurrenceRuleId,
            seriesId,
            occurrence,
          )
          .run()
        await recordTaskHistory(
          c.env.DB,
          user.id,
          taskId,
          'created',
          `Recurring occurrence ${occurrence}`,
        )
      }
    } else {
      createdTaskId = newId('task')
      await c.env.DB.prepare(
        `INSERT INTO tasks
          (id, user_id, category_id, title, notes, priority, due_date, capacity_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
        .bind(
          createdTaskId,
          user.id,
          categoryId,
          item.title,
          `From brain dump (${item.kind})`,
          'normal',
          item.dueDate,
        )
        .run()
      await recordTaskHistory(
        c.env.DB,
        user.id,
        createdTaskId,
        'created',
        'From capture',
      )
    }
  }

  await c.env.DB.prepare(
    `UPDATE capture_items SET
      status = 'accepted',
      created_task_id = ?,
      created_event_id = ?,
      created_note_id = ?,
      created_shopping_item_id = ?,
      created_reminder_id = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      createdTaskId,
      createdEventId,
      createdNoteId,
      createdShoppingItemId,
      createdReminderId,
      itemId,
      user.id,
    )
    .run()

  await c.env.DB.prepare(
    `UPDATE review_items SET status = 'accepted',
      reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE user_id = ? AND source_type = 'capture' AND source_id = ?
       AND status IN ('pending', 'snoozed')`,
  )
    .bind(user.id, itemId)
    .run()

  await maybeMarkReviewed(c.env.DB, user.id, captureId)

  const task = createdTaskId
    ? await getTaskForUser(c.env.DB, user.id, createdTaskId)
    : null
  const capture = await loadCapture(c.env.DB, user.id, captureId)
  return c.json({
    task,
    capture,
    created: {
      taskId: createdTaskId,
      eventId: createdEventId,
      noteId: createdNoteId,
      shoppingItemId: createdShoppingItemId,
      reminderId: createdReminderId,
    },
  })
})

captureRoutes.post('/:captureId/items/:itemId/reject', async (c) => {
  const user = c.get('user')
  const captureId = c.req.param('captureId')
  const itemId = c.req.param('itemId')

  const result = await c.env.DB.prepare(
    `UPDATE capture_items SET status = 'rejected'
     WHERE id = ? AND capture_id = ? AND user_id = ? AND status = 'suggested'`,
  )
    .bind(itemId, captureId, user.id)
    .run()

  if (!result.meta.changes) {
    return c.json({ error: 'Suggestion not found' }, 404)
  }

  await c.env.DB.prepare(
    `UPDATE review_items SET status = 'dismissed',
      reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE user_id = ? AND source_type = 'capture' AND source_id = ?
       AND status IN ('pending', 'snoozed')`,
  )
    .bind(user.id, itemId)
    .run()

  await maybeMarkReviewed(c.env.DB, user.id, captureId)
  const capture = await loadCapture(c.env.DB, user.id, captureId)
  return c.json({ capture })
})
