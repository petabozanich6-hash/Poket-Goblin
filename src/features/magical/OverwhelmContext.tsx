import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router'

import {
  OverwhelmContext,
  type OverwhelmContextValue,
} from './overwhelmContextShared'

const STORAGE_KEY = 'pg_overwhelm'

export function OverwhelmProvider({ children }: { children: ReactNode }) {
  const [params, setParams] = useSearchParams()
  const [active, setActive] = useState(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (params.get('mode') === 'calm') {
      setActive(true)
      try {
        sessionStorage.setItem(STORAGE_KEY, '1')
      } catch {
        /* ignore */
      }
      const next = new URLSearchParams(params)
      next.delete('mode')
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  const value = useMemo<OverwhelmContextValue>(
    () => ({
      active,
      enter: () => {
        setActive(true)
        try {
          sessionStorage.setItem(STORAGE_KEY, '1')
        } catch {
          /* ignore */
        }
      },
      exit: () => {
        setActive(false)
        try {
          sessionStorage.removeItem(STORAGE_KEY)
        } catch {
          /* ignore */
        }
      },
    }),
    [active],
  )

  return (
    <OverwhelmContext.Provider value={value}>
      {children}
    </OverwhelmContext.Provider>
  )
}
