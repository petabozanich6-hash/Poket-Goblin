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
  stripe_promotion_code_id: string | null
  start_at: string | null
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

type GiveawayGrant = {
  id: string
  email: string
  issuedAt: string
  expiresAt: string | null
  endedAt: string | null
  status: string
}

function GiveawayGrantTracker({ giveawayId }: { giveawayId: string }) {
  const claims = useQuery({
    queryKey: ['hq', 'giveaways', giveawayId, 'grants'],
    queryFn: () =>
      api.admin.get<{ grants: GiveawayGrant[] }>(
        `/deals/giveaways/${encodeURIComponent(giveawayId)}/grants`,
      ),
  })
  if (claims.isLoading) return <p>Checking the gift ledger…</p>
  if (claims.isError) return <p role="alert">Could not load gift history.</p>
  if (!claims.data?.grants.length) return <p>No Premium gifts awarded yet.</p>
  return (
    <ul>
      {claims.data.grants.map((gift) => (
        <li key={gift.id}>
          {gift.email} — {gift.status} · Awarded:{' '}
          {new Date(gift.issuedAt).toLocaleDateString()} · Premium until:{' '}
          {gift.expiresAt
            ? new Date(gift.expiresAt).toLocaleDateString()
            : 'Not specified'}
        </li>
      ))}
    </ul>
  )
}

function GiveawaysPanel() {
  const qc = useQueryClient()
  const [notice, setNotice] = useState('')
  const [expandedGift, setExpandedGift] = useState<string | null>(null)
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
      api.admin.send<{ emailSent: boolean }>(
        'POST',
        `/deals/giveaways/${encodeURIComponent(id)}/grant`,
        { email },
      ),
    onSuccess: (result) => {
      setNotice(
        result.emailSent
          ? 'Free Premium awarded! The gift email was sent to the email service.'
          : 'Free Premium awarded, but the notification email could not be sent. The recipient can already sign in and use Premium.',
      )
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
          <div>
            <Button
              variant="secondary"
              onClick={() =>
                setExpandedGift(expandedGift === gift.id ? null : gift.id)
              }
            >
              {expandedGift === gift.id ? 'Hide recipients' : 'View recipients'}
            </Button>
            {expandedGift === gift.id ? (
              <GiveawayGrantTracker giveawayId={gift.id} />
            ) : null}
          </div>
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

type StripeCode = {
  id: string
  code: string
  active: boolean
  redemptions: number
  maxRedemptions: number | null
  expiresAt: string | null
}

type StripeCodesResponse = {
  live: boolean
  hasMore: boolean
  codes: StripeCode[]
}

type StripeUsage = {
  linked: boolean
  source: 'stripe' | 'draft'
  active?: boolean
  redemptions: number
  maxRedemptions?: number | null
  remaining?: number | null
  expiresAt?: string | null
}

function StripeUsageTracker({ campaignId }: { campaignId: string }) {
  const usage = useQuery({
    queryKey: ['hq', 'deals', campaignId, 'stripe-usage'],
    queryFn: () =>
      api.admin.get<StripeUsage>(
        `/deals/${encodeURIComponent(campaignId)}/stripe-usage`,
      ),
    staleTime: 0,
  })
  if (usage.isLoading) return <p>Checking Stripe's ledger…</p>
  if (usage.isError)
    return <p role="alert">Could not check Stripe redemption totals.</p>
  const stats = usage.data
  if (!stats?.linked)
    return <p>Draft only. This code has not been published to Stripe.</p>
  return (
    <p>
      Stripe-confirmed redemptions: <strong>{stats.redemptions}</strong>
      {stats.maxRedemptions !== null ? ` / ${stats.maxRedemptions}` : ''} ·
      Remaining: {stats.remaining ?? 'Unlimited'} · Status:{' '}
      {stats.active ? 'Active' : 'Inactive'}
      {stats.expiresAt
        ? ` · Expires ${new Date(stats.expiresAt).toLocaleDateString()}`
        : ''}
      <br />
      <small>
        Checkout previews do not count as redemptions. Financial totals below
        come from the internal ledger, not Stripe, until invoice reconciliation
        is implemented.
      </small>
      <Button variant="secondary" onClick={() => void usage.refetch()}>
        Refresh Stripe usage
      </Button>
    </p>
  )
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
  if (claims.isError)
    return <p role="alert">Could not load the claims ledger.</p>
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
  const [section, setSection] = useState<'gifts' | 'discounts'>('gifts')
  const stripeCodes = useQuery({
    queryKey: ['hq', 'deals', 'stripe-codes'],
    queryFn: () => api.admin.get<StripeCodesResponse>('/deals/stripe-codes'),
    enabled: section === 'discounts',
    staleTime: 0,
  })
  const [expandedTracker, setExpandedTracker] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['hq', 'deals'] })
  const create = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.admin.send('POST', '/deals', data),
    onSuccess: () => {
      setMessage('Local draft saved. It cannot be used in Stripe Checkout.')
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
  const publish = useMutation({
    mutationFn: (id: string) =>
      api.admin.send(
        'POST',
        `/deals/${encodeURIComponent(id)}/publish-first-invoice`,
        {},
      ),
    onSuccess: () => {
      setMessage(
        'First-invoice code published to Stripe. Test at Checkout without completing payment.',
      )
      void refresh()
    },
    onError: (e: Error) => setMessage(e.message),
  })
  const discard = useMutation({
    mutationFn: (id: string) =>
      api.admin.send('DELETE', `/deals/${encodeURIComponent(id)}`),
    onSuccess: () => {
      setMessage('Unused local draft discarded. No Stripe codes were changed.')
      void refresh()
    },
    onError: (error: Error) => setMessage(error.message),
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
        Stripe is responsible for the real discount codes used at checkout.
        Codes created in Stripe are listed below, including your live launch
        promotion. The campaign form creates local planning drafts only, unless
        a supported one-invoice offer is explicitly published to Stripe.
      </p>
      <nav
        aria-label="Deals & Mischief sections"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}
      >
        <Button
          variant={section === 'gifts' ? 'primary' : 'secondary'}
          onClick={() => setSection('gifts')}
        >
          🎁 Free Premium giveaways
        </Button>
        <Button
          variant={section === 'discounts' ? 'primary' : 'secondary'}
          onClick={() => setSection('discounts')}
        >
          💰 Discount campaigns
        </Button>
      </nav>
      {section === 'gifts' ? (
        <GiveawaysPanel />
      ) : (
        <>
          <p role="status">{message}</p>
          <Card>
            <h3>💳 Stripe promotion codes</h3>
            <p>
              These codes come directly from Stripe, including promotions you
              created in the Stripe dashboard. Stripe is the source of truth.
              Viewing this list does not activate, redeem or change a code.
            </p>
            {stripeCodes.isLoading ? (
              <p>Checking Stripe's code ledger…</p>
            ) : null}
            {stripeCodes.isError ? (
              <p role="alert">
                Unable to read Stripe's promotions. Check the Stripe dashboard
                before advertising a code.
              </p>
            ) : null}
            {stripeCodes.data ? (
              <>
                <p>
                  {stripeCodes.data.live
                    ? 'Live Stripe account'
                    : 'Stripe test mode'}{' '}
                  · Latest 100 codes
                </p>
                {stripeCodes.data.codes.length === 0 ? (
                  <p>No promotion codes found in this Stripe mode.</p>
                ) : (
                  <ul>
                    {stripeCodes.data.codes.map((code) => (
                      <li key={code.id}>
                        <strong>{code.code}</strong>
                        <span>
                          {' — '}
                          {code.active ? 'Active in Stripe' : 'Inactive in Stripe'}
                        </span>
                        <span>
                          {' · Redeemed '}
                          {code.redemptions}
                          {code.maxRedemptions === null
                            ? ' times'
                            : ` / ${code.maxRedemptions}`}
                        </span>
                        {code.expiresAt ? (
                          <span>
                            {' · Redemption deadline '}
                            {new Date(code.expiresAt).toLocaleDateString()}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {stripeCodes.data.hasMore ? (
                  <p>
                    More codes exist. See the Stripe dashboard for the full list.
                  </p>
                ) : null}
              </>
            ) : null}
            <Button
              variant="secondary"
              onClick={() => void stripeCodes.refetch()}
            >
              Refresh Stripe codes
            </Button>
            <p>
              <a
                href="https://dashboard.stripe.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Stripe dashboard
              </a>{' '}
              to edit live coupons, redemption limits and duration.
            </p>
          </Card>
          <p>
            Below are Pocket Goblin's <strong>local campaign records</strong>.
            An unlinked draft is not a working promotion code and does not
            affect Stripe Checkout.
          </p>
          <Card>
            <h3>Create a local campaign draft</h3>
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
                  <option value="student">
                    Student / verified eligibility
                  </option>
                  <option value="founder">
                    Founding goblins / limited places
                  </option>
                  <option value="flash">Flash sale / time-limited deal</option>
                  <option value="giveaway">
                    Free Premium giveaway (draft only)
                  </option>
                </select>
              </label>
              {preset === 'giveaway' ? (
                <p role="note">
                  Free giveaways need a separate, time-limited Premium
                  entitlement with no checkout or recurring charges. Save a
                  campaign draft for now; giveaway redemption is not enabled
                  yet.
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
                  onChange={(e) =>
                    setKind(e.target.value as 'percent' | 'fixed')
                  }
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
                CAUTION: A billing cycle means one invoice, not one calendar
                month. Six cycles means six months on a monthly plan but six
                years on an annual plan. These draft codes cannot be activated
                or redeemed. Calendar-duration and plan-specific discount rules
                are being designed separately. Free Premium gifts are handled
                above.
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
                Start date (optional){' '}
                <input name="startAt" type="datetime-local" />
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
                Save local draft
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
                  {p.stripe_promotion_code_id
                    ? 'Linked to Stripe — check live status below'
                    : 'Local draft — not valid at checkout'})
                </h3>
                <p>
                  {p.kind === 'percent' ? `${p.amount}%` : money(p.amount)} off
                  for {p.billing_cycles} billing cycle(s). Audience:{' '}
                  {p.audience}.{' '}
                  {p.verification === 'manual'
                    ? 'Manual eligibility verification required.'
                    : ''}
                </p>
                <p>
                  Redemptions: {p.redemptions}
                  {p.max_redemptions !== null
                    ? ` / ${p.max_redemptions}`
                    : ''}{' '}
                  · Revenue: {money(p.revenue_cents)} · Discounts given:{' '}
                  {money(p.realised_cents)}
                </p>
                <StripeUsageTracker campaignId={p.id} />
                <p>
                  Committed: {money(p.committed_cents)} · Outstanding:{' '}
                  {money(Math.max(0, p.committed_cents - p.realised_cents))} ·
                  Budget left:{' '}
                  {p.budget_cents === null
                    ? 'Unlimited'
                    : money(Math.max(0, p.budget_cents - p.committed_cents))}
                </p>
                {p.activation_window_days ? (
                  <p>
                    Expires {p.activation_window_days} days after activation.
                  </p>
                ) : null}
                {!p.active &&
                !p.stripe_promotion_code_id &&
                p.kind === 'percent' &&
                p.billing_cycles === 1 &&
                p.audience === 'new' &&
                p.verification === 'none' &&
                p.max_redemptions === 1 &&
                p.budget_cents === null &&
                p.start_at === null &&
                p.activation_window_days === null ? (
                  <Button
                    variant="secondary"
                    disabled={publish.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          'Publish this one-use, first-invoice code in live Stripe? It can be redeemed for a real discount. No payment is required to inspect Checkout.',
                        )
                      )
                        publish.mutate(p.id)
                    }}
                  >
                    Publish 1-use code to Stripe
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  onClick={() =>
                    setExpandedTracker(expandedTracker === p.id ? null : p.id)
                  }
                >
                  {expandedTracker === p.id
                    ? 'Hide claims'
                    : 'View claim tracker'}
                </Button>
                {expandedTracker === p.id ? (
                  <RedemptionTracker campaignId={p.id} />
                ) : null}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {!p.stripe_promotion_code_id &&
                  !p.active &&
                  p.redemptions === 0 ? (
                    <Button
                      variant="secondary"
                      disabled={discard.isPending}
                      onClick={() => {
                        if (
                          window.confirm(
                            'Discard this unused local draft? This does not remove or deactivate anything in Stripe.',
                          )
                        )
                          discard.mutate(p.id)
                      }}
                    >
                      Discard local draft
                    </Button>
                  ) : null}
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
                          fields: {
                            maxRedemptions: s === '' ? null : Number(s),
                          },
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
                        p.budget_cents === null
                          ? ''
                          : String(p.budget_cents / 100),
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
        </>
      )}
    </section>
  )
}
