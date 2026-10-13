import { Hono } from 'hono'

import type { SearchResultGroup } from '../../shared/types'
import type { Env } from '../env'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'

type Vars = { user: AuthUser }

export const searchRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

function expandQuery(q: string): string[] {
  const base = q.trim()
  const variants = new Set<string>([base])
  const lower = base.toLowerCase()
  // Lightweight natural-language hints — still exact substring search, no invented hits
  const stripped = lower
    .replace(/^(that|my|the|find|show|things?\s+i\s+need\s+to)\s+/i, '')
    .replace(/\?+$/, '')
    .trim()
  if (stripped) variants.add(stripped)
  if (/\bbuy\b|\bshop\b|\bgrocer/i.test(lower)) variants.add('buy')
  return [...variants]
}

searchRoutes.get('/', async (c) => {
  const user = c.get('user')
  const q = c.req.query('q')?.trim()
  if (!q || q.length < 1) {
    const recent = await c.env.DB.prepare(
      `SELECT query FROM search_history
       WHERE user_id = ? ORDER BY created_at DESC LIMIT 8`,
    )
      .bind(user.id)
      .all<{ query: string }>()
    return c.json({
      groups: [] as SearchResultGroup[],
      suggestions: [],
      recent: (recent.results ?? []).map((r) => r.query),
    })
  }

  const variants = expandQuery(q)
  const likes = variants.map((v) => `%${v}%`)

  // Use primary query for history; avoid logging every keystroke spam by length
  if (q.length >= 2) {
    await c.env.DB.prepare(
      `INSERT INTO search_history (id, user_id, query) VALUES (?, ?, ?)`,
    )
      .bind(newId('srch'), user.id, q.slice(0, 120))
      .run()
  }

  const like = likes[0]!

  const tasks = await c.env.DB.prepare(
    `SELECT id, title, status FROM tasks
     WHERE user_id = ? AND (title LIKE ? OR notes LIKE ?)
     ORDER BY updated_at DESC LIMIT 8`,
  )
    .bind(user.id, like, like)
    .all<{ id: string; title: string; status: string }>()

  const notes = await c.env.DB.prepare(
    `SELECT id, title FROM notes
     WHERE user_id = ? AND (title LIKE ? OR body LIKE ?)
     ORDER BY updated_at DESC LIMIT 8`,
  )
    .bind(user.id, like, like)
    .all<{ id: string; title: string }>()

  const events = await c.env.DB.prepare(
    `SELECT id, title, starts_at as startsAt FROM events
     WHERE user_id = ? AND status = 'scheduled'
       AND (title LIKE ? OR description LIKE ? OR location LIKE ?)
     ORDER BY starts_at ASC LIMIT 8`,
  )
    .bind(user.id, like, like, like)
    .all<{ id: string; title: string; startsAt: string }>()

  const shopping = await c.env.DB.prepare(
    `SELECT id, name FROM shopping_items
     WHERE user_id = ? AND name LIKE ?
     ORDER BY updated_at DESC LIMIT 8`,
  )
    .bind(user.id, like)
    .all<{ id: string; name: string }>()

  const captures = await c.env.DB.prepare(
    `SELECT id, raw_text as rawText FROM captures
     WHERE user_id = ? AND raw_text LIKE ?
     ORDER BY created_at DESC LIMIT 5`,
  )
    .bind(user.id, like)
    .all<{ id: string; rawText: string }>()

  const documents = await c.env.DB.prepare(
    `SELECT id, display_name as displayName, category_slug as categorySlug
     FROM documents
     WHERE user_id = ? AND (display_name LIKE ? OR IFNULL(category_slug, '') LIKE ?)
     ORDER BY updated_at DESC LIMIT 8`,
  )
    .bind(user.id, like, like)
    .all<{
      id: string
      displayName: string
      categorySlug: string | null
    }>()

  const reminders = await c.env.DB.prepare(
    `SELECT id, title, status FROM reminders
     WHERE user_id = ? AND title LIKE ?
     ORDER BY remind_at DESC LIMIT 6`,
  )
    .bind(user.id, like)
    .all<{ id: string; title: string; status: string }>()

  const groups: SearchResultGroup[] = []

  if (tasks.results?.length) {
    groups.push({
      type: 'task',
      label: 'Tasks',
      items: tasks.results.map((t) => ({
        id: t.id,
        title: t.title,
        subtitle: t.status,
        href: '/tasks',
      })),
    })
  }
  if (notes.results?.length) {
    groups.push({
      type: 'note',
      label: 'Notes',
      items: notes.results.map((n) => ({
        id: n.id,
        title: n.title,
        href: '/life',
      })),
    })
  }
  if (events.results?.length) {
    groups.push({
      type: 'event',
      label: 'Appointments',
      items: events.results.map((e) => ({
        id: e.id,
        title: e.title,
        subtitle: e.startsAt,
        href: '/calendar',
      })),
    })
  }
  if (shopping.results?.length) {
    groups.push({
      type: 'shopping',
      label: 'Shopping',
      items: shopping.results.map((s) => ({
        id: s.id,
        title: s.name,
        href: '/life',
      })),
    })
  }
  if (documents.results?.length) {
    groups.push({
      type: 'document',
      label: 'Documents',
      items: documents.results.map((d) => ({
        id: d.id,
        title: d.displayName,
        subtitle: d.categorySlug ?? undefined,
        href: '/vault',
      })),
    })
  }
  if (reminders.results?.length) {
    groups.push({
      type: 'reminder',
      label: 'Reminders',
      items: reminders.results.map((r) => ({
        id: r.id,
        title: r.title,
        subtitle: r.status,
        href: '/life',
      })),
    })
  }
  if (captures.results?.length) {
    groups.push({
      type: 'capture',
      label: 'Captures',
      items: captures.results.map((cap) => ({
        id: cap.id,
        title: cap.rawText.slice(0, 80),
        href: '/capture',
      })),
    })
  }

  const suggestions = groups
    .flatMap((g) => g.items.map((i) => i.title))
    .slice(0, 6)

  return c.json({ groups, suggestions, recent: [] as string[] })
})
