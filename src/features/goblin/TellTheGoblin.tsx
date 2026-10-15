import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic, MicOff, Paperclip, Send, X } from 'lucide-react'
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'

import { detectIntent } from '@shared/intent'
import type { AssistantReply } from '@shared/intelligence/types'
import type { Capture } from '@shared/types'

import { Button } from '@/components/ui/Button'
import { CaptureReview } from '@/features/capture/CaptureReview'
import { createCapture, fetchCaptures } from '@/features/capture/captureApi'
import { useVoiceInput } from '@/features/capture/useVoiceInput'
import { DevourReview } from '@/features/documents/DocumentDevourer'
import {
  devourDocument,
  type DevourResponse,
} from '@/features/explore/exploreApi'
import { askAssistant } from '@/features/intelligence/intelligenceApi'
import { RescuePanel } from '@/features/magical/RescuePanel'
import { useOverwhelm } from '@/features/magical/useOverwhelm'
import { ApiError } from '@/lib/api'

import styles from './TellTheGoblin.module.css'

type ResultBody =
  | { kind: 'capture'; capture: Capture }
  | { kind: 'answer'; question: string; reply: AssistantReply }
  | { kind: 'overwhelm' }
  | { kind: 'document'; devour: DevourResponse }
type Result = ResultBody & { id: number }

const MAX_FILE_MB = 10

/**
 * The one place to tell the goblin anything: thoughts, requests, questions,
 * a photo or file. It reuses the existing engines (brain-dump processor,
 * Ask the Goblin, Rescue My Day, Document Devourer) and shows the approval
 * right here, so nothing needs a trip to another page.
 */
export function TellTheGoblin({ prominent = false }: { prominent?: boolean }) {
  const queryClient = useQueryClient()
  const overwhelm = useOverwhelm()
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [keepFile, setKeepFile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Result[]>([])
  const [rescueOpen, setRescueOpen] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // Live copies of captures, so approving an item here updates in place.
  const captures = useQuery({
    queryKey: ['captures'],
    queryFn: fetchCaptures,
    enabled: results.some((r) => r.kind === 'capture'),
  })
  const live = (capture: Capture) =>
    captures.data?.captures.find((c) => c.id === capture.id) ?? capture
  const nextId = useRef(1)

  const voice = useVoiceInput(
    (chunk) =>
      setText((prev) =>
        `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${chunk}`.trim(),
      ),
    setError,
  )

  const add = (result: ResultBody) =>
    setResults((list) =>
      [{ ...result, id: nextId.current++ }, ...list].slice(0, 3),
    )

  const refresh = () =>
    Promise.all(
      [
        'captures',
        'review',
        'den-summary',
        'documents',
        'sorting-documents',
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    )

  const send = useMutation({
    mutationFn: async ({
      words,
      attachment,
    }: {
      words: string
      attachment: File | null
    }) => {
      if (attachment) {
        const devour = await devourDocument(
          attachment,
          keepFile ? 'keep' : 'sort',
        )
        add({ kind: 'document', devour })
      }
      if (!words) return
      const intent = detectIntent(words)
      if (intent === 'overwhelm') {
        add({ kind: 'overwhelm' })
      } else if (intent === 'question') {
        const { reply } = await askAssistant(words)
        add({ kind: 'answer', question: words, reply })
      } else {
        const { capture } = await createCapture(words)
        add({ kind: 'capture', capture })
      }
    },
    onSuccess: async () => {
      setText('')
      setFile(null)
      setKeepFile(false)
      setError(null)
      await refresh()
    },
    onError: (err) =>
      setError(
        err instanceof ApiError
          ? err.message
          : 'The goblin couldn’t take that just now — your words are still here.',
      ),
  })

  function submit(event?: FormEvent) {
    event?.preventDefault()
    const words = text.trim()
    if (!words && !file) return
    send.mutate({ words, attachment: file })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
  }

  function chooseFile(chosen: File | undefined) {
    if (!chosen) return
    if (chosen.size > MAX_FILE_MB * 1024 * 1024) {
      setError(
        `That file is over ${MAX_FILE_MB} MB. Try a smaller copy or a PDF.`,
      )
      return
    }
    setError(null)
    setFile(chosen)
  }

  return (
    <div className={styles.wrap}>
      <form
        className={[styles.box, prominent ? styles.prominent : ''].join(' ')}
        onSubmit={submit}
        aria-label="Tell the Goblin"
      >
        <label className={styles.label} htmlFor="tell-the-goblin">
          What’s on your mind?
        </label>
        <textarea
          id="tell-the-goblin"
          className={styles.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Pay the electricity bill Friday, book the dentist, milk and bread…"
          rows={prominent ? 3 : 2}
        />
        {file ? (
          <div className={styles.attachment}>
            <Paperclip size={14} aria-hidden />
            <span className={styles.fileName}>{file.name}</span>
            <label className={styles.keep}>
              <input
                type="checkbox"
                checked={keepFile}
                onChange={(e) => setKeepFile(e.target.checked)}
              />
              Keep the file
            </label>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setFile(null)}
              aria-label="Remove file"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        ) : null}
        <div className={styles.toolbar}>
          <div className={styles.tools}>
            <button
              type="button"
              className={styles.tool}
              onClick={voice.toggle}
              aria-pressed={voice.listening}
              disabled={!voice.supported}
              title={
                voice.supported
                  ? 'Speak'
                  : 'Voice isn’t supported in this browser'
              }
            >
              {voice.listening ? (
                <MicOff size={18} aria-hidden />
              ) : (
                <Mic size={18} aria-hidden />
              )}
              <span>{voice.listening ? 'Stop' : 'Speak'}</span>
            </button>
            <button
              type="button"
              className={styles.tool}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={18} aria-hidden />
              <span>Add a letter or photo</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              accept=".pdf,.docx,.txt,.md,image/jpeg,image/png,image/webp,image/gif"
              aria-label="Choose a document"
              onChange={(e) => {
                chooseFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
          <Button
            type="submit"
            disabled={send.isPending || (!text.trim() && !file)}
          >
            <Send size={16} aria-hidden />
            {send.isPending ? 'Thinking…' : 'Give it to the Goblin'}
          </Button>
        </div>
        {voice.listening ? (
          <p className={styles.hint}>
            Listening… stop when you’re done, then check the words.
          </p>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>

      <div aria-live="polite" className={styles.results}>
        {results.map((result) => (
          <div key={result.id} className={styles.result}>
            {result.kind === 'capture' ? (
              <>
                <p className={styles.goblinSays}>
                  <span aria-hidden>👹 </span>
                  {live(result.capture).items.length === 0
                    ? 'Got it — saved so nothing gets lost.'
                    : `Here’s what I found. Keep what’s right — nothing is added until you do.`}
                </p>
                <CaptureReview capture={live(result.capture)} />
              </>
            ) : result.kind === 'answer' ? (
              <>
                <p className={styles.question}>“{result.question}”</p>
                <p className={styles.goblinSays}>
                  <span aria-hidden>👹 </span>
                  {result.reply.message}
                </p>
                {result.reply.mode === 'rules' ? (
                  <p className={styles.hint}>
                    Answered from your own Pocket Goblin records.
                  </p>
                ) : null}
                <p className={styles.hint}>
                  <Link to="/ask">Keep talking in Ask the Goblin</Link>
                </p>
              </>
            ) : result.kind === 'overwhelm' ? (
              <>
                <p className={styles.goblinSays}>
                  <span aria-hidden>👹 </span>
                  That’s a lot to carry. Let’s make today smaller — you don’t
                  have to do everything.
                </p>
                <div className={styles.tools}>
                  <Button onClick={() => setRescueOpen(true)}>
                    Sort my day for me
                  </Button>
                  <Button variant="secondary" onClick={() => overwhelm.enter()}>
                    Show me just one thing
                  </Button>
                </div>
              </>
            ) : (
              <DevourReview
                result={result.devour}
                onClose={() =>
                  setResults((list) => list.filter((r) => r.id !== result.id))
                }
              />
            )}
          </div>
        ))}
      </div>
      <RescuePanel open={rescueOpen} onClose={() => setRescueOpen(false)} />
    </div>
  )
}
