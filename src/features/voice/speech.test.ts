import { beforeEach, describe, expect, it } from 'vitest'

import {
  describeError,
  getRecognitionCtor,
  HandsFreeSession,
  PushToTalk,
  type SpeechRecognitionLike,
} from './speech'
import { pickVoice } from './tts'

/** A controllable stand-in for the browser's SpeechRecognition. */
class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = []
  static throwOnStart = false
  continuous = false
  interimResults = false
  lang = ''
  started = false
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  private results: { 0: { transcript: string }; isFinal: boolean }[] = []
  constructor() {
    FakeRecognition.instances.push(this)
  }
  start() {
    if (FakeRecognition.throwOnStart) throw new Error('InvalidStateError')
    this.started = true
  }
  stop() {
    this.started = false
    this.onend?.()
  }
  abort() {
    this.started = false
    this.onend?.()
  }
  say(text: string, isFinal = true) {
    const index = this.results.length
    this.results.push({ 0: { transcript: text }, isFinal })
    this.onresult?.({ resultIndex: index, results: this.results })
  }
  fail(error: string) {
    this.onerror?.({ error })
    this.onend?.()
  }
}

/** Manual timers so tests control silence and limits. */
function clock() {
  let now = 0
  let next = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    setTimer: (fn: () => void, ms: number) => {
      const id = next++
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimer: (id: unknown) => void timers.delete(id as number),
    advance(ms: number) {
      now += ms
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(id)) {
          timers.delete(id)
          t.fn()
        }
      }
    },
    pending: () => timers.size,
  }
}

beforeEach(() => {
  FakeRecognition.instances = []
  FakeRecognition.throwOnStart = false
})

function ptt(extra: Partial<ConstructorParameters<typeof PushToTalk>[0]> = {}) {
  const c = clock()
  const done: string[] = []
  const statuses: string[] = []
  const messages: string[] = []
  const controller = new PushToTalk({
    Ctor: FakeRecognition,
    lang: 'en-GB',
    onInterim: () => {},
    onDone: (t) => done.push(t),
    onStatus: (s, m) => {
      statuses.push(s)
      if (m) messages.push(m)
    },
    setTimer: c.setTimer,
    clearTimer: c.clearTimer,
    ...extra,
  })
  return { controller, c, done, statuses, messages }
}

describe('capability detection', () => {
  it('finds standard and prefixed recognition, or none', () => {
    expect(getRecognitionCtor({ SpeechRecognition: FakeRecognition })).toBe(
      FakeRecognition,
    )
    expect(
      getRecognitionCtor({ webkitSpeechRecognition: FakeRecognition }),
    ).toBe(FakeRecognition)
    expect(getRecognitionCtor({})).toBeNull()
    expect(getRecognitionCtor(undefined)).toBeNull()
  })
})

describe('push-to-talk', () => {
  it('joins several recognition results into one utterance', () => {
    const t = ptt()
    t.controller.start()
    const r = FakeRecognition.instances[0]!
    expect(r.continuous).toBe(true)
    expect(r.lang).toBe('en-GB')
    r.say('we need milk')
    r.say('and bread')
    t.c.advance(2500)
    expect(t.done).toEqual(['we need milk and bread'])
  })

  it('waits through a natural pause before stopping', () => {
    const t = ptt()
    t.controller.start()
    const r = FakeRecognition.instances[0]!
    r.say('remind me to')
    t.c.advance(2000)
    r.say('call Mum on Thursday')
    t.c.advance(2400)
    expect(t.done).toEqual([])
    t.c.advance(200)
    expect(t.done).toEqual(['remind me to call Mum on Thursday'])
  })

  it('silence with nothing said ends with nothing sent', () => {
    const t = ptt()
    t.controller.start()
    t.c.advance(8000)
    expect(t.done).toEqual([''])
    expect(FakeRecognition.instances).toHaveLength(1)
  })

  it('has a hard time limit and never restarts itself', () => {
    const t = ptt({ maxMs: 10_000, silenceMs: 60_000 })
    t.controller.start()
    const r = FakeRecognition.instances[0]!
    for (let i = 0; i < 5; i += 1) {
      r.say(`word ${i}`, false)
      t.c.advance(2000)
    }
    expect(t.done).toHaveLength(1)
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(t.c.pending()).toBe(0)
  })

  it('cancel discards the words', () => {
    const t = ptt()
    t.controller.start()
    FakeRecognition.instances[0]!.say('something private')
    t.controller.cancel()
    expect(t.done).toEqual([''])
  })

  it('permission denied is reported, not sent', () => {
    const t = ptt()
    t.controller.start()
    FakeRecognition.instances[0]!.fail('not-allowed')
    expect(t.statuses).toContain('denied')
    expect(t.messages[0]).toMatch(/blocked/)
    expect(t.done).toEqual([''])
  })

  it('an interrupted session keeps what was already heard', () => {
    const t = ptt()
    t.controller.start()
    const r = FakeRecognition.instances[0]!
    r.say('buy eggs')
    r.fail('no-speech')
    expect(t.done).toEqual(['buy eggs'])
  })

  it('a busy microphone fails cleanly', () => {
    FakeRecognition.throwOnStart = true
    const t = ptt()
    t.controller.start()
    expect(t.statuses).toContain('unavailable')
    expect(t.done).toEqual([''])
  })

  it('finishes once even if stopped twice', () => {
    const t = ptt()
    t.controller.start()
    FakeRecognition.instances[0]!.say('milk')
    t.controller.stop()
    t.controller.stop()
    expect(t.done).toEqual(['milk'])
  })
})

describe('error messages', () => {
  it.each(['not-allowed', 'audio-capture', 'network', 'no-speech', 'whatever'])(
    '%s',
    (code) => {
      expect(describeError(code)?.message).toBeTruthy()
    },
  )
  it('aborted is silent', () => expect(describeError('aborted')).toBeNull())
})

describe('hands-free', () => {
  function session(
    extra: Partial<ConstructorParameters<typeof HandsFreeSession>[0]> = {},
  ) {
    const c = clock()
    const heard: string[] = []
    const statuses: string[] = []
    const s = new HandsFreeSession({
      Ctor: FakeRecognition,
      lang: 'en',
      isForGoblin: (t) => /^(hey )?gobbo\b/i.test(t),
      onUtterance: (t) => heard.push(t),
      onInterim: () => {},
      onStatus: (st) => statuses.push(st),
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
      ...extra,
    })
    return { s, c, heard, statuses }
  }

  it('acts only on speech addressed to the Goblin', () => {
    const t = session()
    t.s.start()
    const r = FakeRecognition.instances[0]!
    r.say('pass the salt please')
    t.c.advance(1500)
    r.say('hey Gobbo add milk')
    t.c.advance(1500)
    expect(t.heard).toEqual(['hey Gobbo add milk'])
  })

  it('reopens after the browser ends a session, but only a bounded number of times', () => {
    const t = session({ maxRestarts: 3 })
    t.s.start()
    for (let i = 0; i < 5; i += 1) {
      FakeRecognition.instances.at(-1)!.onend?.()
      t.c.advance(400)
    }
    expect(FakeRecognition.instances.length).toBe(4)
    expect(t.statuses.at(-1)).toBe('ended')
    expect(t.s.isActive).toBe(false)
  })

  it('stops after the session limit and after going quiet', () => {
    const a = session({ sessionMs: 1000, idleMs: 10_000 })
    a.s.start()
    a.c.advance(1000)
    expect(a.s.isActive).toBe(false)
    const b = session({ sessionMs: 100_000, idleMs: 2000 })
    b.s.start()
    b.c.advance(2000)
    expect(b.s.isActive).toBe(false)
  })

  it('stops on permission loss, and pause stops the mic while the Goblin talks', () => {
    const t = session()
    t.s.start()
    t.s.pause()
    expect(FakeRecognition.instances[0]!.started).toBe(false)
    t.s.resume()
    expect(FakeRecognition.instances[1]!.started).toBe(true)
    FakeRecognition.instances[1]!.fail('not-allowed')
    expect(t.s.isActive).toBe(false)
  })

  it('end() leaves nothing running', () => {
    const t = session()
    t.s.start()
    t.s.end()
    t.c.advance(1_000_000)
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(t.c.pending()).toBe(0)
  })
})

describe('voices', () => {
  const voices = [
    { name: 'Daniel', lang: 'en-GB', default: false },
    { name: 'Samantha', lang: 'en-US', default: true },
    { name: 'Amélie', lang: 'fr-CA', default: false },
  ]
  it('uses the chosen voice, else the language, else the default', () => {
    expect(pickVoice(voices, 'Daniel', '')?.name).toBe('Daniel')
    expect(pickVoice(voices, 'Missing voice', 'fr-FR')?.name).toBe('Amélie')
    expect(pickVoice(voices, 'Missing voice', 'ja-JP')?.name).toBe('Samantha')
    expect(pickVoice([], 'x', 'en')).toBeNull()
  })
})
