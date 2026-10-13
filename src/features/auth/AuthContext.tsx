import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { applyTheme } from '@/lib/theme'

import {
  fetchMe,
  loginAccount,
  logoutAccount,
  registerAccount,
  updateSettings,
} from './authApi'
import { AuthContext, type AuthContextValue } from './authContextShared'

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

  useEffect(() => {
    if (meQuery.data?.settings.theme) {
      applyTheme(meQuery.data.settings.theme)
    }
  }, [meQuery.data?.settings.theme])

  useEffect(() => {
    function onExpired() {
      queryClient.clear()
      if (window.location.pathname !== '/') {
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
      user: meQuery.data?.user ?? null,
      settings: meQuery.data?.settings ?? null,
      isLoading: !bootstrapped || meQuery.isLoading,
      isAuthenticated: Boolean(meQuery.data?.user),
      login: async (input) => {
        await loginMutation.mutateAsync(input)
      },
      register: async (input) => {
        await registerMutation.mutateAsync(input)
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
      loginMutation,
      registerMutation,
      logoutMutation,
      settingsMutation,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
