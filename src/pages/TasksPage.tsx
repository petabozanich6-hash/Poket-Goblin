import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Card } from '@/components/ui/Card'
import { TaskForm } from '@/features/tasks/TaskForm'
import { TaskList } from '@/features/tasks/TaskList'
import { fetchTasks } from '@/features/tasks/tasksApi'

import styles from './Page.module.css'

export function TasksPage() {
  const [tab, setTab] = useState<'open' | 'completed'>('open')
  const tasksQuery = useQuery({
    queryKey: ['tasks', tab],
    queryFn: () => fetchTasks(tab),
  })

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Tasks</h1>
          <p className={styles.sub}>
            Built-in life categories are ready. No setup ritual required.
          </p>
        </div>
      </header>

      <Card>
        <h2>Add a task</h2>
        <div className={styles.stackTight}>
          <TaskForm />
        </div>
      </Card>

      <Card>
        <div className={styles.tabs}>
          <button
            type="button"
            className={tab === 'open' ? styles.tabActive : styles.tab}
            onClick={() => setTab('open')}
          >
            Open
          </button>
          <button
            type="button"
            className={tab === 'completed' ? styles.tabActive : styles.tab}
            onClick={() => setTab('completed')}
          >
            Completed
          </button>
        </div>
        <TaskList tasks={tasksQuery.data?.tasks ?? []} />
      </Card>
    </div>
  )
}
