import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, TextArea } from '@/components/ui/Input'
import {
  addShoppingItem,
  completeReminder,
  createNote,
  createReminder,
  deleteNote,
  dismissReminder,
  fetchDueReminders,
  fetchNotes,
  fetchReminders,
  fetchShopping,
  fetchTaskHistory,
  snoozeReminder,
  updateNote,
  updateShoppingItem,
} from '@/features/life/lifeApi'

import styles from './Page.module.css'

type Tab = 'shopping' | 'notes' | 'reminders' | 'history'

export function LifePage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('shopping')
  const [itemName, setItemName] = useState('')
  const [noteTitle, setNoteTitle] = useState('')
  const [noteBody, setNoteBody] = useState('')
  const [reminderTitle, setReminderTitle] = useState('')
  const [remindAt, setRemindAt] = useState('')

  const shoppingQuery = useQuery({
    queryKey: ['shopping'],
    queryFn: fetchShopping,
  })
  const notesQuery = useQuery({
    queryKey: ['notes'],
    queryFn: () => fetchNotes(),
  })
  const remindersQuery = useQuery({
    queryKey: ['reminders'],
    queryFn: () => fetchReminders('pending'),
  })
  const dueQuery = useQuery({
    queryKey: ['reminders', 'due'],
    queryFn: fetchDueReminders,
  })
  const historyQuery = useQuery({
    queryKey: ['history'],
    queryFn: fetchTaskHistory,
  })

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['shopping'] }),
      queryClient.invalidateQueries({ queryKey: ['notes'] }),
      queryClient.invalidateQueries({ queryKey: ['reminders'] }),
      queryClient.invalidateQueries({ queryKey: ['history'] }),
      queryClient.invalidateQueries({ queryKey: ['den-summary'] }),
    ])
  }

  const addItem = useMutation({
    mutationFn: addShoppingItem,
    onSuccess: async () => {
      setItemName('')
      await invalidate()
    },
  })
  const toggleItem = useMutation({
    mutationFn: ({ id, checked }: { id: string; checked: boolean }) =>
      updateShoppingItem(id, { checked }),
    onSuccess: invalidate,
  })
  const saveNote = useMutation({
    mutationFn: createNote,
    onSuccess: async () => {
      setNoteTitle('')
      setNoteBody('')
      await invalidate()
    },
  })
  const pinNote = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      updateNote(id, { pinned }),
    onSuccess: invalidate,
  })
  const removeNote = useMutation({
    mutationFn: deleteNote,
    onSuccess: invalidate,
  })
  const saveReminder = useMutation({
    mutationFn: createReminder,
    onSuccess: async () => {
      setReminderTitle('')
      setRemindAt('')
      await invalidate()
    },
  })

  const defaultList = shoppingQuery.data?.lists.find((list) => list.isDefault)

  function onAddItem(event: FormEvent) {
    event.preventDefault()
    if (!itemName.trim()) return
    addItem.mutate({ name: itemName.trim() })
  }

  function onAddNote(event: FormEvent) {
    event.preventDefault()
    if (!noteTitle.trim()) return
    saveNote.mutate({ title: noteTitle.trim(), body: noteBody })
  }

  function onAddReminder(event: FormEvent) {
    event.preventDefault()
    if (!reminderTitle.trim() || !remindAt) return
    saveReminder.mutate({
      title: reminderTitle.trim(),
      remindAt: new Date(remindAt).toISOString(),
    })
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Life shelves</h1>
          <p className={styles.sub}>
            Shopping, notes, reminders and history — without forcing you to
            invent a filing system first.
          </p>
        </div>
      </header>

      <div className={styles.tabs}>
        {(
          [
            ['shopping', 'Shopping'],
            ['notes', 'Notes'],
            ['reminders', 'Reminders'],
            ['history', 'History'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? styles.tabActive : styles.tab}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'shopping' ? (
        <Card>
          <h2>{defaultList?.name ?? 'Groceries'}</h2>
          <form className={styles.inlineForm} onSubmit={onAddItem}>
            <Input
              label="Add item"
              name="item"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="Milk, bread…"
            />
            <Button type="submit">Add</Button>
          </form>
          <ul className={styles.stack}>
            {(defaultList?.items ?? []).map((item) => (
              <li key={item.id} className={styles.listRow}>
                <label className={styles.checkField}>
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={(e) =>
                      toggleItem.mutate({
                        id: item.id,
                        checked: e.target.checked,
                      })
                    }
                  />
                  <span className={item.checked ? styles.doneText : undefined}>
                    {item.name}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {(defaultList?.items.length ?? 0) === 0 ? (
            <p className={styles.sub}>Your grocery list is empty — luxury.</p>
          ) : null}
        </Card>
      ) : null}

      {tab === 'notes' ? (
        <>
          <Card>
            <h2>New note</h2>
            <form className={styles.stackTight} onSubmit={onAddNote}>
              <Input
                label="Title"
                name="noteTitle"
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                required
              />
              <TextArea
                label="Body"
                name="noteBody"
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
              />
              <Button type="submit">Save note</Button>
            </form>
          </Card>
          <Card>
            <h2>Your notes</h2>
            <ul className={styles.stack}>
              {(notesQuery.data?.notes ?? []).map((note) => (
                <li key={note.id} className={styles.listRow}>
                  <div>
                    <strong>
                      {note.pinned ? '📌 ' : ''}
                      {note.title}
                    </strong>
                    <p className={styles.sub}>{note.body || 'No body text'}</p>
                  </div>
                  <div className={styles.rowActions}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        pinNote.mutate({ id: note.id, pinned: !note.pinned })
                      }
                    >
                      {note.pinned ? 'Unpin' : 'Pin'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeNote.mutate(note.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}

      {tab === 'reminders' ? (
        <>
          <Card>
            <h2>Due now</h2>
            <ul className={styles.stack}>
              {(dueQuery.data?.reminders ?? []).length === 0 ? (
                <p className={styles.sub}>Nothing nagging you right now.</p>
              ) : (
                (dueQuery.data?.reminders ?? []).map((reminder) => (
                  <li key={reminder.id} className={styles.listRow}>
                    <div>
                      <strong>{reminder.title}</strong>
                      <p className={styles.sub}>
                        {new Date(reminder.remindAt).toLocaleString()}
                      </p>
                    </div>
                    <div className={styles.rowActions}>
                      <Button
                        size="sm"
                        onClick={() =>
                          void snoozeReminder(reminder.id, 60).then(invalidate)
                        }
                      >
                        Snooze 1h
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void completeReminder(reminder.id).then(invalidate)
                        }
                      >
                        Done
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void dismissReminder(reminder.id).then(invalidate)
                        }
                      >
                        Dismiss
                      </Button>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </Card>
          <Card>
            <h2>Schedule a reminder</h2>
            <form className={styles.stackTight} onSubmit={onAddReminder}>
              <Input
                label="Reminder"
                name="reminderTitle"
                value={reminderTitle}
                onChange={(e) => setReminderTitle(e.target.value)}
                required
              />
              <label className={styles.field}>
                <span>When</span>
                <input
                  type="datetime-local"
                  value={remindAt}
                  onChange={(e) => setRemindAt(e.target.value)}
                  required
                />
              </label>
              <Button type="submit">Save reminder</Button>
            </form>
            <ul className={styles.stack}>
              {(remindersQuery.data?.reminders ?? []).map((reminder) => (
                <li key={reminder.id} className={styles.listRow}>
                  <div>
                    <strong>{reminder.title}</strong>
                    <p className={styles.sub}>
                      {new Date(reminder.remindAt).toLocaleString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}

      {tab === 'history' ? (
        <Card>
          <h2>Task history</h2>
          <p className={styles.sub}>
            For reflection and retrieval — not scorekeeping.
          </p>
          <ul className={styles.stack}>
            {(historyQuery.data?.entries ?? []).length === 0 ? (
              <p className={styles.sub}>No history yet.</p>
            ) : (
              (historyQuery.data?.entries ?? []).map((entry) => (
                <li key={entry.id} className={styles.listRow}>
                  <div>
                    <strong>
                      {entry.action}: {entry.taskTitle ?? entry.taskId}
                    </strong>
                    <p className={styles.sub}>
                      {entry.detail} ·{' '}
                      {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </div>
                </li>
              ))
            )}
          </ul>
        </Card>
      ) : null}
    </div>
  )
}
