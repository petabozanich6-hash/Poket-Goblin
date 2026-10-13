import { newId } from './ids'

export type JobType =
  'document_extract' | 'email_sync' | 'calendar_sync' | 'interpret'

export async function enqueueJob(
  db: D1Database,
  userId: string,
  jobType: JobType,
  subjectId: string | null,
  idempotencyKey: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .prepare(
      `SELECT id, status FROM processing_jobs
       WHERE user_id = ? AND idempotency_key = ?`,
    )
    .bind(userId, idempotencyKey)
    .first<{ id: string; status: string }>()
  if (existing) {
    return { id: existing.id, created: false }
  }
  const id = newId('job')
  await db
    .prepare(
      `INSERT INTO processing_jobs
        (id, user_id, job_type, subject_id, status, idempotency_key)
       VALUES (?, ?, ?, ?, 'queued', ?)`,
    )
    .bind(id, userId, jobType, subjectId, idempotencyKey)
    .run()
  return { id, created: true }
}

export async function markJob(
  db: D1Database,
  userId: string,
  jobId: string,
  status: 'running' | 'succeeded' | 'failed',
  lastError: string | null = null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE processing_jobs SET
        status = ?,
        last_error = ?,
        attempts = attempts + CASE WHEN ? = 'running' THEN 1 ELSE 0 END,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
    )
    .bind(status, lastError, status, jobId, userId)
    .run()
}
