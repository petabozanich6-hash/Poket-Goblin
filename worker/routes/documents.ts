import { Hono } from 'hono'

import type { Env } from '../env'
import { processDocumentForUser } from '../lib/documents/processDocument'
import {
  MAX_UPLOAD_BYTES,
  sha256Hex,
  validateUpload,
} from '../lib/documents/validateUpload'
import { newId } from '../lib/ids'
import type { AuthUser } from '../lib/session'
import { getObjectStore } from '../lib/storage'
import { asString } from '../lib/validate'

type Vars = { user: AuthUser }

export const documentRoutes = new Hono<{ Bindings: Env; Variables: Vars }>()

function mapDoc(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    displayName: row.displayName as string,
    mimeType: row.mimeType as string,
    byteSize: row.byteSize as number,
    categorySlug: (row.categorySlug as string) ?? null,
    status: row.status as string,
    processingError: (row.processingError as string) ?? null,
    linkedTaskId: (row.linkedTaskId as string) ?? null,
    linkedEventId: (row.linkedEventId as string) ?? null,
    linkedReminderId: (row.linkedReminderId as string) ?? null,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    hasExtractedText: Boolean(row.hasText),
  }
}

const SELECT = `
  SELECT id, display_name as displayName, mime_type as mimeType,
         byte_size as byteSize, category_slug as categorySlug, status,
         processing_error as processingError,
         linked_task_id as linkedTaskId, linked_event_id as linkedEventId,
         linked_reminder_id as linkedReminderId,
         created_at as createdAt, updated_at as updatedAt,
         CASE WHEN extracted_text IS NOT NULL AND length(extracted_text) > 0
           THEN 1 ELSE 0 END as hasText
  FROM documents
`

documentRoutes.get('/', async (c) => {
  const user = c.get('user')
  const q = c.req.query('q')?.trim()
  const status = c.req.query('status')?.trim()
  const category = c.req.query('category')?.trim()
  let sql = `${SELECT} WHERE user_id = ?`
  const binds: string[] = [user.id]
  if (q) {
    sql += " AND (display_name LIKE ? OR ifnull(extracted_text, '') LIKE ?)"
    binds.push(`%${q}%`, `%${q}%`)
  }
  if (status) {
    sql += ' AND status = ?'
    binds.push(status)
  }
  if (category) {
    sql += ' AND category_slug = ?'
    binds.push(category)
  }
  sql += ' ORDER BY updated_at DESC LIMIT 100'
  const rows = await c.env.DB.prepare(sql)
    .bind(...binds)
    .all()
  return c.json({
    documents: (rows.results ?? []).map((r) => mapDoc(r)),
    storage: c.env.UPLOADS ? 'r2' : 'memory-fallback',
    maxUploadBytes: MAX_UPLOAD_BYTES,
  })
})

documentRoutes.get('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()
  if (!row) return c.json({ error: 'Document not found' }, 404)
  const extractions = await c.env.DB.prepare(
    `SELECT id, kind, label, value, confidence, source_excerpt as sourceExcerpt
     FROM document_extractions WHERE document_id = ? AND user_id = ?
     ORDER BY created_at ASC`,
  )
    .bind(id, user.id)
    .all()
  return c.json({
    document: mapDoc(row),
    extractions: extractions.results ?? [],
  })
})

documentRoutes.post('/', async (c) => {
  const user = c.get('user')
  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return c.json({ error: 'file is required' }, 400)
  }
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const validated = validateUpload({
    filename: file.name || 'document',
    declaredMime: file.type || '',
    bytes,
  })
  if (!validated.ok) return c.json({ error: validated.error }, 400)

  const id = newId('doc')
  const storageKey = `${user.id}/${id}/${validated.safeName}`
  const store = getObjectStore(c.env)
  await store.put(storageKey, bytes, validated.mime)
  const hash = await sha256Hex(bytes)

  await c.env.DB.prepare(
    `INSERT INTO documents
      (id, user_id, display_name, storage_key, mime_type, byte_size, sha256, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded')`,
  )
    .bind(
      id,
      user.id,
      validated.safeName,
      storageKey,
      validated.mime,
      bytes.byteLength,
      hash,
    )
    .run()

  // Process inline for local/dev (practical, testable — not a fake queue)
  const result = await processDocumentForUser(c.env, user.id, id)
  const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()

  return c.json(
    {
      document: mapDoc(row!),
      processing: result,
    },
    201,
  )
})

documentRoutes.post('/:id/process', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const existing = await c.env.DB.prepare(
    `SELECT id FROM documents WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first()
  if (!existing) return c.json({ error: 'Document not found' }, 404)
  const result = await processDocumentForUser(c.env, user.id, id)
  const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()
  return c.json({ document: mapDoc(row!), processing: result })
})

documentRoutes.patch('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null
  const existing = await c.env.DB.prepare(
    `${SELECT} WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first()
  if (!existing) return c.json({ error: 'Document not found' }, 404)

  const displayName =
    body?.displayName !== undefined
      ? asString(body.displayName, 200)
      : (existing.displayName as string)
  if (!displayName) return c.json({ error: 'Name is required' }, 400)

  await c.env.DB.prepare(
    `UPDATE documents SET
      display_name = ?,
      category_slug = COALESCE(?, category_slug),
      linked_task_id = COALESCE(?, linked_task_id),
      linked_event_id = COALESCE(?, linked_event_id),
      linked_reminder_id = COALESCE(?, linked_reminder_id),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      displayName,
      typeof body?.categorySlug === 'string' ? body.categorySlug : null,
      typeof body?.linkedTaskId === 'string' ? body.linkedTaskId : null,
      typeof body?.linkedEventId === 'string' ? body.linkedEventId : null,
      typeof body?.linkedReminderId === 'string' ? body.linkedReminderId : null,
      id,
      user.id,
    )
    .run()

  if (typeof body?.linkedTaskId === 'string') {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO record_links
        (id, user_id, from_type, from_id, to_type, to_id, reason)
       VALUES (?, ?, 'document', ?, 'task', ?, 'User linked')`,
    )
      .bind(newId('link'), user.id, id, body.linkedTaskId)
      .run()
  }

  const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()
  return c.json({ document: mapDoc(row!) })
})

documentRoutes.get('/:id/download', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const doc = await c.env.DB.prepare(
    `SELECT storage_key as storageKey, display_name as displayName, mime_type as mimeType
     FROM documents WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first<{ storageKey: string; displayName: string; mimeType: string }>()
  if (!doc) return c.json({ error: 'Document not found' }, 404)

  const store = getObjectStore(c.env)
  const obj = await store.get(doc.storageKey)
  if (!obj) return c.json({ error: 'File missing from storage' }, 404)

  const headers = new Headers()
  headers.set('Content-Type', obj.contentType || doc.mimeType)
  headers.set(
    'Content-Disposition',
    `attachment; filename="${doc.displayName.replace(/"/g, '')}"`,
  )
  headers.set('Cache-Control', 'private, no-store')

  if (obj.body instanceof ArrayBuffer) {
    return new Response(obj.body, { headers })
  }
  return new Response(obj.body, { headers })
})

documentRoutes.delete('/:id', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const doc = await c.env.DB.prepare(
    `SELECT storage_key as storageKey FROM documents WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first<{ storageKey: string }>()
  if (!doc) return c.json({ error: 'Document not found' }, 404)

  const store = getObjectStore(c.env)
  await store.delete(doc.storageKey)
  await c.env.DB.prepare(
    `DELETE FROM review_items WHERE user_id = ? AND source_type = 'document' AND source_id = ?`,
  )
    .bind(user.id, id)
    .run()
  await c.env.DB.prepare(`DELETE FROM documents WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .run()
  return c.json({ ok: true })
})
