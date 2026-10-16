import { freeQuota } from './freeQuota'
/**
 * Turn one suggestion (from a brain dump, capture or document) into a real
 * task, reminder, calendar entry, note or shopping item, exactly once.
 * Shared by the review screen and the Devourer's automatic adding.
 */
import { addHoursIso, localDateTimeToIso, readOffsetMinutes } from './datetime'
import {
  claimCaptureItem,
  duplicateMessage,
  findExistingForUser,
  releaseCaptureItem,
} from './dedupe'
import { recordTaskHistory } from './history'
import { newId } from './ids'
import { ensureDefaultShoppingList } from './shopping'
import { resolveCategoryId } from './tasks'
import { asString } from './validate'

export type AcceptResult = {
  status: 200 | 400 | 403 | 404 | 409
  body: Record<string, unknown>
}

export async function acceptReviewItem(
  db: D1Database,
  userId: string,
  id: string,
  body: Record<string, unknown> | null,
  reason = 'Accepted from review',
): Promise<AcceptResult> {
  const item = await db
    .prepare(
      `SELECT id, source_type as sourceType, source_id as sourceId,
            title, suggestion_type as suggestionType, payload_json as payloadJson,
            status
     FROM review_items WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first<{
      id: string
      sourceType: string
      sourceId: string | null
      title: string
      suggestionType: string
      payloadJson: string
      status: string
    }>()
  if (!item || !['pending', 'snoozed', 'edited'].includes(item.status)) {
    return { status: 404, body: { error: 'Item not found' } }
  }

  const payload = JSON.parse(item.payloadJson || '{}') as Record<
    string,
    unknown
  >
  const title =
    asString(body?.title, 200) || asString(payload.title, 200) || item.title
  const type =
    asString(body?.type, 40) ||
    asString(payload.type, 40) ||
    item.suggestionType
  const dueDate =
    typeof body?.dueDate === 'string'
      ? body.dueDate
      : typeof payload.dueDate === 'string'
        ? payload.dueDate
        : null
  const offset = readOffsetMinutes(body)

  if (
    (type === 'appointment' || type === 'reminder' || type === 'follow_up') &&
    !dueDate
  ) {
    return {
      status: 400,
      body: {
        error: `Confirm a date before accepting this ${type === 'appointment' ? 'appointment' : 'reminder'}`,
      },
    }
  }
  if (body?.allowDuplicate !== true) {
    // Reminders from the inbox don't create tasks, so only task/shopping here.
    const existing = await findExistingForUser(
      db,
      userId,
      type === 'shopping' ? 'shopping' : type === 'task' ? 'task' : 'none',
      title,
    )
    if (existing) {
      return {
        status: 409,
        body: { error: duplicateMessage(existing), duplicateOf: existing },
      }
    }
  }

  const resource =
    type === 'note'
      ? 'notes'
      : type === 'reminder' || type === 'follow_up'
        ? 'reminders'
        : type === 'shopping' || type === 'appointment'
          ? null
          : 'tasks'
  if (resource) {
    const quota = await freeQuota(db, userId, resource)
    if (quota) return { status: 403, body: quota }
  }

  // Atomic claim: a double-tap, or accepting the same suggestion from
  // Capture and Inbox, must create exactly one record.
  const claimed = await db
    .prepare(
      `UPDATE review_items SET status = 'accepted',
      reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ? AND status IN ('pending', 'snoozed', 'edited')`,
    )
    .bind(id, userId)
    .run()
  if (!claimed.meta.changes)
    return { status: 409, body: { error: 'Already handled' } }
  const captureItemId =
    item.sourceType === 'capture' && item.sourceId ? item.sourceId : null
  if (captureItemId && !(await claimCaptureItem(db, userId, captureItemId))) {
    return { status: 409, body: { error: 'Already handled from Capture' } }
  }

  let createdId: string | null = null
  let createdKind = type
  try {
    if (type === 'shopping') {
      const listId = await ensureDefaultShoppingList(db, userId)
      createdId = newId('sitem')
      await db
        .prepare(
          `INSERT INTO shopping_items (id, list_id, user_id, name, sort_order)
       VALUES (?, ?, ?, ?, 0)`,
        )
        .bind(createdId, listId, userId, title)
        .run()
    } else if (type === 'note') {
      createdId = newId('note')
      const categoryId = await resolveCategoryId(
        db,
        userId,
        null,
        typeof payload.categorySlug === 'string' ? payload.categorySlug : null,
      )
      await db
        .prepare(
          `INSERT INTO notes (id, user_id, title, body, category_id)
       VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          createdId,
          userId,
          title,
          typeof payload.details === 'string' ? payload.details : '',
          categoryId,
        )
        .run()
    } else if (type === 'appointment') {
      if (!dueDate) {
        return {
          status: 400,
          body: { error: 'Confirm a date before accepting this appointment' },
        }
      }
      createdId = newId('evt')
      const startTime =
        typeof body?.startTime === 'string'
          ? body.startTime
          : typeof payload.startTime === 'string'
            ? payload.startTime
            : null
      const startsAt = localDateTimeToIso(
        dueDate,
        startTime,
        !startTime,
        offset,
      )
      await db
        .prepare(
          `INSERT INTO events (id, user_id, title, starts_at, ends_at, all_day)
       VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          createdId,
          userId,
          title,
          startsAt,
          addHoursIso(startsAt, startTime ? 1 : 24),
          startTime ? 0 : 1,
        )
        .run()
    } else if (type === 'reminder' || type === 'follow_up') {
      if (!dueDate) {
        return {
          status: 400,
          body: { error: 'Confirm a date before accepting this reminder' },
        }
      }
      createdId = newId('rem')
      const remindAt = localDateTimeToIso(
        dueDate,
        typeof body?.startTime === 'string'
          ? body.startTime
          : typeof payload.startTime === 'string' &&
              /^\d{2}:\d{2}$/.test(payload.startTime)
            ? payload.startTime
            : '09:00',
        false,
        offset,
      )
      await db
        .prepare(
          `INSERT INTO reminders (id, user_id, title, remind_at, entity_type)
       VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(
          createdId,
          userId,
          title,
          remindAt,
          type === 'follow_up' ? 'follow_up' : 'general',
        )
        .run()
    } else {
      createdId = newId('task')
      createdKind = 'task'
      const categoryId = await resolveCategoryId(
        db,
        userId,
        null,
        typeof payload.categorySlug === 'string' ? payload.categorySlug : null,
      )
      await db
        .prepare(
          `INSERT INTO tasks
        (id, user_id, category_id, title, notes, priority, due_date, capacity_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, 2)`,
        )
        .bind(
          createdId,
          userId,
          categoryId,
          title,
          typeof payload.details === 'string' ? payload.details : '',
          // "Do this straight away" parts of a document plan.
          payload.priority === 'high' ? 'high' : 'normal',
          dueDate,
        )
        .run()
      await recordTaskHistory(db, userId, createdId, 'created', 'From inbox')
    }
  } catch (error) {
    // Put the suggestion back so the user can try again.
    if (captureItemId) {
      await releaseCaptureItem(db, userId, captureItemId)
    }
    await db
      .prepare(
        `UPDATE review_items SET status = 'pending', reviewed_at = NULL
       WHERE id = ? AND user_id = ?`,
      )
      .bind(id, userId)
      .run()
    throw error
  }

  if (captureItemId && createdId) {
    const column =
      createdKind === 'shopping'
        ? 'created_shopping_item_id'
        : createdKind === 'note'
          ? 'created_note_id'
          : createdKind === 'appointment'
            ? 'created_event_id'
            : createdKind === 'reminder' || createdKind === 'follow_up'
              ? 'created_reminder_id'
              : 'created_task_id'
    await db
      .prepare(
        `UPDATE capture_items SET ${column} = ? WHERE id = ? AND user_id = ?`,
      )
      .bind(createdId, captureItemId, userId)
      .run()
    await db
      .prepare(
        `UPDATE captures SET status = 'reviewed'
       WHERE user_id = ? AND id = (SELECT capture_id FROM capture_items WHERE id = ?)
         AND NOT EXISTS (
           SELECT 1 FROM capture_items
           WHERE capture_id = captures.id AND status = 'suggested'
         )`,
      )
      .bind(userId, captureItemId)
      .run()
  }

  if (item.sourceType === 'document' && item.sourceId && createdId) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO record_links
        (id, user_id, from_type, from_id, to_type, to_id, reason)
       VALUES (?, ?, 'document', ?, ?, ?, ?)`,
      )
      .bind(
        newId('link'),
        userId,
        item.sourceId,
        createdKind,
        createdId,
        reason,
      )
      .run()
    if (createdKind === 'task') {
      await db
        .prepare(
          `UPDATE documents SET linked_task_id = ? WHERE id = ? AND user_id = ?`,
        )
        .bind(createdId, item.sourceId, userId)
        .run()
    }
  }

  await db
    .prepare(
      `UPDATE review_items SET status = 'accepted',
      reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .run()

  return { status: 200, body: { ok: true, createdId, createdKind } }
}
