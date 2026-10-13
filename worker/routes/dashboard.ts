import { Hono } from 'hono'

import type { Env } from '../env'
import type { AuthUser } from '../lib/session'
import { ensureDefaultShoppingList } from '../lib/shopping'

type Vars = { user: AuthUser }

export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

dashboardRoutes.get('/den', async (c) => {
  const user = c.get('user')
  await ensureDefaultShoppingList(c.env.DB, user.id)
  const now = new Date().toISOString()
  const soon = new Date(Date.now() + 7 * 86_400_000).toISOString()

  const events = await c.env.DB.prepare(
    `SELECT id, title, description, location, starts_at as startsAt, ends_at as endsAt,
            all_day as allDay, timezone, category_id as categoryId,
            linked_task_id as linkedTaskId, recurrence_rule_id as recurrenceRuleId,
            series_id as seriesId, status, created_at as createdAt, updated_at as updatedAt
     FROM events
     WHERE user_id = ? AND status = 'scheduled' AND starts_at >= ? AND starts_at <= ?
     ORDER BY starts_at ASC LIMIT 5`,
  )
    .bind(user.id, now, soon)
    .all()

  const reminders = await c.env.DB.prepare(
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
    .bind(user.id, now, now)
    .all()

  const shopping = await c.env.DB.prepare(
    `SELECT id, list_id as listId, name, quantity, notes, checked,
            sort_order as sortOrder, created_at as createdAt, updated_at as updatedAt
     FROM shopping_items
     WHERE user_id = ? AND checked = 0
     ORDER BY sort_order ASC LIMIT 5`,
  )
    .bind(user.id)
    .all()

  const notes = await c.env.DB.prepare(
    `SELECT n.id, n.title, n.body, n.category_id as categoryId,
            c.slug as categorySlug, c.name as categoryName,
            n.pinned, n.linked_task_id as linkedTaskId, n.linked_event_id as linkedEventId,
            n.created_at as createdAt, n.updated_at as updatedAt
     FROM notes n
     LEFT JOIN categories c ON c.id = n.category_id
     WHERE n.user_id = ? AND n.pinned = 1
     ORDER BY n.updated_at DESC LIMIT 3`,
  )
    .bind(user.id)
    .all()

  const pendingCaptures = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM capture_items
     WHERE user_id = ? AND status = 'suggested'`,
  )
    .bind(user.id)
    .first<{ count: number }>()

  const pendingReview = await c.env.DB.prepare(
    `SELECT COUNT(*) as count FROM review_items
     WHERE user_id = ? AND status = 'pending'`,
  )
    .bind(user.id)
    .first<{ count: number }>()

  const recentDocs = await c.env.DB.prepare(
    `SELECT id, display_name as displayName, status
     FROM documents WHERE user_id = ?
     ORDER BY updated_at DESC LIMIT 3`,
  )
    .bind(user.id)
    .all()

  return c.json({
    summary: {
      upcomingEvents: (events.results ?? []).map((e) => ({
        ...e,
        allDay: Boolean(e.allDay),
      })),
      dueReminders: (reminders.results ?? []).map((r) => ({
        ...r,
        snoozedUntil: r.snoozedUntil ?? null,
      })),
      shoppingNeedsAttention: (shopping.results ?? []).map((s) => ({
        ...s,
        checked: Boolean(s.checked),
      })),
      pinnedNotes: (notes.results ?? []).map((n) => ({
        ...n,
        pinned: Boolean(n.pinned),
      })),
      unprocessedCaptures: pendingCaptures?.count ?? 0,
      pendingReview: pendingReview?.count ?? 0,
      recentDocuments: recentDocs.results ?? [],
    },
  })
})
