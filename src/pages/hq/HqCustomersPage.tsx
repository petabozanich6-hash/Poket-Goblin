import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import {
  formatBytes,
  formatDate,
  hq,
  PLAN_LABELS,
  type CustomerSummary,
} from '@/features/hq/hqApi'

import styles from './Hq.module.css'
import { HqError } from './HqLayout'

export function PlanBadge({
  c,
}: {
  c: Pick<CustomerSummary, 'plan' | 'isOwner'>
}) {
  const cls =
    c.plan === 'owner_premium'
      ? styles.badgeOwner
      : c.plan === 'premium'
        ? styles.badgePremium
        : ''
  return (
    <span className={[styles.badge, cls].join(' ')}>
      {c.isOwner ? '👑 ' : ''}
      {PLAN_LABELS[c.plan]}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return status === 'suspended' ? (
    <span className={[styles.badge, styles.badgeDanger].join(' ')}>
      Suspended
    </span>
  ) : (
    <span className={styles.badge}>Active</span>
  )
}

export function HqCustomersPage() {
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const page = Number(params.get('page') ?? '1') || 1

  const customers = useQuery({
    queryKey: ['hq', 'customers', params.toString()],
    queryFn: () => hq.customers(params),
  })

  function update(next: Record<string, string>) {
    const merged = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v) merged.set(k, v)
      else merged.delete(k)
    }
    if (!('page' in next)) merged.delete('page')
    setParams(merged)
  }

  function search(event: FormEvent) {
    event.preventDefault()
    update({ q: q.trim() })
  }

  return (
    <Card>
      <h2 className={styles.sectionTitle}>Customers</h2>
      <p className={styles.sectionLead}>
        Account metadata and usage totals only. Notes, brain dumps, documents,
        calendars and lists stay private.
      </p>
      <form className={styles.filters} onSubmit={search} role="search">
        <Input
          label="Search by email or account ID"
          name="q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={254}
        />
        <label className={styles.fieldLabel}>
          Status
          <select
            className={styles.select}
            value={params.get('status') ?? ''}
            onChange={(e) => update({ status: e.target.value })}
          >
            <option value="">Any</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
        <label className={styles.fieldLabel}>
          Plan
          <select
            className={styles.select}
            value={params.get('plan') ?? ''}
            onChange={(e) => update({ plan: e.target.value })}
          >
            <option value="">Any</option>
            <option value="free">Free</option>
            <option value="premium">Premium</option>
            <option value="owner_premium">Owner Premium</option>
          </select>
        </label>
        <Button type="submit">Search</Button>
      </form>
      <label className={styles.check} style={{ marginTop: 'var(--space-3)' }}>
        <input
          type="checkbox"
          checked={params.get('problems') === '1'}
          onChange={(e) => update({ problems: e.target.checked ? '1' : '' })}
        />
        Only accounts with technical problems
      </label>

      {customers.isLoading ? <p className={styles.note}>Searching…</p> : null}
      {customers.error ? <HqError error={customers.error} /> : null}
      {customers.data ? (
        customers.data.customers.length === 0 ? (
          <p className={styles.note}>No customers match.</p>
        ) : (
          <div
            className={styles.tableWrap}
            style={{ marginTop: 'var(--space-4)' }}
          >
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th>Last active</th>
                  <th>Storage</th>
                  <th>Problems</th>
                </tr>
              </thead>
              <tbody>
                {customers.data.customers.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Customer">
                      <Link to={`/hq/customers/${c.id}`}>{c.email}</Link>
                      <div className={styles.muted}>{c.displayName}</div>
                    </td>
                    <td data-label="Plan">
                      <PlanBadge c={c} />
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={c.status} />
                    </td>
                    <td data-label="Joined">{formatDate(c.createdAt)}</td>
                    <td data-label="Last active">{formatDate(c.lastSeenAt)}</td>
                    <td data-label="Storage">
                      {formatBytes(c.storageBytes)} · {c.documentCount} doc(s)
                    </td>
                    <td data-label="Problems">
                      {c.problems > 0 ? (
                        <span
                          className={[styles.badge, styles.badgeDanger].join(
                            ' ',
                          )}
                        >
                          {c.problems}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      <div className={styles.pager}>
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => update({ page: String(page - 1) })}
        >
          Previous
        </Button>
        <span className={styles.muted}>Page {page}</span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!customers.data?.hasMore}
          onClick={() => update({ page: String(page + 1) })}
        >
          Next
        </Button>
      </div>
    </Card>
  )
}
