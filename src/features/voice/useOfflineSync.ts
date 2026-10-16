import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { createCapture } from '@/features/capture/captureApi'
import { GOBLIN_QUERY_KEYS } from '@/features/goblin/goblinApi'
import { ApiError } from '@/lib/api'

import { bumpAttempt, isOfflineError, readQueue, remove } from './offlineQueue'
import { converse } from './voiceApi'

/**
 * Send thoughts saved offline once the connection is back. One at a time,
 * in order; each carries its request id, so a send that is interrupted and
 * retried is never acted on twice. Stops at the first sign of no network
 * or an ended session, and leaves everything else queued.
 */
export function useOfflineSync(userId: string | undefined) {
  const queryClient = useQueryClient()
  const running = useRef(false)
  const [lastSynced, setLastSynced] = useState(0)

  useEffect(() => {
    if (!userId) return
    async function sync() {
      if (running.current || !navigator.onLine || !userId) return
      running.current = true
      let sent = 0
      try {
        for (const item of readQueue(userId)) {
          try {
            const res = await converse({
              text: item.text,
              requestId: item.requestId,
              source: 'offline',
              capturedAt: item.capturedAt,
              timezoneOffsetMinutes: item.timezoneOffsetMinutes,
            })
            // Leftovers go to review; captures de-duplicate repeats themselves.
            if (res.capture.length && !res.replayed)
              await createCapture(res.capture.join(' '))
            remove(userId, item.requestId)
            sent += 1
          } catch (error) {
            if (isOfflineError(error)) break
            if (
              error instanceof ApiError &&
              (error.status === 401 || error.status === 403)
            )
              break
            if (
              error instanceof ApiError &&
              (error.status === 409 || error.status === 429)
            )
              break
            // Keep it; a later sync will try again.
            bumpAttempt(userId, item.requestId)
          }
        }
      } finally {
        running.current = false
      }
      if (sent) {
        setLastSynced(sent)
        await Promise.all(
          ['captures', ...GOBLIN_QUERY_KEYS].map((key) =>
            queryClient.invalidateQueries({ queryKey: [key] }),
          ),
        )
      }
    }
    void sync()
    window.addEventListener('online', sync)
    const onVisible = () =>
      document.visibilityState === 'visible' && void sync()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('online', sync)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [queryClient, userId])

  const clearSynced = useCallback(() => setLastSynced(0), [])
  return useMemo(() => ({ lastSynced, clearSynced }), [lastSynced, clearSynced])
}
