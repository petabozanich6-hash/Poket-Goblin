import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { detectPlatform, isStandalone } from '@/lib/pwa'

import {
  PUSH_QUERY_KEY,
  fetchPushStatus,
  removeSubscription,
  saveSubscription,
} from './pushApi'

/**
 * Where this device stands:
 * - unavailable: the server isn't set up for notifications yet
 * - unsupported: this browser can't do web push
 * - needs-install: iPhone/iPad only allow it from the home-screen app
 * - blocked: the person (or browser) said no; only browser settings can undo it
 * - off / on: ready either way
 */
export type PushState =
  | 'loading'
  | 'unavailable'
  | 'unsupported'
  | 'needs-install'
  | 'blocked'
  | 'off'
  | 'on'

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) return existing
  // Development builds don't register the worker on start; do it now.
  await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  return navigator.serviceWorker.ready
}

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64Url.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

export function usePush() {
  const qc = useQueryClient()
  const status = useQuery({
    queryKey: PUSH_QUERY_KEY,
    queryFn: fetchPushStatus,
    staleTime: 60_000,
  })
  const [endpoint, setEndpoint] = useState<string | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const ready = status.data?.available && status.data.configured

  // What this device already has. If it's subscribed, tell the server again:
  // after a fresh sign-in this moves it to the new session.
  useEffect(() => {
    if (!ready || !supported()) return
    let cancelled = false
    void navigator.serviceWorker
      .getRegistration('/')
      .then((reg) => reg?.pushManager.getSubscription())
      .then(async (sub) => {
        if (cancelled) return
        setEndpoint(sub?.endpoint ?? null)
        if (sub && Notification.permission === 'granted')
          await saveSubscription(sub.endpoint).catch(() => undefined)
      })
      .catch(() => !cancelled && setEndpoint(null))
    return () => {
      cancelled = true
    }
  }, [ready])

  let state: PushState
  if (status.isLoading) state = 'loading'
  else if (!ready) state = 'unavailable'
  else if (!supported()) {
    const platform = detectPlatform()
    state =
      (platform === 'ios-safari' || platform === 'ios-other') && !isStandalone()
        ? 'needs-install'
        : 'unsupported'
  } else if (Notification.permission === 'denied') state = 'blocked'
  else if (endpoint === undefined) state = 'loading'
  else state = endpoint && Notification.permission === 'granted' ? 'on' : 'off'

  const turnOn = useCallback(async () => {
    const data = status.data
    if (!data?.available || !data.publicKey) return
    setBusy(true)
    setError('')
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setError(
          permission === 'denied'
            ? 'Notifications are blocked for Pocket Goblin. You can allow them in your browser’s site settings.'
            : 'No problem. You can turn them on any time.',
        )
        return
      }
      const reg = await registration()
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(data.publicKey),
        }))
      await saveSubscription(sub.endpoint)
      setEndpoint(sub.endpoint)
      await qc.invalidateQueries({ queryKey: PUSH_QUERY_KEY })
    } catch (e) {
      setError(
        e instanceof Error && 'status' in e
          ? e.message
          : 'Notifications couldn’t be turned on in this browser. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }, [qc, status.data])

  const turnOff = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const reg = await navigator.serviceWorker.getRegistration('/')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await removeSubscription(sub.endpoint).catch(() => undefined)
        await sub.unsubscribe()
      }
      setEndpoint(null)
      await qc.invalidateQueries({ queryKey: PUSH_QUERY_KEY })
    } finally {
      setBusy(false)
    }
  }, [qc])

  return { status: status.data, state, busy, error, turnOn, turnOff }
}
