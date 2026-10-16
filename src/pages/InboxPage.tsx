import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import {
  acceptReviewItem,
  dismissReviewItem,
  fetchReviewItems,
  snoozeReviewItem,
} from '@/features/explore/exploreApi'
import { ApiError } from '@/lib/api'

import styles from './Page.module.css'

function duplicateTitle(payload: unknown): string | null {
  const ref = (payload as { possibleDuplicateOf?: { title?: unknown } } | null)
    ?.possibleDuplicateOf
  return typeof ref?.title === 'string' ? ref.title : null
}

export function InboxPage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'pending' | 'all'>('pending')
  const [dueEdits, setDueEdits] = useState<Record<string, string>>({})
  const [banner, setBanner] = useState<string | null>(null)

  const reviewQuery = useQuery({
    queryKey: ['review', tab],
    queryFn: () => fetchReviewItems(tab === 'pending' ? 'pending' : 'all'),
  })

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['review'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['events'] }),
      queryClient.invalidateQueries({ queryKey: ['reminders'] }),
      queryClient.invalidateQueries({ queryKey: ['notes'] }),
      queryClient.invalidateQueries({ queryKey: ['shopping'] }),
      queryClient.invalidateQueries({ queryKey: ['documents'] }),
      queryClient.invalidateQueries({ queryKey: ['den-summary'] }),
    ])
  }

  const acceptMutation = useMutation({
    mutationFn: ({ id, dueDate }: { id: string; dueDate?: string | null }) =>
      acceptReviewItem(id, { dueDate }),
    onSuccess: invalidate,
    onError: (err) => {
      setBanner(err instanceof ApiError ? err.message : 'Could not accept')
    },
  })
  const dismissMutation = useMutation({
    mutationFn: dismissReviewItem,
    onSuccess: invalidate,
  })
  const snoozeMutation = useMutation({
    mutationFn: (id: string) => snoozeReviewItem(id, 24),
    onSuccess: invalidate,
  })

  const items = reviewQuery.data?.items ?? []

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Inbox</h1>
          <p className={styles.sub}>
            One calm review shelf for dumps and documents — without the clutter.
          </p>
        </div>
      </header>

      {banner ? <p className={styles.sub}>{banner}</p> : null}

      <Card>
        <div className={styles.tabs}>
          <button
            type="button"
            className={tab === 'pending' ? styles.tabActive : styles.tab}
            onClick={() => setTab('pending')}
          >
            Awaiting review
          </button>
          <button
            type="button"
            className={tab === 'all' ? styles.tabActive : styles.tab}
            onClick={() => setTab('all')}
          >
            History
          </button>
        </div>
        {items.length === 0 ? (
          <p className={styles.sub}>
            Nothing waiting. Capture a thought, upload a document, or speak a
            dump when something pops up.
          </p>
        ) : (
          <ul className={styles.stack}>
            {items.map((item) => (
              <li key={item.id} className={styles.listRow}>
                <div>
                  <strong>{item.title}</strong>
                  <p className={styles.sub}>
                    {item.suggestionType} · from {item.sourceType}
                    {item.uncertain ? ' · needs confirmation' : ''}
                    {duplicateTitle(item.payload)
                      ? ` · you already have “${duplicateTitle(item.payload)}”`
                      : ''}
                    {item.status !== 'pending' ? ` · ${item.status}` : ''}
                  </p>
                  {item.summary ? (
                    <p className={styles.sub}>{item.summary}</p>
                  ) : null}
                  {item.status === 'pending' || item.status === 'snoozed' ? (
                    <Input
                      label="Confirm date (if needed)"
                      type="date"
                      value={dueEdits[item.id] ?? ''}
                      onChange={(e) =>
                        setDueEdits((prev) => ({
                          ...prev,
                          [item.id]: e.target.value,
                        }))
                      }
                    />
                  ) : null}
                </div>
                {item.status === 'pending' || item.status === 'snoozed' ? (
                  <div className={styles.tabs}>
                    <Button
                      size="sm"
                      disabled={acceptMutation.isPending}
                      onClick={() =>
                        acceptMutation.mutate({
                          id: item.id,
                          dueDate: dueEdits[item.id] || null,
                        })
                      }
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => snoozeMutation.mutate(item.id)}
                    >
                      Snooze
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => dismissMutation.mutate(item.id)}
                    >
                      Dismiss
                    </Button>
                    {item.sourceType === 'document' && item.sourceId ? (
                      <Link className={styles.tab} to="/life/documents">
                        Open vault
                      </Link>
                    ) : null}
                    {item.sourceType === 'capture' ? (
                      <Link className={styles.tab} to="/tell">
                        Open dump
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

    </div>
  )
}
