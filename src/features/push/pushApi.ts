import { api } from '@/lib/api'

export type PushPreferences = {
  timezone: string
  remindersEnabled: boolean
  messagesEnabled: boolean
  morningEnabled: boolean
  morningTime: string
  eveningEnabled: boolean
  eveningTime: string
}

export type PushStatus =
  | { available: false; configured: false }
  | {
      available: true
      configured: boolean
      publicKey: string | null
      preferences: PushPreferences
      devices: number
    }

export const PUSH_QUERY_KEY = ['push'] as const

export const fetchPushStatus = () => api.get<PushStatus>('/push')

export const timezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

export const saveSubscription = (endpoint: string) =>
  api.post<{ ok: true; preferences: PushPreferences }>('/push/subscriptions', {
    endpoint,
    timezone: timezone(),
  })

export const removeSubscription = (endpoint: string) =>
  api.delete_with_body<{ ok: true }>('/push/subscriptions', { endpoint })

export const savePushPreferences = (patch: Partial<PushPreferences>) =>
  api.patch<{ preferences: PushPreferences }>('/push/preferences', patch)

export const sendTestPush = () =>
  api.post<{ sent: number; devices: number }>('/push/test')
