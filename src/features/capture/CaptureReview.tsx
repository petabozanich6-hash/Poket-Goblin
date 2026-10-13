import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { Capture } from '@shared/types'

import { Button } from '@/components/ui/Button'

import { acceptCaptureItem, rejectCaptureItem } from './captureApi'
import styles from './CaptureReview.module.css'

type CaptureReviewProps = {
  capture: Capture
}

export function CaptureReview({ capture }: CaptureReviewProps) {
  const queryClient = useQueryClient()

  const acceptMutation = useMutation({
    mutationFn: ({
      captureId,
      itemId,
    }: {
      captureId: string
      itemId: string
    }) => acceptCaptureItem(captureId, itemId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['captures'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['plan'] }),
      ])
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({
      captureId,
      itemId,
    }: {
      captureId: string
      itemId: string
    }) => rejectCaptureItem(captureId, itemId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['captures'] })
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
                {item.dueDate ? ` · due ${item.dueDate}` : ' · no date guessed'}
                {item.uncertain ? ' · needs your eyes' : ''}
                {` · ${item.confidence} confidence`}
              </p>
            </div>
            {item.status === 'suggested' ? (
              <div className={styles.actions}>
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
    </article>
  )
}
