import type { Env } from '../../env'
import { createMemoryStore } from './memoryStore'
import { createR2Store } from './r2Store'
import type { ObjectStore } from './types'

let memoryFallback: ObjectStore | null = null

/**
 * Prefer R2 binding (local Miniflare or remote). Fall back to memory only when
 * the binding is absent — never claim remote R2 is provisioned.
 */
export function getObjectStore(env: Env): ObjectStore {
  if (env.UPLOADS) return createR2Store(env.UPLOADS)
  if (!memoryFallback) memoryFallback = createMemoryStore()
  return memoryFallback
}

export type { ObjectStore } from './types'
