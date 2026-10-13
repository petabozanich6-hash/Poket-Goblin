import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Mic, MicOff } from 'lucide-react'

import type { Capture } from '@shared/types'

import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/Input'
import { ApiError } from '@/lib/api'

import { createCapture } from './captureApi'
import styles from './QuickCapture.module.css'

type QuickCaptureProps = {
  onCaptured?: (capture: Capture) => void
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  onresult:
    | ((event: {
        resultIndex: number
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
      }) => void)
    | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function QuickCapture({ onCaptured }: QuickCaptureProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [voiceSupported, setVoiceSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    setVoiceSupported(Boolean(getSpeechRecognition()))
    return () => {
      recognitionRef.current?.stop()
    }
  }, [])

  const mutation = useMutation({
    mutationFn: createCapture,
    onSuccess: async (data) => {
      setText('')
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['captures'] }),
        queryClient.invalidateQueries({ queryKey: ['review'] }),
      ])
      onCaptured?.(data.capture)
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not capture that')
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!text.trim()) return
    mutation.mutate(text.trim())
  }

  function toggleVoice() {
    const Ctor = getSpeechRecognition()
    if (!Ctor) {
      setError(
        'Voice capture is not supported in this browser. You can still type or paste.',
      )
      return
    }

    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-AU'
    recognition.onresult = (event) => {
      let finalChunk = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (!result) continue
        if (result.isFinal) finalChunk += result[0].transcript
      }
      if (finalChunk) {
        setText((prev) =>
          `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${finalChunk}`.trim(),
        )
      }
    }
    recognition.onerror = (event) => {
      setListening(false)
      if (event.error === 'not-allowed') {
        setError(
          'Microphone permission was denied. Enable it to use voice dump.',
        )
      } else if (event.error !== 'aborted') {
        setError(`Voice capture stopped (${event.error}).`)
      }
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setError(null)
    setListening(true)
    recognition.start()
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <TextArea
        label="Brain dump"
        name="brainDump"
        placeholder="Type, paste, or speak whatever is rattling around — appointments, bills, reminders, half-thoughts…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className={styles.actions}>
        <p className={styles.hint}>
          {listening
            ? 'Listening… speak naturally, then stop and edit before sending.'
            : voiceSupported
              ? 'The goblin will suggest structure. Review before anything becomes a commitment. Voice stays on-device when your browser supports it.'
              : 'Voice capture is unavailable here — typing still works. The goblin suggests structure; you review first.'}
        </p>
        <div className={styles.buttonRow}>
          <Button
            type="button"
            variant="secondary"
            onClick={toggleVoice}
            disabled={!voiceSupported && !listening}
          >
            {listening ? (
              <MicOff size={16} aria-hidden />
            ) : (
              <Mic size={16} aria-hidden />
            )}
            {listening ? 'Stop' : 'Speak'}
          </Button>
          <Button type="submit" disabled={mutation.isPending || !text.trim()}>
            {mutation.isPending ? 'Listening…' : 'Give it to the goblin'}
          </Button>
        </div>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </form>
  )
}
