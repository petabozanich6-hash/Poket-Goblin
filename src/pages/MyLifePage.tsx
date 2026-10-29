import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'

import { fetchDocuments } from '@/features/explore/exploreApi'
import { fetchDenSummary } from '@/features/life/lifeApi'
import { fetchTasks } from '@/features/tasks/tasksApi'

import styles from './MyLifePage.module.css'

const SECTIONS = [
  { to: '/life', label: 'Overview', end: true },
  { to: '/life/tasks', label: 'Tasks' },
  { to: '/life/calendar', label: 'Calendar' },
  { to: '/life/lists', label: 'Lists, notes & reminders' },
  { to: '/life/documents', label: 'Documents' },
  { to: '/life/health', label: 'Health' },
  { to: '/life/plan', label: 'Plan my day' },
  { to: '/life/review', label: 'Suggestions' },
]

/** My Life: everything the Goblin has organised, one place, one search. */
export function MyLifeLayout() {
  const navigate = useNavigate()
  const [q, setQ] = useState('')

  function search(event: FormEvent) {
    event.preventDefault()
    if (q.trim()) navigate(`/life/search?q=${encodeURIComponent(q.trim())}`)
  }

  return (
    <div className={styles.layout}>
      <div className={styles.top}>
        <p className={styles.eyebrow}>My Life</p>
        <form className={styles.search} onSubmit={search} role="search">
          <Search size={18} aria-hidden />
          <label className={styles.srOnly} htmlFor="life-search">
            Search everything
          </label>
          <input
            id="life-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search everything — tasks, notes, dates…"
          />
        </form>
      </div>
      <nav className={styles.sections} aria-label="My Life sections">
        {SECTIONS.map((section) => (
          <NavLink
            key={section.to}
            to={section.to}
            end={section.end}
            className={({ isActive }) =>
              [styles.section, isActive ? styles.active : ''].join(' ')
            }
          >
            {section.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}

function Tile({
  to,
  label,
  value,
  hint,
}: {
  to: string
  label: string
  value: number | string
  hint?: string
}) {
  return (
    <Link to={to} className={styles.tile}>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileLabel}>{label}</span>
      {hint ? <span className={styles.tileHint}>{hint}</span> : null}
    </Link>
  )
}

export function MyLifeOverview() {
  const den = useQuery({ queryKey: ['den-summary'], queryFn: fetchDenSummary })
  const tasks = useQuery({
    queryKey: ['tasks', 'open'],
    queryFn: () => fetchTasks('open'),
  })
  const docs = useQuery({
    queryKey: ['documents', ''],
    queryFn: () => fetchDocuments(),
  })
  const s = den.data?.summary
  const loading = den.isLoading || tasks.isLoading

  const openTasks = tasks.data?.tasks.length ?? 0
  const everythingEmpty =
    !loading &&
    openTasks === 0 &&
    (s?.upcomingEvents.length ?? 0) === 0 &&
    (s?.dueReminders.length ?? 0) === 0 &&
    (s?.shoppingNeedsAttention.length ?? 0) === 0 &&
    (s?.pinnedNotes.length ?? 0) === 0 &&
    (docs.data?.documents.length ?? 0) === 0

  if (everythingEmpty) {
    return (
      <section className={styles.empty}>
        <h1>Nothing here yet</h1>
        <p>
          Everything you give the goblin ends up here, sorted: tasks,
          appointments, lists, notes and documents.
        </p>
        <p>
          <Link to="/tell">Tell the Goblin something</Link> to get started.
        </p>
      </section>
    )
  }

  return (
    <section className={styles.overview}>
      <h1 className={styles.srOnly}>My Life overview</h1>
      <div className={styles.tiles}>
        <Tile
          to="/life/tasks"
          label="Open tasks"
          value={loading ? '…' : openTasks}
        />
        <Tile
          to="/life/calendar"
          label="Appointments this week"
          value={s?.upcomingEvents.length ?? '…'}
        />
        <Tile
          to="/life/lists"
          label="Reminders due"
          value={s?.dueReminders.length ?? '…'}
        />
        <Tile
          to="/life/lists"
          label="On the shopping list"
          value={s?.shoppingNeedsAttention.length ?? '…'}
        />
        <Tile
          to="/life/lists"
          label="Pinned notes"
          value={s?.pinnedNotes.length ?? '…'}
        />
        <Tile
          to="/life/documents"
          label="Kept documents"
          value={docs.data?.documents.length ?? '…'}
        />
      </div>
      {(s?.pendingReview ?? 0) > 0 ? (
        <p>
          <Link to="/tell#waiting">
            {s?.pendingReview ?? 0} suggestion(s) waiting for your OK
          </Link>
        </p>
      ) : null}
    </section>
  )
}
