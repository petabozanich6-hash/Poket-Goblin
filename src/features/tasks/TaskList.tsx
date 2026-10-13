import { useMutation, useQueryClient } from '@tanstack/react-query'

import type { Task } from '@shared/types'

import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/useAuth'

import {
  pauseTaskSeries,
  skipTaskOccurrence,
  stopTaskSeries,
  updateTask,
} from './tasksApi'
import styles from './TaskList.module.css'

const encouragement = [
  'Nice one. The goblin noticed.',
  'Quest complete — soft applause from the den.',
  'That was a real thing. Well done.',
]

type TaskListProps = {
  tasks: Task[]
  emptyMessage?: string
}

export function TaskList({
  tasks,
  emptyMessage = 'Nothing here yet. Dump a thought or add a task.',
}: TaskListProps) {
  const queryClient = useQueryClient()
  const { settings } = useAuth()

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['plan'] }),
      queryClient.invalidateQueries({ queryKey: ['history'] }),
    ])
  }

  const completeMutation = useMutation({
    mutationFn: (task: Task) =>
      updateTask(task.id, {
        status: task.status === 'completed' ? 'open' : 'completed',
      }),
    onSuccess: refresh,
  })

  const skipMutation = useMutation({
    mutationFn: (id: string) => skipTaskOccurrence(id),
    onSuccess: refresh,
  })
  const pauseMutation = useMutation({
    mutationFn: (id: string) => pauseTaskSeries(id),
    onSuccess: refresh,
  })
  const stopMutation = useMutation({
    mutationFn: (id: string) => stopTaskSeries(id),
    onSuccess: refresh,
  })

  if (tasks.length === 0) {
    return <p className={styles.empty}>{emptyMessage}</p>
  }

  return (
    <ul className={styles.list}>
      {tasks.map((task) => (
        <li key={task.id} className={styles.item}>
          <div className={styles.main}>
            <p
              className={[
                styles.title,
                task.status === 'completed' ? styles.done : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {task.title}
            </p>
            <p className={styles.meta}>
              {task.categoryName ?? 'Uncategorised'}
              {task.dueDate ? ` · due ${task.dueDate}` : ''}
              {` · ${task.priority}`}
              {task.recurrenceRuleId ? ' · repeating' : ''}
            </p>
            {settings?.gamificationEnabled &&
            completeMutation.isSuccess &&
            completeMutation.variables?.id === task.id &&
            task.status !== 'completed' ? (
              <p className={styles.cheer}>
                {
                  encouragement[
                    Math.floor(Math.random() * encouragement.length)
                  ]
                }
              </p>
            ) : null}
          </div>
          <div className={styles.actions}>
            {task.recurrenceRuleId && task.status === 'open' ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => skipMutation.mutate(task.id)}
                >
                  Skip
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => pauseMutation.mutate(task.id)}
                >
                  Pause
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => stopMutation.mutate(task.id)}
                >
                  Stop
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              variant={task.status === 'completed' ? 'secondary' : 'primary'}
              onClick={() => completeMutation.mutate(task)}
            >
              {task.status === 'completed' ? 'Undo' : 'Done'}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}
