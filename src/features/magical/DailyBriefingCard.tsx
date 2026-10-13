import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { useAuth } from '@/features/auth/useAuth'

import { useOverwhelm } from './useOverwhelm'
import { fetchBriefing } from './magicalApi'
import styles from './DailyBriefing.module.css'

const BADGE: Record<string, string> = {
  appointment: 'Appt',
  deadline: 'Due',
  overdue: 'Open',
  reminder: 'Nudge',
  review: 'Inbox',
  plan: 'Plan',
}

type Props = {
  onRescue: () => void
}

export function DailyBriefingCard({ onRescue }: Props) {
  const { settings } = useAuth()
  const { enter } = useOverwhelm()
  const query = useQuery({
    queryKey: ['briefing'],
    queryFn: fetchBriefing,
    enabled: settings?.dailyBriefingEnabled !== false,
  })

  if (settings?.dailyBriefingEnabled === false) return null

  const briefing = query.data?.briefing

  return (
    <Card>
      <div className={styles.briefing}>
        {query.isLoading ? (
          <p className={styles.body}>Gathering today’s shelves…</p>
        ) : query.isError ? (
          <p className={styles.body}>
            Couldn’t load the briefing. Your other shelves still work — try
            again in a moment.
          </p>
        ) : briefing ? (
          <>
            <p className={styles.greeting}>{briefing.greeting}</p>
            <h2 className={styles.headline}>{briefing.headline}</h2>
            <p className={styles.body}>{briefing.body}</p>
            {briefing.facts.length > 0 ? (
              <ul className={styles.facts}>
                {briefing.facts.map((fact, index) => (
                  <li key={`${fact.kind}-${index}`} className={styles.fact}>
                    <span className={styles.badge}>
                      {BADGE[fact.kind] ?? fact.kind}
                    </span>
                    <span>{fact.label}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={styles.actions}>
              {briefing.focusTaskId ? (
                <Link to="/tasks">
                  <Button size="sm">Start with this</Button>
                </Link>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => enter()}>
                I&apos;m overwhelmed
              </Button>
              <Button size="sm" variant="ghost" onClick={onRescue}>
                Rescue my day
              </Button>
              {briefing.pendingReview > 0 ? (
                <Link to="/inbox">
                  <Button size="sm" variant="ghost">
                    Open Inbox
                  </Button>
                </Link>
              ) : null}
            </div>
            <p className={styles.modeNote}>
              Rule-based briefing from your real data — not invented
              commitments.
            </p>
          </>
        ) : null}
      </div>
    </Card>
  )
}
