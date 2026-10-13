import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, TextArea } from '@/components/ui/Input'
import { createEvent, deleteEvent, fetchEvents } from '@/features/life/lifeApi'

import styles from './Page.module.css'

type View = 'month' | 'week' | 'agenda'

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function toLocalDateInput(d: Date) {
  const offset = d.getTimezoneOffset()
  return new Date(d.getTime() - offset * 60_000).toISOString().slice(0, 10)
}

export function CalendarPage() {
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>('agenda')
  const [cursor, setCursor] = useState(() => new Date())
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(toLocalDateInput(new Date()))
  const [startTime, setStartTime] = useState('10:00')
  const [allDay, setAllDay] = useState(false)
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')

  const range = useMemo(() => {
    const from = new Date(cursor)
    from.setDate(from.getDate() - 7)
    const to = new Date(cursor)
    to.setDate(to.getDate() + 45)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [cursor])

  const eventsQuery = useQuery({
    queryKey: ['events', range.from, range.to],
    queryFn: () => fetchEvents(range.from, range.to),
  })

  const createMutation = useMutation({
    mutationFn: createEvent,
    onSuccess: async () => {
      setTitle('')
      setDescription('')
      setLocation('')
      await queryClient.invalidateQueries({ queryKey: ['events'] })
      await queryClient.invalidateQueries({ queryKey: ['den-summary'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteEvent,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events'] })
      await queryClient.invalidateQueries({ queryKey: ['den-summary'] })
    },
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    createMutation.mutate({
      title,
      date,
      startTime: allDay ? null : startTime,
      allDay,
      description,
      location,
    })
  }

  const events = eventsQuery.data?.events ?? []
  const monthLabel = cursor.toLocaleString(undefined, {
    month: 'long',
    year: 'numeric',
  })

  const monthDays = useMemo(() => {
    const start = startOfMonth(cursor)
    const days: Date[] = []
    const firstWeekday = start.getDay()
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(start)
      d.setDate(1 - firstWeekday + i)
      days.push(d)
    }
    return days
  }, [cursor])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Calendar</h1>
          <p className={styles.sub}>
            Appointments live here — create them directly or accept them from a
            brain dump.
          </p>
        </div>
      </header>

      <Card>
        <div className={styles.tabs}>
          {(['agenda', 'week', 'month'] as View[]).map((item) => (
            <button
              key={item}
              type="button"
              className={view === item ? styles.tabActive : styles.tab}
              onClick={() => setView(item)}
            >
              {item}
            </button>
          ))}
        </div>

        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setCursor(
                new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1),
              )
            }
          >
            Prev
          </Button>
          <strong>{monthLabel}</strong>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setCursor(
                new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1),
              )
            }
          >
            Next
          </Button>
        </div>

        {view === 'month' ? (
          <div className={styles.monthGrid}>
            {monthDays.map((day) => {
              const key = toLocalDateInput(day)
              const dayEvents = events.filter(
                (event) => toLocalDateInput(new Date(event.startsAt)) === key,
              )
              return (
                <div key={key} className={styles.monthCell}>
                  <strong>{day.getDate()}</strong>
                  {dayEvents.slice(0, 2).map((event) => (
                    <p key={event.id} className={styles.monthEvent}>
                      {event.title}
                    </p>
                  ))}
                </div>
              )
            })}
          </div>
        ) : null}

        {(view === 'agenda' || view === 'week') && (
          <ul className={styles.stack}>
            {events.length === 0 ? (
              <p className={styles.sub}>No upcoming appointments yet.</p>
            ) : (
              events.map((event) => (
                <li key={event.id} className={styles.listRow}>
                  <div>
                    <strong>{event.title}</strong>
                    <p className={styles.sub}>
                      {new Date(event.startsAt).toLocaleString()}
                      {event.location ? ` · ${event.location}` : ''}
                      {event.allDay ? ' · all day' : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(event.id)}
                  >
                    Remove
                  </Button>
                </li>
              ))
            )}
          </ul>
        )}
      </Card>

      <Card>
        <h2>New appointment</h2>
        <form className={styles.stackTight} onSubmit={onSubmit}>
          <Input
            label="Title"
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <div className={styles.row3}>
            <label className={styles.field}>
              <span>Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>
            <label className={styles.field}>
              <span>Start time</span>
              <input
                type="time"
                value={startTime}
                disabled={allDay}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </label>
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              All day
            </label>
          </div>
          <Input
            label="Location"
            name="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <TextArea
            label="Notes"
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button type="submit" disabled={createMutation.isPending || !title}>
            {createMutation.isPending ? 'Saving…' : 'Add appointment'}
          </Button>
        </form>
      </Card>
    </div>
  )
}
