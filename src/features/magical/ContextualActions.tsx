import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { useState } from 'react'

import type { Task } from '@shared/types'

import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'

import styles from './DailyBriefing.module.css'

type Props = {
  task: Task
}

export function ContextualActions({ task }: Props) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const addReminder = useMutation({
    mutationFn: () =>
      api.post<{ reminder: { id: string } }>('/reminders', {
        title: `Follow up: ${task.title}`,
        remindAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
        entityType: 'task',
        entityId: task.id,
      }),
    onSuccess: async () => {
      setMessage('Reminder set for tomorrow.')
      await queryClient.invalidateQueries({ queryKey: ['den-summary'] })
    },
    onError: () => setMessage('Could not add reminder.'),
  })

  const addToPlan = useMutation({
    mutationFn: () =>
      api.post('/plan/today/add', {
        taskId: task.id,
        timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      }),
    onSuccess: async () => {
      setMessage('Added to today’s plan.')
      await queryClient.invalidateQueries({ queryKey: ['plan'] })
    },
    onError: () => setMessage('Could not update plan — open Plan to adjust.'),
  })

  if (task.status !== 'open') return null

  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        More
      </Button>
      {open ? (
        <div className={styles.actions} style={{ marginTop: '0.35rem' }}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => addReminder.mutate()}
            disabled={addReminder.isPending}
          >
            Add reminder
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => addToPlan.mutate()}
            disabled={addToPlan.isPending}
          >
            Add to today
          </Button>
          <Link to="/vault">
            <Button size="sm" variant="ghost">
              Link document
            </Button>
          </Link>
          {message ? <span className={styles.modeNote}>{message}</span> : null}
        </div>
      ) : null}
    </div>
  )
}
