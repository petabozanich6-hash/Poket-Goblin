import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { api, ApiError } from '@/lib/api'

import styles from './AuthPage.module.css'

/** The single-use token from the link (#token=…; never sent to the server in the URL). */
function useFragmentToken(): string {
  const match = window.location.hash.match(/token=([A-Za-z0-9_-]+)/)
  return match?.[1] ?? ''
}

/** Once a token has been used, take it out of the address bar and history. */
function forgetFragment() {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname)
  }
}

function errorText(err: unknown) {
  return err instanceof ApiError
    ? err.message
    : 'Something went wrong — please try again.'
}

function Shell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.page}>
      <Card className={styles.panel}>
        <div>
          <h1>{title}</h1>
        </div>
        {children}
        <p className={styles.switch}>
          <Link to="/">Back to sign in</Link>
        </p>
      </Card>
    </div>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ message: string }>('/auth/password/forgot', {
        email,
      })
      setDone(res.message)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell title="Forgot your password?">
      {done ? (
        <p role="status">{done} Check your spam folder if it doesn’t arrive.</p>
      ) : (
        <form className={styles.form} onSubmit={(e) => void submit(e)}>
          <p className={styles.tagline}>
            Tell the goblin your email and it’ll send a link to choose a new
            password.
          </p>
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send me a reset link'}
          </Button>
        </form>
      )}
    </Shell>
  )
}

export function ResetPasswordPage() {
  const token = useFragmentToken()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) {
      setError('Those passwords don’t match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/password/reset', { token, password })
      forgetFragment()
      setDone(true)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (!token && !done) {
    return (
      <Shell title="Reset link missing">
        <p>
          This page needs the link from your email.{' '}
          <Link to="/forgot-password">Ask for a new one</Link>.
        </p>
      </Shell>
    )
  }

  return (
    <Shell title="Choose a new password">
      {done ? (
        <p role="status">
          Done! Your password is changed and you’ve been signed out everywhere.{' '}
          <Link to="/">Sign in with your new password</Link>.
        </p>
      ) : (
        <form className={styles.form} onSubmit={(e) => void submit(e)}>
          <Input
            label="New password (8+ characters)"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Input
            label="Type it again"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
          {error ? (
            <p className={styles.error} role="alert">
              {error}{' '}
              {/expired|used/.test(error) ? (
                <Link to="/forgot-password">Get a new link</Link>
              ) : null}
            </p>
          ) : null}
          <Button type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'}
          </Button>
        </form>
      )}
    </Shell>
  )
}

export function VerifyEmailPage() {
  const token = useFragmentToken()
  const [state, setState] = useState<'working' | 'done' | 'failed'>(
    token ? 'working' : 'failed',
  )
  const sent = useRef(false)

  useEffect(() => {
    if (!token || sent.current) return
    sent.current = true
    api
      .post('/auth/verify-email', { token })
      .then(() => setState('done'))
      .catch(() => setState('failed'))
      .finally(forgetFragment)
  }, [token])

  return (
    <Shell title="Confirm your email">
      <p role="status">
        {state === 'working'
          ? 'Checking your link…'
          : state === 'done'
            ? 'Thanks — your email is confirmed. 👹'
            : 'That link has expired or was already used. You can send a new one from Settings.'}
      </p>
    </Shell>
  )
}
