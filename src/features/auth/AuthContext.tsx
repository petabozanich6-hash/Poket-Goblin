import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { User } from '@shared/types'

import { ApiError } from '@/lib/api'
import { applyTheme } from '@/lib/theme'

import {
  fetchMe,
  loginAccount,
  logoutAccount,
  registerAccount,
  updateSettings,
} from './authApi'
import { AuthContext, type AuthContextValue } from './authContextShared'

const LAST_USER = 'pg:last-user'

function rememberUser(user: User) {
  try {
    localStorage.setItem(
      LAST_USER,
      JSON.stringify({
        id: user.id,
        displayName: user.displayName,
        email: '',
        createdAt: '',
      }),
    )
  } catch {
    /* storage unavailable: offline capture just won't open signed in */
  }
}

function forgetUser() {
  try {
    localStorage.removeItem(LAST_USER)
  } catch {
    /* nothing stored */
  }
}

function recalledUser(): User | null {
  try {
    const raw = localStorage.getItem(LAST_USER)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [bootstrapped, setBootstrapped] = useState(false)

  const meQuery = useQuery({
    queryKey: ['me'],
    queryFn: fetchMe,
    retry: false,
  })

  useEffect(() => {
    if (!meQuery.isLoading) setBootstrapped(true)
  }, [meQuery.isLoading])

  // Remember who was signed in (id and name only), so the app can still open
  // for offline quick capture. A real "signed out" answer forgets it.
  useEffect(() => {
    if (meQuery.data?.user) rememberUser(meQuery.data.user)
    else if (meQuery.error instanceof ApiError) forgetUser()
  }, [meQuery.data?.user, meQuery.error])
  const offlineUser =
    !meQuery.data && meQuery.error && !(meQuery.error instanceof ApiError)
      ? recalledUser()
      : null

  useEffect(() => {
    if (meQuery.data?.settings.theme) {
      applyTheme(meQuery.data.settings.theme)
    }
  }, [meQuery.data?.settings.theme])

  useEffect(() => {
    function onExpired() {
      forgetUser()
      queryClient.clear()
      if (
        !['/', '/forgot-password', '/reset-password', '/verify-email'].includes(
          window.location.pathname,
        )
      ) {
        window.location.assign('/')
      }
    }
    window.addEventListener('pg:session-expired', onExpired)
    return () => window.removeEventListener('pg:session-expired', onExpired)
  }, [queryClient])

  const loginMutation = useMutation({
    mutationFn: loginAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const registerMutation = useMutation({
    mutationFn: registerAccount,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const logoutMutation = useMutation({
    mutationFn: logoutAccount,
    onSuccess: async () => {
      forgetUser()
      queryClient.clear()
    },
  })

  const settingsMutation = useMutation({
    mutationFn: updateSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })

  const value = useMemo<AuthContextValue>(
    () => ({
      user: meQuery.data?.user ?? offlineUser,
      settings: meQuery.data?.settings ?? null,
      access: meQuery.data?.access ?? null,
      account: meQuery.data?.account ?? null,
      isLoading: !bootstrapped || meQuery.isLoading,
      isAuthenticated: Boolean(meQuery.data?.user ?? offlineUser),
      login: async (input) => {
        await loginMutation.mutateAsync(input)
      },
      register: async (input) => {
        return await registerMutation.mutateAsync(input)
      },
      logout: async () => {
        await logoutMutation.mutateAsync()
      },
      saveSettings: async (input) => {
        await settingsMutation.mutateAsync(input)
      },
    }),
    [
      bootstrapped,
      meQuery.data,
      meQuery.isLoading,
      offlineUser,
      loginMutation,
      registerMutation,
      logoutMutation,
      settingsMutation,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
