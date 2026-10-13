import { api } from '@/lib/api'

export type VaultDocument = {
  id: string
  displayName: string
  mimeType: string
  byteSize: number
  categorySlug: string | null
  status: string
  processingError: string | null
  linkedTaskId: string | null
  linkedEventId: string | null
  linkedReminderId: string | null
  createdAt: string
  updatedAt: string
  hasExtractedText: boolean
}

export type ReviewItem = {
  id: string
  sourceType: string
  sourceId: string | null
  title: string
  summary: string
  suggestionType: string
  payload: Record<string, unknown>
  status: string
  uncertain: boolean
  snoozedUntil: string | null
  createdAt: string
  reviewedAt: string | null
}

export type ExternalConnection = {
  id: string
  provider: string
  status: string
  accountLabel: string
  scopes: string
  statusMessage: string
  lastSyncedAt: string | null
  oauthConfigured: boolean
}

export function fetchDocuments(params?: {
  q?: string
  status?: string
  category?: string
}) {
  const search = new URLSearchParams()
  if (params?.q) search.set('q', params.q)
  if (params?.status) search.set('status', params.status)
  if (params?.category) search.set('category', params.category)
  const q = search.toString()
  return api.get<{
    documents: VaultDocument[]
    storage: string
    maxUploadBytes: number
  }>(`/documents${q ? `?${q}` : ''}`)
}

export function uploadDocument(file: File) {
  const form = new FormData()
  form.append('file', file)
  return api.upload<{
    document: VaultDocument
    processing: { status: string; warnings: string[] }
  }>('/documents', form)
}

export function renameDocument(id: string, displayName: string) {
  return api.patch<{ document: VaultDocument }>(`/documents/${id}`, {
    displayName,
  })
}

export function linkDocument(
  id: string,
  links: Partial<{
    linkedTaskId: string
    linkedEventId: string
    linkedReminderId: string
    categorySlug: string
  }>,
) {
  return api.patch<{ document: VaultDocument }>(`/documents/${id}`, links)
}

export function deleteDocument(id: string) {
  return api.delete<{ ok: boolean }>(`/documents/${id}`)
}

export function reprocessDocument(id: string) {
  return api.post<{
    document: VaultDocument
    processing: { status: string; warnings: string[] }
  }>(`/documents/${id}/process`)
}

export function downloadDocumentUrl(id: string) {
  return `/api/documents/${id}/download`
}

export function fetchReviewItems(status = 'pending') {
  return api.get<{ items: ReviewItem[] }>(`/review?status=${status}`)
}

export function acceptReviewItem(
  id: string,
  input?: { title?: string; type?: string; dueDate?: string | null },
) {
  return api.post<{ ok: boolean; createdId: string; createdKind: string }>(
    `/review/${id}/accept`,
    {
      ...input,
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    },
  )
}

export function dismissReviewItem(id: string) {
  return api.post<{ ok: boolean }>(`/review/${id}/dismiss`)
}

export function snoozeReviewItem(id: string, hours = 24) {
  return api.post<{ ok: boolean }>(`/review/${id}/snooze`, { hours })
}

export function fetchConnections() {
  return api.get<{ connections: ExternalConnection[] }>('/connections')
}

export function connectProvider(provider: string) {
  return api.post<{
    status: string
    authorizeUrl?: string
    message?: string
    error?: string
  }>(`/connections/${provider}/connect`)
}

export function disconnectProvider(provider: string) {
  return api.post<{ ok: boolean }>(`/connections/${provider}/disconnect`)
}
