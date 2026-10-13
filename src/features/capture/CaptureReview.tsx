import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { Capture, CaptureItemKind } from '@shared/types'

import { Button } from '@/components/ui/Button'
import { updateCaptureItem } from '@/features/life/lifeApi'

import { acceptCaptureItem, rejectCaptureItem } from './captureApi'
import styles from './CaptureReview.module.css'

type CaptureReviewProps = {
  capture: Capture
}

const kinds: CaptureItemKind[] = [
  'task',
  'appointment',
  'reminder',
  'note',
  'shopping',
  'follow_up',
]

export function CaptureReview({ capture }: CaptureReviewProps) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)

  async function invalidateAll() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['captures'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['plan'] }),
      queryClient.invalidateQueries({ queryKey: ['events'] }),
      queryClient.invalidateQueries({ queryKey: ['reminders'] }),
      queryClient.invalidateQueries({ queryKey: ['notes'] }),
      queryClient.invalidateQueries({ queryKey: ['shopping'] }),
      queryClient.invalidateQueries({ queryKey: ['den-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['history'] }),
      queryClient.invalidateQueries({ queryKey: ['review'] }),
      queryClient.invalidateQueries({ queryKey: ['briefing'] }),
      queryClient.invalidateQueries({ queryKey: ['priorities'] }),
      queryClient.invalidateQueries({ queryKey: ['nudges'] }),
    ])
  }

  const acceptMutation = useMutation({
    mutationFn: ({
      captureId,
      itemId,
    }: {
      captureId: string
      itemId: string
    }) => acceptCaptureItem(captureId, itemId),
    onSuccess: invalidateAll,
  })

  const rejectMutation = useMutation({
    mutationFn: ({
      captureId,
      itemId,
    }: {
      captureId: string
      itemId: string
    }) => rejectCaptureItem(captureId, itemId),
    onSuccess: invalidateAll,
  })

  const editMutation = useMutation({
    mutationFn: ({
      captureId,
      itemId,
      kind,
    }: {
      captureId: string
      itemId: string
      kind: CaptureItemKind
    }) => updateCaptureItem(captureId, itemId, { kind }),
    onSuccess: async () => {
      setEditingId(null)
      await invalidateAll()
    },
  })

  return (
    <article className={styles.card}>
      <p className={styles.raw}>“{capture.rawText}”</p>
      <ul className={styles.list}>
        {capture.items.map((item) => (
          <li key={item.id} className={styles.item}>
            <div>
              <p className={styles.title}>{item.title}</p>
              <p className={styles.meta}>
                {item.kind}
                {item.categorySlug ? ` · ${item.categorySlug}` : ''}
                {item.dueDate ? ` · ${item.dueDate}` : ' · no date guessed'}
                {item.startTime ? ` · ${item.startTime}` : ''}
                {item.recurrenceFrequency
                  ? ` · repeats ${item.recurrenceFrequency}`
                  : ''}
                {item.uncertain ? ' · needs your eyes' : ''}
                {` · ${item.confidence} confidence`}
              </p>
              {editingId === item.id ? (
                <div className={styles.kindRow}>
                  {kinds.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={styles.kindChip}
                      onClick={() =>
                        editMutation.mutate({
                          captureId: capture.id,
                          itemId: item.id,
                          kind,
                        })
                      }
                    >
                      {kind}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {item.status === 'suggested' ? (
              <div className={styles.actions}>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setEditingId(editingId === item.id ? null : item.id)
                  }
                >
                  Type
                </Button>
                <Button
                  size="sm"
                  onClick={() =>
                    acceptMutation.mutate({
                      captureId: capture.id,
                      itemId: item.id,
                    })
                  }
                >
                  Keep
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    rejectMutation.mutate({
                      captureId: capture.id,
                      itemId: item.id,
                    })
                  }
                >
                  Skip
                </Button>
              </div>
            ) : (
              <span className={styles.status}>{item.status}</span>
            )}
          </li>
        ))}
      </ul>
      {acceptMutation.isError ? (
        <p className={styles.error}>
          {(acceptMutation.error as Error).message ||
            'Could not accept that suggestion — check the date if needed.'}
        </p>
      ) : null}
    </article>
  )
}
