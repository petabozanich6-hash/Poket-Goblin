import {
  CloudOff,
  Ear,
  EarOff,
  Keyboard,
  Mic,
  Send,
  Square,
  VolumeX,
  X,
} from 'lucide-react'
import { useEffect, useRef, type FormEvent } from 'react'
import { Link } from 'react-router'

import { understandsLanguage } from '@shared/goblin/profile'

import { Button } from '@/components/ui/Button'
import { ActionResults } from '@/features/goblin/ActionResults'

import { useVoice, type Turn } from './VoiceContext'
import styles from './VoicePanel.module.css'

function SpeechNotice() {
  const voice = useVoice()
  if (!voice.needsSpeechNotice) return null
  return (
    <div
      className={styles.notice}
      role="dialog"
      aria-labelledby="speech-notice-title"
    >
      <p id="speech-notice-title" className={styles.noticeTitle}>
        Before you talk to the Goblin
      </p>
      <p>
        Your browser’s own speech service turns what you say into text. In
        Chrome, Edge and Samsung Internet that usually happens on the browser
        maker’s servers; in Safari, on Apple’s servers or on your device. Pocket
        Goblin never records or keeps audio — only the words reach us, and we
        act on them without storing the transcript.
      </p>
      <div className={styles.row}>
        <Button onClick={voice.acceptSpeechNotice}>
          <Mic size={16} aria-hidden /> OK, start listening
        </Button>
        <Button variant="ghost" onClick={voice.declineSpeechNotice}>
          I’ll type instead
        </Button>
      </div>
    </div>
  )
}

function TurnCard({ turn }: { turn: Turn }) {
  const r = turn.response
  return (
    <li className={styles.turn}>
      <p className={styles.said}>“{turn.said}”</p>
      {turn.state === 'sending' ? (
        <p className={styles.muted}>Thinking…</p>
      ) : null}
      {turn.state === 'saved-offline' ? (
        <p className={styles.offline}>
          <CloudOff size={16} aria-hidden /> Saved on this device. I’ll send it
          when you’re back online — nothing has changed yet.
        </p>
      ) : null}
      {turn.state === 'failed' ? (
        <p className={styles.error} role="alert">
          {turn.error}
        </p>
      ) : null}
      {r ? (
        <>
          {r.reply ? <p className={styles.reply}>{r.reply}</p> : null}
          {r.expressionsUsed.length ? (
            <p className={styles.muted}>
              Using your phrase “{r.expressionsUsed.join('”, “')}”.
            </p>
          ) : null}
          {r.answers.map((a) => (
            <div key={a.title} className={styles.answer}>
              <p className={styles.answerTitle}>{a.title}</p>
              <ul>
                {a.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
          {r.results.some((x) => x.kind !== 'info') ? (
            <ActionResults
              results={r.results.filter((x) => x.kind !== 'info')}
            />
          ) : null}
          {turn.answers.map((a) => (
            <p key={a.question} className={styles.reply}>
              {a.reply.message}
            </p>
          ))}
          {turn.captured ? (
            <p className={styles.muted}>
              Kept the rest for you to check in{' '}
              <Link to="/tell#waiting">Tell the Goblin</Link>.
            </p>
          ) : null}
          {turn.error ? <p className={styles.error}>{turn.error}</p> : null}
        </>
      ) : null}
    </li>
  )
}

const STATUS_TEXT: Record<string, string> = {
  idle: 'Not listening',
  starting: 'Starting the microphone…',
  listening: 'Listening…',
  processing: 'Working on it…',
  unsupported: 'Voice isn’t available in this browser — type below',
  denied: 'Microphone blocked',
  unavailable: 'Microphone unavailable',
}

/**
 * The voice interface: one big microphone, the words as they're heard, a
 * text box that always works, and the Goblin's replies with Undo.
 */
export function VoicePanel({ typeFirst = false }: { typeFirst?: boolean }) {
  const voice = useVoice()
  const input = useRef<HTMLInputElement>(null)
  const listening = voice.status === 'listening' || voice.status === 'starting'
  const name = voice.profile.name

  useEffect(() => {
    if (typeFirst || !voice.supported) input.current?.focus()
  }, [typeFirst, voice.supported])

  function submit(event: FormEvent) {
    event.preventDefault()
    void voice.send(voice.draft, 'text')
  }

  return (
    <div className={styles.panel}>
      <SpeechNotice />

      <div className={styles.micArea}>
        <button
          type="button"
          className={[
            styles.mic,
            listening ? styles.micLive : '',
            voice.status === 'processing' ? styles.micBusy : '',
          ].join(' ')}
          onClick={() => voice.startListening()}
          disabled={!voice.supported || voice.handsFree}
          aria-pressed={listening}
          aria-label={listening ? 'Stop listening and send' : `Talk to ${name}`}
        >
          {listening ? (
            <Square size={34} aria-hidden />
          ) : (
            <Mic size={40} aria-hidden />
          )}
        </button>
        <p className={styles.status} role="status" aria-live="polite">
          {voice.handsFree
            ? voice.status === 'listening'
              ? `Hands-free: say “${name}…” to talk`
              : STATUS_TEXT[voice.status]
            : STATUS_TEXT[voice.status]}
        </p>
        {voice.interim ? (
          <p className={styles.interim} aria-live="off">
            {voice.interim}
          </p>
        ) : null}
        <div className={styles.row}>
          {listening && !voice.handsFree ? (
            <Button variant="ghost" size="sm" onClick={voice.cancelListening}>
              <X size={16} aria-hidden /> Cancel
            </Button>
          ) : null}
          {voice.speaking ? (
            <Button variant="secondary" size="sm" onClick={voice.stopTalking}>
              <VolumeX size={16} aria-hidden /> Stop talking
            </Button>
          ) : null}
          {voice.handsFreeSupported ? (
            voice.handsFree ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={voice.stopHandsFree}
              >
                <EarOff size={16} aria-hidden /> Stop hands-free
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={voice.startHandsFree}>
                <Ear size={16} aria-hidden /> Start hands-free
              </Button>
            )
          ) : null}
        </div>
        {voice.notice ? (
          <p className={styles.hint} role="alert">
            {voice.notice}
          </p>
        ) : null}
        {voice.supported && !understandsLanguage(voice.profile.language) ? (
          <p className={styles.hint}>
            The Goblin understands English best for now; other languages are
            transcribed but may not be understood.
          </p>
        ) : null}
      </div>

      <form className={styles.typeRow} onSubmit={submit}>
        <label htmlFor="voice-text" className={styles.srOnly}>
          Or type to {name}
        </label>
        <Keyboard size={18} aria-hidden className={styles.typeIcon} />
        <input
          id="voice-text"
          ref={input}
          className={styles.input}
          value={voice.draft}
          onChange={(e) => voice.setDraft(e.target.value)}
          placeholder="Or type it here"
          autoComplete="off"
          enterKeyHint="send"
        />
        <Button
          type="submit"
          disabled={!voice.draft.trim() || voice.status === 'processing'}
        >
          <Send size={16} aria-hidden />
          <span className={styles.srOnly}>Send</span>
        </Button>
      </form>

      {voice.pendingOffline > 0 ? (
        <p className={styles.offline}>
          <CloudOff size={16} aria-hidden /> {voice.pendingOffline} saved on
          this device, waiting for a connection.
        </p>
      ) : null}
      {voice.syncedOffline > 0 ? (
        <p className={styles.muted} role="status">
          Sent {voice.syncedOffline} thought
          {voice.syncedOffline === 1 ? '' : 's'} saved while offline.{' '}
          <button
            type="button"
            className={styles.link}
            onClick={voice.clearSynced}
          >
            OK
          </button>
        </p>
      ) : null}

      <ol className={styles.turns} aria-live="polite" aria-label="Conversation">
        {voice.turns.map((turn) => (
          <TurnCard key={turn.id} turn={turn} />
        ))}
      </ol>

      <p className={styles.privacy}>
        Push-to-talk listens only after you tap and stops by itself.{' '}
        {voice.supported
          ? 'Speech is turned into text by your browser’s speech service; audio is never recorded by Pocket Goblin.'
          : null}{' '}
        <Link to="/settings#goblin">Get to know your Goblin</Link>
      </p>
    </div>
  )
}
