import type { User, UserSettings } from '@shared/types'

import { api } from '@/lib/api'

export type Access = {
  plan: 'free' | 'premium' | 'owner_premium'
  planLabel: string
  /** Display only. Every Goblin HQ request is authorised on the server. */
  isOwner: boolean
}

export type AccountStatus = { emailVerified: boolean; emailConfigured: boolean }

export function fetchMe() {
  return api.get<{
    user: User
    settings: UserSettings
    access: Access
    account: AccountStatus
  }>('/me')
}

export function registerAccount(input: {
  email: string
  password: string
  displayName: string
}) {
  return api.post<{ user?: User; verificationRequired?: boolean; emailSent?: boolean; email?: string }>('/auth/register', input)
}

export function loginAccount(input: { email: string; password: string }) {
  return api.post<{ user: User }>('/auth/login', input)
}

export function logoutAccount() {
  return api.post<{ ok: boolean }>('/auth/logout')
}

export function updateSettings(input: Partial<UserSettings>) {
  return api.patch<{ settings: UserSettings }>('/me/settings', input)
}
