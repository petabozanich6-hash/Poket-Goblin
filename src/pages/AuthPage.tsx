import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/features/auth/useAuth'
import { ApiError } from '@/lib/api'

import styles from './AuthPage.module.css'

export function AuthPage() {
  const { isAuthenticated, isLoading, login, register } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('register')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
        await register({ email, password, displayName })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.page}>
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

          {error ? <p className={styles.error}>{error}</p> : null}

          <Button type="submit" disabled={busy}>
            {busy
              ? 'Working…'
              : mode === 'login'
                ? 'Enter the den'
                : 'Create account'}
          </Button>
        </form>

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
      </Card>
    </div>
  )
}
