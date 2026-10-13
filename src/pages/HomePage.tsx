import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { CAPACITY_LABELS } from '@shared/types'

import { GoblinMascot } from '@/components/goblin/GoblinMascot'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/features/auth/useAuth'
import { CaptureReview } from '@/features/capture/CaptureReview'
import { QuickCapture } from '@/features/capture/QuickCapture'
import { fetchCaptures } from '@/features/capture/captureApi'
import { fetchTodayPlan } from '@/features/plan/planApi'
import { TaskList } from '@/features/tasks/TaskList'
import { fetchTasks } from '@/features/tasks/tasksApi'

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
  const planQuery = useQuery({
    queryKey: ['plan', 'today'],
    queryFn: fetchTodayPlan,
  })
  const tasksQuery = useQuery({
    queryKey: ['tasks', 'open'],
    queryFn: () => fetchTasks('open'),
  })
  const capturesQuery = useQuery({
    queryKey: ['captures'],
    queryFn: fetchCaptures,
  })

  const hour = new Date().getHours()
  const greeting =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const awaiting = (capturesQuery.data?.captures ?? [])
    .flatMap((capture) =>
      capture.items
        .filter((item) => item.status === 'suggested')
        .map((item) => ({ capture, item })),
    )
    .slice(0, 5)

  const recentCaptures = (capturesQuery.data?.captures ?? []).slice(0, 2)
  const dueSoon = (tasksQuery.data?.tasks ?? [])
    .filter((task) => task.dueDate)
    .slice(0, 4)

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <GoblinMascot size={84} mood="idle" />
        <div>
          <p className={styles.kicker}>{formatToday()}</p>
          <h1>
            {greeting}, {user?.displayName}.
          </h1>
          <p className={styles.sub}>
            The den is calm. Drop a thought anytime — the goblin will sort the
            shelves.
          </p>
          <p className={styles.capacity}>
            Today&apos;s capacity:{' '}
            <strong>
              {CAPACITY_LABELS[settings?.capacityMode ?? 'steady']}
            </strong>{' '}
            · <Link to="/plan">Adjust plan</Link>
          </p>
        </div>
      </header>

      <Card>
        <h2>Quick capture</h2>
        <p className={styles.cardHint}>
          One box. No filing cabinets. The goblin proposes structure; you
          decide.
        </p>
        <QuickCapture />
      </Card>

      <div className={styles.grid}>
        <Card>
          <h2>Today&apos;s priorities</h2>
          <TaskList
            tasks={planQuery.data?.plan.tasks ?? []}
            emptyMessage="No plan yet — visit Plan to shape a gentle day."
          />
        </Card>

        <Card>
          <h2>Awaiting attention</h2>
          {awaiting.length === 0 ? (
            <p className={styles.cardHint}>
              Nothing waiting for a decision. Lovely.
            </p>
          ) : (
            <ul className={styles.awaitList}>
              {awaiting.map(({ capture, item }) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span> from a recent dump</span>
                  <div>
                    <Link to="/capture">Review</Link>
                  </div>
                  <span className={styles.sr}>{capture.id}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className={styles.grid}>
        <Card>
          <h2>Upcoming</h2>
          <TaskList tasks={dueSoon} emptyMessage="No dated commitments yet." />
        </Card>
        <Card>
          <h2>Recently captured</h2>
          {recentCaptures.length === 0 ? (
            <p className={styles.cardHint}>
              Your first dump will show up here.
            </p>
          ) : (
            <div className={styles.captureStack}>
              {recentCaptures.map((capture) => (
                <CaptureReview key={capture.id} capture={capture} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
