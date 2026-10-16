/**
 * Per-user Goblin personalisation and expressions. Every query is scoped by
 * the authenticated user's id; nothing here is shared between accounts.
 */
import {
  DEFAULT_PROFILE,
  LIMITS,
  type GoblinExpression,
  type GoblinProfile,
} from '../../../shared/goblin/profile'
import { newId } from '../ids'

type ProfileRow = {
  name: string
  aliasesJson: string
  style: GoblinProfile['style']
  humour: GoblinProfile['humour']
  replyLength: GoblinProfile['replyLength']
  speakReplies: number
  voiceName: string
  speechRate: number
  speechVolume: number
  language: string
  listenMode: GoblinProfile['listenMode']
  speechNoticeAt: string | null
}

function parseAliases(json: string): string[] {
  try {
    const value = JSON.parse(json) as unknown
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string').slice(0, LIMITS.aliases)
      : []
  } catch {
    return []
  }
}

export async function loadProfile(
  db: D1Database,
  userId: string,
): Promise<GoblinProfile> {
  const row = await db
    .prepare(
      `SELECT name, aliases_json as aliasesJson, style, humour, reply_length as replyLength,
              speak_replies as speakReplies, voice_name as voiceName, speech_rate as speechRate,
              speech_volume as speechVolume, language, listen_mode as listenMode,
              speech_notice_at as speechNoticeAt
       FROM goblin_profiles WHERE user_id = ?`,
    )
    .bind(userId)
    .first<ProfileRow>()
  if (!row) return { ...DEFAULT_PROFILE }
  return {
    name: row.name || DEFAULT_PROFILE.name,
    aliases: parseAliases(row.aliasesJson),
    style: row.style,
    humour: row.humour,
    replyLength: row.replyLength,
    speakReplies: Boolean(row.speakReplies),
    voiceName: row.voiceName,
    speechRate: row.speechRate,
    speechVolume: row.speechVolume,
    language: row.language,
    listenMode: row.listenMode,
    speechNoticeAt: row.speechNoticeAt,
  }
}

export async function saveProfile(
  db: D1Database,
  userId: string,
  patch: Partial<GoblinProfile>,
): Promise<GoblinProfile> {
  const next = { ...(await loadProfile(db, userId)), ...patch }
  await db
    .prepare(
      `INSERT INTO goblin_profiles (user_id, name, aliases_json, style, humour, reply_length,
         speak_replies, voice_name, speech_rate, speech_volume, language, listen_mode,
         speech_notice_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(user_id) DO UPDATE SET
         name = excluded.name, aliases_json = excluded.aliases_json, style = excluded.style,
         humour = excluded.humour, reply_length = excluded.reply_length,
         speak_replies = excluded.speak_replies, voice_name = excluded.voice_name,
         speech_rate = excluded.speech_rate, speech_volume = excluded.speech_volume,
         language = excluded.language, listen_mode = excluded.listen_mode,
         speech_notice_at = excluded.speech_notice_at, updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      next.name,
      JSON.stringify(next.aliases),
      next.style,
      next.humour,
      next.replyLength,
      next.speakReplies ? 1 : 0,
      next.voiceName,
      next.speechRate,
      next.speechVolume,
      next.language,
      next.listenMode,
      next.speechNoticeAt,
    )
    .run()
  return next
}

/** Forget every personalisation: profile, expressions and context. */
export async function resetPersonalisation(db: D1Database, userId: string) {
  await db.batch([
    db.prepare(`DELETE FROM goblin_profiles WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM goblin_expressions WHERE user_id = ?`).bind(userId),
    db.prepare(`DELETE FROM goblin_context WHERE user_id = ?`).bind(userId),
  ])
}

export async function listExpressions(
  db: D1Database,
  userId: string,
): Promise<GoblinExpression[]> {
  const rows = await db
    .prepare(
      `SELECT id, phrase, meaning, created_at as createdAt FROM goblin_expressions
       WHERE user_id = ? ORDER BY created_at ASC LIMIT ?`,
    )
    .bind(userId, LIMITS.expressions)
    .all<GoblinExpression>()
  return rows.results ?? []
}

export async function addExpression(
  db: D1Database,
  userId: string,
  phrase: string,
  meaning: string,
): Promise<{ ok: true; expression: GoblinExpression } | { ok: false; error: string }> {
  const existing = await listExpressions(db, userId)
  if (existing.length >= LIMITS.expressions)
    return { ok: false, error: `Up to ${LIMITS.expressions} expressions.` }
  if (existing.some((e) => e.phrase.toLowerCase() === phrase.toLowerCase()))
    return { ok: false, error: 'You already taught me that phrase — edit it instead.' }
  const id = newId('gexp')
  await db
    .prepare(
      `INSERT INTO goblin_expressions (id, user_id, phrase, meaning) VALUES (?, ?, ?, ?)`,
    )
    .bind(id, userId, phrase, meaning)
    .run()
  return {
    ok: true,
    expression: { id, phrase, meaning, createdAt: new Date().toISOString() },
  }
}

export async function updateExpression(
  db: D1Database,
  userId: string,
  id: string,
  phrase: string,
  meaning: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE goblin_expressions SET phrase = ?, meaning = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ? AND user_id = ?`,
    )
    .bind(phrase, meaning, id, userId)
    .run()
  return res.meta.changes === 1
}

export async function deleteExpression(
  db: D1Database,
  userId: string,
  id: string,
): Promise<boolean> {
  const res = await db
    .prepare(`DELETE FROM goblin_expressions WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run()
  return res.meta.changes === 1
}
