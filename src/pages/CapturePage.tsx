import { useQuery } from '@tanstack/react-query'

import { Card } from '@/components/ui/Card'
import { CaptureReview } from '@/features/capture/CaptureReview'
import { QuickCapture } from '@/features/capture/QuickCapture'
import { fetchCaptures } from '@/features/capture/captureApi'

import styles from './Page.module.css'

export function CapturePage() {
  const capturesQuery = useQuery({
    queryKey: ['captures'],
    queryFn: fetchCaptures,
  })

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Brain dump</h1>
          <p className={styles.sub}>
            Pour it out. The goblin suggests structure — nothing becomes a task
            until you keep it.
          </p>
        </div>
      </header>

      <Card>
        <QuickCapture />
      </Card>

      <section className={styles.stack}>
        <h2>Recent dumps</h2>
        {(capturesQuery.data?.captures ?? []).length === 0 ? (
          <p className={styles.sub}>No captures yet.</p>
        ) : (
          (capturesQuery.data?.captures ?? []).map((capture) => (
            <CaptureReview key={capture.id} capture={capture} />
          ))
        )}
      </section>
    </div>
  )
}
