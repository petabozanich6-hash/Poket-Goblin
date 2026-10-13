import { Sparkles } from 'lucide-react'

import styles from './LandingPage.module.css'

/**
 * Temporary landing page while the Floot application is migrated.
 * Replace with the real app shell once source is imported.
 */
export function LandingPage() {
  return (
    <main className={styles.page}>
      <div className={styles.panel}>
        <div className={styles.brandRow}>
          <Sparkles className={styles.icon} aria-hidden="true" />
          <h1 className={styles.title}>Pocket Goblin</h1>
        </div>
        <p className={styles.tagline}>Preparing the goblin&apos;s new home.</p>
      </div>
    </main>
  )
}
