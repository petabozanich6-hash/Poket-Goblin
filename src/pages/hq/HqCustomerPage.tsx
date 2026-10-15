import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, TextArea } from '@/components/ui/Input'
import { formatBytes, formatDate, hq } from '@/features/hq/hqApi'

import styles from './Hq.module.css'
import { PlanBadge, StatusBadge } from './HqCustomersPage'
import { HqError } from './HqLayout'

const USAGE_LABELS: Record<string, string> = {
  tasks: 'Tasks',
  notes: 'Notes',
  events: 'Calendar entries',
  reminders: 'Reminders',
  shoppingItems: 'Shopping items',
  captures: 'Brain dumps',
  documents: 'Documents',
  aiRequests30d: 'AI requests (30 days)',
}

type Action = 'suspend' | 'restore' | 'revoke'

function AccountActions({
  id,
  status,
  isOwner,
}: {
  id: string
  status: string
  isOwner: boolean
}) {
  const queryClient = useQueryClient()
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [typed, setTyped] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const run = useMutation({
    mutationFn: async () => {
      if (action === 'suspend') return hq.suspend(id, reason.trim())
      if (action === 'restore') return hq.restore(id, reason.trim())
      return hq.revokeSessions(id, reason.trim())
    },
    onSuccess: async () => {
      setMessage(
        action === 'suspend'
          ? 'Account suspended and signed out everywhere.'
          : action === 'restore'
            ? 'Account restored.'
            : 'Signed out of every session.',
      )
      setAction(null)
      setReason('')
      setTyped('')
      await queryClient.invalidateQueries({ queryKey: ['hq'] })
    },
  })

  if (isOwner) {
    return (
      <p className={styles.note}>
        Owner accounts can’t be suspended or signed out from here.
      </p>
    )
  }

  const reasonOk = reason.trim().length >= 5 && reason.trim().length <= 500
  const ready = reasonOk && (action !== 'suspend' || typed === 'SUSPEND')

  return (
    <>
      <div className={styles.actionsRow}>
        {status === 'suspended' ? (
          <Button variant="secondary" onClick={() => setAction('restore')}>
            Restore account
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setAction('suspend')}>
            Suspend account
          </Button>
        )}
        <Button variant="secondary" onClick={() => setAction('revoke')}>
          Sign out all sessions
        </Button>
      </div>
      {message ? (
        <p className={styles.message} role="status">
          {message}
        </p>
      ) : null}
      {action ? (
        <form
          className={styles.confirmBox}
          onSubmit={(e) => {
            e.preventDefault()
            if (ready) run.mutate()
          }}
        >
          <strong>
            {action === 'suspend'
              ? 'Suspend this account?'
              : action === 'restore'
                ? 'Restore this account?'
                : 'Sign this customer out everywhere?'}
          </strong>
          {action === 'suspend' ? (
            <span className={styles.muted}>
              They are signed out immediately and can’t sign in until restored.
              Their data is kept.
            </span>
          ) : null}
          <TextArea
            label="Reason (kept in the audit log)"
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            required
          />
          {action === 'suspend' ? (
            <Input
              label="Type SUSPEND to confirm"
              name="confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          ) : null}
          <div className={styles.actionsRow}>
            <Button
              type="submit"
              variant={action === 'suspend' ? 'danger' : 'primary'}
              disabled={!ready || run.isPending}
            >
              Confirm
            </Button>
            <Button variant="ghost" onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
          {run.error ? <HqError error={run.error} /> : null}
        </form>
      ) : null}
    </>
  )
}

export function HqCustomerPage() {
  const { id = '' } = useParams()
  const detail = useQuery({
    queryKey: ['hq', 'customer', id],
    queryFn: () => hq.customer(id),
  })

  if (detail.isLoading) return <p>Looking up the account…</p>
  if (detail.error) return <HqError error={detail.error} />
  const data = detail.data
  if (!data) return null
  const c = data.customer

  return (
    <>
      <p>
        <Link to="/hq/customers">← All customers</Link>
      </p>
      <div className={styles.twoCol}>
        <Card>
          <h2 className={styles.sectionTitle}>{c.email}</h2>
          <dl className={styles.dl}>
            <dt>Name</dt>
            <dd>{c.displayName}</dd>
            <dt>Account ID</dt>
            <dd className={styles.mono}>{c.id}</dd>
            <dt>Plan</dt>
            <dd>
              <PlanBadge c={c} />
            </dd>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={c.status} />
              {data.suspension?.reason ? (
                <div className={styles.muted}>
                  Since {formatDate(data.suspension.suspendedAt)}:{' '}
                  {data.suspension.reason}
                </div>
              ) : null}
            </dd>
            <dt>Joined</dt>
            <dd>{formatDate(c.createdAt)}</dd>
            <dt>Last active</dt>
            <dd>{formatDate(c.lastSeenAt)}</dd>
            <dt>Signed-in sessions</dt>
            <dd>{data.activeSessions}</dd>
            <dt>Storage</dt>
            <dd>{formatBytes(c.storageBytes)}</dd>
          </dl>
          <AccountActions id={c.id} status={c.status} isOwner={c.isOwner} />
        </Card>
        <Card>
          <h2 className={styles.sectionTitle}>Usage</h2>
          <p className={styles.sectionLead}>How much, never what.</p>
          <div className={styles.stats}>
            {Object.entries(data.usage).map(([key, value]) => (
              <div className={styles.stat} key={key}>
                <span className={styles.statLabel}>
                  {USAGE_LABELS[key] ?? key}
                </span>
                <span className={styles.statValue}>{value}</span>
              </div>
            ))}
          </div>
          {data.problems.length > 0 ? (
            <ul
              className={styles.warnings}
              style={{ marginTop: 'var(--space-4)' }}
            >
              {data.problems.map((p) => (
                <li className={styles.warning} key={p}>
                  {p}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.note}>No technical problems detected.</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className={styles.sectionTitle}>Subscription</h2>
        {data.entitlements.length === 0 ? (
          <p className={styles.muted}>
            Free plan. No subscription records (Stripe is not connected yet).
          </p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Entitlement</th>
                  <th>Source</th>
                  <th>Status</th>
                  <th>Billing</th>
                  <th>Renews / ends</th>
                </tr>
              </thead>
              <tbody>
                {data.entitlements.map((e, i) => (
                  <tr key={`${e.entitlement}-${i}`}>
                    <td data-label="Entitlement">
                      {e.entitlement === 'owner_premium'
                        ? 'Owner Premium'
                        : 'Premium'}
                    </td>
                    <td data-label="Source">
                      {e.source === 'admin' ? 'Granted' : 'Stripe'}
                    </td>
                    <td data-label="Status">
                      {e.endedAt ? `${e.status} (ended)` : e.status}
                    </td>
                    <td data-label="Billing">
                      {e.billingInterval
                        ? `${e.billingInterval === 'year' ? 'Annual' : 'Monthly'}${e.currency ? ` · ${e.currency.toUpperCase()}` : ''}`
                        : '—'}
                    </td>
                    <td data-label="Renews / ends">
                      {e.source === 'admin'
                        ? 'Permanent'
                        : `${formatDate(e.currentPeriodEnd)}${e.cancelAtPeriodEnd ? ' (cancelling)' : ''}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className={styles.twoCol}>
        <Card>
          <h2 className={styles.sectionTitle}>Security events</h2>
          {data.securityEvents.length === 0 ? (
            <p className={styles.muted}>None recorded.</p>
          ) : (
            <table className={styles.table}>
              <tbody>
                {data.securityEvents.map((e, i) => (
                  <tr key={i}>
                    <td data-label="Event">{e.type.replaceAll('_', ' ')}</td>
                    <td data-label="When">{formatDate(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <h2 className={styles.sectionTitle}>Administrative history</h2>
          {data.auditTrail.length === 0 ? (
            <p className={styles.muted}>No administrative actions.</p>
          ) : (
            <table className={styles.table}>
              <tbody>
                {data.auditTrail.map((e, i) => (
                  <tr key={i}>
                    <td data-label="Action">{e.action}</td>
                    <td data-label="When">{formatDate(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  )
}
