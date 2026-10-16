/**
 * "Get to Know Your Goblin": optional, per-user personalisation. Every field
 * has a sensible default, so nobody has to configure anything to use voice.
 */

export type GoblinStyle = 'friendly' | 'professional' | 'chaotic' | 'quiet'
export type GoblinHumour = 'none' | 'some' | 'lots'
export type GoblinReplyLength = 'short' | 'detailed'
export type ListenMode = 'push' | 'handsfree'

export type GoblinProfile = {
  /** What the person calls their Goblin. Default "Goblin". */
  name: string
  /** Other names it answers to: "Gobbo", "Mr Goblin", "Gerald". */
  aliases: string[]
  style: GoblinStyle
  humour: GoblinHumour
  replyLength: GoblinReplyLength
  /** Read replies aloud with the browser's own speech synthesis. */
  speakReplies: boolean
  /** A browser voice name; falls back to the device default if missing. */
  voiceName: string
  /** 0.5–2 */
  speechRate: number
  /** 0–1 */
  speechVolume: number
  /** BCP-47 tag for speech recognition and voices; '' = the device's language. */
  language: string
  /** Push-to-talk (default) or the optional in-app hands-free session. */
  listenMode: ListenMode
  /** When the person read the speech-processing notice (ISO), or null. */
  speechNoticeAt: string | null
}

export type GoblinExpression = {
  id: string
  phrase: string
  meaning: string
  createdAt: string
}

export const DEFAULT_PROFILE: GoblinProfile = {
  name: 'Goblin',
  aliases: [],
  style: 'friendly',
  humour: 'some',
  replyLength: 'short',
  speakReplies: false,
  voiceName: '',
  speechRate: 1,
  speechVolume: 1,
  language: '',
  listenMode: 'push',
  speechNoticeAt: null,
}

export const STYLE_LABELS: Record<GoblinStyle, { label: string; sample: string }> = {
  friendly: {
    label: 'Friendly',
    sample: 'Morning! One appointment and three things to tackle today.',
  },
  professional: {
    label: 'Professional',
    sample: 'You have one appointment at 10:30 and three remaining tasks.',
  },
  chaotic: {
    label: 'Chaotic',
    sample:
      'GOOD MORNING, HUMAN. One appointment, three tasks, and an alarming amount of misplaced confidence.',
  },
  quiet: { label: 'Quiet', sample: 'One appointment. Three tasks.' },
}

export const LIMITS = {
  name: 40,
  aliases: 8,
  alias: 40,
  expressions: 50,
  phrase: 80,
  meaning: 240,
}

/** Common speech-recognition languages offered in settings. */
export const SPEECH_LANGUAGES: { tag: string; label: string }[] = [
  { tag: '', label: 'Same as this device' },
  { tag: 'en-GB', label: 'English (UK)' },
  { tag: 'en-US', label: 'English (US)' },
  { tag: 'en-AU', label: 'English (Australia)' },
  { tag: 'en-NZ', label: 'English (New Zealand)' },
  { tag: 'en-IE', label: 'English (Ireland)' },
  { tag: 'en-CA', label: 'English (Canada)' },
  { tag: 'en-IN', label: 'English (India)' },
  { tag: 'en-ZA', label: 'English (South Africa)' },
  { tag: 'es-ES', label: 'Español (España)' },
  { tag: 'es-MX', label: 'Español (México)' },
  { tag: 'fr-FR', label: 'Français' },
  { tag: 'de-DE', label: 'Deutsch' },
  { tag: 'it-IT', label: 'Italiano' },
  { tag: 'pt-BR', label: 'Português (Brasil)' },
  { tag: 'pt-PT', label: 'Português (Portugal)' },
  { tag: 'nl-NL', label: 'Nederlands' },
  { tag: 'sv-SE', label: 'Svenska' },
  { tag: 'pl-PL', label: 'Polski' },
  { tag: 'hi-IN', label: 'हिन्दी' },
  { tag: 'ja-JP', label: '日本語' },
  { tag: 'zh-CN', label: '中文 (简体)' },
]

/**
 * Pocket Goblin understands requests in English; other recognition languages
 * transcribe accurately, but the Goblin may not understand the result yet.
 */
export function understandsLanguage(tag: string): boolean {
  return !tag || tag.toLowerCase().startsWith('en')
}

function cleanName(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const v = value.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim()
  if (!v || v.length > max) return null
  return v
}

/** Validate a partial profile update. Unknown or invalid fields are errors. */
export function validateProfilePatch(
  body: Record<string, unknown>,
): { ok: true; patch: Partial<GoblinProfile> } | { ok: false; error: string } {
  const patch: Partial<GoblinProfile> = {}
  if ('name' in body) {
    const name = cleanName(body.name, LIMITS.name)
    if (!name) return { ok: false, error: 'Give your Goblin a name (up to 40 characters).' }
    patch.name = name
  }
  if ('aliases' in body) {
    if (!Array.isArray(body.aliases)) return { ok: false, error: 'Nicknames must be a list.' }
    const aliases: string[] = []
    for (const raw of body.aliases) {
      const alias = cleanName(raw, LIMITS.alias)
      if (!alias) return { ok: false, error: 'Each nickname must be 1–40 characters.' }
      if (!aliases.some((a) => a.toLowerCase() === alias.toLowerCase())) aliases.push(alias)
    }
    if (aliases.length > LIMITS.aliases)
      return { ok: false, error: `Up to ${LIMITS.aliases} nicknames.` }
    patch.aliases = aliases
  }
  if ('style' in body) {
    if (!['friendly', 'professional', 'chaotic', 'quiet'].includes(body.style as string))
      return { ok: false, error: 'Unknown style.' }
    patch.style = body.style as GoblinStyle
  }
  if ('humour' in body) {
    if (!['none', 'some', 'lots'].includes(body.humour as string))
      return { ok: false, error: 'Unknown humour level.' }
    patch.humour = body.humour as GoblinHumour
  }
  if ('replyLength' in body) {
    if (!['short', 'detailed'].includes(body.replyLength as string))
      return { ok: false, error: 'Unknown reply length.' }
    patch.replyLength = body.replyLength as GoblinReplyLength
  }
  if ('speakReplies' in body) {
    if (typeof body.speakReplies !== 'boolean') return { ok: false, error: 'speakReplies must be true or false.' }
    patch.speakReplies = body.speakReplies
  }
  if ('voiceName' in body) {
    if (typeof body.voiceName !== 'string' || body.voiceName.length > 120)
      return { ok: false, error: 'Unknown voice.' }
    patch.voiceName = body.voiceName.trim()
  }
  if ('speechRate' in body) {
    const n = Number(body.speechRate)
    if (!Number.isFinite(n) || n < 0.5 || n > 2) return { ok: false, error: 'Speech rate must be 0.5–2.' }
    patch.speechRate = Math.round(n * 100) / 100
  }
  if ('speechVolume' in body) {
    const n = Number(body.speechVolume)
    if (!Number.isFinite(n) || n < 0 || n > 1) return { ok: false, error: 'Volume must be 0–1.' }
    patch.speechVolume = Math.round(n * 100) / 100
  }
  if ('language' in body) {
    if (typeof body.language !== 'string' || !/^(?:[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8}){0,2})?$/.test(body.language))
      return { ok: false, error: 'Unknown language.' }
    patch.language = body.language
  }
  if ('listenMode' in body) {
    if (!['push', 'handsfree'].includes(body.listenMode as string))
      return { ok: false, error: 'Unknown listening mode.' }
    patch.listenMode = body.listenMode as ListenMode
  }
  if ('speechNoticeAccepted' in body) {
    if (body.speechNoticeAccepted !== true && body.speechNoticeAccepted !== false)
      return { ok: false, error: 'speechNoticeAccepted must be true or false.' }
    patch.speechNoticeAt = body.speechNoticeAccepted ? new Date().toISOString() : null
  }
  return { ok: true, patch }
}

export function validateExpression(
  body: Record<string, unknown> | null,
): { ok: true; phrase: string; meaning: string } | { ok: false; error: string } {
  const phrase = cleanName(body?.phrase, LIMITS.phrase)
  const meaning = cleanName(body?.meaning, LIMITS.meaning)
  if (!phrase) return { ok: false, error: 'Say the phrase you use (up to 80 characters).' }
  if (!meaning) return { ok: false, error: 'Say what it means (up to 240 characters).' }
  if (phrase.replace(/[^a-z0-9]/gi, '').length < 2)
    return { ok: false, error: 'That phrase is too short to recognise.' }
  return { ok: true, phrase, meaning }
}
