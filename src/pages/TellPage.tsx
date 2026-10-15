import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'

import { CaptureReview } from '@/features/capture/CaptureReview'
import { fetchCaptures } from '@/features/capture/captureApi'
import { TellTheGoblin } from '@/features/goblin/TellTheGoblin'
import { fetchDenSummary } from '@/features/life/lifeApi'

import styles from './Page.module.css'

/**
 * Tell the Goblin: one place for thoughts, requests, questions, letters and
 * photos — and everything still waiting for the user's OK.
 */
export function TellPage() {
  const location = useLocation()
  const captures = useQuery({ queryKey: ['captures'], queryFn: fetchCaptures })
  const den = useQuery({ queryKey: ['den-summary'], queryFn: fetchDenSummary })

  const waiting = (captures.data?.captures ?? []).filter((capture) =>
    capture.items.some((item) => item.status === 'suggested'),
  )
  const otherWaiting = den.data?.summary.pendingReview ?? 0

  useEffect(() => {
    if (location.hash === '#waiting') {
      document.getElementById('waiting')?.scrollIntoView({ block: 'start' })
    }
  }, [location.hash, captures.data])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Tell the Goblin</h1>
          <p className={styles.sub}>
            Type, speak or add a letter. Ask a question, or just empty your head
            — the goblin sorts it and checks with you before anything is added.
          </p>
        </div>
      </header>

      <TellTheGoblin prominent />

      {waiting.length > 0 || otherWaiting > 0 ? (
        <section
          id="waiting"
          className={styles.stack}
          aria-labelledby="waiting-heading"
        >
          <h2 id="waiting-heading">Waiting for your OK</h2>
          {waiting.map((capture) => (
            <CaptureReview key={capture.id} capture={capture} />
          ))}
          {otherWaiting > 0 ? (
            <p className={styles.sub}>
              <Link to="/life/review">
                {otherWaiting} more from documents and other places
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      <p className={styles.sub}>
        Want a longer chat? <Link to="/ask">Ask the Goblin</Link> · Paperwork to
        keep? <Link to="/life/documents">Your documents</Link>
      </p>
    </div>
  )
}
