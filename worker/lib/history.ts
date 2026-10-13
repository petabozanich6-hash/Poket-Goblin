import { newId } from './ids'

export async function recordTaskHistory(
  db: D1Database,
  userId: string,
  taskId: string,
  action: string,
  detail = '',
) {
  await db
    .prepare(
      `INSERT INTO task_history (id, user_id, task_id, action, detail)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(newId('thist'), userId, taskId, action, detail)
    .run()
}
