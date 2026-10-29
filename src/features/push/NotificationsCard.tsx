import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { ApiError } from '@/lib/api'

import styles from '@/pages/Page.module.css'

import own from './NotificationsCard.module.css'

import {
  PUSH_QUERY_KEY,
  savePushPreferences,
  sendTestPush,
  type PushPreferences,
  type PushStatus,
} from './pushApi'
import { usePush } from './usePush'

/** Settings → Notifications: turn on for this device, choose what's sent. */
export function NotificationsCard() {
  const push = usePush()
  const qc = useQueryClient()
  const [note, setNote] = useState('')
  // Show the change at once; the server's answer (or a refetch on failure)
  // settles it.
  const save = useMutation({
    mutationFn: savePushPreferences,
    onSuccess: ({ preferences }) =>
      qc.setQueryData<PushStatus>(PUSH_QUERY_KEY, (old) =>
        old?.available ? { ...old, preferences } : old,
      ),
    onError: () => qc.invalidateQueries({ queryKey: PUSH_QUERY_KEY }),
  })
  const test = useMutation({
    mutationFn: sendTestPush,
    onMutate: () => setNote(''),
    onSuccess: (r) =>
      setNote(
        r.sent
          ? 'Sent. It should pop up in a few seconds.'
          : 'That didn’t reach a device. Try turning notifications off and on again.',
      ),
    onError: (e) =>
      setNote(e instanceof ApiError ? e.message : 'That didn’t send.'),
  })

  if (push.state === 'loading') return <p className={styles.sub}>Checking…</p>
  if (push.state === 'unavailable')
    return (
      <p className={styles.sub}>
        Notifications are nearly ready. They’ll appear here once they’re
        switched on.
      </p>
    )
  if (push.state === 'needs-install')
    return (
      <p className={styles.sub} data-testid="push-needs-install">
        On iPhone and iPad, notifications only work from the home-screen app.
        Add Pocket Goblin to your Home Screen (Share → Add to Home Screen), open
        it from there, then turn notifications on here.
      </p>
    )
  if (push.state === 'unsupported')
    return (
      <p className={styles.sub}>
        This browser can’t show Pocket Goblin notifications. Chrome, Edge,
        Firefox and Safari can.
      </p>
    )
  if (push.state === 'blocked')
    return (
      <p className={styles.sub} data-testid="push-blocked">
        Notifications are blocked for Pocket Goblin in this browser. Allow them
        in the site settings (the icon beside the address), then come back.
      </p>
    )

  const prefs = push.status?.available ? push.status.preferences : null
  const set = (patch: Partial<PushPreferences>) => {
    qc.setQueryData<PushStatus>(PUSH_QUERY_KEY, (old) =>
      old?.available
        ? { ...old, preferences: { ...old.preferences, ...patch } }
        : old,
    )
    save.mutate(patch)
  }

  if (push.state === 'off')
    return (
      <div className={styles.stackTight}>
        <p className={styles.sub}>
          A nudge on this device when a reminder is due, plus a short morning
          check-in so the Goblin doesn’t slip your mind. You choose what comes
          through.
        </p>
        <div>
          <Button
            onClick={() => void push.turnOn()}
            disabled={push.busy}
            data-testid="push-turn-on"
          >
            Turn on notifications
          </Button>
        </div>
        {push.error ? <p className={styles.sub}>{push.error}</p> : null}
      </div>
    )

  return (
    <div className={styles.stackTight} data-testid="push-on">
      <p className={styles.sub}>
        On for this device. Notifications show counts, not your task names, so
        your lock screen stays private. Reminders show the words you set.
      </p>
      {prefs ? (
        <>
          <label className={`${styles.sub} ${own.option}`}>
            <input
              type="checkbox"
              checked={prefs.remindersEnabled}
              onChange={(e) => set({ remindersEnabled: e.target.checked })}
            />{' '}
            <span>Reminders when they’re due</span>
          </label>
          <label className={`${styles.sub} ${own.option}`}>
            <input
              type="checkbox"
              checked={prefs.morningEnabled}
              onChange={(e) => set({ morningEnabled: e.target.checked })}
              data-testid="push-morning"
            />{' '}
            <span>Morning check-in at</span>
            <input
              type="time"
              value={prefs.morningTime}
              aria-label="Morning check-in time"
              onChange={(e) =>
                e.target.value && set({ morningTime: e.target.value })
              }
            />
          </label>
          <label className={`${styles.sub} ${own.option}`}>
            <input
              type="checkbox"
              checked={prefs.eveningEnabled}
              onChange={(e) => set({ eveningEnabled: e.target.checked })}
            />{' '}
            <span>Evening check-in at</span>
            <input
              type="time"
              value={prefs.eveningTime}
              aria-label="Evening check-in time"
              onChange={(e) =>
                e.target.value && set({ eveningTime: e.target.value })
              }
            />
          </label>
          <label className={`${styles.sub} ${own.option}`}>
            <input
              type="checkbox"
              checked={prefs.messagesEnabled}
              onChange={(e) => set({ messagesEnabled: e.target.checked })}
            />{' '}
            <span>
              Replies from Goblin HQ (held until your quiet hours end)
            </span>
          </label>
          <p className={styles.sub}>
            Times are in {prefs.timezone.replace(/_/g, ' ')}.
          </p>
        </>
      ) : null}
      <div className={styles.actions}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => test.mutate()}
          disabled={test.isPending}
          data-testid="push-test"
        >
          Send a test
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void push.turnOff()}
          disabled={push.busy}
          data-testid="push-turn-off"
        >
          Turn off on this device
        </Button>
      </div>
      {note ? (
        <p className={styles.sub} role="status">
          {note}
        </p>
      ) : null}
    </div>
  )
}
