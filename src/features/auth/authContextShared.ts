import { createContext } from 'react'

import type { User, UserSettings } from '@shared/types'

import type { AccountStatus, Access } from './authApi'

export type AuthContextValue = {
  user: User | null
  settings: UserSettings | null
  access: Access | null
  account: AccountStatus | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (input: { email: string; password: string }) => Promise<void>
  register: (input: {
    email: string
    password: string
    displayName: string
  }) => Promise<{
    verificationRequired?: boolean
    emailSent?: boolean
    email?: string
  }>
  logout: () => Promise<void>
  saveSettings: (input: Partial<UserSettings>) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
