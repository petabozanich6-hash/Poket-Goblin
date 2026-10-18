import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { api } from '@/lib/api'
import { detectPlatform, isStandalone } from '@/lib/pwa'

import styles from '@/pages/Page.module.css'

type PushStatus = {
  configured: boolean
  subscribed: boolean
  publicKey: string | null
}

function decodeKey(encoded: string): Uint8Array {
  const padded =
    encoded.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (encoded.length % 4)) % 4)
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

function supported() {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    window.isSecureContext
  )
}

export function PushControls() {
  const [status, setStatus] = useState<PushStatus | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const ios = ['ios-safari', 'ios-other'].includes(detectPlatform())
  const needsInstall = ios && !isStandalone()
  const available = supported() && !needsInstall

  useEffect(() => {
    let active = true
    void api
      .get<PushStatus>('/push/status')
      .then(async (data) => {
        if (!active) return
        setStatus(data)
        if (supported()) {
          const registration =
            await navigator.serviceWorker.getRegistration('/')
          const subscription = await registration?.pushManager.getSubscription()
          if (active) setEnabled(Boolean(subscription) && data.subscribed)
        }
      })
      .catch(() => {
        if (active) setMessage('Could not check notifications right now.')
      })
    return () => {
      active = false
    }
  }, [])

  async function enable() {
    if (!status?.publicKey || !available) return
    setBusy(true)
    setMessage(null)
    try {
      // Request permission directly from this click to preserve user activation,
      // especially for installed iOS web apps.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setMessage(
          'Notifications were not allowed. You can change this in your browser or device settings.',
        )
        return
      }
      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeKey(status.publicKey) as BufferSource,
        }))
      try {
        await api.post('/push/subscriptions', {
          endpoint: subscription.endpoint,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        })
      } catch (error) {
        if (!existing) await subscription.unsubscribe()
        throw error
      }
      setEnabled(true)
      setMessage(
        'The Goblin will nudge this device for due reminders and HQ replies. You can turn it off anytime.',
      )
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not turn on notifications.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setMessage(null)
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await api.delete_with_body('/push/subscriptions', {
          endpoint: subscription.endpoint,
        })
        await subscription.unsubscribe()
      }
      setEnabled(false)
      setMessage('Notifications are off on this device.')
    } catch {
      setMessage('Could not switch notifications off. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className={styles.sub}>
        Your Goblin can send a quiet alert when a reminder is due or Goblin HQ
        replies, even when the app is closed. No task details appear on your
        lock screen. Optional, per device, and off until you choose.
      </p>
      {!status ? (
        <p className={styles.sub}>Checking this device…</p>
      ) : !status.configured ? (
        <p className={styles.sub}>
          The notification workshop isn't configured yet. No alerts are being
          sent.
        </p>
      ) : needsInstall ? (
        <p className={styles.sub}>
          On iPhone or iPad, first add Pocket Goblin to your Home Screen, then
          open the installed app and return here to enable notifications.
        </p>
      ) : !available ? (
        <p className={styles.sub}>
          This browser doesn't support Pocket Goblin push alerts. Try an
          up-to-date browser or the installed app.
        </p>
      ) : (
        <>
          <p className={styles.sub} role="status">
            This device:{' '}
            <strong>
              {enabled ? 'Notifications on' : 'Notifications off'}
            </strong>
            {Notification.permission === 'denied'
              ? ' — blocked in browser settings'
              : ''}
          </p>
          <Button
            disabled={
              busy || (!enabled && Notification.permission === 'denied')
            }
            onClick={() => void (enabled ? disable() : enable())}
          >
            {busy
              ? 'Working…'
              : enabled
                ? 'Turn off notifications'
                : 'Enable notifications'}
          </Button>
        </>
      )}
      {message ? (
        <p role="status" className={styles.sub}>
          {message}
        </p>
      ) : null}
      <p className={styles.sub}>
        Existing quiet hours are respected. Scheduled reminders are checked
        approximately every five minutes; delivery also depends on the device
        and network.
      </p>
    </>
  )
}
