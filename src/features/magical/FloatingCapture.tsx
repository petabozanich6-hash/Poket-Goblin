import { useState } from 'react'

import { goblinLine } from '@shared/magical/personality'

import { Button } from '@/components/ui/Button'
import { QuickCapture } from '@/features/capture/QuickCapture'

import styles from './FloatingCapture.module.css'

export function FloatingCapture() {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)

  return (
    <div className={styles.fabWrap}>
      {open ? (
        <div className={styles.panel} role="region" aria-label="Quick capture">
          <strong>Quick capture</strong>
          <QuickCapture
            onCaptured={() => {
              setConfirm(goblinLine('captureSaved'))
              window.setTimeout(() => {
                setConfirm(null)
                setOpen(false)
              }, 1600)
            }}
          />
          {confirm ? <p className={styles.confirm}>{confirm}</p> : null}
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      ) : null}
      <Button
        className={styles.fab}
        aria-label={open ? 'Close quick capture' : 'Open quick capture'}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '×' : '+'}
      </Button>
    </div>
  )
}
