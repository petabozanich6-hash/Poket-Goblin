/**
 * Browser speech recognition, wrapped so it behaves predictably.
 *
 * - Feature-detected: `SpeechRecognition` or `webkitSpeechRecognition`.
 *   Where neither exists the app offers typing instead — nothing breaks.
 * - Push-to-talk keeps listening through natural pauses and stops after a
 *   stretch of silence, a hard time limit, or a tap. It never restarts
 *   itself.
 * - Hands-free is a separate, explicitly started session with a time limit,
 *   an idle limit and a cap on restarts, so the microphone can never stay
 *   open indefinitely or loop.
 *
 * Pocket Goblin never records audio. The browser's speech service turns
 * speech into text; in Chrome and Edge that service runs on the browser
 * vendor's servers, in Safari on Apple's servers or on the device.
 */

export type RecognitionResultList = ArrayLike<{
  0: { transcript: string }
  isFinal: boolean
}>

export type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives?: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult:
    | ((event: { resultIndex: number; results: RecognitionResultList }) => void)
    | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  onstart?: (() => void) | null
  onspeechstart?: (() => void) | null
}

export type RecognitionCtor = new () => SpeechRecognitionLike

export function getRecognitionCtor(
  scope: unknown = typeof window === 'undefined' ? undefined : window,
): RecognitionCtor | null {
  const w = scope as
    | {
        SpeechRecognition?: RecognitionCtor
        webkitSpeechRecognition?: RecognitionCtor
      }
    | undefined
  return w?.SpeechRecognition || w?.webkitSpeechRecognition || null
}

export type ListenStatus =
  'idle' | 'starting' | 'listening' | 'unsupported' | 'denied' | 'unavailable'

export type ListenError = {
  status: ListenStatus
  message: string
}

/** Turn a recognition error code into something a person can act on. */
export function describeError(code: string): ListenError | null {
  switch (code) {
    case 'aborted':
      return null
    case 'no-speech':
      return {
        status: 'idle',
        message: 'I didn’t catch anything. Tap the microphone and try again.',
      }
    case 'not-allowed':
    case 'service-not-allowed':
      return {
        status: 'denied',
        message:
          'Microphone access is blocked. Allow it in your browser’s site settings, or type instead.',
      }
    case 'audio-capture':
      return {
        status: 'unavailable',
        message: 'No microphone was found. You can type instead.',
      }
    case 'network':
      return {
        status: 'unavailable',
        message:
          'Voice needs an internet connection in this browser. Type it and I’ll keep it safe.',
      }
    case 'language-not-supported':
      return {
        status: 'unavailable',
        message:
          'This browser can’t recognise that language. Change it in Get to Know Your Goblin.',
      }
    default:
      return {
        status: 'idle',
        message: 'Voice stopped unexpectedly. Tap to try again, or type.',
      }
  }
}

export type PushToTalkOptions = {
  Ctor: RecognitionCtor
  lang: string
  /** Live words while speaking. */
  onInterim: (text: string) => void
  /** The whole utterance once listening ends ('' if nothing was said). */
  onDone: (text: string) => void
  onStatus: (status: ListenStatus, message?: string) => void
  /** Stop after this much quiet once someone has spoken. */
  silenceMs?: number
  /** Give up if nothing at all is said for this long. */
  initialSilenceMs?: number
  /** Hard cap on one utterance. */
  maxMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
}

/**
 * One utterance: tap → speak (pauses are fine) → it stops by itself after
 * a quiet moment, or when tapped again. `cancel()` throws the words away.
 */
export class PushToTalk {
  private recognition: SpeechRecognitionLike | null = null
  private finals: string[] = []
  private interim = ''
  private silence: unknown = null
  private hardStop: unknown = null
  private cancelled = false
  private finished = false
  private readonly opts: Required<
    Omit<PushToTalkOptions, 'setTimer' | 'clearTimer'>
  > &
    Pick<PushToTalkOptions, 'setTimer' | 'clearTimer'>

  constructor(opts: PushToTalkOptions) {
    this.opts = {
      silenceMs: 2500,
      initialSilenceMs: 8000,
      maxMs: 60_000,
      ...opts,
    }
  }

  private set(fn: () => void, ms: number) {
    return (this.opts.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, ms)
  }
  private clear(id: unknown) {
    if (id != null)
      (this.opts.clearTimer ?? ((i) => clearTimeout(i as number)))(id)
  }

  private armSilence(ms: number) {
    this.clear(this.silence)
    this.silence = this.set(() => this.stop(), ms)
  }

  /** Must be called from a user gesture (tap/click/key) in most browsers. */
  start() {
    const recognition = new this.opts.Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.lang = this.opts.lang
    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (!result) continue
        const words = result[0].transcript
        if (result.isFinal) this.finals.push(words.trim())
        else interim += words
      }
      this.interim = interim.trim()
      this.opts.onInterim(
        [...this.finals, this.interim].filter(Boolean).join(' '),
      )
      this.armSilence(this.opts.silenceMs)
    }
    recognition.onerror = (event) => {
      const problem = describeError(event.error)
      if (problem) this.opts.onStatus(problem.status, problem.message)
      if (problem && problem.status !== 'idle') this.cancelled = true
    }
    recognition.onend = () => this.finish()
    this.recognition = recognition
    this.opts.onStatus('starting')
    try {
      recognition.start()
    } catch {
      this.opts.onStatus(
        'unavailable',
        'The microphone is busy. Try again in a moment.',
      )
      this.cancelled = true
      this.finish()
      return
    }
    this.opts.onStatus('listening')
    this.armSilence(this.opts.initialSilenceMs)
    this.hardStop = this.set(() => this.stop(), this.opts.maxMs)
  }

  /** Stop listening and use what was said. */
  stop() {
    this.clear(this.silence)
    this.clear(this.hardStop)
    try {
      this.recognition?.stop()
    } catch {
      this.finish()
    }
  }

  /** Stop listening and discard the words. */
  cancel() {
    this.cancelled = true
    this.clear(this.silence)
    this.clear(this.hardStop)
    try {
      this.recognition?.abort()
    } catch {
      /* already stopped */
    }
    this.finish()
  }

  private finish() {
    if (this.finished) return
    this.finished = true
    this.clear(this.silence)
    this.clear(this.hardStop)
    if (this.recognition) {
      this.recognition.onresult = null
      this.recognition.onend = null
      this.recognition.onerror = null
    }
    const text = this.cancelled
      ? ''
      : [...this.finals, this.interim]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
    this.opts.onStatus('idle')
    this.opts.onDone(text)
  }
}

export type HandsFreeOptions = {
  Ctor: RecognitionCtor
  lang: string
  /** Decide whether a finished utterance is meant for the Goblin. */
  isForGoblin: (text: string) => boolean
  onUtterance: (text: string) => void
  onInterim: (text: string) => void
  onStatus: (status: ListenStatus | 'ended', message?: string) => void
  /** Whole session cap. */
  sessionMs?: number
  /** End when nobody has talked to the Goblin for this long. */
  idleMs?: number
  /** A pause this long ends one utterance. */
  utteranceGapMs?: number
  maxRestarts?: number
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (id: unknown) => void
}

/**
 * An explicitly started, time-limited listening session while the app is
 * open and visible. Only utterances addressed to the Goblin (or quick
 * follow-ups) are acted on; everything else is discarded unseen.
 */
export class HandsFreeSession {
  private recognition: SpeechRecognitionLike | null = null
  private active = false
  private paused = false
  private restarts = 0
  private buffer: string[] = []
  private gap: unknown = null
  private sessionTimer: unknown = null
  private idleTimer: unknown = null
  private readonly o: Required<
    Omit<HandsFreeOptions, 'setTimer' | 'clearTimer' | 'now'>
  > &
    Pick<HandsFreeOptions, 'setTimer' | 'clearTimer' | 'now'>

  constructor(opts: HandsFreeOptions) {
    this.o = {
      sessionMs: 5 * 60_000,
      idleMs: 90_000,
      utteranceGapMs: 1500,
      maxRestarts: 40,
      ...opts,
    }
  }

  get isActive() {
    return this.active
  }

  private set(fn: () => void, ms: number) {
    return (this.o.setTimer ?? ((f, m) => setTimeout(f, m)))(fn, ms)
  }
  private clear(id: unknown) {
    if (id != null)
      (this.o.clearTimer ?? ((i) => clearTimeout(i as number)))(id)
  }

  private resetIdle() {
    this.clear(this.idleTimer)
    this.idleTimer = this.set(
      () =>
        this.end('Hands-free paused after a quiet spell. Tap to start again.'),
      this.o.idleMs,
    )
  }

  start() {
    if (this.active) return
    this.active = true
    this.restarts = 0
    this.sessionTimer = this.set(
      () => this.end('Hands-free stops after 5 minutes. Tap to start again.'),
      this.o.sessionMs,
    )
    this.resetIdle()
    this.open()
  }

  /** While the Goblin is talking, stop listening so it can't hear itself. */
  pause() {
    this.paused = true
    this.closeRecognition()
  }

  resume() {
    if (!this.active || !this.paused) return
    this.paused = false
    this.open()
  }

  /** A reply counts as activity: keep the session going a while longer. */
  touch() {
    if (this.active) this.resetIdle()
  }

  end(message?: string) {
    if (!this.active) return
    this.active = false
    this.clear(this.gap)
    this.clear(this.sessionTimer)
    this.clear(this.idleTimer)
    this.buffer = []
    this.closeRecognition()
    this.o.onStatus('ended', message)
  }

  private closeRecognition() {
    const r = this.recognition
    this.recognition = null
    if (!r) return
    r.onend = null
    r.onresult = null
    r.onerror = null
    try {
      r.abort()
    } catch {
      /* already closed */
    }
  }

  private flush() {
    const text = this.buffer.join(' ').replace(/\s+/g, ' ').trim()
    this.buffer = []
    this.o.onInterim('')
    if (!text) return
    if (this.o.isForGoblin(text)) {
      this.resetIdle()
      this.o.onUtterance(text)
    }
  }

  private open() {
    if (!this.active || this.paused) return
    const r = new this.o.Ctor()
    r.continuous = true
    r.interimResults = true
    r.lang = this.o.lang
    r.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (!result) continue
        if (result.isFinal) this.buffer.push(result[0].transcript.trim())
        else interim += result[0].transcript
      }
      // Show live words only once the person has addressed the Goblin.
      const live = [...this.buffer, interim].join(' ').trim()
      this.o.onInterim(this.o.isForGoblin(live) ? live : '')
      this.clear(this.gap)
      this.gap = this.set(() => this.flush(), this.o.utteranceGapMs)
    }
    r.onerror = (event) => {
      const problem = describeError(event.error)
      if (
        problem &&
        (problem.status === 'denied' || problem.status === 'unavailable')
      ) {
        this.end(problem.message)
      }
    }
    r.onend = () => {
      // Browsers end recognition sessions on their own; reopen a bounded
      // number of times, with a short pause, never in a tight loop.
      this.recognition = null
      this.flush()
      if (!this.active || this.paused) return
      this.restarts += 1
      if (this.restarts > this.o.maxRestarts) {
        this.end(
          'Hands-free stopped to rest the microphone. Tap to start again.',
        )
        return
      }
      this.set(() => this.open(), 400)
    }
    this.recognition = r
    try {
      r.start()
      this.o.onStatus('listening')
    } catch {
      this.end('The microphone is busy. Try again in a moment.')
    }
  }
}
