import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import styles from './Hq.module.css'

type Campaign = {
  id: string
  code: string
  name: string
  kind: 'percent' | 'fixed'
  amount: number
  billing_cycles: number
  audience: string
  verification: string
  active: number
  max_redemptions: number | null
  budget_cents: number | null
  redemptions: number
  committed_cents: number
  realised_cents: number
  revenue_cents: number
  expires_at: string | null
  activation_window_days: number | null
}
const money = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(
    cents / 100,
  )
const fetchDeals = () =>
  api.admin.get<{ campaigns: Campaign[]; checkoutIntegrated: boolean }>(
    '/deals',
  )
export function HqDealsPage() {
  const qc = useQueryClient()
  const deals = useQuery({ queryKey: ['hq', 'deals'], queryFn: fetchDeals })
  const [message, setMessage] = useState('')
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent')
  const refresh = () => qc.invalidateQueries({ queryKey: ['hq', 'deals'] })
  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.admin.send('POST', '/deals', data),
    onSuccess: () => {
      setMessage('New campaign saved inactive.')
      void refresh()
    },
    onError: (e: Error) => setMessage(e.message),
  })
  const edit = useMutation({
    mutationFn: ({
      id,
      fields,
    }: {
      id: string
      fields: Record<string, unknown>
    }) => api.admin.send('PATCH', `/deals/${encodeURIComponent(id)}`, fields),
    onSuccess: () => {
      setMessage('Campaign saved.')
      void refresh()
    },
    onError: (e: Error) => setMessage(e.message),
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const f = new FormData(event.currentTarget)
    const max = String(f.get('max') ?? '')
    const budget = String(f.get('budget') ?? '')
    create.mutate({
      code: String(f.get('code') ?? ''),
      name: String(f.get('name') ?? ''),
      kind,
      amount:
        kind === 'percent'
          ? Number(f.get('amount'))
          : Math.round(Number(f.get('amount')) * 100),
      billingCycles: Number(f.get('cycles')),
      audience: String(f.get('audience')),
      verification: String(f.get('verification')),
      maxRedemptions: max ? Number(max) : null,
      budgetCents: budget ? Math.round(Number(budget) * 100) : null,
    })
  }
  return (
    <section className={styles.page}>
      <h2>🧌 Goblin Deals &amp; Mischief</h2>
      <p>
        Campaign management in AUD. All offers remain inactive while secure
        checkout redemption is being completed.
      </p>
      <p role="status">{message}</p>
      <Card>
        <h3>Create a campaign</h3>
        <form
          onSubmit={submit}
          style={{ display: 'grid', gap: 12, maxWidth: 600 }}
        >
          <label>
            Code{' '}
            <input
              name="code"
              required
              minLength={3}
              maxLength={32}
              placeholder="UNI20"
            />
          </label>
          <label>
            Campaign name{' '}
            <input name="name" required minLength={3} maxLength={100} />
          </label>
          <label>
            Discount type{' '}
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'percent' | 'fixed')}
            >
              <option value="percent">Percentage</option>
              <option value="fixed">Fixed amount (AUD)</option>
            </select>
          </label>
          <label>
            Discount {kind === 'percent' ? '(%)' : '(A$)'}{' '}
            <input
              name="amount"
              type="number"
              min={kind === 'percent' ? 1 : 0.01}
              max={kind === 'percent' ? 100 : undefined}
              step={kind === 'percent' ? 1 : 0.01}
              required
            />
          </label>
          <label>
            Discounted billing cycles{' '}
            <input
              name="cycles"
              type="number"
              min={1}
              max={36}
              defaultValue={1}
              required
            />
          </label>
          <label>
            Audience{' '}
            <select name="audience">
              <option value="new">New subscribers</option>
              <option value="existing">Existing subscribers</option>
              <option value="all">All subscribers</option>
            </select>
          </label>
          <label>
            Eligibility{' '}
            <select name="verification">
              <option value="none">No verification required</option>
              <option value="manual">Manual verification required</option>
            </select>
          </label>
          <label>
            Maximum redemptions (optional){' '}
            <input name="max" type="number" min={1} />
          </label>
          <label>
            Maximum committed discount budget (A$, optional){' '}
            <input name="budget" type="number" step="0.01" min="0.01" />
          </label>
          <Button type="submit" disabled={create.isPending}>
            Save inactive campaign
          </Button>
        </form>
      </Card>
      {deals.isLoading ? (
        <p>Counting mischief…</p>
      ) : deals.isError ? (
        <p role="alert">
          Unable to load campaigns. Check database migration 0015.
        </p>
      ) : (
        deals.data?.campaigns.map((p) => (
          <Card key={p.id}>
            <h3>
              {p.name} — <code>{p.code}</code> (
              {p.active ? 'Active' : 'Inactive'})
            </h3>
            <p>
              {p.kind === 'percent' ? `${p.amount}%` : money(p.amount)} off for{' '}
              {p.billing_cycles} billing cycle(s). Audience: {p.audience}.{' '}
              {p.verification === 'manual'
                ? 'Manual eligibility verification required.'
                : ''}
            </p>
            <p>
              Redemptions: {p.redemptions}
              {p.max_redemptions !== null ? ` / ${p.max_redemptions}` : ''} ·
              Revenue: {money(p.revenue_cents)} · Discounts given:{' '}
              {money(p.realised_cents)}
            </p>
            <p>
              Committed: {money(p.committed_cents)} · Outstanding:{' '}
              {money(Math.max(0, p.committed_cents - p.realised_cents))} ·
              Budget left:{' '}
              {p.budget_cents === null
                ? 'Unlimited'
                : money(Math.max(0, p.budget_cents - p.committed_cents))}
            </p>
            {p.activation_window_days ? (
              <p>Expires {p.activation_window_days} days after activation.</p>
            ) : null}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                disabled={!p.active || edit.isPending}
                onClick={() =>
                  edit.mutate({ id: p.id, fields: { active: false } })
                }
              >
                Deactivate
              </Button>
              <Button
                variant="secondary"
                disabled={edit.isPending}
                onClick={() => {
                  const s = window.prompt('New campaign name', p.name)
                  if (s) edit.mutate({ id: p.id, fields: { name: s } })
                }}
              >
                Rename
              </Button>
              <Button
                variant="secondary"
                disabled={edit.isPending}
                onClick={() => {
                  const s = window.prompt(
                    'Maximum redemption count (blank = unlimited)',
                    String(p.max_redemptions ?? ''),
                  )
                  if (s !== null)
                    edit.mutate({
                      id: p.id,
                      fields: { maxRedemptions: s === '' ? null : Number(s) },
                    })
                }}
              >
                Redemption cap
              </Button>
              <Button
                variant="secondary"
                disabled={edit.isPending}
                onClick={() => {
                  const s = window.prompt(
                    'Discount commitment budget in AUD (blank = unlimited)',
                    p.budget_cents === null ? '' : String(p.budget_cents / 100),
                  )
                  if (s !== null)
                    edit.mutate({
                      id: p.id,
                      fields: {
                        budgetCents:
                          s === '' ? null : Math.round(Number(s) * 100),
                      },
                    })
                }}
              >
                Budget
              </Button>
            </div>
          </Card>
        ))
      )}
    </section>
  )
}
