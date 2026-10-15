import { newId } from './ids'

export type AuditEntry = {
  actorUserId: string | null
  actorLabel: string
  action: string
  targetType?: string
  targetId?: string
  detail?: Record<string, unknown>
}

/** Record an administrative change. Never include secrets or customer content. */
export async function writeAudit(db: D1Database, entry: AuditEntry) {
  await db
    .prepare(
      `INSERT INTO admin_audit_log
        (id, actor_user_id, actor_label, action, target_type, target_id, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('audit'),
      entry.actorUserId,
      entry.actorLabel,
      entry.action,
      entry.targetType ?? '',
      entry.targetId ?? '',
      JSON.stringify(entry.detail ?? {}),
    )
    .run()
}

export type SecurityEventType =
  | 'login_success'
  | 'login_failed'
  | 'login_blocked_suspended'
  | 'logout'
  | 'account_suspended'
  | 'account_restored'
  | 'sessions_revoked'
  | 'passkey_registered'
  | 'passkey_removed'
  | 'step_up_success'
  | 'step_up_failed'
  | 'reauth_failed'
  | 'password_reset_requested'
  | 'password_reset'
  | 'password_changed'
  | 'email_verified'
  | 'calendar_feed_created'
  | 'calendar_feed_revoked'
  | 'data_exported'

/** Per-account security metadata. Failures here never break the request. */
export async function recordSecurityEvent(
  db: D1Database,
  userId: string,
  type: SecurityEventType,
  detail = '',
) {
  try {
    await db
      .prepare(
        `INSERT INTO security_events (id, user_id, event_type, detail)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(newId('sev'), userId, type, detail.slice(0, 200))
      .run()
  } catch (error) {
    console.error('security event not recorded', error)
  }
}
