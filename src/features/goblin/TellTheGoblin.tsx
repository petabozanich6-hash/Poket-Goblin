import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic, MicOff, Paperclip, Send, X } from 'lucide-react'
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'

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

import { ActionResults } from './ActionResults'
import { goblinAct, GOBLIN_QUERY_KEYS, type GoblinResult } from './goblinApi'
import styles from './TellTheGoblin.module.css'

type ResultBody =
  | { kind: 'actions'; said: string; results: GoblinResult[] }
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
  const [files, setFiles] = useState<File[]>([])
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

  // Never silently discard a document review, Undo or confirmation.
  // The old three-result cap could hide decisions before the user made them.
  const add = (result: ResultBody) =>
    setResults((list) => [{ ...result, id: nextId.current++ }, ...list])

  const refresh = () =>
    Promise.all(
      [
        'captures',
        'review',
        'documents',
        'sorting-documents',
        ...GOBLIN_QUERY_KEYS,
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    )

  const send = useMutation({
    mutationFn: async ({
      words,
      attachments,
      mode,
    }: {
      words: string
      attachments: File[]
      mode: 'keep' | 'sort'
    }) => {
      const failures: string[] = []
      for (const attachment of attachments) {
        try {
          const devour = await devourDocument(attachment, mode)
          add({ kind: 'document', devour })
        } catch (err) {
          const message =
            err instanceof ApiError ? err.message : 'Could not read this file.'
          failures.push(`${attachment.name}: ${message}`)
        }
      }
      if (failures.length) setError(failures.join(' · '))
      if (!words) return
      // 1. The Goblin acts on what it can against the user's own records.
      const acted = await goblinAct(words)
      if (acted.results.length)
        add({ kind: 'actions', said: words, results: acted.results })
      // 2. Everything else goes to the existing engines.
      if (acted.overwhelm) add({ kind: 'overwhelm' })
      for (const question of acted.questions) {
        const { reply } = await askAssistant(question)
        add({ kind: 'answer', question, reply })
      }
      if (acted.capture.length) {
        const { capture } = await createCapture(acted.capture.join(' '))
        add({ kind: 'capture', capture })
      }
    },
    onSuccess: async () => {
      setText('')
      setFiles([])
      setKeepFile(false)
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
    if (!words && !files.length) return
    setError(null)
    send.mutate({
      words,
      attachments: files,
      mode: keepFile ? 'keep' : 'sort',
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit()
  }

  function chooseFiles(chosen: File[]) {
    if (!chosen.length) return
    if (chosen.length > 10) {
      setError('Choose up to 10 documents at a time.')
      return
    }
    const oversized = chosen.find(
      (item) => item.size > MAX_FILE_MB * 1024 * 1024,
    )
    if (oversized) {
      setError(`Each file must be under ${MAX_FILE_MB} MB: ${oversized.name}`)
      return
    }
    setError(null)
    setFiles(chosen)
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
        {files.length ? (
          <div className={styles.attachment}>
            <Paperclip size={14} aria-hidden />
            <div
              className={styles.fileName}
              aria-label="Documents ready to upload"
            >
              <strong>{files.length} document(s) selected</strong>
              <ul>
                {files.map((item, index) => (
                  <li key={`${index}-${item.name}`}>{item.name}</li>
                ))}
              </ul>
            </div>
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
              onClick={() => setFiles([])}
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
              <span>Upload up to 10 documents</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              hidden
              multiple
              accept=".pdf,.docx,.txt,.md,image/jpeg,image/png,image/webp,image/gif"
              aria-label="Upload up to 10 documents"
              onChange={(e) => {
                chooseFiles(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
          </div>
          <Button
            type="submit"
            disabled={send.isPending || (!text.trim() && !files.length)}
          >
            <Send size={16} aria-hidden />
            {send.isPending
              ? send.variables?.attachments.some((item) =>
                  item.type.startsWith('image/'),
                )
                ? 'Reading your photo — about 15 seconds…'
                : 'Thinking…'
              : 'Give it to the Goblin'}
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
            {result.kind === 'actions' ? (
              <>
                <p className={styles.question}>“{result.said}”</p>
                <ActionResults results={result.results} />
              </>
            ) : result.kind === 'capture' ? (
              <>
                <p className={styles.goblinSays}>
                  <span aria-hidden>👹 </span>
                  {live(result.capture).items.length === 0
                    ? 'Got it — saved so nothing gets lost.'
                    : `I wasn’t sure about these — keep what’s right.`}
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
