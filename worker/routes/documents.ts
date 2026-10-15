import { Hono } from 'hono'

import type { Env } from '../env'
import { loadAccess } from '../lib/access'
import { autoAddFromDocument, undoAutoAdd } from '../lib/documents/autoAdd'
import {
  DAILY_DOCUMENT_PROCESSING,
  forgetDocument,
  keptKey,
  MAX_PENDING_TEMPORARY,
  sweepExpiredDocuments,
  temporaryKey,
  TEMPORARY_TTL_MS,
  UPLOAD_GRACE_MS,
} from '../lib/documents/lifecycle'
import {
  processDocumentForUser,
  type ProcessOptions,
} from '../lib/documents/processDocument'
import {
  MAX_UPLOAD_BYTES,
  sha256Hex,
  validateUpload,
} from '../lib/documents/validateUpload'
import { newId } from '../lib/ids'
import { firstUnownedLink, linkNotFound } from '../lib/ownership'
import {
  loadPlatformSettings,
  storageQuotaBytesFor,
} from '../lib/platformSettings'
import type { AuthUser } from '../lib/session'
import { getObjectStore } from '../lib/storage'
import { readOffsetMinutes } from '../lib/datetime'
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
    retention: (row.retention as 'keep' | 'temporary') ?? 'keep',
    expiresAt: (row.expiresAt as string) ?? null,
    documentType: (row.documentType as string) ?? null,
    goblinSummary: (row.goblinSummary as string) ?? null,
  }
}

type Row = Record<string, unknown>

async function pendingSuggestions(
  db: D1Database,
  userId: string,
  documentId: string,
) {
  const rows = await db
    .prepare(
      `SELECT id, title, summary, suggestion_type as suggestionType,
              payload_json as payloadJson, uncertain, status
       FROM review_items
       WHERE user_id = ? AND source_type = 'document' AND source_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    )
    .bind(userId, documentId)
    .all<Row>()
  return (rows.results ?? []).map((r) => {
    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(String(r.payloadJson ?? '{}')) as Record<
        string,
        unknown
      >
    } catch {
      payload = {}
    }
    return {
      id: r.id as string,
      title: r.title as string,
      details: r.summary as string,
      type: r.suggestionType as string,
      status: r.status as string,
      uncertain: Boolean(r.uncertain),
      dueDate: typeof payload.dueDate === 'string' ? payload.dueDate : null,
      startTime:
        typeof payload.startTime === 'string' ? payload.startTime : null,
      missingInformation: Array.isArray(payload.missingInformation)
        ? (payload.missingInformation as string[])
        : [],
      sourceExcerpt:
        typeof payload.sourceExcerpt === 'string' ? payload.sourceExcerpt : '',
      group: typeof payload.group === 'string' ? payload.group : null,
      step: typeof payload.step === 'string' ? payload.step : null,
      priority: payload.priority === 'high' ? 'high' : 'normal',
      urgent: payload.urgent === true,
    }
  })
}

function processOptions(body: Record<string, unknown>): ProcessOptions {
  return {
    timezoneOffsetMinutes: readOffsetMinutes(body),
    monthFirst: body.monthFirst === true || body.monthFirst === 'true',
  }
}

const SELECT = `
  SELECT id, display_name as displayName, mime_type as mimeType,
         byte_size as byteSize, category_slug as categorySlug, status,
         processing_error as processingError,
         linked_task_id as linkedTaskId, linked_event_id as linkedEventId,
         linked_reminder_id as linkedReminderId,
         created_at as createdAt, updated_at as updatedAt,
         retention, expires_at as expiresAt, document_type as documentType,
         goblin_summary as goblinSummary,
         CASE WHEN extracted_text IS NOT NULL AND length(extracted_text) > 0
           THEN 1 ELSE 0 END as hasText
  FROM documents
`

documentRoutes.get('/', async (c) => {
  const user = c.get('user')
  const q = c.req.query('q')?.trim()
  const status = c.req.query('status')?.trim()
  const category = c.req.query('category')?.trim()
  const retention =
    c.req.query('retention') === 'temporary' ? 'temporary' : 'keep'
  let sql = `${SELECT} WHERE user_id = ? AND retention = ?`
  const binds: string[] = [user.id, retention]
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
  const access = await loadAccess(c.env.DB, user.id)
  const settings = await loadPlatformSettings(c.env.DB, c.env)
  const used = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(byte_size), 0) as bytes FROM documents
     WHERE user_id = ? AND retention = 'keep'`,
  )
    .bind(user.id)
    .first<{ bytes: number }>()
  return c.json({
    documents: (rows.results ?? []).map((r) => mapDoc(r)),
    storage: c.env.UPLOADS ? 'r2' : 'memory-fallback',
    maxUploadBytes: MAX_UPLOAD_BYTES,
    keptBytes: Number(used?.bytes ?? 0),
    keptAllowanceBytes: storageQuotaBytesFor(access.plan, settings),
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
    suggestions: await pendingSuggestions(c.env.DB, user.id, id),
  })
})

documentRoutes.post('/', async (c) => {
  const user = c.get('user')
  const settings = await loadPlatformSettings(c.env.DB, c.env)
  if (!settings.features.documentUploads) {
    return c.json(
      { error: 'Document uploads are paused for now. Please try again later.' },
      503,
    )
  }
  // Refuse oversized bodies before buffering them.
  const declaredLength = Number(c.req.header('Content-Length') ?? '0')
  if (declaredLength > MAX_UPLOAD_BYTES + 64 * 1024) {
    return c.json({ error: 'File is too large (max 10 MB)' }, 413)
  }

  // Opportunistic cleanup of anything past its expiry (any user).
  try {
    c.executionCtx.waitUntil(
      sweepExpiredDocuments(c.env).catch(() => undefined),
    )
  } catch {
    // No execution context (tests): the hourly sweep still covers it.
  }

  const form = await c.req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return c.json({ error: 'file is required' }, 400)
  }
  const mode = form.get('mode') === 'keep' ? 'keep' : 'temporary'
  const options = processOptions({
    timezoneOffsetMinutes: Number(form.get('timezoneOffsetMinutes') ?? '0'),
    monthFirst: form.get('monthFirst') === 'true',
  })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const validated = validateUpload({
    filename: file.name || 'document',
    declaredMime: file.type || '',
    bytes,
  })
  if (!validated.ok) return c.json({ error: validated.error }, 400)

  const access = await loadAccess(c.env.DB, user.id)
  const hash = await sha256Hex(bytes)

  // The same file again: reuse the open review, or point at the kept copy.
  const duplicate = await c.env.DB.prepare(
    `SELECT id, retention FROM documents WHERE user_id = ? AND sha256 = ?
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(user.id, hash)
    .first<{ id: string; retention: string }>()
  if (duplicate) {
    // Nothing from it added yet? Read it again: the reader may have improved
    // (or the AI was busy) since last time.
    const used = await c.env.DB.prepare(
      `SELECT 1 FROM review_items WHERE user_id = ? AND source_type = 'document'
         AND source_id = ? AND status = 'accepted' LIMIT 1`,
    )
      .bind(user.id, duplicate.id)
      .first()
    let processing: Awaited<ReturnType<typeof processDocumentForUser>> | null =
      null
    let autoAdded = { added: 0, already: 0 }
    if (!used) {
      processing = await processDocumentForUser(
        c.env,
        user.id,
        duplicate.id,
        options,
      )
      if (processing.status === 'ready') {
        autoAdded = await autoAddFromDocument(
          c.env.DB,
          user.id,
          duplicate.id,
          options.timezoneOffsetMinutes ?? 0,
        )
      }
    }
    const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND user_id = ?`)
      .bind(duplicate.id, user.id)
      .first()
    return c.json(
      {
        duplicate: true,
        document: mapDoc(row!),
        ...(processing ? { processing, autoAdded } : {}),
        suggestions: await pendingSuggestions(c.env.DB, user.id, duplicate.id),
        message: processing
          ? 'You’ve given me this one before, so I read it again.'
          : duplicate.retention === 'keep'
            ? 'You’ve already saved this document.'
            : 'You’ve already given me this one — here’s what I found.',
      },
      200,
    )
  }

  if (mode === 'keep') {
    // Only deliberately kept documents count towards the allowance.
    const quota = storageQuotaBytesFor(access.plan, settings)
    const used = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(byte_size), 0) as bytes FROM documents
       WHERE user_id = ? AND retention = 'keep'`,
    )
      .bind(user.id)
      .first<{ bytes: number }>()
    if ((used?.bytes ?? 0) + bytes.byteLength > quota) {
      return c.json(
        {
          error: `Saving this would go over your document storage allowance (${Math.round(quota / (1024 * 1024))} MB). You can still use “Just sort it”, which doesn’t keep the file.`,
        },
        413,
      )
    }
  } else {
    // Fair use for process-and-forget.
    const pending = await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM documents WHERE user_id = ? AND retention = 'temporary'`,
    )
      .bind(user.id)
      .first<{ n: number }>()
    if (Number(pending?.n ?? 0) >= MAX_PENDING_TEMPORARY) {
      return c.json(
        {
          error: `You have ${MAX_PENDING_TEMPORARY} documents waiting for review. Finish or cancel some first.`,
        },
        429,
      )
    }
  }
  const today = new Date().toISOString().slice(0, 10)
  const processedToday = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM ai_events
     WHERE user_id = ? AND feature = 'document' AND created_at >= ?`,
  )
    .bind(user.id, today)
    .first<{ n: number }>()
  if (
    Number(processedToday?.n ?? 0) >= DAILY_DOCUMENT_PROCESSING[access.plan]
  ) {
    return c.json(
      {
        error:
          'That’s a lot of paperwork for one day! The goblin needs a rest — try again tomorrow.',
      },
      429,
    )
  }

  // Record first, store second: an interrupted upload leaves a row with an
  // expiry that the sweep cleans up, never an untracked file.
  const id = newId('doc')
  const now = Date.now()
  const storageKey =
    mode === 'keep'
      ? keptKey(user.id, id, validated.safeName)
      : temporaryKey(user.id, id)
  const expiresAt = new Date(
    now + (mode === 'keep' ? UPLOAD_GRACE_MS : TEMPORARY_TTL_MS),
  ).toISOString()
  await c.env.DB.prepare(
    `INSERT INTO documents
      (id, user_id, display_name, storage_key, mime_type, byte_size, sha256,
       status, retention, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', ?, ?)`,
  )
    .bind(
      id,
      user.id,
      validated.safeName,
      storageKey,
      validated.mime,
      bytes.byteLength,
      hash,
      mode,
      expiresAt,
    )
    .run()
  try {
    await getObjectStore(c.env).put(storageKey, bytes, validated.mime)
  } catch {
    await c.env.DB.prepare(`DELETE FROM documents WHERE id = ? AND user_id = ?`)
      .bind(id, user.id)
      .run()
    return c.json(
      { error: 'Upload failed. Nothing was saved — please try again.' },
      502,
    )
  }
  if (mode === 'keep') {
    // Stored safely: kept documents never expire.
    await c.env.DB.prepare(
      `UPDATE documents SET expires_at = NULL WHERE id = ? AND user_id = ?`,
    )
      .bind(id, user.id)
      .run()
  }

  const result = await processDocumentForUser(c.env, user.id, id, options)
  const autoAdded =
    result.status === 'ready'
      ? await autoAddFromDocument(
          c.env.DB,
          user.id,
          id,
          options.timezoneOffsetMinutes ?? 0,
        )
      : { added: 0, already: 0 }
  const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()

  return c.json(
    {
      document: mapDoc(row!),
      processing: result,
      autoAdded,
      suggestions: await pendingSuggestions(c.env.DB, user.id, id),
    },
    201,
  )
})

/** Undo everything the Devourer added on its own from this document. */
documentRoutes.post('/:id/undo-auto', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const doc = await c.env.DB.prepare(
    `SELECT 1 FROM documents WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first()
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  const undone = await undoAutoAdd(c.env.DB, user.id, id)
  return c.json({
    undone,
    suggestions: await pendingSuggestions(c.env.DB, user.id, id),
  })
})

/**
 * "Just sort it" done: forget the original and everything derived from it.
 * Approved tasks, reminders and calendar entries are untouched.
 */
documentRoutes.post('/:id/finish', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const doc = await c.env.DB.prepare(
    `SELECT retention FROM documents WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first<{ retention: string }>()
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  if (doc.retention !== 'temporary') {
    return c.json(
      { error: 'This document is saved. Delete it from your vault instead.' },
      409,
    )
  }
  const accepted = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM review_items
     WHERE user_id = ? AND source_type = 'document' AND source_id = ? AND status = 'accepted'`,
  )
    .bind(user.id, id)
    .first<{ n: number }>()
  await forgetDocument(c.env, user.id, id)
  return c.json({ devoured: true, saved: Number(accepted?.n ?? 0) })
})

/** Changed their mind: keep the original after all (counts towards allowance). */
documentRoutes.post('/:id/keep', async (c) => {
  const user = c.get('user')
  const id = c.req.param('id')
  const doc = await c.env.DB.prepare(
    `SELECT storage_key as storageKey, display_name as displayName, mime_type as mimeType,
            byte_size as byteSize, retention, status
     FROM documents WHERE id = ? AND user_id = ?`,
  )
    .bind(id, user.id)
    .first<{
      storageKey: string
      displayName: string
      mimeType: string
      byteSize: number
      retention: string
      status: string
    }>()
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  if (doc.retention === 'keep') return c.json({ ok: true })
  const access = await loadAccess(c.env.DB, user.id)
  const settings = await loadPlatformSettings(c.env.DB, c.env)
  const quota = storageQuotaBytesFor(access.plan, settings)
  const used = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(byte_size), 0) as bytes FROM documents
     WHERE user_id = ? AND retention = 'keep'`,
  )
    .bind(user.id)
    .first<{ bytes: number }>()
  if ((used?.bytes ?? 0) + doc.byteSize > quota) {
    return c.json(
      {
        error: `Saving this would go over your document storage allowance (${Math.round(quota / (1024 * 1024))} MB).`,
      },
      413,
    )
  }
  const store = getObjectStore(c.env)
  const obj = await store.get(doc.storageKey)
  if (!obj) {
    return c.json(
      { error: 'The original has already been removed, so it can’t be kept.' },
      410,
    )
  }
  const bytes =
    obj.body instanceof ArrayBuffer
      ? new Uint8Array(obj.body)
      : new Uint8Array(await new Response(obj.body).arrayBuffer())
  const newKey = keptKey(user.id, id, doc.displayName)
  await store.put(newKey, bytes, doc.mimeType)
  await c.env.DB.prepare(
    `UPDATE documents SET retention = 'keep', storage_key = ?, expires_at = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(newKey, id, user.id)
    .run()
  await store.delete(doc.storageKey).catch(() => undefined)
  const row = await c.env.DB.prepare(`${SELECT} WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .first()
  return c.json({ document: mapDoc(row!) })
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
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const result = await processDocumentForUser(
    c.env,
    user.id,
    id,
    processOptions(body),
  )
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

  const linkedTaskId =
    typeof body?.linkedTaskId === 'string' ? body.linkedTaskId : null
  const linkedEventId =
    typeof body?.linkedEventId === 'string' ? body.linkedEventId : null
  const linkedReminderId =
    typeof body?.linkedReminderId === 'string' ? body.linkedReminderId : null
  const unowned = await firstUnownedLink(c.env.DB, user.id, [
    { kind: 'task', id: linkedTaskId },
    { kind: 'event', id: linkedEventId },
    { kind: 'reminder', id: linkedReminderId },
  ])
  if (unowned) return c.json(linkNotFound(unowned), 404)

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
      linkedTaskId,
      linkedEventId,
      linkedReminderId,
      id,
      user.id,
    )
    .run()

  if (linkedTaskId) {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO record_links
        (id, user_id, from_type, from_id, to_type, to_id, reason)
       VALUES (?, ?, 'document', ?, 'task', ?, 'User linked')`,
    )
      .bind(newId('link'), user.id, id, linkedTaskId)
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
  if (!(await forgetDocument(c.env, user.id, id))) {
    return c.json({ error: 'Document not found' }, 404)
  }
  return c.json({ ok: true })
})
