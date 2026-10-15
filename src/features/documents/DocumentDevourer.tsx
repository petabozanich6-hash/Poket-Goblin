import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Bell,
  CalendarDays,
  Check,
  FileText,
  ListTodo,
  StickyNote,
  X,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import {
  acceptReviewItem,
  devourDocument,
  dismissReviewItem,
  finishDevouring,
  keepDocumentInstead,
  type DevourResponse,
  type DocumentSuggestion,
} from '@/features/explore/exploreApi'
import { ApiError } from '@/lib/api'

import styles from './DocumentDevourer.module.css'

const TYPE_META: Record<
  DocumentSuggestion['type'],
  { label: string; icon: typeof ListTodo }
> = {
  task: { label: 'Task', icon: ListTodo },
  reminder: { label: 'Reminder', icon: Bell },
  follow_up: { label: 'Follow-up', icon: Bell },
  appointment: { label: 'Calendar', icon: CalendarDays },
  note: { label: 'Note', icon: StickyNote },
}

function needsDate(s: DocumentSuggestion) {
  return (
    s.type === 'appointment' || s.type === 'reminder' || s.type === 'follow_up'
  )
}

function formatDay(iso: string | null) {
  if (!iso) return null
  const d = new Date(`${iso}T12:00:00`)
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function errorText(err: unknown) {
  return err instanceof ApiError
    ? err.message
    : 'Something went wrong — try again.'
}

/** One suggestion: approve (optionally fixing the date) or skip. */
function SuggestionRow({
  suggestion,
  onDone,
}: {
  suggestion: DocumentSuggestion
  onDone: (outcome: 'accepted' | 'skipped') => void
}) {
  const meta = TYPE_META[suggestion.type] ?? TYPE_META.task
  const Icon = meta.icon
  const [date, setDate] = useState(suggestion.dueDate ?? '')
  const [time, setTime] = useState(suggestion.startTime ?? '')
  const [editing, setEditing] = useState(
    suggestion.uncertain || (needsDate(suggestion) && !suggestion.dueDate),
  )
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState(false)

  const accept = useMutation({
    mutationFn: (allowDuplicate: boolean) =>
      acceptReviewItem(suggestion.id, {
        dueDate: date || null,
        startTime: time || null,
        allowDuplicate,
      }),
    onSuccess: () => onDone('accepted'),
    onError: (err) => {
      if (
        err instanceof ApiError &&
        err.status === 409 &&
        err.data.duplicateOf
      ) {
        setDuplicate(true)
      }
      setError(errorText(err))
    },
  })
  const skip = useMutation({
    mutationFn: () => dismissReviewItem(suggestion.id),
    onSuccess: () => onDone('skipped'),
    onError: (err) => setError(errorText(err)),
  })

  const blocked = needsDate(suggestion) && !date

  return (
    <li className={styles.suggestion}>
      <div className={styles.suggestionHead}>
        <span className={styles.typeBadge}>
          <Icon size={14} aria-hidden />
          {meta.label}
        </span>
        <strong>{suggestion.title}</strong>
      </div>
      {suggestion.details ? (
        <p className={styles.muted}>{suggestion.details}</p>
      ) : null}
      {!editing && suggestion.dueDate ? (
        <p className={styles.when}>
          {formatDay(suggestion.dueDate)}
          {suggestion.startTime ? ` at ${suggestion.startTime}` : ''}{' '}
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => setEditing(true)}
          >
            Change
          </button>
        </p>
      ) : null}
      {suggestion.missingInformation.length > 0 ? (
        <p className={styles.check}>
          Please check: {suggestion.missingInformation.join(' · ')}
        </p>
      ) : null}
      {editing ? (
        <div className={styles.dateRow}>
          <label className={styles.field}>
            {suggestion.type === 'task' ? 'Due date (optional)' : 'Date'}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {suggestion.type !== 'task' && suggestion.type !== 'note' ? (
            <label className={styles.field}>
              Time (optional)
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      {suggestion.sourceExcerpt ? (
        <p className={styles.quote}>
          From the document: “{suggestion.sourceExcerpt}”
        </p>
      ) : null}
      <div className={styles.rowActions}>
        <Button
          size="sm"
          onClick={() => accept.mutate(duplicate)}
          disabled={blocked || accept.isPending || skip.isPending}
          title={blocked ? 'Add a date first' : undefined}
        >
          <Check size={16} aria-hidden />
          {duplicate ? 'Add it anyway' : 'Yes, add it'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => skip.mutate()}
          disabled={accept.isPending || skip.isPending}
        >
          <X size={16} aria-hidden />
          Skip
        </Button>
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </li>
  )
}

/** Review a devoured document, then finish (forget) or keep it. */
export function DevourReview({
  result,
  onClose,
}: {
  result: DevourResponse
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const doc = result.document
  const temporary = doc.retention === 'temporary'
  const [open, setOpen] = useState(
    result.suggestions.filter((s) =>
      ['pending', 'snoozed', 'edited'].includes(s.status),
    ),
  )
  const [saved, setSaved] = useState(
    result.suggestions.filter((s) => s.status === 'accepted').length,
  )
  const [devoured, setDevoured] = useState<{ saved: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = () =>
    Promise.all(
      [
        'documents',
        'sorting-documents',
        'review',
        'tasks',
        'den-summary',
        'events',
        'reminders',
      ].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    )

  const finish = useMutation({
    mutationFn: () => finishDevouring(doc.id),
    onSuccess: async (data) => {
      setDevoured({ saved: data.saved })
      await refresh()
    },
    onError: (err) => setError(errorText(err)),
  })
  const keep = useMutation({
    mutationFn: () => keepDocumentInstead(doc.id),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (err) => setError(errorText(err)),
  })

  if (devoured) {
    return (
      <div className={styles.devoured} role="status">
        <p className={styles.devouredTitle}>
          <span aria-hidden>👹 </span>DOCUMENT DEVOURED!
        </p>
        <p>
          {devoured.saved > 0
            ? `${devoured.saved} important bit${devoured.saved === 1 ? '' : 's'} rescued. Paperwork eliminated.`
            : 'Nothing needed saving. Paperwork eliminated.'}
        </p>
        <p className={styles.muted}>
          One less thing rattling around in your brain.
        </p>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Feed me another
        </Button>
      </div>
    )
  }

  const unreadable = doc.status === 'needs_ocr' || doc.status === 'failed'

  return (
    <div className={styles.review}>
      <div className={styles.summary}>
        <span className={styles.goblin} aria-hidden>
          👹
        </span>
        <div>
          {result.message ? (
            <p className={styles.muted}>{result.message}</p>
          ) : null}
          <p className={styles.summaryText}>
            {doc.goblinSummary ??
              (unreadable
                ? (doc.processingError ?? 'I couldn’t read this one.')
                : 'I read it.')}
          </p>
          <p className={styles.muted}>
            <FileText size={14} aria-hidden /> {doc.displayName}
            {temporary
              ? ' · not kept — deleted when you finish'
              : ' · saved in your vault'}
          </p>
        </div>
      </div>
      {result.processing?.warnings?.length ? (
        <ul className={styles.warnings}>
          {result.processing.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {open.length > 0 ? (
        <>
          <p className={styles.muted}>Nothing is added until you say yes.</p>
          <ul className={styles.suggestions}>
            {open.map((s) => (
              <SuggestionRow
                key={s.id}
                suggestion={s}
                onDone={(outcome) => {
                  setOpen((list) => list.filter((x) => x.id !== s.id))
                  if (outcome === 'accepted') setSaved((n) => n + 1)
                  void refresh()
                }}
              />
            ))}
          </ul>
        </>
      ) : !unreadable ? (
        <p className={styles.muted}>
          {saved > 0
            ? `Added ${saved} item${saved === 1 ? '' : 's'}.`
            : 'Nothing left to review.'}
        </p>
      ) : null}

      <div className={styles.rowActions}>
        {temporary ? (
          <>
            <Button onClick={() => finish.mutate()} disabled={finish.isPending}>
              {open.length > 0
                ? 'Done — skip the rest and delete the file'
                : 'Done — delete the file'}
            </Button>
            {!unreadable ? (
              <Button
                variant="ghost"
                onClick={() => keep.mutate()}
                disabled={keep.isPending}
              >
                Keep the file instead
              </Button>
            ) : null}
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        )}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Upload panel: "Just sort it" by default, or keep the document. */
export function DocumentDevourer({
  maxMb,
  onReviewing,
}: {
  maxMb: number
  /** The document currently under review here, so lists can hide it. */
  onReviewing?: (documentId: string | null) => void
}) {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'sort' | 'keep'>('sort')
  const [result, setResult] = useState<DevourResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const upload = useMutation({
    mutationFn: ({ file }: { file: File }) => devourDocument(file, mode),
    onSuccess: async (data) => {
      setError(null)
      setResult(data)
      onReviewing?.(data.document.id)
      await Promise.all(
        ['documents', 'sorting-documents', 'review'].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
    },
    onError: (err) => setError(errorText(err)),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem(
      'file',
    ) as HTMLInputElement
    const file = input.files?.[0]
    if (!file) {
      setError('Choose a file first.')
      return
    }
    if (file.size > maxMb * 1024 * 1024) {
      setError(`That file is over ${maxMb} MB. Try a smaller copy or a PDF.`)
      return
    }
    upload.mutate({ file })
    event.currentTarget.reset()
  }

  if (result)
    return <DevourReview result={result} onClose={() => setResult(null)} />

  return (
    <form className={styles.form} onSubmit={submit}>
      <fieldset className={styles.modes}>
        <legend className={styles.legend}>
          What should the goblin do with it?
        </legend>
        <label className={mode === 'sort' ? styles.modeActive : styles.mode}>
          <input
            type="radio"
            name="mode"
            value="sort"
            checked={mode === 'sort'}
            onChange={() => setMode('sort')}
          />
          <span>
            <strong>Just sort it</strong>
            <span className={styles.muted}>
              I read it, suggest what to do, and delete the file when you’re
              done.
            </span>
          </span>
        </label>
        <label className={mode === 'keep' ? styles.modeActive : styles.mode}>
          <input
            type="radio"
            name="mode"
            value="keep"
            checked={mode === 'keep'}
            onChange={() => setMode('keep')}
          />
          <span>
            <strong>Keep this document</strong>
            <span className={styles.muted}>
              Sort it and save the file in your private vault.
            </span>
          </span>
        </label>
      </fieldset>
      <label className={styles.field}>
        Choose a bill, letter, form or notice (PDF, Word, text or photo · up to{' '}
        {maxMb} MB)
        <input
          name="file"
          type="file"
          accept=".pdf,.docx,.txt,.md,image/jpeg,image/png,image/webp,image/gif,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          required
        />
      </label>
      <Button type="submit" disabled={upload.isPending}>
        {upload.isPending ? 'The goblin is reading…' : 'Feed it to the goblin'}
      </Button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}
