/**
 * Thoughts captured while offline, kept on this device until they can be
 * sent. Each has a request id, so sending it twice never acts twice (the
 * server returns the first answer).
 *
 * Stored per account in localStorage. It is removed as soon as the server
 * confirms it; signing out asks before deleting anything still waiting.
 */

export type QueuedThought = {
  requestId: string
  text: string
  capturedAt: string
  timezoneOffsetMinutes: number
  attempts: number
}

const PREFIX = 'pg:offline-thoughts:'
const MAX_ITEMS = 100

function key(userId: string) {
  return `${PREFIX}${userId}`
}

export function newRequestId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return `req_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export function readQueue(
  userId: string,
  storage: Storage = localStorage,
): QueuedThought[] {
  try {
    const raw = storage.getItem(key(userId))
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as QueuedThought[]) : []
  } catch {
    return []
  }
}

function write(userId: string, items: QueuedThought[], storage: Storage) {
  if (items.length === 0) storage.removeItem(key(userId))
  else storage.setItem(key(userId), JSON.stringify(items))
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('pg:offline-queue'))
}

/** Keep a thought. Throws if the device refuses to store it, so the UI never claims it was saved. */
export function enqueue(
  userId: string,
  text: string,
  storage: Storage = localStorage,
): QueuedThought {
  const items = readQueue(userId, storage)
  if (items.length >= MAX_ITEMS)
    throw new Error('Too many unsent thoughts on this device.')
  const item: QueuedThought = {
    requestId: newRequestId(),
    text,
    capturedAt: new Date().toISOString(),
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    attempts: 0,
  }
  write(userId, [...items, item], storage)
  return item
}

export function remove(
  userId: string,
  requestId: string,
  storage: Storage = localStorage,
) {
  write(
    userId,
    readQueue(userId, storage).filter((i) => i.requestId !== requestId),
    storage,
  )
}

export function bumpAttempt(
  userId: string,
  requestId: string,
  storage: Storage = localStorage,
) {
  write(
    userId,
    readQueue(userId, storage).map((i) =>
      i.requestId === requestId ? { ...i, attempts: i.attempts + 1 } : i,
    ),
    storage,
  )
}

export function clearQueue(userId: string, storage: Storage = localStorage) {
  write(userId, [], storage)
}

/** A failure that means "no connection", as opposed to the server saying no. */
export function isOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return true
  return error instanceof TypeError
}
