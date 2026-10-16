import { useSyncExternalStore } from 'react'

import { Button } from '@/components/ui/Button'
import { applyUpdate, getPwaState, subscribePwa } from '@/lib/pwa'

import styles from './UpdatePrompt.module.css'

/** Shown when a new version is ready; it never reloads on its own. */
export function UpdatePrompt() {
  const pwa = useSyncExternalStore(subscribePwa, getPwaState)
  if (!pwa.updateReady) return null
  return (
    <div className={styles.toast} role="status">
      <span>A fresh Goblin is ready.</span>
      <Button size="sm" onClick={applyUpdate}>
        Update
      </Button>
    </div>
  )
}
