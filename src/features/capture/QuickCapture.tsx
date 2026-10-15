import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Mic, MicOff } from 'lucide-react'

import type { Capture } from '@shared/types'

import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/Input'
import { ApiError } from '@/lib/api'

import { createCapture } from './captureApi'
import { useVoiceInput } from './useVoiceInput'
import styles from './QuickCapture.module.css'

type QuickCaptureProps = {
  onCaptured?: (capture: Capture) => void
}

export function QuickCapture({ onCaptured }: QuickCaptureProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const voice = useVoiceInput(
    (chunk) =>
      setText((prev) =>
        `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${chunk}`.trim(),
      ),
    setError,
  )
  const listening = voice.listening
  const voiceSupported = voice.supported

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

  const toggleVoice = voice.toggle

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
