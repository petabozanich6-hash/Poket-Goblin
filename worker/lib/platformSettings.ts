/**
 * Owner-managed platform settings, stored in D1 (`platform_settings`).
 *
 * Every key has a strict validator, a default that preserves today's
 * behaviour, and hard limits. Secrets never live here: Cloudflare secrets
 * (AUTH_SECRET, AI_API_KEY, …) are neither readable nor writable through
 * these settings.
 */
import type { Env } from '../env'
import type { Plan } from './access'

export type Announcement = {
  enabled: boolean
  message: string
  tone: 'info' | 'warning'
}
export type Maintenance = { enabled: boolean; message: string }
export type FeatureFlags = {
  registrationsOpen: boolean
  documentUploads: boolean
  /** Master switch for calls to the paid AI provider (rules keep working). */
  aiProvider: boolean
}
export type AiLimits = { free: number; premium: number; owner: number }
export type StorageQuotas = {
  freeMb: number
  premiumMb: number
  ownerMb: number
}

export type PlatformSettings = {
  announcement: Announcement
  maintenance: Maintenance
  features: FeatureFlags
  aiLimits: AiLimits
  storageQuotas: StorageQuotas
}
export type SettingKey = keyof PlatformSettings
export const SETTING_KEYS: readonly SettingKey[] = [
  'announcement',
  'maintenance',
  'features',
  'aiLimits',
  'storageQuotas',
]

/** Hard ceilings no administrative update may exceed. */
export const LIMITS = {
  messageLength: 280,
  aiDailyMax: 500,
  /** Above this, an AI limit counts as a high-cost change. */
  aiDailyHighImpact: 100,
  storageMbMax: 51_200,
  /** Above this, a storage quota counts as a high-cost change. */
  storageMbHighImpact: 5_120,
} as const

function envAiDefault(env: Env): number {
  const n = env.AI_DAILY_USER_LIMIT ? Number(env.AI_DAILY_USER_LIMIT) : 40
  return Number.isFinite(n) && n > 0
    ? Math.min(Math.floor(n), LIMITS.aiDailyMax)
    : 40
}

export function defaultSettings(env: Env): PlatformSettings {
  const ai = envAiDefault(env)
  return {
    announcement: { enabled: false, message: '', tone: 'info' },
    maintenance: { enabled: false, message: '' },
    features: {
      registrationsOpen: true,
      documentUploads: true,
      aiProvider: true,
    },
    aiLimits: { free: ai, premium: ai, owner: Math.max(ai, 200) },
    // Kept documents only; "Just sort it" files never count.
    storageQuotas: { freeMb: 100, premiumMb: 1_024, ownerMb: 5_120 },
  }
}

// ---------------------------------------------------------------- validation

type Result<T> = { ok: true; value: T } | { ok: false; error: string }

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function onlyKeys(v: Record<string, unknown>, keys: string[]): string | null {
  const extra = Object.keys(v).filter((k) => !keys.includes(k))
  return extra.length ? `Unknown field: ${extra[0]}` : null
}

function bool(v: unknown, name: string): Result<boolean> {
  return typeof v === 'boolean'
    ? { ok: true, value: v }
    : { ok: false, error: `${name} must be true or false` }
}

function int(
  v: unknown,
  name: string,
  min: number,
  max: number,
): Result<number> {
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    return { ok: false, error: `${name} must be a whole number` }
  }
  if (v < min || v > max) {
    return { ok: false, error: `${name} must be between ${min} and ${max}` }
  }
  return { ok: true, value: v }
}

function message(v: unknown, name: string): Result<string> {
  if (typeof v !== 'string') return { ok: false, error: `${name} must be text` }
  const trimmed = v.trim()
  if (trimmed.length > LIMITS.messageLength) {
    return {
      ok: false,
      error: `${name} must be ${LIMITS.messageLength} characters or fewer`,
    }
  }
  // Plain text only: rendered as text by React, but refuse markup anyway.
  if (/[<>]/.test(trimmed)) {
    return { ok: false, error: `${name} cannot contain < or >` }
  }
  return { ok: true, value: trimmed }
}

export function validateSetting<K extends SettingKey>(
  key: K,
  raw: unknown,
): Result<PlatformSettings[K]> {
  if (!isObject(raw)) return { ok: false, error: 'Value must be an object' }
  const fail = (error: string) => ({ ok: false as const, error })

  switch (key) {
    case 'announcement': {
      const extra = onlyKeys(raw, ['enabled', 'message', 'tone'])
      if (extra) return fail(extra)
      const enabled = bool(raw.enabled, 'enabled')
      if (!enabled.ok) return enabled
      const msg = message(raw.message, 'message')
      if (!msg.ok) return msg
      if (raw.tone !== 'info' && raw.tone !== 'warning') {
        return fail('tone must be info or warning')
      }
      if (enabled.value && !msg.value) {
        return fail('An enabled announcement needs a message')
      }
      const value: Announcement = {
        enabled: enabled.value,
        message: msg.value,
        tone: raw.tone,
      }
      return { ok: true, value: value as PlatformSettings[K] }
    }
    case 'maintenance': {
      const extra = onlyKeys(raw, ['enabled', 'message'])
      if (extra) return fail(extra)
      const enabled = bool(raw.enabled, 'enabled')
      if (!enabled.ok) return enabled
      const msg = message(raw.message, 'message')
      if (!msg.ok) return msg
      if (enabled.value && !msg.value) {
        return fail('Maintenance messaging needs a message')
      }
      const value: Maintenance = { enabled: enabled.value, message: msg.value }
      return { ok: true, value: value as PlatformSettings[K] }
    }
    case 'features': {
      const keys = ['registrationsOpen', 'documentUploads', 'aiProvider']
      const extra = onlyKeys(raw, keys)
      if (extra) return fail(extra)
      const out: Record<string, boolean> = {}
      for (const k of keys) {
        const b = bool(raw[k], k)
        if (!b.ok) return b
        out[k] = b.value
      }
      return { ok: true, value: out as PlatformSettings[K] }
    }
    case 'aiLimits': {
      const keys = ['free', 'premium', 'owner']
      const extra = onlyKeys(raw, keys)
      if (extra) return fail(extra)
      const out: Record<string, number> = {}
      for (const k of keys) {
        const n = int(raw[k], k, 0, LIMITS.aiDailyMax)
        if (!n.ok) return n
        out[k] = n.value
      }
      return { ok: true, value: out as PlatformSettings[K] }
    }
    case 'storageQuotas': {
      const keys = ['freeMb', 'premiumMb', 'ownerMb']
      const extra = onlyKeys(raw, keys)
      if (extra) return fail(extra)
      const out: Record<string, number> = {}
      for (const k of keys) {
        const n = int(raw[k], k, 0, LIMITS.storageMbMax)
        if (!n.ok) return n
        out[k] = n.value
      }
      return { ok: true, value: out as PlatformSettings[K] }
    }
  }
  return fail('Unknown setting')
}

export function isSettingKey(value: string): value is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(value)
}

/**
 * Changes that could raise costs or expose the platform and therefore need
 * an explicit confirmation from the Owner. Returns human-readable reasons.
 */
export function highImpactReasons<K extends SettingKey>(
  key: K,
  current: PlatformSettings[K],
  next: PlatformSettings[K],
): string[] {
  const reasons: string[] = []
  if (key === 'aiLimits') {
    const c = current as AiLimits
    const n = next as AiLimits
    for (const k of ['free', 'premium', 'owner'] as const) {
      if (n[k] > c[k] && n[k] > LIMITS.aiDailyHighImpact) {
        reasons.push(
          `Raises the ${k} AI limit above ${LIMITS.aiDailyHighImpact} requests per day`,
        )
      }
    }
  }
  if (key === 'storageQuotas') {
    const c = current as StorageQuotas
    const n = next as StorageQuotas
    for (const k of ['freeMb', 'premiumMb', 'ownerMb'] as const) {
      if (n[k] > c[k] && n[k] > LIMITS.storageMbHighImpact) {
        reasons.push(
          `Raises the ${k.replace('Mb', '')} storage quota above ${LIMITS.storageMbHighImpact} MB`,
        )
      }
    }
  }
  if (key === 'features') {
    const c = current as FeatureFlags
    const n = next as FeatureFlags
    if (!c.aiProvider && n.aiProvider) {
      reasons.push('Turns paid AI provider calls back on')
    }
    if (c.registrationsOpen && !n.registrationsOpen) {
      reasons.push('Stops new customers from registering')
    }
  }
  return reasons
}

// ------------------------------------------------------------------- storage

export async function loadPlatformSettings(
  db: D1Database,
  env: Env,
): Promise<PlatformSettings> {
  const defaults = defaultSettings(env)
  const rows = await db
    .prepare(`SELECT key, value_json as valueJson FROM platform_settings`)
    .all<{ key: string; valueJson: string }>()
  const merged: PlatformSettings = { ...defaults }
  for (const row of rows.results ?? []) {
    if (!isSettingKey(row.key)) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(row.valueJson)
    } catch {
      continue
    }
    const checked = validateSetting(row.key, parsed)
    // An invalid stored value falls back to the safe default.
    if (checked.ok) {
      ;(merged as Record<SettingKey, unknown>)[row.key] = checked.value
    }
  }
  return merged
}

export async function saveSetting<K extends SettingKey>(
  db: D1Database,
  key: K,
  value: PlatformSettings[K],
  updatedBy: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO platform_settings (key, value_json, updated_by, updated_at)
       VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(key) DO UPDATE SET
         value_json = excluded.value_json,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
    )
    .bind(key, JSON.stringify(value), updatedBy)
    .run()
}

// --------------------------------------------------------------- plan limits

export function aiDailyLimitFor(
  plan: Plan,
  settings: PlatformSettings,
): number {
  if (plan === 'owner_premium') return settings.aiLimits.owner
  if (plan === 'premium') return settings.aiLimits.premium
  return settings.aiLimits.free
}

export function storageQuotaBytesFor(
  plan: Plan,
  settings: PlatformSettings,
): number {
  const mb =
    plan === 'owner_premium'
      ? settings.storageQuotas.ownerMb
      : plan === 'premium'
        ? settings.storageQuotas.premiumMb
        : settings.storageQuotas.freeMb
  return mb * 1024 * 1024
}
