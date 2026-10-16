import type { ScheduledSession } from '../../../shared/documents/pathwayScheduler'
import { newId } from '../ids'

/**
 * Save an already verified pathway in one D1 transaction.
 * Do not call this with client-supplied sessions: the approval route must
 * recompute and validate the proposal against the user's current workload.
 */
export async function persistApprovedPathway(
  db: D1Database,
  userId: string,
  documentId: string,
  sessions: ScheduledSession[],
  stepDeadlines: ReadonlyMap<string, string> = new Map(),
) {
  if (!sessions.length || sessions.length > 500) {
    throw new Error('A pathway needs between 1 and 500 sessions')
  }
  const existing = await db
    .prepare(
      "SELECT id FROM study_pathways WHERE user_id = ? AND document_id = ? AND status = 'active'",
    )
    .bind(userId, documentId)
    .first<{ id: string }>()
  if (existing) return { id: existing.id, alreadySaved: true }

  const pathwayId = newId('pathway')
  const statements = [
    db
      .prepare(
        `INSERT INTO study_pathways (id, user_id, document_id)
       VALUES (?, ?, ?)`,
      )
      .bind(pathwayId, userId, documentId),
  ]
  for (const session of sessions) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(session.date) ||
      !Number.isFinite(Date.parse(session.date + 'T00:00:00Z')) ||
      new Date(session.date + 'T00:00:00Z').toISOString().slice(0, 10) !==
        session.date ||
      !Number.isInteger(session.minutes) ||
      session.minutes < 1 ||
      session.minutes > 240 ||
      !Number.isInteger(session.sequence) ||
      session.sequence < 1 ||
      !session.stepId ||
      !session.title.trim()
    ) {
      throw new Error('Invalid pathway session')
    }
    const deadline = stepDeadlines.get(session.stepId)
    if (
      deadline !== undefined &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) ||
        !Number.isFinite(Date.parse(deadline + 'T00:00:00Z')) ||
        new Date(deadline + 'T00:00:00Z').toISOString().slice(0, 10) !==
          deadline ||
        session.date > deadline)
    ) {
      throw new Error('Invalid original assessment deadline')
    }
    const match = session.stepId.match(/^[^:]+:(\d+):/)
    const stepOrder = match ? Number(match[1]) : null
    const taskId = newId('task')
    const sessionId = newId('session')
    statements.push(
      db
        .prepare(
          `INSERT INTO tasks
          (id, user_id, title, notes, priority, due_date, capacity_cost)
         VALUES (?, ?, ?, ?, 'normal', ?, 1)`,
        )
        .bind(
          taskId,
          userId,
          session.title.slice(0, 200),
          `Pocket Goblin approved study session · ${session.minutes} min · pathway ${pathwayId}`,
          session.date,
        ),
      db
        .prepare(
          `INSERT INTO study_pathway_sessions
          (id, pathway_id, user_id, step_id, title, scheduled_date, minutes,
           sequence, task_id, deadline_date, goal_id, step_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          sessionId,
          pathwayId,
          userId,
          session.stepId,
          session.title.slice(0, 200),
          session.date,
          session.minutes,
          session.sequence,
          taskId,
          deadline ?? null,
          session.goalId,
          Number.isFinite(Number(session.stepId.match(/^.+?:(\\d+):/)?.[1]))
            ? Number(session.stepId.match(/^.+?:(\\d+):/)?.[1])
            : null,
        ),
    )
  }
  // D1 batch runs in a single transaction; failure rolls back every write.
  await db.batch(statements)
  return { id: pathwayId, alreadySaved: false }
}
