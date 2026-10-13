import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { RecurrenceFrequency, TaskPriority } from '@shared/types'

import { Button } from '@/components/ui/Button'
import { Input, TextArea } from '@/components/ui/Input'
import { ApiError } from '@/lib/api'

import { createTask, fetchCategories } from './tasksApi'
import styles from './TaskForm.module.css'

export function TaskForm({ onCreated }: { onCreated?: () => void }) {
  const queryClient = useQueryClient()
  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
  })

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [categorySlug, setCategorySlug] = useState('other')
  const [recurrence, setRecurrence] = useState<RecurrenceFrequency | ''>('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: createTask,
    onSuccess: async () => {
      setTitle('')
      setNotes('')
      setDueDate('')
      setPriority('normal')
      setRecurrence('')
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['tasks'] }),
        queryClient.invalidateQueries({ queryKey: ['plan'] }),
      ])
      onCreated?.()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not save task')
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    mutation.mutate({
      title,
      notes,
      priority,
      dueDate: dueDate || null,
      categorySlug,
      recurrenceFrequency: recurrence || null,
    })
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <Input
        label="Task"
        name="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
        placeholder="What needs doing?"
      />
      <TextArea
        label="Notes"
        name="notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional details"
      />
      <div className={styles.row}>
        <label className={styles.field}>
          <span>Due date</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          <span>Priority</span>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Category</span>
          <select
            value={categorySlug}
            onChange={(e) => setCategorySlug(e.target.value)}
          >
            {(categoriesQuery.data?.categories ?? []).map((category) => (
              <option key={category.id} value={category.slug}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          <span>Repeat</span>
          <select
            value={recurrence}
            onChange={(e) =>
              setRecurrence(e.target.value as RecurrenceFrequency | '')
            }
          >
            <option value="">Doesn’t repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      <Button type="submit" disabled={mutation.isPending || !title.trim()}>
        {mutation.isPending ? 'Saving…' : 'Add task'}
      </Button>
    </form>
  )
}
