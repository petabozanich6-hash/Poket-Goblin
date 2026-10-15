import { useQuery } from '@tanstack/react-query'

import { api } from '@/lib/api'

export type PlatformStatus = {
  announcement: { message: string; tone: 'info' | 'warning' } | null
  maintenance: { message: string } | null
  registrationsOpen: boolean
}

export function usePlatformStatus() {
  return useQuery({
    queryKey: ['platform-status'],
    queryFn: () => api.get<PlatformStatus>('/platform/status'),
    staleTime: 5 * 60_000,
    retry: false,
  })
}
