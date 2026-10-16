import { Mic, Square, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

import { useVoice } from './VoiceContext'
import styles from './VoiceFab.module.css'
import { VoicePanel } from './VoicePanel'

/**
 * The always-there microphone. One tap opens the Goblin and starts
 * listening in the same tap; the sheet can be closed at any time, which
 * also stops the microphone.
 */
export function VoiceFab() {
  const voice = useVoice()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const dialog = useRef<HTMLDivElement>(null)
  const fab = useRef<HTMLButtonElement>(null)
  const listening = voice.status === 'listening' || voice.status === 'starting'

  function close() {
    if (listening) voice.cancelListening()
    if (voice.handsFree) voice.stopHandsFree()
    voice.stopTalking()
    setOpen(false)
    fab.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    dialog.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
    // close() is stable enough for an Escape handler.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // The Tell page has its own box; /voice is the full-screen version.
  if (location.pathname === '/voice') return null

  return (
    <>
      {open ? (
        <div className={styles.backdrop} onClick={close}>
          <div
            ref={dialog}
            className={styles.sheet}
            role="dialog"
            aria-modal="true"
            aria-label={`Talk to ${voice.profile.name}`}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.sheetHead}>
              <strong>Talk to {voice.profile.name}</strong>
              <button
                type="button"
                className={styles.close}
                onClick={close}
                aria-label="Close"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
            <VoicePanel typeFirst={!voice.supported} />
          </div>
        </div>
      ) : null}
      <button
        ref={fab}
        type="button"
        className={[styles.fab, listening ? styles.live : ''].join(' ')}
        aria-label={
          listening
            ? 'Stop listening'
            : `Talk to ${voice.profile.name}${voice.supported ? '' : ' (type)'}`
        }
        aria-expanded={open}
        onClick={() => {
          if (open && listening) {
            voice.stopListening()
            return
          }
          setOpen(true)
          // Start in this same tap: browsers only allow the mic from a gesture.
          if (voice.supported) voice.startListening()
        }}
      >
        {listening ? (
          <Square size={24} aria-hidden />
        ) : (
          <Mic size={26} aria-hidden />
        )}
      </button>
    </>
  )
}
