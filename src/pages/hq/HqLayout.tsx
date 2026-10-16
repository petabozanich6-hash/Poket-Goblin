import { useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Lock, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { GoblinMascot } from '@/components/goblin/GoblinMascot'
import { useAuth } from '@/features/auth/useAuth'
import {
  addPasskey,
  formatDate,
  hq,
  SECURITY_KEY,
  stepUpWithPasskey,
} from '@/features/hq/hqApi'
import { ApiError } from '@/lib/api'

import styles from './Hq.module.css'

const tabs = [
  { to: '/hq', label: 'Overview', end: true },
  { to: '/hq/customers', label: 'Customers' },
  { to: '/hq/feedback', label: 'Feedback inbox' },
  { to: '/hq/costs', label: 'AI & Costs (AUD)' },
  { to: '/hq/settings', label: 'Platform settings' },
  { to: '/hq/security', label: 'Security & audit' },
]

function describeError(error: unknown) {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.name === 'NotAllowedError') {
    return 'The passkey request was cancelled or timed out.'
  }
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function EnrolPasskey({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    try {
      await addPasskey({
        password: String(form.get('password') ?? ''),
        label: String(form.get('label') ?? '') || 'Passkey',
      })
      onDone()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={styles.gate}>
      <KeyRound size={36} aria-hidden />
      <h1 className={styles.hqTitle}>Secure Goblin HQ with a passkey</h1>
      <p className={styles.hqSub}>
        Goblin HQ holds customer and platform controls, so it needs more than a
        password. Add a passkey (Touch ID, Face ID, Windows Hello, your phone or
        a security key). Enter your password once more to confirm it’s you.
      </p>
      <form className={styles.gateForm} onSubmit={(e) => void submit(e)}>
        <Input
          label="Your Pocket Goblin password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Input
          label="Name this passkey"
          name="label"
          placeholder="e.g. MacBook Touch ID"
          maxLength={60}
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Waiting for your passkey…' : 'Add passkey'}
        </Button>
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Card>
  )
}

function StepUp({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await stepUpWithPasskey()
      onDone()
    } catch (err) {
      setError(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className={styles.gate}>
      <ShieldCheck size={36} aria-hidden />
      <h1 className={styles.hqTitle}>Confirm it’s you</h1>
      <p className={styles.hqSub}>
        Use your passkey to open Goblin HQ. Access lasts 15 minutes, then the
        goblin asks again.
      </p>
      <Button onClick={() => void confirm()} disabled={busy}>
        {busy ? 'Waiting for your passkey…' : 'Confirm with passkey'}
      </Button>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
    </Card>
  )
}

export function HqLayout() {
  const { access, isLoading } = useAuth()
  const queryClient = useQueryClient()
  const isOwner = Boolean(access?.isOwner)
  const status = useQuery({
    queryKey: SECURITY_KEY,
    queryFn: hq.securityStatus,
    enabled: isOwner,
    retry: false,
  })

  // Re-check when the step-up runs out, so the gate comes back by itself.
  const elevatedUntil = status.data?.elevatedUntil
  useEffect(() => {
    if (!elevatedUntil) return
    const ms = new Date(elevatedUntil).getTime() - Date.now()
    const timer = window.setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: SECURITY_KEY }),
      Math.max(0, ms) + 500,
    )
    return () => window.clearTimeout(timer)
  }, [elevatedUntil, queryClient])

  // UI convenience only: the server answers 404 to anyone who is not Owner.
  if (isLoading) return <p>Opening Goblin HQ…</p>
  if (!isOwner) return <Navigate to="/den" replace />

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['hq'] })

  if (status.isLoading) return <p>Opening Goblin HQ…</p>
  if (status.isError || !status.data) {
    return (
      <Card>
        <p className={styles.error}>Goblin HQ is unavailable right now.</p>
      </Card>
    )
  }
  if (status.data.passkeyCount === 0) return <EnrolPasskey onDone={refresh} />
  if (!status.data.elevated) return <StepUp onDone={refresh} />

  async function lock() {
    await hq.endStepUp().catch(() => undefined)
    refresh()
  }

  return (
    <div className={styles.hq}>
      <header className={styles.hqHeader}>
        <GoblinMascot size={64} alt="" loading="lazy" />
        <div className={styles.hqHeaderText}>
          <h1 className={styles.hqTitle}>
            <span aria-hidden>👑 </span>Goblin HQ
          </h1>
          <p className={styles.hqSub}>
            Owner-only. Unlocked until {formatDate(status.data.elevatedUntil)}.
          </p>
        </div>
        <div className={styles.hqHeaderActions}>
          <Button variant="secondary" size="sm" onClick={() => void lock()}>
            <Lock size={16} aria-hidden />
            Lock HQ
          </Button>
        </div>
      </header>
      <nav className={styles.tabs} aria-label="Goblin HQ">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) =>
              [styles.tab, isActive ? styles.tabActive : ''].join(' ')
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}

/** Shared error display; a lapsed step-up sends the Owner back to the gate. */
export function HqError({ error }: { error: unknown }) {
  const queryClient = useQueryClient()
  const stepUp = error instanceof ApiError && error.code === 'step_up_required'
  useEffect(() => {
    if (stepUp) void queryClient.invalidateQueries({ queryKey: SECURITY_KEY })
  }, [stepUp, queryClient])
  return (
    <p className={styles.error} role="alert">
      {stepUp ? 'Confirm with your passkey again.' : describeError(error)}
    </p>
  )
}
