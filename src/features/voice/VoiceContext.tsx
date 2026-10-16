/**
 * The Goblin's ears and voice, shared by the floating microphone and the
 * /voice page. Listening is started directly from the tap handler (Safari
 * only allows the microphone inside a user gesture), so this lives in a
 * provider the button can call synchronously.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { startsWithAddress } from '@shared/goblin/address'
import { DEFAULT_PROFILE, type GoblinProfile } from '@shared/goblin/profile'
import type { AssistantReply } from '@shared/intelligence/types'

import { useAuth } from '@/features/auth/useAuth'
import { createCapture } from '@/features/capture/captureApi'
import { GOBLIN_QUERY_KEYS } from '@/features/goblin/goblinApi'
import { askAssistant } from '@/features/intelligence/intelligenceApi'
import { ApiError } from '@/lib/api'

import {
  enqueue,
  isOfflineError,
  newRequestId,
  readQueue,
} from './offlineQueue'
import {
  getRecognitionCtor,
  HandsFreeSession,
  PushToTalk,
  type ListenStatus,
} from './speech'
import { speak, stopSpeaking, ttsSupported } from './tts'
import { useOfflineSync } from './useOfflineSync'
import {
  converse,
  fetchGoblinProfile,
  GOBLIN_PROFILE_KEY,
  saveGoblinProfile,
  type ConverseResponse,
} from './voiceApi'

export type Turn = {
  id: string
  said: string
  state: 'sending' | 'done' | 'saved-offline' | 'failed'
  response?: ConverseResponse
  answers: { question: string; reply: AssistantReply }[]
  captured: boolean
  error?: string
}

export type VoiceStatus = ListenStatus | 'processing'

type VoiceContextValue = {
  profile: GoblinProfile
  supported: boolean
  status: VoiceStatus
  interim: string
  notice: string | null
  turns: Turn[]
  speaking: boolean
  handsFree: boolean
  handsFreeSupported: boolean
  needsSpeechNotice: boolean
  pendingOffline: number
  /** How many saved-offline thoughts were just sent. */
  syncedOffline: number
  clearSynced: () => void
  draft: string
  setDraft: (text: string) => void
  /** Call from a tap/click. Shows the speech notice first if needed. */
  startListening: (opts?: { auto?: boolean }) => void
  stopListening: () => void
  cancelListening: () => void
  acceptSpeechNotice: () => void
  declineSpeechNotice: () => void
  send: (text: string, source?: 'voice' | 'text') => Promise<void>
  stopTalking: () => void
  startHandsFree: () => void
  stopHandsFree: () => void
  clearNotice: () => void
}

const VoiceContext = createContext<VoiceContextValue | null>(null)

const NOTICE_KEY = 'pg:speech-notice'
const FOLLOW_UP_MS = 20_000

function noticeSeenLocally(): boolean {
  try {
    return localStorage.getItem(NOTICE_KEY) === '1'
  } catch {
    return false
  }
}

export function VoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const profileQuery = useQuery({
    queryKey: GOBLIN_PROFILE_KEY,
    queryFn: fetchGoblinProfile,
    staleTime: 60_000,
    enabled: Boolean(user),
  })
  const profile = profileQuery.data?.profile ?? DEFAULT_PROFILE
  const Ctor = useMemo(() => getRecognitionCtor(), [])
  const supported = Boolean(Ctor)

  const [status, setStatus] = useState<VoiceStatus>(
    supported ? 'idle' : 'unsupported',
  )
  const [interim, setInterim] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [speaking, setSpeaking] = useState(false)
  const [handsFree, setHandsFree] = useState(false)
  const [draft, setDraft] = useState('')
  const [askNotice, setAskNotice] = useState(false)
  const [noticeLocal, setNoticeLocal] = useState(noticeSeenLocally)
  const [pendingOffline, setPendingOffline] = useState(() =>
    user ? readQueue(user.id).length : 0,
  )

  const sync = useOfflineSync(user?.id)
  const ptt = useRef<PushToTalk | null>(null)
  const session = useRef<HandsFreeSession | null>(null)
  const lastReplyAt = useRef(0)
  const profileRef = useRef(profile)
  useEffect(() => {
    profileRef.current = profile
  }, [profile])

  const needsSpeechNotice = supported && !profile.speechNoticeAt && !noticeLocal

  useEffect(() => {
    if (!user) return
    const update = () => setPendingOffline(readQueue(user.id).length)
    update()
    window.addEventListener('pg:offline-queue', update)
    return () => window.removeEventListener('pg:offline-queue', update)
  }, [user])

  const refresh = useCallback(
    () =>
      Promise.all(
        ['captures', 'review', ...GOBLIN_QUERY_KEYS].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      ),
    [queryClient],
  )

  const patchTurn = (id: string, patch: Partial<Turn>) =>
    setTurns((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const say = useCallback((text: string) => {
    const p = profileRef.current
    if (!p.speakReplies || !ttsSupported() || !text) return
    session.current?.pause()
    speak(text, {
      voiceName: p.voiceName,
      language: p.language,
      rate: p.speechRate,
      volume: p.speechVolume,
      onStart: () => setSpeaking(true),
      onEnd: () => {
        setSpeaking(false)
        lastReplyAt.current = Date.now()
        session.current?.resume()
      },
    })
  }, [])

  const send = useCallback(
    async (raw: string, source: 'voice' | 'text' = 'text') => {
      const text = raw.trim()
      if (!text) return
      const id = newRequestId()
      setTurns((list) =>
        [
          {
            id,
            said: text,
            state: 'sending' as const,
            answers: [],
            captured: false,
          },
          ...list,
        ].slice(0, 12),
      )
      setStatus('processing')
      setNotice(null)
      try {
        const response = await converse({ text, requestId: id, source })
        patchTurn(id, { state: 'done', response })
        let spoken = response.reply
        const answers: Turn['answers'] = []
        for (const question of response.questions) {
          try {
            const { reply } = await askAssistant(question)
            answers.push({ question, reply })
            spoken = `${spoken} ${reply.message}`.trim()
          } catch {
            /* the question is still visible; Ask the Goblin can retry */
          }
        }
        let captured = false
        if (response.capture.length) {
          try {
            await createCapture(response.capture.join(' '))
            captured = true
          } catch {
            patchTurn(id, {
              error: 'Some of that couldn’t be saved — try again.',
            })
          }
        }
        patchTurn(id, { answers, captured })
        lastReplyAt.current = Date.now()
        session.current?.touch()
        say(spoken)
        void refresh()
        setDraft('')
      } catch (error) {
        if (isOfflineError(error) && user) {
          try {
            enqueue(user.id, text)
            patchTurn(id, { state: 'saved-offline' })
            setDraft('')
          } catch {
            patchTurn(id, {
              state: 'failed',
              error: 'This device couldn’t store it.',
            })
            setDraft(text)
          }
        } else {
          patchTurn(id, {
            state: 'failed',
            error:
              error instanceof ApiError
                ? error.message
                : 'The Goblin couldn’t take that just now. Your words are back in the box.',
          })
          // Never lose what someone said.
          setDraft(text)
        }
      } finally {
        setStatus(supported ? 'idle' : 'unsupported')
      }
    },
    [refresh, say, supported, user],
  )

  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  }, [send])

  const beginPushToTalk = useCallback(
    (auto: boolean) => {
      if (!Ctor) {
        setStatus('unsupported')
        setNotice(
          'Voice isn’t available in this browser. Type instead — it works the same.',
        )
        return
      }
      stopSpeaking()
      setSpeaking(false)
      ptt.current?.cancel()
      setInterim('')
      setNotice(null)
      const controller = new PushToTalk({
        Ctor,
        lang: profileRef.current.language || navigator.language || 'en',
        onInterim: setInterim,
        onStatus: (next, message) => {
          if (auto && next === 'denied') {
            // Some browsers only allow the microphone after a tap.
            setStatus('idle')
            setNotice('Tap the microphone to start.')
            return
          }
          setStatus((current) =>
            current === 'processing' && next === 'idle' ? current : next,
          )
          if (message) setNotice(message)
        },
        onDone: (text) => {
          setInterim('')
          ptt.current = null
          if (text) void sendRef.current(text, 'voice')
        },
      })
      ptt.current = controller
      controller.start()
    },
    [Ctor],
  )

  const startListening = useCallback(
    (opts: { auto?: boolean } = {}) => {
      if (session.current?.isActive) return
      if (status === 'listening' || status === 'starting') {
        ptt.current?.stop()
        return
      }
      if (needsSpeechNotice) {
        if (!opts.auto) setAskNotice(true)
        return
      }
      beginPushToTalk(Boolean(opts.auto))
    },
    [beginPushToTalk, needsSpeechNotice, status],
  )

  const acceptSpeechNotice = useCallback(() => {
    try {
      localStorage.setItem(NOTICE_KEY, '1')
    } catch {
      /* private mode: the server copy still records it */
    }
    setNoticeLocal(true)
    setAskNotice(false)
    void saveGoblinProfile({ speechNoticeAccepted: true })
      .then(() =>
        queryClient.invalidateQueries({ queryKey: GOBLIN_PROFILE_KEY }),
      )
      .catch(() => undefined)
    // Still inside the tap that accepted, so the microphone may start.
    beginPushToTalk(false)
  }, [beginPushToTalk, queryClient])

  const stopHandsFree = useCallback(() => {
    session.current?.end()
    session.current = null
    setHandsFree(false)
    setInterim('')
    setStatus(supported ? 'idle' : 'unsupported')
  }, [supported])

  const startHandsFree = useCallback(() => {
    if (!Ctor || needsSpeechNotice) {
      if (needsSpeechNotice) setAskNotice(true)
      return
    }
    ptt.current?.cancel()
    const names = [profileRef.current.name, ...profileRef.current.aliases]
    const s = new HandsFreeSession({
      Ctor,
      lang: profileRef.current.language || navigator.language || 'en',
      isForGoblin: (text) =>
        startsWithAddress(text, names) ||
        Date.now() - lastReplyAt.current < FOLLOW_UP_MS,
      onUtterance: (text) => void sendRef.current(text, 'voice'),
      onInterim: setInterim,
      onStatus: (next, message) => {
        if (next === 'ended') {
          session.current = null
          setHandsFree(false)
          setInterim('')
          setStatus(Ctor ? 'idle' : 'unsupported')
        } else {
          setStatus(next)
        }
        if (message) setNotice(message)
      },
    })
    session.current = s
    setHandsFree(true)
    setNotice(null)
    s.start()
  }, [Ctor, needsSpeechNotice])

  // Never keep listening in the background or after leaving.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        ptt.current?.cancel()
        if (session.current?.isActive) {
          session.current.end(
            'Hands-free stopped because Pocket Goblin went into the background.',
          )
        }
        stopSpeaking()
      }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      ptt.current?.cancel()
      session.current?.end()
      stopSpeaking()
    }
  }, [])

  const value = useMemo<VoiceContextValue>(
    () => ({
      profile,
      supported,
      status,
      interim,
      notice,
      turns,
      speaking,
      handsFree,
      handsFreeSupported: supported && profile.listenMode === 'handsfree',
      needsSpeechNotice: needsSpeechNotice && askNotice,
      pendingOffline,
      syncedOffline: sync.lastSynced,
      clearSynced: sync.clearSynced,
      draft,
      setDraft,
      startListening,
      stopListening: () => ptt.current?.stop(),
      cancelListening: () => {
        ptt.current?.cancel()
        setInterim('')
        setNotice('Cancelled. Nothing was sent.')
      },
      acceptSpeechNotice,
      declineSpeechNotice: () => setAskNotice(false),
      send,
      stopTalking: () => {
        stopSpeaking()
        setSpeaking(false)
        session.current?.resume()
      },
      startHandsFree,
      stopHandsFree,
      clearNotice: () => setNotice(null),
    }),
    [
      profile,
      supported,
      status,
      interim,
      notice,
      turns,
      speaking,
      handsFree,
      needsSpeechNotice,
      askNotice,
      pendingOffline,
      sync,
      draft,
      startListening,
      acceptSpeechNotice,
      send,
      startHandsFree,
      stopHandsFree,
    ],
  )

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useVoice(): VoiceContextValue {
  const ctx = useContext(VoiceContext)
  if (!ctx) throw new Error('useVoice must be used inside VoiceProvider')
  return ctx
}
