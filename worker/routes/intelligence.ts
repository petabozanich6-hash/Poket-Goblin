import { Hono } from 'hono'

import type { BreakdownLevel } from '../../shared/intelligence'
import { isCaptureKind } from '../../shared/intelligence'
import type { Env } from '../env'
import { answerAssistant } from '../lib/intelligence/assistant'
import {
  breakdownIntelligence,
  interpretIntelligence,
  resolveProvider,
} from '../lib/intelligence/provider'
import {
  assertUnderLimit,
  dailyLimit,
  getUsageToday,
  recordUsage,
} from '../lib/intelligence/usage'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'
import { asString } from '../lib/validate'
import { ensureDefaultShoppingList } from '../lib/shopping'
import { resolveCategoryId } from '../lib/tasks'
import { recordTaskHistory } from '../lib/history'

type Vars = { user: AuthUser }

export const intelligenceRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

intelligenceRoutes.get('/status', async (c) => {
  const user = c.get('user')
  const provider = resolveProvider(c.env)
  const usage = await getUsageToday(c.env.DB, user.id)
  return c.json({
    provider: provider.kind,
    aiConfigured: provider.configured,
    model: provider.model,
    dailyLimit: dailyLimit(c.env),
    usedToday: usage.requestCount,
    modeLabel: provider.configured
      ? 'AI credentials present — structured interpret may use AI; assistant stays grounded'
      : 'Rule-based goblin brain (no AI credentials)',
  })
})

intelligenceRoutes.post('/interpret', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const text = asString(body?.text, 4000)
  if (!text) return c.json({ error: 'Text is required' }, 400)

  const gate = await assertUnderLimit(c.env.DB, c.env, user.id)
  if (!gate.ok) return c.json({ error: gate.error }, 429)

  const result = await interpretIntelligence(c.env, text)
  await recordUsage(c.env.DB, user.id, result.provider)
  return c.json({ result })
})

intelligenceRoutes.post('/breakdown', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const title = asString(body?.title, 200)
  if (!title) return c.json({ error: 'Title is required' }, 400)
  const level = (asString(body?.level, 20) ?? 'normal') as BreakdownLevel
  if (!['tiny', 'normal', 'detailed'].includes(level)) {
    return c.json({ error: 'Invalid breakdown level' }, 400)
  }

  const gate = await assertUnderLimit(c.env.DB, c.env, user.id)
  if (!gate.ok) return c.json({ error: gate.error }, 429)

  const result = await breakdownIntelligence(c.env, title, level)
  await recordUsage(c.env.DB, user.id, result.provider)
  return c.json({ result })
})

intelligenceRoutes.post('/breakdown/accept', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const existingParentId = asString(body?.parentId, 80)
  const parentTitle = asString(body?.parentTitle, 200)
  const steps = Array.isArray(body?.steps) ? body.steps : []
  if (steps.length === 0) {
    return c.json({ error: 'steps are required' }, 400)
  }

  let parentId = existingParentId
  let resolvedTitle = parentTitle

  if (parentId) {
    const existing = await c.env.DB.prepare(
      `SELECT id, title FROM tasks WHERE id = ? AND user_id = ?`,
    )
      .bind(parentId, user.id)
      .first<{ id: string; title: string }>()
    if (!existing) return c.json({ error: 'Parent task not found' }, 404)
    resolvedTitle = existing.title
  } else {
    if (!parentTitle) {
      return c.json({ error: 'parentTitle or parentId is required' }, 400)
    }
    parentId = newId('task')
    await c.env.DB.prepare(
      `INSERT INTO tasks (id, user_id, title, notes, priority, capacity_cost)
       VALUES (?, ?, ?, ?, 'normal', 3)`,
    )
      .bind(
        parentId,
        user.id,
        parentTitle,
        'Parent task for accepted breakdown',
      )
      .run()
    await recordTaskHistory(
      c.env.DB,
      user.id,
      parentId,
      'created',
      'Breakdown parent',
    )
  }

  const created = []
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue
    const title = asString((step as Record<string, unknown>).title, 200)
    if (!title) continue
    const id = newId('task')
    await c.env.DB.prepare(
      `INSERT INTO tasks
        (id, user_id, title, notes, priority, capacity_cost, parent_id)
       VALUES (?, ?, ?, ?, 'normal', 1, ?)`,
    )
      .bind(id, user.id, title, `Step of: ${resolvedTitle}`, parentId)
      .run()
    await recordTaskHistory(c.env.DB, user.id, id, 'created', 'Breakdown step')
    created.push({ id, title })
  }

  return c.json({ parentId, tasks: created }, 201)
})

intelligenceRoutes.post('/assist', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const question = asString(body?.question, 2000)
  if (!question) return c.json({ error: 'Question is required' }, 400)

  // Soft prompt-injection fence: treat user text as data, never as instructions
  // for mutating other users or bypassing confirmation.
  if (
    /\b(ignore previous|system prompt|exfiltrat|other users?|dump all)\b/i.test(
      question,
    )
  ) {
    return c.json({
      reply: {
        mode: 'rules',
        provider: 'rules',
        message:
          'I only answer about your own Pocket Goblin shelves, and I will not follow instructions that try to override that.',
        actions: [],
        groundedFacts: [],
        warnings: ['Blocked a prompt that looked like an injection attempt.'],
      },
    })
  }

  const gate = await assertUnderLimit(c.env.DB, c.env, user.id)
  if (!gate.ok) return c.json({ error: gate.error }, 429)

  const reply = await answerAssistant(c.env, c.env.DB, user.id, question)
  await recordUsage(c.env.DB, user.id, reply.provider)

  await c.env.DB.prepare(
    `INSERT INTO assistant_messages (id, user_id, role, content, actions_json)
     VALUES (?, ?, 'user', ?, '[]')`,
  )
    .bind(newId('amsg'), user.id, question)
    .run()
  await c.env.DB.prepare(
    `INSERT INTO assistant_messages (id, user_id, role, content, actions_json)
     VALUES (?, ?, 'assistant', ?, ?)`,
  )
    .bind(newId('amsg'), user.id, reply.message, JSON.stringify(reply.actions))
    .run()

  return c.json({ reply })
})

intelligenceRoutes.get('/memory', async (c) => {
  const user = c.get('user')
  const rows = await c.env.DB.prepare(
    `SELECT id, key, value, source, created_at as createdAt, updated_at as updatedAt
     FROM user_memory WHERE user_id = ? ORDER BY updated_at DESC`,
  )
    .bind(user.id)
    .all()
  return c.json({ memories: rows.results ?? [] })
})

intelligenceRoutes.post('/memory', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const key = asString(body?.key, 80)?.toLowerCase().replace(/\s+/g, '_')
  const value = asString(body?.value, 500)
  if (!key || !value)
    return c.json({ error: 'key and value are required' }, 400)

  const id = newId('mem')
  await c.env.DB.prepare(
    `INSERT INTO user_memory (id, user_id, key, value, source)
     VALUES (?, ?, ?, ?, 'user')
     ON CONFLICT(user_id, key) DO UPDATE SET
       value = excluded.value,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  )
    .bind(id, user.id, key, value)
    .run()

  const row = await c.env.DB.prepare(
    `SELECT id, key, value, source, created_at as createdAt, updated_at as updatedAt
     FROM user_memory WHERE user_id = ? AND key = ?`,
  )
    .bind(user.id, key)
    .first()
  return c.json({ memory: row }, 201)
})

intelligenceRoutes.delete('/memory/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const result = await c.env.DB.prepare(
    `DELETE FROM user_memory WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .run()
  if (!result.meta.changes) return c.json({ error: 'Memory not found' }, 404)
  return c.json({ ok: true })
})

intelligenceRoutes.post('/follow-up/accept', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const title = asString(body?.title, 200)
  const remindAt = asString(body?.remindAt, 40)
  if (!title || !remindAt) {
    return c.json({ error: 'title and remindAt are required' }, 400)
  }
  const id = newId('rem')
  await c.env.DB.prepare(
    `INSERT INTO reminders (id, user_id, title, remind_at, entity_type)
     VALUES (?, ?, ?, ?, 'follow_up')`,
  )
    .bind(id, user.id, title, remindAt)
    .run()
  return c.json({ reminderId: id }, 201)
})

/** Optional: accept a validated shopping/task suggestion outside capture flow */
intelligenceRoutes.post('/suggestions/accept-shopping', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const name = asString(body?.title, 200)
  if (!name) return c.json({ error: 'title is required' }, 400)
  const listId = await ensureDefaultShoppingList(c.env.DB, user.id)
  const id = newId('sitem')
  await c.env.DB.prepare(
    `INSERT INTO shopping_items (id, list_id, user_id, name, sort_order)
     VALUES (?, ?, ?, ?, 0)`,
  )
    .bind(id, listId, user.id, name)
    .run()
  return c.json({ id }, 201)
})

intelligenceRoutes.post('/suggestions/accept-task', async (c) => {
  const user = c.get('user')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const title = asString(body?.title, 200)
  if (!title) return c.json({ error: 'title is required' }, 400)
  const type = asString(body?.type, 40) ?? 'task'
  if (!isCaptureKind(type) || type === 'shopping' || type === 'appointment') {
    return c.json({ error: 'Unsupported type for this endpoint' }, 400)
  }
  const categoryId = await resolveCategoryId(
    c.env.DB,
    user.id,
    null,
    typeof body?.categorySlug === 'string' ? body.categorySlug : null,
  )
  const id = newId('task')
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, user_id, category_id, title, notes, priority, due_date, capacity_cost)
     VALUES (?, ?, ?, ?, '', 'normal', ?, 2)`,
  )
    .bind(
      id,
      user.id,
      categoryId,
      title,
      typeof body?.dueDate === 'string' ? body.dueDate : null,
    )
    .run()
  await recordTaskHistory(c.env.DB, user.id, id, 'created', 'From intelligence')
  return c.json({ id }, 201)
})
