import { useQuery } from '@tanstack/react-query'
import { Bell, CalendarDays, Inbox } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import type { CalendarEvent, Task } from '@shared/types'

import { GoblinMascot } from '@/components/goblin/GoblinMascot'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/features/auth/useAuth'
import { TellTheGoblin } from '@/features/goblin/TellTheGoblin'
import { fetchDenSummary } from '@/features/life/lifeApi'
import { RescuePanel } from '@/features/magical/RescuePanel'
import { fetchPriorities } from '@/features/magical/magicalApi'
import { useOverwhelm } from '@/features/magical/useOverwhelm'
import { fetchTodayPlan } from '@/features/plan/planApi'
import { TaskList } from '@/features/tasks/TaskList'
import { HealthNudge } from '@/features/health/HealthNudge'

import styles from './HomePage.module.css'

function greeting(now = new Date()) {
  const h = now.getHours()
  return h < 5 ? 'Hello' : h < 12 ? 'Morning' : h < 18 ? 'Afternoon' : 'Evening'
}

function sameLocalDay(iso: string, day = new Date()) {
  const d = new Date(iso)
  return (
    d.getFullYear() === day.getFullYear() &&
    d.getMonth() === day.getMonth() &&
    d.getDate() === day.getDate()
  )
}

function timeOf(event: CalendarEvent) {
  return event.allDay
    ? 'All day'
    : new Date(event.startsAt).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
}

function dayOf(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
}

/** Up to `limit` tasks: today's plan first, then the suggested order, no repeats. */
function focusTasks(plan: Task[], ranked: Task[], limit = 3): Task[] {
  const seen = new Set<string>()
  const out: Task[] = []
  for (const task of [...plan, ...ranked]) {
    if (task.status !== 'open' || seen.has(task.id)) continue
    seen.add(task.id)
    out.push(task)
    if (out.length === limit) break
  }
  return out
}

export function HomePage() {
  const { user } = useAuth()
  const overwhelm = useOverwhelm()
  const [params] = useSearchParams()
  const [rescueOpen, setRescueOpen] = useState(params.get('rescue') === '1')
  // "Clear my day for me" from the panic screen, even when already on Home.
  const rescueAsked = params.get('rescue') === '1'
  useEffect(() => {
    if (rescueAsked) setRescueOpen(true)
  }, [rescueAsked])

  const plan = useQuery({
    queryKey: ['plan', 'today'],
    queryFn: fetchTodayPlan,
  })
  const den = useQuery({ queryKey: ['den-summary'], queryFn: fetchDenSummary })
  const priorities = useQuery({
    queryKey: ['priorities'],
    queryFn: fetchPriorities,
  })

  const loading = plan.isLoading || den.isLoading || priorities.isLoading
  const summary = den.data?.summary
  const ranked = (priorities.data?.items ?? []).map((item) => item.task)
  const reasons = Object.fromEntries(
    (priorities.data?.items ?? []).map((item) => [item.task.id, item.reasons]),
  )
  const tasks = focusTasks(plan.data?.plan.tasks ?? [], ranked)
  const events = summary?.upcomingEvents ?? []
  const todayEvents = events.filter((e) => sameLocalDay(e.startsAt))
  const laterEvents = events
    .filter((e) => !sameLocalDay(e.startsAt))
    .slice(0, 3)
  const reminders = summary?.dueReminders ?? []
  const waiting =
    // Every suggestion (brain dump or document) has one review item.
    summary?.pendingReview ?? 0
  const openTasks = ranked.length

  const hasToday =
    tasks.length + todayEvents.length + reminders.length + waiting > 0
  const quiet = !loading && !hasToday && laterEvents.length === 0

  return (
    <div className={styles.page}>
      <header className={styles.greeting} data-tour="den">
        <GoblinMascot
          size={72}
          alt=""
          loading="eager"
          className={styles.mascot}
        />
        <div>
          <h1>
            {greeting()}
            {user?.displayName ? `, ${user.displayName}` : ''}!{' '}
            <span aria-hidden>👹</span>
          </h1>
          <p className={styles.date}>
            {new Intl.DateTimeFormat(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            }).format(new Date())}
          </p>
        </div>
      </header>

      <button
        type="button"
        className={styles.panic}
        onClick={() => overwhelm.enter()}
      >
        <span className={styles.panicTitle}>Panic button</span>
        <span className={styles.panicSub}>
          Everything feels like too much? Tap here.
        </span>
      </button>

      {quiet ? (
        <section className={styles.quiet} aria-label="All quiet">
          <p className={styles.quietTitle}>All quiet in the cave. 👹</p>
          <p>Nothing urgent needs your attention.</p>
          <p className={styles.muted}>
            Got something on your mind? Give it to the Goblin.
          </p>
        </section>
      ) : null}

      <div data-tour="capture">
        <TellTheGoblin prominent />
      </div>

      <HealthNudge />

      {hasToday ? (
        <section className={styles.panel} aria-labelledby="today-heading">
          <div className={styles.panelHead}>
            <h2 id="today-heading">Today</h2>
            {openTasks >= 4 ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setRescueOpen(true)}
              >
                Sort my day
              </Button>
            ) : tasks.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => overwhelm.enter()}
              >
                Help me get started
              </Button>
            ) : null}
          </div>

          {waiting > 0 ? (
            <Link to="/tell#waiting" className={styles.decision}>
              <Inbox size={18} aria-hidden />
              <span>
                <strong>{waiting}</strong> suggestion{waiting === 1 ? '' : 's'}{' '}
                waiting for your OK
              </span>
            </Link>
          ) : null}

          {todayEvents.length > 0 ? (
            <ul className={styles.items} aria-label="Today’s appointments">
              {todayEvents.map((event) => (
                <li key={event.id} className={styles.item}>
                  <CalendarDays size={18} aria-hidden />
                  <span className={styles.itemText}>
                    <strong>{event.title}</strong>
                    <span className={styles.muted}> · {timeOf(event)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {reminders.length > 0 ? (
            <ul className={styles.items} aria-label="Reminders due">
              {reminders.slice(0, 4).map((reminder) => (
                <li key={reminder.id} className={styles.item}>
                  <Bell size={18} aria-hidden />
                  <span className={styles.itemText}>
                    <strong>{reminder.title}</strong>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {tasks.length > 0 ? (
            <TaskList tasks={tasks} showPriorityReason reasonsById={reasons} />
          ) : null}

          {openTasks > tasks.length ? (
            <p className={styles.more}>
              <Link to="/life/tasks">See all {openTasks} tasks</Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {laterEvents.length > 0 ? (
        <section className={styles.panel} aria-labelledby="coming-heading">
          <h2 id="coming-heading">Coming up</h2>
          <ul className={styles.items}>
            {laterEvents.map((event) => (
              <li key={event.id} className={styles.item}>
                <CalendarDays size={18} aria-hidden />
                <span className={styles.itemText}>
                  <strong>{event.title}</strong>
                  <span className={styles.muted}>
                    {' '}
                    · {dayOf(event.startsAt)}
                    {event.allDay ? '' : `, ${timeOf(event)}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <p className={styles.more}>
            <Link to="/life/calendar">Open calendar</Link>
          </p>
        </section>
      ) : null}

      <RescuePanel open={rescueOpen} onClose={() => setRescueOpen(false)} />
    </div>
  )
}
