import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'

import { dismissNudge, fetchNudges, snoozeNudge } from './magicalApi'
import styles from './DailyBriefing.module.css'

export function NudgeTray() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const nudges = useQuery({
    queryKey: ['nudges'],
    queryFn: fetchNudges,
    refetchInterval: 120_000,
  })

  const snooze = useMutation({
    mutationFn: (id: string) => snoozeNudge(id, 60),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nudges'] })
    },
  })
  const dismiss = useMutation({
    mutationFn: dismissNudge,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['nudges'] })
    },
  })

  const count = nudges.data?.nudges.length ?? 0

  return (
    <div style={{ position: 'relative' }}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={
          count > 0 ? `Gentle nudges, ${count} waiting` : 'Gentle nudges'
        }
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={16} aria-hidden />
        {count > 0 ? ` ${count}` : ''}
      </Button>
      {open ? (
        <div
          className={styles.briefing}
          style={{
            position: 'absolute',
            right: 0,
            top: '2.5rem',
            width: 'min(20rem, 90vw)',
            padding: '1rem',
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            zIndex: 20,
            boxShadow: 'var(--shadow-soft)',
          }}
          role="region"
          aria-label="In-app nudges"
        >
          {nudges.data?.quiet || nudges.data?.message ? (
            <p className={styles.body}>
              {nudges.data.message ?? 'Quiet for now.'}
            </p>
          ) : null}
          {(nudges.data?.nudges.length ?? 0) === 0 ? (
            <p className={styles.body}>No gentle nudges right now.</p>
          ) : (
            <ul className={styles.facts}>
              {nudges.data?.nudges.map((nudge) => (
                <li key={nudge.id} className={styles.fact}>
                  <div>
                    <strong>{nudge.title}</strong>
                    <div className={styles.modeNote}>{nudge.body}</div>
                    <div className={styles.actions}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => snooze.mutate(nudge.id)}
                      >
                        Snooze 1h
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => dismiss.mutate(nudge.id)}
                      >
                        Mute
                      </Button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.modeNote}>
            In-app only — no push or email unless you configure and opt in
            later.
          </p>
        </div>
      ) : null}
    </div>
  )
}
