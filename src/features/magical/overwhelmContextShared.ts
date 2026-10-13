import { createContext } from 'react'

export type OverwhelmContextValue = {
  active: boolean
  enter: () => void
  exit: () => void
}

export const OverwhelmContext = createContext<OverwhelmContextValue | null>(
  null,
)
