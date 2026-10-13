import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { Capture } from '@shared/types'

import { Button } from '@/components/ui/Button'
import { TextArea } from '@/components/ui/Input'
import { ApiError } from '@/lib/api'

import { createCapture } from './captureApi'
import styles from './QuickCapture.module.css'

type QuickCaptureProps = {
  onCaptured?: (capture: Capture) => void
}

export function QuickCapture({ onCaptured }: QuickCaptureProps) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: createCapture,
    onSuccess: async (data) => {
      setText('')
      setError(null)
      await queryClient.invalidateQueries({ queryKey: ['captures'] })
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

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <TextArea
        label="Brain dump"
        name="brainDump"
        placeholder="Type or paste whatever is rattling around — appointments, bills, reminders, half-thoughts…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className={styles.actions}>
        <p className={styles.hint}>
          The goblin will suggest structure. You review before anything becomes
          a commitment.
        </p>
        <Button type="submit" disabled={mutation.isPending || !text.trim()}>
          {mutation.isPending ? 'Listening…' : 'Give it to the goblin'}
        </Button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </form>
  )
}
