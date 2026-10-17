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

type Giveaway = {
  id: string
  name: string
  durationDays: number
  maxRecipients: number
  recipients: number
}

function GiveawaysPanel() {
  const qc = useQueryClient()
  const [notice, setNotice] = useState('')
  const [recipientEmails, setRecipientEmails] = useState<
    Record<string, string>
  >({})
  const campaigns = useQuery({
    queryKey: ['hq', 'giveaways'],
    queryFn: () => api.admin.get<{ giveaways: Giveaway[] }>('/deals/giveaways'),
  })
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.admin.send('POST', '/deals/giveaways', body),
    onSuccess: () => {
      setNotice('Free Premium giveaway created. No payment details needed.')
      void qc.invalidateQueries({ queryKey: ['hq', 'giveaways'] })
    },
    onError: (error: Error) => setNotice(error.message),
  })
  const grant = useMutation({
    mutationFn: ({ id, email }: { id: string; email: string }) =>
      api.admin.send(
        'POST',
        `/deals/giveaways/${encodeURIComponent(id)}/grant`,
        { email },
      ),
    onSuccess: () => {
      setNotice('Free Premium has been awarded — no recurring payment.')
      void qc.invalidateQueries({ queryKey: ['hq', 'giveaways'] })
    },
    onError: (error: Error) => setNotice(error.message),
  })
  return (
    <Card>
      <h3>🎁 Free Premium giveaways</h3>
      <p>
        Choose how long Premium lasts and how many customers can receive it.
        Grant access to an existing account by email. No checkout, payment
        details, or recurring charge. Each account may receive a campaign only
        once.
      </p>
      <p role="status">{notice}</p>
      <form
        style={{ display: 'grid', gap: 12, maxWidth: 600 }}
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          create.mutate({
            name: String(form.get('name') ?? ''),
            durationDays: Number(form.get('days')),
            maxRecipients: Number(form.get('max')),
          })
        }}
      >
        <label>
          Giveaway name{' '}
          <input name="name" required minLength={3} maxLength={100} />
        </label>
        <label>
          Free Premium duration (days){' '}
          <input
            name="days"
            type="number"
            min={1}
            max={365}
            defaultValue={7}
            required
          />
        </label>
        <label>
          Maximum recipients{' '}
          <input
            name="max"
            type="number"
            min={1}
            max={10000}
            defaultValue={1}
            required
          />
        </label>
        <Button type="submit" disabled={create.isPending}>
          Create giveaway
        </Button>
      </form>
      {campaigns.isError ? (
        <p role="alert">
          Could not load giveaways. Check that the giveaway database migration
          is applied.
        </p>
      ) : null}
      {campaigns.data?.giveaways.map((gift) => (
        <div key={gift.id} style={{ marginTop: 20 }}>
          <strong>{gift.name}</strong> — {gift.durationDays} free days,{' '}
          {gift.recipients} / {gift.maxRecipients} awarded
          <form
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}
            onSubmit={(event) => {
              event.preventDefault()
              grant.mutate({
                id: gift.id,
                email: recipientEmails[gift.id] ?? '',
              })
            }}
          >
            <label>
              Customer email{' '}
              <input
                type="email"
                required
                value={recipientEmails[gift.id] ?? ''}
                onChange={(event) =>
                  setRecipientEmails((previous) => ({
                    ...previous,
                    [gift.id]: event.target.value,
                  }))
                }
              />
            </label>
            <Button
              type="submit"
              disabled={
                grant.isPending || gift.recipients >= gift.maxRecipients
              }
            >
              Award free Premium
            </Button>
          </form>
        </div>
      ))}
    </Card>
  )
}

type Redemption = {
  id: string
  email: string
  status: 'reserved' | 'confirmed' | 'failed' | 'expired'
  createdAt: string
  confirmedAt: string | null
  committedCents: number
  discountsRealisedCents: number
  revenuePaidCents: number
}

function RedemptionTracker({ campaignId }: { campaignId: string }) {
  const claims = useQuery({
    queryKey: ['hq', 'deals', campaignId, 'redemptions'],
    queryFn: () =>
      api.admin.get<{ redemptions: Redemption[] }>(
        `/deals/${encodeURIComponent(campaignId)}/redemptions`,
      ),
  })
  if (claims.isLoading) return <p>Checking the treasure ledger…</p>
  if (claims.isError) return <p role="alert">Could not load the claims ledger.</p>
  if (!claims.data?.redemptions.length)
    return <p>No claims recorded for this campaign yet.</p>
  return (
    <div>
      <h4>Claim history (latest 250)</h4>
      <ul>
        {claims.data.redemptions.map((claim) => (
          <li key={claim.id}>
            {claim.email} — {claim.status} ·{' '}
            {new Date(claim.createdAt).toLocaleDateString()} · Discount used:{' '}
            {money(claim.discountsRealisedCents)} · Revenue:{' '}
            {money(claim.revenuePaidCents)}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function HqDealsPage() {
  const qc = useQueryClient()
  const deals = useQuery({ queryKey: ['hq', 'deals'], queryFn: fetchDeals })
  const [message, setMessage] = useState('')
  const [kind, setKind] = useState<'percent' | 'fixed'>('percent')
  const [preset, setPreset] = useState('custom')
  const [expandedTracker, setExpandedTracker] = useState<string | null>(null)
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
      activationWindowDays: f.get('activationWindowDays')
        ? Number(f.get('activationWindowDays'))
        : null,
      startAt: f.get('startAt')
        ? new Date(String(f.get('startAt'))).toISOString()
        : null,
      expiresAt: f.get('expiresAt')
        ? new Date(String(f.get('expiresAt'))).toISOString()
        : null,
    })
  }
  return (
    <section className={styles.page}>
      <h2>🧌 Goblin Deals &amp; Mischief</h2>
      <p>
        Create targeted offers with limits, budgets and time windows. All
        discount campaigns remain inactive until secure redemption is
        implemented.
      </p>
      <p role="status">{message}</p>
      <GiveawaysPanel />
      <Card>
        <h3>Create a campaign</h3>
        <form
          onSubmit={submit}
          style={{ display: 'grid', gap: 12, maxWidth: 600 }}
        >
          <label>
            Mischief recipe{' '}
            <select
              value={preset}
              onChange={(e) => {
                const next = e.target.value
                setPreset(next)
                if (next === 'giveaway') setKind('percent')
                if (next === 'fixed') setKind('fixed')
                if (next === 'percent') setKind('percent')
              }}
            >
              <option value="custom">Custom deal</option>
              <option value="percent">Percentage discount</option>
              <option value="fixed">Fixed-dollar discount (AUD)</option>
              <option value="student">Student / verified eligibility</option>
              <option value="founder">Founding goblins / limited places</option>
              <option value="flash">Flash sale / time-limited deal</option>
              <option value="giveaway">
                Free Premium giveaway (draft only)
              </option>
            </select>
          </label>
          {preset === 'giveaway' ? (
            <p role="note">
              Free giveaways need a separate, time-limited Premium entitlement
              with no checkout or recurring charges. Save a campaign draft for
              now; giveaway redemption is not enabled yet.
            </p>
          ) : null}
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
            Discounted invoices (not months){' '}
            <input
              name="cycles"
              type="number"
              min={1}
              max={36}
              defaultValue={1}
              required
            />
          </label>
          <p role="note">
            CAUTION: A billing cycle means one invoice, not one calendar month.
            Six cycles means six months on a monthly plan but six years on an
            annual plan. These draft codes cannot be activated or redeemed.
            Calendar-duration and plan-specific discount rules are being designed
            separately. Free Premium gifts are handled above.
          </p>
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
            Start date (optional) <input name="startAt" type="datetime-local" />
          </label>
          <label>
            Expiry date (optional){' '}
            <input name="expiresAt" type="datetime-local" />
          </label>
          <label>
            Days after activation before expiry (optional){' '}
            <input
              name="activationWindowDays"
              type="number"
              min={1}
              max={365}
            />
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
            <Button
              variant="secondary"
              onClick={() =>
                setExpandedTracker(expandedTracker === p.id ? null : p.id)
              }
            >
              {expandedTracker === p.id ? 'Hide claims' : 'View claim tracker'}
            </Button>
            {expandedTracker === p.id ? (
              <RedemptionTracker campaignId={p.id} />
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
