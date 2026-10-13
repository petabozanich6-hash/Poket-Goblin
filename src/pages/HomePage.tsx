import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { CAPACITY_LABELS } from '@shared/types'

import { GoblinMascot } from '@/components/goblin/GoblinMascot'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/features/auth/useAuth'
import { DailyBriefingCard } from '@/features/magical/DailyBriefingCard'
import { RescuePanel } from '@/features/magical/RescuePanel'
import { fetchPriorities } from '@/features/magical/magicalApi'
import { fetchDenSummary } from '@/features/life/lifeApi'
import { fetchTodayPlan } from '@/features/plan/planApi'
import { TaskList } from '@/features/tasks/TaskList'

import styles from './HomePage.module.css'

function formatToday() {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())
}

export function HomePage() {
  const { user, settings } = useAuth()
  const [params] = useSearchParams()
  const [rescueOpen, setRescueOpen] = useState(params.get('rescue') === '1')

  const planQuery = useQuery({
    queryKey: ['plan', 'today'],
    queryFn: fetchTodayPlan,
  })
  const denQuery = useQuery({
    queryKey: ['den-summary'],
    queryFn: fetchDenSummary,
  })
  const priorities = useQuery({
    queryKey: ['priorities'],
    queryFn: fetchPriorities,
  })

  const summary = denQuery.data?.summary
  const reasonMap = Object.fromEntries(
    (priorities.data?.items ?? []).map((item) => [item.task.id, item.reasons]),
  )

  return (
    <div className={styles.page}>
      <header className={styles.welcome}>
        <div className={styles.welcomeCopy}>
          <p className={styles.kicker}>{formatToday()}</p>
          <h1>The Den</h1>
          <p className={styles.sub}>
            {user?.displayName
              ? `Welcome back, ${user.displayName}.`
              : 'Welcome back.'}{' '}
            Here&apos;s what needs a gentle look today.
          </p>
          <p className={styles.capacity}>
            Capacity:{' '}
            <strong>
              {CAPACITY_LABELS[settings?.capacityMode ?? 'steady']}
            </strong>
            {' · '}
            <Link to="/plan">Adjust</Link>
            {summary && summary.pendingReview > 0 ? (
              <>
                {' · '}
                <Link to="/inbox">{summary.pendingReview} in Inbox</Link>
              </>
            ) : null}
            {' · '}
            <Link to="/capture">Quick capture</Link>
          </p>
        </div>
        <div className={styles.welcomeMascot} aria-hidden={false}>
          <GoblinMascot size={148} loading="eager" />
        </div>
      </header>

      <DailyBriefingCard onRescue={() => setRescueOpen(true)} />

      <RescuePanel open={rescueOpen} onClose={() => setRescueOpen(false)} />

      <div className={styles.grid}>
        <Card>
          <h2>Today&apos;s focus</h2>
          <TaskList
            tasks={planQuery.data?.plan.tasks ?? []}
            emptyMessage="No plan yet — visit Plan, or use Rescue my day."
            showPriorityReason
            reasonsById={reasonMap}
          />
        </Card>

        <Card>
          <h2>Suggested order</h2>
          <p className={styles.cardHint}>
            You can override anytime — this is a gentle suggestion, not a
            verdict.
          </p>
          <TaskList
            tasks={(priorities.data?.items ?? [])
              .slice(0, 5)
              .map((item) => item.task)}
            emptyMessage="No open tasks to rank."
            showPriorityReason
            reasonsById={reasonMap}
          />
        </Card>
      </div>

      <div className={styles.grid}>
        <Card>
          <h2>Coming up</h2>
          {(summary?.upcomingEvents.length ?? 0) === 0 ? (
            <p className={styles.cardHint}>
              No appointments in the next week.{' '}
              <Link to="/calendar">Open calendar</Link>
            </p>
          ) : (
            <ul className={styles.awaitList}>
              {summary?.upcomingEvents.map((event) => (
                <li key={event.id}>
                  <strong>{event.title}</strong>
                  <div>{new Date(event.startsAt).toLocaleString()}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2>Due reminders</h2>
          {(summary?.dueReminders.length ?? 0) === 0 ? (
            <p className={styles.cardHint}>
              Nothing due right now. <Link to="/life">Life shelves</Link>
            </p>
          ) : (
            <ul className={styles.awaitList}>
              {summary?.dueReminders.map((reminder) => (
                <li key={reminder.id}>
                  <strong>{reminder.title}</strong>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
