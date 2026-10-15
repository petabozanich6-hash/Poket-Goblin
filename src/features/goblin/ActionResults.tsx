import { useQueryClient } from '@tanstack/react-query'
import { Check, Undo2 } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { ApiError } from '@/lib/api'

import {
  confirmGoblinAction,
  declineGoblinAction,
  GOBLIN_QUERY_KEYS,
  undoGoblinAction,
  type GoblinResult,
} from './goblinApi'
import styles from './TellTheGoblin.module.css'

type LineState = 'idle' | 'busy' | 'undone' | 'confirmed' | 'declined'

function Line({ result }: { result: GoblinResult }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<LineState>('idle')
  const [note, setNote] = useState<string | null>(null)

  async function run(
    fn: () => Promise<{ message?: string } | unknown>,
    next: LineState,
  ) {
    setState('busy')
    try {
      const res = (await fn()) as { message?: string }
      setNote(res?.message ?? null)
      setState(next)
      await Promise.all(
        GOBLIN_QUERY_KEYS.map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      )
    } catch (err) {
      setNote(
        err instanceof ApiError ? err.message : 'That didn’t work — try again.',
      )
      setState('idle')
    }
  }

  if (result.kind === 'info')
    return <li className={styles.line}>{result.message}</li>

  if (result.kind === 'done') {
    return (
      <li className={styles.line}>
        <span className={state === 'undone' ? styles.struck : undefined}>
          <Check size={16} aria-hidden className={styles.tick} />{' '}
          {result.message}
        </span>
        {state === 'undone' ? (
          <span className={styles.lineNote}>Undone.</span>
        ) : result.undoable ? (
          <button
            type="button"
            className={styles.undo}
            disabled={state === 'busy'}
            onClick={() =>
              void run(() => undoGoblinAction(result.actionId), 'undone')
            }
          >
            <Undo2 size={14} aria-hidden /> Undo
          </button>
        ) : null}
        {note && state === 'idle' ? (
          <span className={styles.error}>{note}</span>
        ) : null}
      </li>
    )
  }

  if (result.kind === 'confirm') {
    if (state === 'confirmed' || state === 'declined') {
      return (
        <li className={styles.line}>
          {state === 'confirmed' ? (note ?? 'Done.') : 'Okay, left as it was.'}
        </li>
      )
    }
    return (
      <li className={styles.line}>
        <span>{result.message}</span>
        <span className={styles.lineActions}>
          <Button
            size="sm"
            disabled={state === 'busy'}
            onClick={() =>
              void run(() => confirmGoblinAction(result.actionId), 'confirmed')
            }
          >
            Yes
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={state === 'busy'}
            onClick={() =>
              void run(() => declineGoblinAction(result.actionId), 'declined')
            }
          >
            No
          </Button>
        </span>
        {note && state === 'idle' ? (
          <span className={styles.error}>{note}</span>
        ) : null}
      </li>
    )
  }

  // clarify
  if (state === 'confirmed' || state === 'declined') {
    return (
      <li className={styles.line}>
        {state === 'confirmed' ? (note ?? 'Done.') : 'Okay, nothing changed.'}
      </li>
    )
  }
  return (
    <li className={styles.line}>
      <span>{result.message}</span>
      <span className={styles.lineActions}>
        {result.options.map((option) => (
          <Button
            key={option.actionId}
            size="sm"
            variant="secondary"
            disabled={state === 'busy'}
            onClick={() =>
              void run(() => confirmGoblinAction(option.actionId), 'confirmed')
            }
          >
            {option.label}
          </Button>
        ))}
        <Button
          size="sm"
          variant="ghost"
          disabled={state === 'busy'}
          onClick={() => {
            const first = result.options[0]
            if (first)
              void run(() => declineGoblinAction(first.actionId), 'declined')
          }}
        >
          None of these
        </Button>
      </span>
      {note && state === 'idle' ? (
        <span className={styles.error}>{note}</span>
      ) : null}
    </li>
  )
}

/** The Goblin's replies: what it did (with Undo), what it needs to know. */
export function ActionResults({ results }: { results: GoblinResult[] }) {
  return (
    <ul className={styles.lines}>
      {results.map((result, i) => (
        <Line
          key={
            'actionId' in result ? result.actionId : `${i}-${result.message}`
          }
          result={result}
        />
      ))}
    </ul>
  )
}
