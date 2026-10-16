import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import { api } from '@/lib/api'

/** Query key for the step-up status; invalidated when a step-up lapses. */
export const SECURITY_KEY = ['hq', 'security'] as const

export type Plan = 'free' | 'premium' | 'owner_premium'

export const PLAN_LABELS: Record<Plan, string> = {
  free: 'Free',
  premium: 'Premium',
  owner_premium: 'Owner Premium',
}

export type Unavailable = { available: false; reason: string }

export type SecurityStatus = {
  passkeyCount: number
  elevated: boolean
  elevatedUntil: string | null
  stepUpMinutes: number
}

export type Overview = {
  generatedAt: string
  customers: {
    total: number
    active30d: number
    new7d: number
    new30d: number
    suspended: number
    byPlan: Record<Plan, number>
    activeDefinition: string
  }
  subscriptions: {
    stripeConfigured: boolean
    active: number
    monthly: number
    annual: number
    failedPayments: number
    upcomingCancellations: number
    cancelled: number
    recurringRevenue: Unavailable
  }
  ai: {
    providerConfigured: boolean
    providerEnabled: boolean
    model: string | null
    requests: { today: number; last7d: number; last30d: number }
    byFeature30d: { feature: string; outcome: string; count: number }[]
    failed30d: number
    eventsTrackedSince: string | null
    approachingLimit: {
      userId: string
      plan: Plan
      used: number
      limit: number
    }[]
    costs: Unavailable
  }
  storage: {
    trackedBytes: number
    documents: number
    source: string
    byPlan: { plan: Plan; documents: number; bytes: number }[]
    processingFailures: number
    temporaryInReview: number
    awaitingOcr: number
    nearQuota: { userId: string; plan: Plan; bytes: number; quota: number }[]
  }
  health: {
    api: { status: 'ok'; environment: string }
    errors24h: number
    errors7d: number
    topErrorRoutes: {
      method: string
      route: string
      count: number
      lastSeen: string
    }[]
    failedJobs7d: number
    deployments: Unavailable
    warnings: string[]
  }
}

export type CustomerSummary = {
  id: string
  email: string
  displayName: string
  createdAt: string
  status: 'active' | 'suspended'
  plan: Plan
  isOwner: boolean
  lastSeenAt: string | null
  documentCount: number
  storageBytes: number
  problems: number
}

export type CustomerDetail = {
  customer: CustomerSummary
  suspension: { suspendedAt: string | null; reason: string | null } | null
  entitlements: {
    entitlement: string
    source: string
    status: string
    billingInterval: string | null
    currency: string | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: number
    createdAt: string
    endedAt: string | null
  }[]
  usage: Record<string, number>
  activeSessions: number
  problems: string[]
  securityEvents: { type: string; detail: string; createdAt: string }[]
  auditTrail: {
    action: string
    actor: string
    detail: unknown
    createdAt: string
  }[]
}

export type PlatformSettings = {
  announcement: { enabled: boolean; message: string; tone: 'info' | 'warning' }
  maintenance: { enabled: boolean; message: string }
  features: {
    registrationsOpen: boolean
    documentUploads: boolean
    aiProvider: boolean
  }
  aiLimits: { free: number; premium: number; owner: number }
  storageQuotas: { freeMb: number; premiumMb: number; ownerMb: number }
}

export type SettingsResponse = {
  settings: PlatformSettings
  defaults: PlatformSettings
  limits: {
    messageLength: number
    aiDailyMax: number
    aiDailyHighImpact: number
    storageMbMax: number
    storageMbHighImpact: number
  }
  updatedAt: Record<string, string>
}

export type AuditEntry = {
  id: string
  actor: string
  action: string
  targetType: string
  targetId: string
  detail: unknown
  createdAt: string
}

export type FxQuote = { base: 'USD'; quote: 'AUD'; rate: number; date: string; source: 'Frankfurter' }

export const hq = {
  fx: () => api.admin.get<{ quote: FxQuote | null; conversionAvailable: boolean; costCollectionStatus: string; costExplanation: string }>('/finance/fx'),
  securityStatus: () => api.admin.get<SecurityStatus>('/security/status'),
  overview: () => api.admin.get<Overview>('/overview'),
  customers: (params: URLSearchParams) =>
    api.admin.get<{
      customers: CustomerSummary[]
      hasMore: boolean
      page: number
    }>(`/customers?${params.toString()}`),
  customer: (id: string) =>
    api.admin.get<CustomerDetail>(`/customers/${encodeURIComponent(id)}`),
  suspend: (id: string, reason: string) =>
    api.admin.send('POST', `/customers/${encodeURIComponent(id)}/suspend`, {
      confirm: 'SUSPEND',
      reason,
    }),
  restore: (id: string, reason: string) =>
    api.admin.send('POST', `/customers/${encodeURIComponent(id)}/restore`, {
      reason,
    }),
  revokeSessions: (id: string, reason: string) =>
    api.admin.send<{ revoked: number }>(
      'POST',
      `/customers/${encodeURIComponent(id)}/sessions/revoke`,
      { reason },
    ),
  settings: () => api.admin.get<SettingsResponse>('/settings'),
  saveSetting: <K extends keyof PlatformSettings>(
    key: K,
    value: PlatformSettings[K],
    confirmHighImpact = false,
  ) =>
    api.admin.send<{ key: K; value: PlatformSettings[K] }>(
      'PUT',
      `/settings/${key}`,
      {
        value,
        confirmHighImpact,
      },
    ),
  audit: (page: number) =>
    api.admin.get<{ entries: AuditEntry[]; hasMore: boolean; page: number }>(
      `/audit?page=${page}`,
    ),
  passkeys: () =>
    api.admin.get<{
      passkeys: {
        id: string
        label: string
        createdAt: string
        lastUsedAt: string | null
      }[]
    }>('/security/passkeys'),
  removePasskey: (id: string) =>
    api.admin.send('DELETE', `/security/passkeys/${encodeURIComponent(id)}`),
  sessions: () =>
    api.admin.get<{
      sessions: {
        createdAt: string
        lastSeenAt: string | null
        expiresAt: string
        current: boolean
      }[]
    }>('/security/sessions'),
  revokeOtherSessions: () =>
    api.admin.send<{ revoked: number }>(
      'POST',
      '/security/sessions/revoke-others',
      {},
    ),
  endStepUp: () => api.admin.send('POST', '/security/step-up/end', {}),
}

/** Add a passkey: the browser asks the authenticator (Touch ID, phone, key). */
export async function addPasskey(input: { password?: string; label: string }) {
  const { options } = await api.admin.send<{
    options: PublicKeyCredentialCreationOptionsJSON
  }>('POST', '/security/passkeys/register/options', {
    password: input.password,
  })
  const response = await startRegistration({ optionsJSON: options })
  await api.admin.send('POST', '/security/passkeys/register/verify', {
    response,
    label: input.label,
  })
}

/** Confirm it's the Owner with a passkey; elevates this session briefly. */
export async function stepUpWithPasskey() {
  const { options } = await api.admin.send<{
    options: PublicKeyCredentialRequestOptionsJSON
  }>('POST', '/security/step-up/options', {})
  const response = await startAuthentication({ optionsJSON: options })
  return api.admin.send<{ elevatedUntil: string }>(
    'POST',
    '/security/step-up/verify',
    { response },
  )
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
