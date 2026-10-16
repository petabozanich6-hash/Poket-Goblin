/**
 * Spoken replies with the browser's own speech synthesis (free, no API).
 * Voices differ per device: a chosen voice that isn't installed here falls
 * back to the best match for the language, then the device default.
 */

export function ttsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  )
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (!ttsSupported()) return []
  return window.speechSynthesis.getVoices()
}

/** Voices load asynchronously in some browsers. */
export function onVoicesChanged(fn: () => void): () => void {
  if (!ttsSupported()) return () => {}
  const synth = window.speechSynthesis
  synth.addEventListener?.('voiceschanged', fn)
  return () => synth.removeEventListener?.('voiceschanged', fn)
}

export function pickVoice(
  voices: Pick<SpeechSynthesisVoice, 'name' | 'lang' | 'default'>[],
  preferred: string,
  language: string,
) {
  if (preferred) {
    const exact = voices.find((v) => v.name === preferred)
    if (exact) return exact
  }
  const lang = (
    language ||
    (typeof navigator !== 'undefined' ? navigator.language : '') ||
    'en'
  ).toLowerCase()
  return (
    voices.find((v) => v.lang.toLowerCase() === lang) ??
    voices.find((v) => v.lang.toLowerCase().startsWith(lang.split('-')[0]!)) ??
    voices.find((v) => v.default) ??
    null
  )
}

export type SpeakOptions = {
  voiceName: string
  language: string
  rate: number
  volume: number
  onStart?: () => void
  onEnd?: () => void
}

/** Speak `text`, interrupting anything already being said. */
export function speak(text: string, opts: SpeakOptions): boolean {
  if (!ttsSupported() || !text.trim()) {
    opts.onEnd?.()
    return false
  }
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const voice = pickVoice(synth.getVoices(), opts.voiceName, opts.language)
  if (voice) {
    utterance.voice = voice as SpeechSynthesisVoice
    utterance.lang = voice.lang
  } else if (opts.language) {
    utterance.lang = opts.language
  }
  utterance.rate = opts.rate
  utterance.volume = opts.volume
  utterance.onstart = () => opts.onStart?.()
  utterance.onend = () => opts.onEnd?.()
  utterance.onerror = () => opts.onEnd?.()
  synth.speak(utterance)
  return true
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel()
}
