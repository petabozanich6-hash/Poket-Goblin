import { Hono } from 'hono'

import type { SearchResultGroup } from '../../shared/types'
import type { Env } from '../env'
import type { AuthUser } from '../lib/session'

type Vars = { user: AuthUser }

export const searchRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

searchRoutes.get('/', async (c) => {
  const user = c.get('user')
  const q = c.req.query('q')?.trim()
  if (!q || q.length < 1) {
    return c.json({ groups: [] as SearchResultGroup[], suggestions: [] })
  }
  const like = `%${q}%`

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
        href: '/notes',
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
        href: '/shopping',
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

  return c.json({ groups, suggestions })
})
