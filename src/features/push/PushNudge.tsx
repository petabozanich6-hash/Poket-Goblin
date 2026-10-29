import { useState } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'

import styles from '@/pages/Page.module.css'

import { usePush } from './usePush'

const DISMISSED = 'pg-push-nudge-dismissed'

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISSED) ?? 0)
    return Date.now() - at < 14 * 86_400_000
  } catch {
    return false
  }
}

/** On the Den: offer notifications once, so the Goblin can find you. */
export function PushNudge() {
  const push = usePush()
  const [hidden, setHidden] = useState(dismissedRecently)
  if (hidden || (push.state !== 'off' && push.state !== 'needs-install'))
    return null
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, String(Date.now()))
    } catch {
      // Private mode: it just shows again next time.
    }
    setHidden(true)
  }
  return (
    <Card>
      <div className={styles.stackTight} data-testid="push-nudge">
        <h2>Let the Goblin find you</h2>
        {push.state === 'needs-install' ? (
          <p className={styles.sub}>
            Want a nudge when reminders are due? On iPhone, add Pocket Goblin to
            your Home Screen first, then turn notifications on in{' '}
            <Link to="/settings#notifications">Settings</Link>.
          </p>
        ) : (
          <p className={styles.sub}>
            Get a nudge when a reminder is due and a short morning check-in, so
            nothing slips. You can change what comes through in Settings.
          </p>
        )}
        <div className={styles.actions}>
          {push.state === 'off' ? (
            <Button onClick={() => void push.turnOn()} disabled={push.busy}>
              Turn on notifications
            </Button>
          ) : null}
          <Button variant="ghost" onClick={dismiss}>
            Not now
          </Button>
        </div>
        {push.error ? <p className={styles.sub}>{push.error}</p> : null}
      </div>
    </Card>
  )
}
