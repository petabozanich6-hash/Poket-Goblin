import { Link } from 'react-router'

import privacy from '../../docs/legal/PRIVACY_POLICY_DRAFT.md?raw'
import terms from '../../docs/legal/TERMS_DRAFT.md?raw'

import { Markdown } from '@/features/legal/markdown'

import styles from './LegalPage.module.css'

/**
 * Terms and Privacy, rendered from docs/legal so the app and the
 * documents can't drift apart. Public: reachable while signed out.
 */
export function LegalPage({ doc }: { doc: 'terms' | 'privacy' }) {
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
        <a href="mailto:support@pocketgoblin.org">Contact</a>
      </nav>
      <main className={styles.doc} id="main">
        <Markdown source={doc === 'terms' ? terms : privacy} />
      </main>
    </div>
  )
}
