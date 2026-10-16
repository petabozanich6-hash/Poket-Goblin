import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Crown } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import {
  fetchBilling,
  formatPrice,
  openBillingPortal,
  startCheckout,
  type BillingStatus,
  type Interval,
} from '@/features/billing/billingApi'
import { ApiError } from '@/lib/api'

import pageStyles from './Page.module.css'
import styles from './SubscriptionPage.module.css'

function formatDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function storage(mb: number) {
  return mb >= 1024 ? `${Math.round(mb / 1024)} GB` : `${mb} MB`
}

function SubscriptionStatus({ data }: { data: BillingStatus }) {
  const sub = data.subscription
  if (!sub) return null
  const when = formatDate(sub.currentPeriodEnd)
  if (sub.status === 'past_due' || sub.status === 'unpaid')
    return (
      <p className={styles.warn} role="status">
        Your last payment didn’t go through. Update your card under Manage
        billing so Premium keeps going.
      </p>
    )
  if (sub.cancelAtPeriodEnd)
    return (
      <p className={styles.sub}>
        Premium ends on <strong>{when}</strong>. You can change your mind under
        Manage billing.
      </p>
    )
  return (
    <p className={styles.sub}>
      Premium{sub.interval ? `, paid ${sub.interval}ly` : ''}
      {when ? (
        <>
          {' '}
          · renews on <strong>{when}</strong>
        </>
      ) : null}
    </p>
  )
}

export function SubscriptionPage() {
  const [params] = useSearchParams()
  const justPaid = params.get('checkout') === 'success'
  const [interval, setInterval] = useState<Interval>('month')
  const [error, setError] = useState<string | null>(null)
  const billing = useQuery({
    queryKey: ['billing'],
    queryFn: fetchBilling,
    // Stripe tells us a moment after checkout: check back briefly.
    refetchInterval: (q) =>
      justPaid && q.state.data?.plan === 'free' ? 3000 : false,
  })
  const go = (url: string) => window.location.assign(url)
  const checkout = useMutation({
    mutationFn: () => startCheckout(interval),
    onSuccess: (data) => go(data.url),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Try again.'),
  })
  const portal = useMutation({
    mutationFn: openBillingPortal,
    onSuccess: (data) => go(data.url),
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Try again.'),
  })

  const data = billing.data
  const intervals = (['month', 'year'] as Interval[]).filter(
    (i) => data?.prices[i],
  )
  const chosen =
    data?.prices[interval] ??
    (intervals[0] ? data?.prices[intervals[0]] : undefined)
  const monthly = data?.prices.month
  const yearly = data?.prices.year
  const saving =
    monthly && yearly && monthly.currency === yearly.currency
      ? Math.round((1 - yearly.amount / (monthly.amount * 12)) * 100)
      : 0

  return (
    <div className={pageStyles.page}>
      <header className={pageStyles.header}>
        <div>
          <h1>Your plan</h1>
          <p className={pageStyles.sub}>
            <Link to="/settings">Settings</Link> · Plan and billing
          </p>
        </div>
      </header>

      {justPaid ? (
        <p className={styles.success} role="status">
          {data?.plan === 'premium'
            ? 'Welcome to Premium! 👹 Thank you for supporting Pocket Goblin.'
            : 'Thank you! Your Premium is switching on — this takes a moment.'}
        </p>
      ) : null}
      {data?.testMode ? (
        <p className={styles.test}>
          Test mode: no real money is taken. Use Stripe’s test card 4242 4242
          4242 4242.
        </p>
      ) : null}

      {billing.isLoading || !data ? (
        <Card>
          <p className={pageStyles.sub}>Loading your plan…</p>
        </Card>
      ) : data.plan === 'owner_premium' ? (
        <Card>
          <h2 className={styles.title}>
            <Crown size={20} aria-hidden /> Owner Premium
          </h2>
          <p className={pageStyles.sub}>
            Every Premium feature, permanently. Nothing to pay or manage.
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <p className={styles.current}>
              You’re on <strong>{data.planLabel}</strong>.
            </p>
            <SubscriptionStatus data={data} />
            {data.canManage ? (
              <div className={styles.actions}>
                <Button
                  variant="secondary"
                  onClick={() => portal.mutate()}
                  disabled={portal.isPending}
                >
                  {portal.isPending ? 'Opening…' : 'Manage billing'}
                </Button>
                <span className={pageStyles.sub}>
                  Change your card, see receipts or cancel.
                </span>
              </div>
            ) : null}
          </Card>

          <div className={styles.plans}>
            <Card className={data.plan === 'free' ? styles.mine : undefined}>
              <h2 className={styles.title}>Free</h2>
              <p className={styles.price}>Free, always</p>
              <ul className={styles.list}>
                <li>
                  <Check size={16} aria-hidden /> Tell the Goblin anything —
                  lists, tasks, reminders, appointments
                </li>
                <li>
                  <Check size={16} aria-hidden /> Documents turned into plans,
                  and the panic button
                </li>
                <li>
                  <Check size={16} aria-hidden /> Your calendar on your phone
                </li>
                <li>
                  <Check size={16} aria-hidden /> Smart help{' '}
                  {data.limits.free.aiPerDay} times a day
                </li>
                <li>
                  <Check size={16} aria-hidden /> Keep{' '}
                  {storage(data.limits.free.storageMb)} of documents
                </li>
              </ul>
            </Card>

            <Card className={data.plan === 'premium' ? styles.mine : undefined}>
              <h2 className={styles.title}>
                <Crown size={20} aria-hidden /> Premium
              </h2>
              {data.billingAvailable && chosen ? (
                <>
                  <p className={styles.price}>
                    {formatPrice(chosen)}
                    <span className={pageStyles.sub}> / {chosen.interval}</span>
                  </p>
                  <p className={pageStyles.sub}>
                    Base price shown in {chosen.currency.toUpperCase()}. Stripe
                    automatically shows your supported local currency and
                    confirms the exact recurring amount before you pay. No
                    conversion is calculated by Pocket Goblin.
                  </p>
                </>
              ) : (
                <p className={styles.price}>Coming soon</p>
              )}
              <ul className={styles.list}>
                <li>
                  <Check size={16} aria-hidden /> Everything in Free
                </li>
                <li>
                  <Check size={16} aria-hidden /> Smart help{' '}
                  {data.limits.premium.aiPerDay} times a day
                </li>
                <li>
                  <Check size={16} aria-hidden /> Keep{' '}
                  {storage(data.limits.premium.storageMb)} of documents
                </li>
                <li>
                  <Check size={16} aria-hidden /> Helps keep Pocket Goblin
                  independent and ad-free
                </li>
              </ul>
              {data.plan === 'free' && data.billingAvailable ? (
                <div className={styles.buy}>
                  {intervals.length > 1 ? (
                    <div
                      className={styles.toggle}
                      role="radiogroup"
                      aria-label="How often to pay"
                    >
                      {intervals.map((i) => (
                        <button
                          key={i}
                          type="button"
                          role="radio"
                          aria-checked={interval === i}
                          className={
                            interval === i ? styles.toggleOn : styles.toggleOff
                          }
                          onClick={() => setInterval(i)}
                        >
                          {i === 'month' ? 'Monthly' : 'Yearly'}
                          {i === 'year' && saving > 0
                            ? ` (save ${saving}%)`
                            : ''}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <Button
                    onClick={() => checkout.mutate()}
                    disabled={checkout.isPending}
                  >
                    {checkout.isPending
                      ? 'Opening checkout…'
                      : 'Upgrade to Premium'}
                  </Button>
                  <p className={pageStyles.sub}>
                    Secure payment by Stripe. Cancel any time — you keep Premium
                    until the end of what you’ve paid for.
                  </p>
                </div>
              ) : null}
            </Card>
          </div>
        </>
      )}
      {error ? (
        <p className={styles.warn} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
