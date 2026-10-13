import type { Capture, Task } from '@shared/types'

import { api } from '@/lib/api'

export function fetchCaptures() {
  return api.get<{ captures: Capture[] }>('/captures')
}

export function createCapture(text: string) {
  return api.post<{ capture: Capture }>('/captures', {
    text,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
  })
}

export function acceptCaptureItem(captureId: string, itemId: string) {
  return api.post<{ capture: Capture; task: Task }>(
    `/captures/${captureId}/items/${itemId}/accept`,
    { timezoneOffsetMinutes: new Date().getTimezoneOffset() },
  )
}

export function rejectCaptureItem(captureId: string, itemId: string) {
  return api.post<{ capture: Capture }>(
    `/captures/${captureId}/items/${itemId}/reject`,
  )
}
