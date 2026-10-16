import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'

import styles from './PlanLimitNotice.module.css'

type Limit = { message: string }

/**
 * When any request hits a Free-plan limit (the API answers with code
 * FREE_PLAN_LIMIT), say so once, plainly, with the way out: Premium, or
 * tidying up something already done. Nothing is ever deleted to make room.
 */
export function PlanLimitNotice() {
  const [limit, setLimit] = useState<Limit | null>(null)
  useEffect(() => {
    const on = (event: Event) =>
      setLimit({ message: (event as CustomEvent<Limit>).detail.message })
    window.addEventListener('pg:plan-limit', on)
    return () => window.removeEventListener('pg:plan-limit', on)
  }, [])
  if (!limit) return null
  return (
    <div className={styles.notice} role="status">
      <p>
        <strong>{limit.message}</strong> Finish or delete something to make
        room, or <Link to="/settings/plan">see Premium</Link>. Nothing you’ve
        saved is ever removed.
      </p>
      <button
        type="button"
        className={styles.close}
        onClick={() => setLimit(null)}
        aria-label="Dismiss"
      >
        <X size={18} aria-hidden />
      </button>
    </div>
  )
}
