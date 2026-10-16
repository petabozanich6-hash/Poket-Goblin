import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { addPasskey, formatDate, hq } from '@/features/hq/hqApi'

import styles from './Hq.module.css'
import { HqError } from './HqLayout'

function Passkeys() {
  const queryClient = useQueryClient()
  const passkeys = useQuery({
    queryKey: ['hq', 'passkeys'],
    queryFn: hq.passkeys,
  })
  const [label, setLabel] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const remove = useMutation({
    mutationFn: hq.removePasskey,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['hq'] }),
  })

  async function add() {
    setBusy(true)
    setError(null)
    try {
      await addPasskey({ label: label.trim() || 'Passkey' })
      setLabel('')
      await queryClient.invalidateQueries({ queryKey: ['hq'] })
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <h2 className={styles.sectionTitle}>Passkeys</h2>
      <p className={styles.sectionLead}>
        Passkeys unlock Goblin HQ. Keep at least two (for example your laptop
        and your phone) so losing one device doesn’t lock you out.
      </p>
      {passkeys.error ? <HqError error={passkeys.error} /> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Added</th>
            <th>Last used</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {passkeys.data?.passkeys.map((p) => (
            <tr key={p.id}>
              <td data-label="Name">{p.label}</td>
              <td data-label="Added">{formatDate(p.createdAt)}</td>
              <td data-label="Last used">{formatDate(p.lastUsedAt)}</td>
              <td>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={
                    (passkeys.data?.passkeys.length ?? 0) < 2 ||
                    remove.isPending
                  }
                  onClick={() => remove.mutate(p.id)}
                >
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {remove.error ? <HqError error={remove.error} /> : null}
      <div className={styles.filters} style={{ marginTop: 'var(--space-4)' }}>
        <Input
          label="Name for a new passkey"
          name="label"
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. iPhone"
        />
        <Button onClick={() => void add()} disabled={busy}>
          {busy ? 'Waiting for your passkey…' : 'Add another passkey'}
        </Button>
      </div>
      {error ? <HqError error={error} /> : null}
    </Card>
  )
}

function Sessions() {
  const queryClient = useQueryClient()
  const sessions = useQuery({
    queryKey: ['hq', 'sessions'],
    queryFn: hq.sessions,
  })
  const revoke = useMutation({
    mutationFn: hq.revokeOtherSessions,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['hq', 'sessions'] }),
  })
  const others = sessions.data?.sessions.filter((s) => !s.current).length ?? 0

  return (
    <Card>
      <h2 className={styles.sectionTitle}>Your sessions</h2>
      {sessions.error ? <HqError error={sessions.error} /> : null}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Signed in</th>
            <th>Last active</th>
            <th>Expires</th>
          </tr>
        </thead>
        <tbody>
          {sessions.data?.sessions.map((s, i) => (
            <tr key={i}>
              <td data-label="Signed in">
                {formatDate(s.createdAt)}
                {s.current ? (
                  <span className={styles.badge}> This device</span>
                ) : null}
              </td>
              <td data-label="Last active">{formatDate(s.lastSeenAt)}</td>
              <td data-label="Expires">{formatDate(s.expiresAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.actionsRow}>
        <Button
          variant="secondary"
          disabled={others === 0 || revoke.isPending}
          onClick={() => revoke.mutate()}
        >
          Sign out other sessions ({others})
        </Button>
        {revoke.data ? (
          <span className={styles.message} role="status">
            Signed out {revoke.data.revoked} session(s).
          </span>
        ) : null}
      </div>
      {revoke.error ? <HqError error={revoke.error} /> : null}
    </Card>
  )
}

function AuditLog() {
  const [page, setPage] = useState(1)
  const audit = useQuery({
    queryKey: ['hq', 'audit', page],
    queryFn: () => hq.audit(page),
  })

  return (
    <Card>
      <h2 className={styles.sectionTitle}>Audit log</h2>
      <p className={styles.sectionLead}>
        Every administrative change, newest first. It can’t be edited from here.
      </p>
      {audit.error ? <HqError error={audit.error} /> : null}
      {audit.data?.entries.length === 0 ? (
        <p className={styles.muted}>Nothing recorded yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Target</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.data?.entries.map((e) => (
                <tr key={e.id}>
                  <td data-label="When">{formatDate(e.createdAt)}</td>
                  <td data-label="Action">{e.action}</td>
                  <td data-label="Target" className={styles.mono}>
                    {e.targetType ? `${e.targetType}: ${e.targetId}` : '—'}
                  </td>
                  <td data-label="Details" className={styles.mono}>
                    {JSON.stringify(e.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.pager}>
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Newer
        </Button>
        <span className={styles.muted}>Page {page}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!audit.data?.hasMore}
          onClick={() => setPage(page + 1)}
        >
          Older
        </Button>
      </div>
    </Card>
  )
}

export function HqSecurityPage() {
  return (
    <>
      <div className={styles.twoCol}>
        <Passkeys />
        <Sessions />
      </div>
    </>
  )
}

/** The audit log has its own HQ tab, as in Side-Quest Owner HQ. */
export function HqAuditPage() {
  return <AuditLog />
}
