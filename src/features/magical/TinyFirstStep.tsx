import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import type { Task } from '@shared/types'

import { Button } from '@/components/ui/Button'
import { updateTask } from '@/features/tasks/tasksApi'

import { acceptTinyStep, fetchTinySteps } from './magicalApi'
import styles from './DailyBriefing.module.css'

type Props = {
  task: Task
}

export function TinyFirstStep({ task }: Props) {
  const [open, setOpen] = useState(false)
  const [steps, setSteps] = useState<string[]>([])
  const [note, setNote] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const load = useMutation({
    mutationFn: (current?: string) => fetchTinySteps(task.title, current),
    onSuccess: (data) => {
      setSteps(data.steps.map((s) => s.title))
      setNote(data.note)
      setOpen(true)
    },
  })

  const accept = useMutation({
    mutationFn: (title: string) => acceptTinyStep(task.id, title),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setNote('Added as a subtask. Tiny is enough.')
    },
  })

  const completeStep = useMutation({
    mutationFn: async (title: string) => {
      const created = await acceptTinyStep(task.id, title)
      await updateTask(created.task.id, { status: 'completed' })
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
      setNote('Tiny step done. One less rattle.')
    },
  })

  if (task.status !== 'open') return null

  return (
    <div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (open) {
            setOpen(false)
            return
          }
          load.mutate(undefined)
        }}
        aria-expanded={open}
      >
        Help me start
      </Button>
      {open ? (
        <div className={styles.briefing} style={{ marginTop: '0.5rem' }}>
          <ul className={styles.facts}>
            {steps.map((title) => (
              <li key={title} className={styles.fact}>
                <span>{title}</span>
                <span className={styles.actions}>
                  <Button
                    size="sm"
                    onClick={() => accept.mutate(title)}
                    disabled={accept.isPending}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => completeStep.mutate(title)}
                    disabled={completeStep.isPending}
                  >
                    Done
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => load.mutate(steps[0])}
            >
              Smaller
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => load.mutate(undefined)}
            >
              Another
            </Button>
          </div>
          {note ? <p className={styles.modeNote}>{note}</p> : null}
        </div>
      ) : null}
    </div>
  )
}
