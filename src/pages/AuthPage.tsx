import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/features/auth/useAuth'
import { PlatformBanner } from '@/features/platform/PlatformBanner'
import { api, ApiError } from '@/lib/api'
import { TrustFooter } from '@/features/legal/TrustFooter'

import styles from './AuthPage.module.css'

export function AuthPage() {
  const { isAuthenticated, isLoading, login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingEmail, setPendingEmail] = useState<string | null>(null)
  const [resendMessage, setResendMessage] = useState<string | null>(null)

  if (!isLoading && isAuthenticated) {
    return <Navigate to="/den" replace />
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'login') {
        await login({ email, password })
      } else {
        const created = await register({ email, password, displayName })
        if (created.verificationRequired) {
          setPendingEmail(created.email || email)
        }
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.message.includes('confirm your email')
      ) {
        setPendingEmail(email)
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong')
      }
    } finally {
      setBusy(false)
    }
  }

  async function resend() {
    if (!pendingEmail) return
    setBusy(true)
    setError(null)
    try {
      await api.post('/auth/verify-email/resend', { email: pendingEmail })
      setResendMessage('If confirmation is needed, a fresh link is on its way.')
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not resend the email',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
      <PlatformBanner />
      <Card className={styles.panel}>
        <div className={styles.hero}>
          <div>
            <h1>Pocket Goblin</h1>
            <p className={styles.tagline}>
              Your brain has enough tabs open. Let the goblin handle it.
            </p>
          </div>
        </div>

        <div className={styles.modeTabs} role="tablist" aria-label="Account">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            className={mode === 'register' ? styles.modeActive : styles.modeTab}
            onClick={() => setMode('register')}
          >
            Register
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            className={mode === 'login' ? styles.modeActive : styles.modeTab}
            onClick={() => setMode('login')}
          >
            Sign in
          </button>
        </div>

        {pendingEmail ? (
          <div className={styles.form} data-testid="email-verification-pending">
            <p role="status">
              <strong>Check your inbox!</strong> We sent a confirmation link to{' '}
              {pendingEmail}. You can enter the Goblin's den after confirming
              that the email is yours.
            </p>
            <p>
              If it isn't there, check spam. Email delivery may take a few
              minutes.
            </p>
            <Button type="button" disabled={busy} onClick={() => void resend()}>
              {busy ? 'Sending…' : 'Resend confirmation email'}
            </Button>
            {resendMessage && <p role="status">{resendMessage}</p>}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                setPendingEmail(null)
                setMode('login')
              }}
            >
              Already verified? Sign in
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingEmail(null)
                setMode('register')
              }}
            >
              Wrong address? Register with the correct email
            </button>
          </div>
        ) : (
          <form className={styles.form} onSubmit={(e) => void onSubmit(e)}>
            {mode === 'register' ? (
              <Input
                label="What should the goblin call you?"
                name="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoComplete="nickname"
                required
              />
            ) : null}
            <Input
              label="Email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
            <Input
              label="Password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === 'login' ? 'current-password' : 'new-password'
              }
              minLength={8}
              required
            />

            {error ? (
              <p className={styles.error} role="alert">
                {error}
              </p>
            ) : null}

            <Button type="submit" disabled={busy}>
              {busy
                ? 'Working…'
                : mode === 'login'
                  ? 'Enter the den'
                  : 'Create account'}
            </Button>
          </form>
        )}

        {!pendingEmail && mode === 'login' ? (
          <p className={styles.switch}>
            <Link to="/forgot-password">Forgot your password?</Link>
          </p>
        ) : null}

        {!pendingEmail && (
          <p className={styles.switch}>
            {mode === 'login' ? (
              <>
                New here?{' '}
                <button type="button" onClick={() => setMode('register')}>
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already settled in?{' '}
                <button type="button" onClick={() => setMode('login')}>
                  Log in
                </button>
              </>
            )}
          </p>
        )}
        <TrustFooter />
      </Card>
    </div>
  )
}
