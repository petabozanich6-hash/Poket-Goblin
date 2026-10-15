import { api } from '@/lib/api'

export type Interval = 'month' | 'year'
export type Price = { amount: number; currency: string; interval: Interval }

export type BillingStatus = {
  plan: 'free' | 'premium' | 'owner_premium'
  planLabel: string
  billingAvailable: boolean
  testMode: boolean | null
  prices: Partial<Record<Interval, Price>>
  limits: Record<'free' | 'premium', { aiPerDay: number; storageMb: number }>
  subscription: {
    status: string
    interval: string | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
  } | null
  canManage: boolean
}

export function fetchBilling() {
  return api.get<BillingStatus>('/billing')
}

export function startCheckout(interval: Interval) {
  return api.post<{ url: string }>('/billing/checkout', { interval })
}

export function openBillingPortal() {
  return api.post<{ url: string }>('/billing/portal', {})
}

export function formatPrice(price: Price): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: price.currency.toUpperCase(),
    }).format(price.amount / 100)
  } catch {
    return `${(price.amount / 100).toFixed(2)} ${price.currency.toUpperCase()}`
  }
}
