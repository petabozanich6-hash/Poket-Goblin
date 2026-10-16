import { Link } from 'react-router'

import privacy from '../../docs/legal/PRIVACY_POLICY.md?raw'
import terms from '../../docs/legal/TERMS_OF_SERVICE.md?raw'
import refunds from '../../docs/legal/BILLING_AND_REFUNDS.md?raw'
import dataAndAi from '../../docs/legal/AI_VOICE_AND_DOCUMENTS.md?raw'

import { Markdown } from '@/features/legal/markdown'

import styles from './LegalPage.module.css'

/**
 * Terms and Privacy, rendered from docs/legal so the app and the
 * documents can't drift apart. Public: reachable while signed out.
 */
type LegalDoc = 'terms' | 'privacy' | 'refunds' | 'data-and-ai'

export function LegalPage({ doc }: { doc: LegalDoc }) {
  const source =
    doc === 'terms'
      ? terms
      : doc === 'privacy'
        ? privacy
        : doc === 'refunds'
          ? refunds
          : dataAndAi

  return (
    <div className={styles.page}>
      <nav className={styles.nav} aria-label="Legal">
        <Link to="/">Pocket Goblin</Link>
        <Link to="/terms" aria-current={doc === 'terms' ? 'page' : undefined}>
          Terms
        </Link>
        <Link
          to="/privacy"
          aria-current={doc === 'privacy' ? 'page' : undefined}
        >
          Privacy
        </Link>
        <Link
          to="/refunds"
          aria-current={doc === 'refunds' ? 'page' : undefined}
        >
          Billing &amp; refunds
        </Link>
        <Link
          to="/data-and-ai"
          aria-current={doc === 'data-and-ai' ? 'page' : undefined}
        >
          AI &amp; documents
        </Link>
        <a href="mailto:support@pocketgoblin.org">Contact</a>
      </nav>
      <main className={styles.doc} id="main">
        <Markdown source={source} />
      </main>
    </div>
  )
}
