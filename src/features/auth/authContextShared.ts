import { createContext } from 'react'

import type { User, UserSettings } from '@shared/types'

export type AuthContextValue = {
  user: User | null
  settings: UserSettings | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (input: { email: string; password: string }) => Promise<void>
  register: (input: {
    email: string
    password: string
    displayName: string
  }) => Promise<void>
  logout: () => Promise<void>
  saveSettings: (input: Partial<UserSettings>) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
