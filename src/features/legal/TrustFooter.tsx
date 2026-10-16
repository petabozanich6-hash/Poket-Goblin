import { Link } from 'react-router'

import styles from './TrustFooter.module.css'

/** Terms, Privacy and a human to write to — reachable while signed out. */
export function TrustFooter() {
  return (
    <p className={styles.footer}>
      <Link to="/terms">Terms</Link>
      <span aria-hidden> · </span>
      <Link to="/privacy">Privacy</Link>
      <span aria-hidden> · </span>
      <Link to="/refunds">Billing &amp; refunds</Link>
      <span aria-hidden> · </span>
      <Link to="/data-and-ai">AI &amp; documents</Link>
      <span aria-hidden> · </span>
      Can’t sign in or need help?{' '}
      <a href="mailto:support@pocketgoblin.org">support@pocketgoblin.org</a>
    </p>
  )
}
