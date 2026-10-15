import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api, ApiError } from '@/lib/api'

import styles from './AccountControls.module.css'

function errorText(err: unknown) {
  return err instanceof ApiError
    ? err.message
    : 'Something went wrong — please try again.'
}

function useAction() {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function run(fn: () => Promise<string>) {
    setBusy(true)
    setMessage(null)
    setError(null)
    try {
      setMessage(await fn())
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  return { busy, message, error, run }
}

function Feedback({
  message,
  error,
}: {
  message: string | null
  error: string | null
}) {
  if (error) {
    return (
      <p className={styles.error} role="alert">
        {error}
      </p>
    )
  }
  return message ? (
    <p className={styles.message} role="status">
      {message}
    </p>
  ) : null
}

export function EmailStatus({
  verified,
  configured,
}: {
  verified: boolean
  configured: boolean
}) {
  const resend = useAction()
  if (verified) return <p className={styles.muted}>Email confirmed ✓</p>
  return (
    <div className={styles.row}>
      <p className={styles.muted}>
        Email not confirmed yet
        {configured ? '' : ' (email sending isn’t switched on yet)'}.
      </p>
      {configured ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={resend.busy}
          onClick={() =>
            void resend.run(async () => {
              await api.post('/account/verify-email/resend', {})
              return 'Sent — check your inbox.'
            })
          }
        >
          Send confirmation email
        </Button>
      ) : null}
      <Feedback message={resend.message} error={resend.error} />
    </div>
  )
}

export function ChangePassword() {
  const action = useAction()
  const [open, setOpen] = useState(false)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    void action.run(async () => {
      await api.post('/account/password', {
        currentPassword: String(data.get('currentPassword') ?? ''),
        newPassword: String(data.get('newPassword') ?? ''),
      })
      form.reset()
      setOpen(false)
      return 'Password changed. Other devices have been signed out.'
    })
  }

  return (
    <div className={styles.block}>
      {open ? (
        <form className={styles.form} onSubmit={submit}>
          <Input
            label="Current password"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
          <Input
            label="New password (8+ characters)"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <div className={styles.row}>
            <Button type="submit" size="sm" disabled={action.busy}>
              Change password
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Change password
        </Button>
      )}
      <Feedback message={action.message} error={action.error} />
    </div>
  )
}

export function YourData({ isOwner }: { isOwner: boolean }) {
  const exporter = useAction()
  const deleter = useAction()
  const [deleting, setDeleting] = useState(false)

  async function download() {
    const res = await fetch('/api/account/export', { credentials: 'include' })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new ApiError(res.status, body.error ?? 'Export failed')
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `pocket-goblin-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    return 'Your data is downloading.'
  }

  function submitDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    void deleter.run(async () => {
      await api.delete_with_body('/account', {
        confirm: String(data.get('confirm') ?? ''),
        password: String(data.get('password') ?? ''),
      })
      window.location.assign('/')
      return 'Account deleted.'
    })
  }

  return (
    <div className={styles.block}>
      <p className={styles.muted}>
        Download everything Pocket Goblin holds about you (tasks, notes,
        calendar, settings and more) as a file.
      </p>
      <Button
        size="sm"
        variant="secondary"
        disabled={exporter.busy}
        onClick={() => void exporter.run(download)}
      >
        Download my data
      </Button>
      <Feedback message={exporter.message} error={exporter.error} />

      {isOwner ? (
        <p className={styles.muted}>
          The Owner account can’t be deleted from here.
        </p>
      ) : deleting ? (
        <form className={styles.danger} onSubmit={submitDelete}>
          <strong>Delete your account?</strong>
          <p className={styles.muted}>
            This permanently deletes your account, tasks, notes, calendar, lists
            and kept documents. It can’t be undone. Download your data first if
            you want a copy.
          </p>
          <Input
            label="Your password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
          <Input
            label="Type DELETE to confirm"
            name="confirm"
            autoComplete="off"
            required
          />
          <div className={styles.row}>
            <Button
              type="submit"
              variant="danger"
              size="sm"
              disabled={deleter.busy}
            >
              Delete my account
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setDeleting(false)}
            >
              Keep my account
            </Button>
          </div>
          <Feedback message={deleter.message} error={deleter.error} />
        </form>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setDeleting(true)}>
          Delete my account…
        </Button>
      )}
    </div>
  )
}
