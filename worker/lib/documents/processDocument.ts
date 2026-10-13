import {
  extractPlainText,
  interpretDocumentText,
} from '../../../shared/documents/extract'
import { newId } from '../ids'
import { enqueueJob, markJob } from '../jobs'
import { getObjectStore } from '../storage'
import type { Env } from '../../env'

export async function processDocumentForUser(
  env: Env,
  userId: string,
  documentId: string,
): Promise<{ status: string; warnings: string[] }> {
  const doc = await env.DB.prepare(
    `SELECT id, storage_key as storageKey, mime_type as mimeType,
            display_name as displayName, status
     FROM documents WHERE id = ? AND user_id = ?`,
  )
    .bind(documentId, userId)
    .first<{
      id: string
      storageKey: string
      mimeType: string
      displayName: string
      status: string
    }>()
  if (!doc) throw new Error('Document not found')

  const { id: jobId } = await enqueueJob(
    env.DB,
    userId,
    'document_extract',
    documentId,
    `document_extract:${documentId}`,
  )
  await markJob(env.DB, userId, jobId, 'running')

  await env.DB.prepare(
    `UPDATE documents SET status = 'processing',
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(documentId, userId)
    .run()

  try {
    const store = getObjectStore(env)
    const obj = await store.get(doc.storageKey)
    if (!obj) throw new Error('Stored file missing')

    let bytes: Uint8Array
    if (obj.body instanceof ArrayBuffer) {
      bytes = new Uint8Array(obj.body)
    } else {
      const buf = await new Response(obj.body).arrayBuffer()
      bytes = new Uint8Array(buf)
    }

    const extracted = extractPlainText(bytes, doc.mimeType)
    if (extracted.needsOcr && !extracted.text) {
      await env.DB.prepare(
        `UPDATE documents SET status = 'needs_ocr', extracted_text = '',
          processing_error = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND user_id = ?`,
      )
        .bind(
          'OCR is not configured. The file is saved; text extraction needs an OCR provider.',
          documentId,
          userId,
        )
        .run()
      await markJob(
        env.DB,
        userId,
        jobId,
        'succeeded',
        'Needs OCR — file preserved',
      )
      return {
        status: 'needs_ocr',
        warnings: [
          'Scanned/image content needs OCR. File kept safely; no invented text.',
        ],
      }
    }

    // docx without parser
    if (doc.mimeType.includes('word') && !extracted.text) {
      await env.DB.prepare(
        `UPDATE documents SET status = 'ready', extracted_text = '',
          processing_error = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND user_id = ?`,
      )
        .bind(
          'Word text extraction is limited in local mode. Upload a PDF or text file for richer suggestions, or wait for structured DOCX support.',
          documentId,
          userId,
        )
        .run()
      await markJob(env.DB, userId, jobId, 'succeeded')
      return {
        status: 'ready',
        warnings: ['Limited DOCX extraction locally — file stored safely.'],
      }
    }

    const interpreted = interpretDocumentText(extracted.text, doc.displayName)

    await env.DB.prepare(
      `DELETE FROM document_extractions WHERE document_id = ? AND user_id = ?`,
    )
      .bind(documentId, userId)
      .run()

    for (const fact of interpreted.facts) {
      await env.DB.prepare(
        `INSERT INTO document_extractions
          (id, document_id, user_id, kind, label, value, confidence, source_excerpt)
         VALUES (?, ?, ?, 'fact', ?, ?, ?, ?)`,
      )
        .bind(
          newId('dext'),
          documentId,
          userId,
          fact.label,
          fact.value,
          fact.confidence,
          fact.sourceExcerpt,
        )
        .run()
    }

    // Clear prior pending review items for this document
    await env.DB.prepare(
      `DELETE FROM review_items
       WHERE user_id = ? AND source_type = 'document' AND source_id = ?
         AND status = 'pending'`,
    )
      .bind(userId, documentId)
      .run()

    for (const suggestion of interpreted.suggestions) {
      await env.DB.prepare(
        `INSERT INTO document_extractions
          (id, document_id, user_id, kind, label, value, confidence, source_excerpt)
         VALUES (?, ?, ?, 'suggestion', ?, ?, ?, ?)`,
      )
        .bind(
          newId('dext'),
          documentId,
          userId,
          suggestion.type,
          suggestion.title,
          suggestion.confidence,
          suggestion.sourceExcerpt,
        )
        .run()

      await env.DB.prepare(
        `INSERT INTO review_items
          (id, user_id, source_type, source_id, title, summary, suggestion_type,
           payload_json, uncertain)
         VALUES (?, ?, 'document', ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          newId('rev'),
          userId,
          documentId,
          suggestion.title,
          suggestion.details,
          suggestion.type,
          JSON.stringify(suggestion),
          suggestion.uncertain ? 1 : 0,
        )
        .run()
    }

    await env.DB.prepare(
      `UPDATE documents SET
        status = ?,
        extracted_text = ?,
        category_slug = ?,
        processing_error = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        interpreted.status,
        extracted.text.slice(0, 50_000),
        interpreted.categorySlug,
        documentId,
        userId,
      )
      .run()

    await markJob(env.DB, userId, jobId, 'succeeded')
    return { status: interpreted.status, warnings: interpreted.warnings }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Processing failed'
    await env.DB.prepare(
      `UPDATE documents SET status = 'failed', processing_error = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
    )
      .bind(message, documentId, userId)
      .run()
    await markJob(env.DB, userId, jobId, 'failed', message)
    return { status: 'failed', warnings: [message] }
  }
}
