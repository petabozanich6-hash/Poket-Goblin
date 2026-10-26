import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { fetchHealth } from './healthApi'
import styles from './HealthPage.module.css'

/** On the Den: a quiet line when supplements are still to take today. Nothing when Health is off. */
export function HealthNudge() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    staleTime: 60_000,
  })
  const s = health.data
  if (!s || !s.available || !s.enabled || !s.supplementsDue) return null
  const left = s.supplements
    .filter((x) => x.taken < x.dosesPerDay)
    .map((x) => x.name)
  return (
    <p className={styles.note} data-testid="health-nudge">
      💊 Still to take today: {left.join(', ')}.{' '}
      <Link to="/life/health">Tick off</Link> or tell the Goblin “took my{' '}
      {left.length === 1 ? left[0] : 'supplements'}”.
    </p>
  )
}
