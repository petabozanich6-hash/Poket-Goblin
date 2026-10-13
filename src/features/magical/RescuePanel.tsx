import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'

import { goblinLine } from '@shared/magical/personality'
import type { RescueSuggestion } from '@shared/magical'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

import { acceptRescue, dismissRescue, proposeRescue } from './magicalApi'
import styles from './DailyBriefing.module.css'

type Props = {
  open: boolean
  onClose: () => void
}

export function RescuePanel({ open, onClose }: Props) {
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()
  const [rescueId, setRescueId] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<RescueSuggestion | null>(null)
  const [keepIds, setKeepIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const rescueParam = params.get('rescue')

  const load = useMutation({
    mutationFn: proposeRescue,
    onSuccess: (data) => {
      setRescueId(data.rescueId)
      setSuggestion(data.suggestion)
      setKeepIds(data.suggestion.keep.map((k) => k.task.id))
      setError(null)
    },
    onError: () => setError('Could not build a rescue plan right now.'),
  })

  useEffect(() => {
    if (rescueParam === '1') {
      load.mutate()
      const next = new URLSearchParams(params)
      next.delete('rescue')
      setParams(next, { replace: true })
    }
    // Bootstrap from URL once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescueParam])

  useEffect(() => {
    if (open && !suggestion && !load.isPending && !load.isSuccess) {
      load.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const accept = useMutation({
    mutationFn: () => acceptRescue(rescueId!, keepIds),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plan'] }),
        queryClient.invalidateQueries({ queryKey: ['briefing'] }),
        queryClient.invalidateQueries({ queryKey: ['priorities'] }),
      ])
      onClose()
      setSuggestion(null)
      load.reset()
    },
  })

  if (!open) return null

  function toggle(id: string) {
    setKeepIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  return (
    <Card>
      <div className={styles.briefing}>
        <h2 className={styles.headline}>Rescue my day</h2>
        <p className={styles.body}>{goblinLine('rescuePlan')}</p>
        {load.isPending ? (
          <p className={styles.body}>Sketching a realistic remainder…</p>
        ) : null}
        {error ? <p className={styles.body}>{error}</p> : null}
        {suggestion ? (
          <>
            <p className={styles.body}>{suggestion.summary}</p>
            <p className={styles.modeNote}>{suggestion.note}</p>
            {suggestion.remainingAppointments.length > 0 ? (
              <ul className={styles.facts}>
                {suggestion.remainingAppointments.map((event) => (
                  <li key={event.id} className={styles.fact}>
                    <span className={styles.badge}>Appt</span>
                    <span>{event.title} (unchanged)</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <h3 className={styles.headline}>Keep in focus</h3>
            <ul className={styles.facts}>
              {suggestion.keep.map((row) => (
                <li key={row.task.id} className={styles.fact}>
                  <label>
                    <input
                      type="checkbox"
                      checked={keepIds.includes(row.task.id)}
                      onChange={() => toggle(row.task.id)}
                    />{' '}
                    <strong>{row.task.title}</strong>
                    <div className={styles.modeNote}>{row.reason}</div>
                  </label>
                </li>
              ))}
            </ul>
            {suggestion.defer.length > 0 ? (
              <>
                <h3 className={styles.headline}>Park for later</h3>
                <ul className={styles.facts}>
                  {suggestion.defer.slice(0, 6).map((row) => (
                    <li key={row.task.id} className={styles.fact}>
                      <label>
                        <input
                          type="checkbox"
                          checked={keepIds.includes(row.task.id)}
                          onChange={() => toggle(row.task.id)}
                        />{' '}
                        {row.task.title}
                        <div className={styles.modeNote}>{row.reason}</div>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className={styles.actions}>
              <Button
                onClick={() => accept.mutate()}
                disabled={!rescueId || accept.isPending}
              >
                Accept revised plan
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  if (rescueId) void dismissRescue(rescueId)
                  setSuggestion(null)
                  load.reset()
                  onClose()
                }}
              >
                Keep original plan
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Card>
  )
}
