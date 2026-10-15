/**
 * Read a document, understand it, and turn it into reviewable suggestions.
 *
 * - Text comes from text files, Word (.docx) and PDFs. Photos and scans need
 *   a vision-capable AI provider; without one the goblin says so plainly.
 * - AI is used when configured, enabled and under the user's daily limit;
 *   otherwise (or if it fails or returns junk) the deterministic reader runs.
 * - Nothing is written to tasks/reminders/calendar here: suggestions wait in
 *   review_items until the user approves them.
 * - Temporary ("Just sort it") documents never have their text stored, and a
 *   failure deletes their original immediately.
 */
import { extractText } from '../../../shared/documents/binaryText'
import {
  understandDocument,
  withDeadlinePlan,
  type DocumentUnderstanding,
} from '../../../shared/documents/understand'
import { userLocalNow } from '../../../shared/intelligence/grounding'
import type { Env } from '../../env'
import { WorkersAiBlockedError } from '../intelligence/workersAi'
import { newId } from '../ids'
import { resolveProvider } from '../intelligence/provider'
import {
  assertUnderLimit,
  loadAiPolicy,
  recordAiEvent,
  recordUsage,
} from '../intelligence/usage'
import { enqueueJob, markJob } from '../jobs'
import { getObjectStore } from '../storage'
import {
  callDocumentAi,
  validateDocumentAi,
  type FetchLike,
} from './aiDocument'
import { deleteOriginal } from './lifecycle'

export type ProcessOptions = {
  timezoneOffsetMinutes?: number
  monthFirst?: boolean
  fetchImpl?: FetchLike
  now?: Date
}

export type ProcessResult = {
  status: 'ready' | 'needs_ocr' | 'failed'
  documentType: string | null
  summary: string
  warnings: string[]
  mode: 'ai' | 'rules' | 'unreadable'
}

const UNREADABLE_SUMMARY =
  'I can’t read photos or scanned pages yet, so I couldn’t pull anything out of this one. A PDF with selectable text, a Word file or a text file works best.'

async function readBytes(env: Env, storageKey: string): Promise<Uint8Array> {
  const obj = await getObjectStore(env).get(storageKey)
  if (!obj) throw new Error('Stored file missing')
  return obj.body instanceof ArrayBuffer
    ? new Uint8Array(obj.body)
    : new Uint8Array(await new Response(obj.body).arrayBuffer())
}

export async function processDocumentForUser(
  env: Env,
  userId: string,
  documentId: string,
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const doc = await env.DB.prepare(
    `SELECT id, storage_key as storageKey, mime_type as mimeType,
            display_name as displayName, retention
     FROM documents WHERE id = ? AND user_id = ?`,
  )
    .bind(documentId, userId)
    .first<{
      id: string
      storageKey: string
      mimeType: string
      displayName: string
      retention: 'keep' | 'temporary'
    }>()
  if (!doc) throw new Error('Document not found')
  const temporary = doc.retention === 'temporary'

  const { id: jobId } = await enqueueJob(
    env.DB,
    userId,
    'document_extract',
    documentId,
    `document_extract:${documentId}:${Date.now()}`,
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
    const bytes = await readBytes(env, doc.storageKey)
    const extracted = await extractText(bytes, doc.mimeType)
    const now = options.now ?? new Date()
    const local = userLocalNow(options.timezoneOffsetMinutes ?? 0, now)
    const today = local.toISOString().slice(0, 10)

    const policy = await loadAiPolicy(env.DB, env, userId)
    const gate = await assertUnderLimit(env.DB, policy, userId)
    const provider = resolveProvider(policy.env)
    const aiReady = provider.configured && gate.ok

    let understanding: Omit<DocumentUnderstanding, 'status'> | null = null
    let mode: ProcessResult['mode'] = 'rules'
    let outcome:
      'ai' | 'ai_unavailable' | 'rules' | 'limit_reached' | 'disabled' =
      !gate.ok ? 'limit_reached' : policy.providerEnabled ? 'rules' : 'disabled'

    const canUseAi =
      aiReady &&
      (extracted.text.length > 0 ||
        (extracted.needsVision && provider.kind === 'openai_compatible'))
    if (canUseAi) {
      let aiCalled = true
      try {
        const raw = await callDocumentAi(
          policy.env,
          extracted.text
            ? { text: extracted.text }
            : { image: bytes, mime: doc.mimeType },
          today,
          options.fetchImpl,
        )
        const validated = validateDocumentAi(raw, extracted.text || null, local)
        if (validated) {
          understanding = { ...validated, facts: [] }
          mode = 'ai'
          outcome = 'ai'
        } else {
          outcome = 'ai_unavailable'
        }
      } catch (error) {
        aiCalled = !(error instanceof WorkersAiBlockedError)
        outcome = 'ai_unavailable'
      }
      if (aiCalled) await recordUsage(env.DB, userId, provider.kind)
    }

    if (!understanding && extracted.text) {
      understanding = understandDocument(extracted.text, doc.displayName, {
        reference: local,
        monthFirst: options.monthFirst,
      })
      if (outcome === 'ai_unavailable') {
        understanding.warnings.push(
          'The AI reader had a problem, so the built-in goblin read it instead.',
        )
      }
    }
    if (understanding && extracted.text) {
      understanding = withDeadlinePlan(understanding, extracted.text, {
        reference: local,
        monthFirst: options.monthFirst,
      })
    }
    await recordAiEvent(
      env.DB,
      userId,
      'document',
      canUseAi ? provider.kind : 'rules',
      outcome,
    )

    if (!understanding) {
      // Nothing readable and no vision model: say so, keep nothing extra.
      if (temporary) await deleteOriginal(env, doc.storageKey)
      await env.DB.prepare(
        `UPDATE documents SET status = 'needs_ocr', extracted_text = '',
          document_type = 'general', goblin_summary = ?, processing_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND user_id = ?`,
      )
        .bind(UNREADABLE_SUMMARY, documentId, userId)
        .run()
      await markJob(
        env.DB,
        userId,
        jobId,
        'succeeded',
        'Unreadable without vision',
      )
      return {
        status: 'needs_ocr',
        documentType: 'general',
        summary: UNREADABLE_SUMMARY,
        warnings: [],
        mode: 'unreadable',
      }
    }

    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM document_extractions WHERE document_id = ? AND user_id = ?`,
      ).bind(documentId, userId),
      env.DB.prepare(
        `DELETE FROM review_items
         WHERE user_id = ? AND source_type = 'document' AND source_id = ?
           AND status IN ('pending', 'snoozed', 'edited')`,
      ).bind(userId, documentId),
    ])

    const statements: D1PreparedStatement[] = []
    // Facts are only kept for documents the user chose to keep.
    if (!temporary) {
      for (const fact of understanding.facts) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO document_extractions
              (id, document_id, user_id, kind, label, value, confidence, source_excerpt)
             VALUES (?, ?, ?, 'fact', ?, ?, ?, ?)`,
          ).bind(
            newId('dext'),
            documentId,
            userId,
            fact.label,
            fact.value,
            fact.confidence,
            fact.sourceExcerpt,
          ),
        )
      }
    }
    for (const suggestion of understanding.suggestions) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO review_items
            (id, user_id, source_type, source_id, title, summary, suggestion_type,
             payload_json, uncertain)
           VALUES (?, ?, 'document', ?, ?, ?, ?, ?, ?)`,
        ).bind(
          newId('rev'),
          userId,
          documentId,
          suggestion.title,
          suggestion.details,
          suggestion.type,
          JSON.stringify(suggestion),
          suggestion.uncertain ? 1 : 0,
        ),
      )
    }
    statements.push(
      env.DB.prepare(
        `UPDATE documents SET
          status = 'ready', extracted_text = ?, category_slug = ?,
          document_type = ?, goblin_summary = ?, processing_error = NULL,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND user_id = ?`,
      ).bind(
        temporary ? '' : extracted.text.slice(0, 50_000),
        understanding.categorySlug,
        understanding.documentType,
        understanding.summary,
        documentId,
        userId,
      ),
    )
    await env.DB.batch(statements)
    await markJob(env.DB, userId, jobId, 'succeeded')
    return {
      status: 'ready',
      documentType: understanding.documentType,
      summary: understanding.summary,
      warnings: understanding.warnings,
      mode,
    }
  } catch (err) {
    // Never echo document content into errors; keep the class of failure.
    const message =
      err instanceof Error && err.message === 'Stored file missing'
        ? 'The file was missing from storage.'
        : 'Something went wrong reading this document.'
    if (temporary) {
      await deleteOriginal(env, doc.storageKey).catch(() => undefined)
    }
    await env.DB.prepare(
      `UPDATE documents SET status = 'failed', processing_error = ?, extracted_text = '',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
    )
      .bind(message, documentId, userId)
      .run()
    await markJob(env.DB, userId, jobId, 'failed', message)
    return {
      status: 'failed',
      documentType: null,
      summary: message,
      warnings: [message],
      mode: 'rules',
    }
  }
}
