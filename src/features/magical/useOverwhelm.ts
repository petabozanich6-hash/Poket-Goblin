import { useContext } from 'react'

import { OverwhelmContext } from './overwhelmContextShared'

export function useOverwhelm() {
  const ctx = useContext(OverwhelmContext)
  if (!ctx) {
    throw new Error('useOverwhelm requires OverwhelmProvider')
  }
  return ctx
}
