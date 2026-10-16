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
  retention: 'keep' | 'temporary'
  expiresAt: string | null
  documentType: string | null
  goblinSummary: string | null
}

export type DocumentSuggestion = {
  id: string
  title: string
  details: string
  type: 'task' | 'reminder' | 'appointment' | 'note' | 'follow_up'
  status: string
  uncertain: boolean
  dueDate: string | null
  startTime: string | null
  missingInformation: string[]
  sourceExcerpt: string
  /** The deadline a planned step belongs to. */
  group?: string | null
  step?: string | null
  priority?: 'high' | 'normal'
  urgent?: boolean
}

export type DevourResponse = {
  document: VaultDocument
  suggestions: DocumentSuggestion[]
  processing?: {
    status: string
    summary: string
    warnings: string[]
    mode: string
  }
  duplicate?: boolean
  message?: string
  /** What the Devourer added on its own (confident items only). */
  autoAdded?: { added: number; already: number }
}

/** True when the reader's locale writes numeric dates month-first (e.g. US). */
export function localeWritesMonthFirst(): boolean {
  try {
    const parts = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).formatToParts(new Date(2020, 10, 22))
    const order = parts.filter((p) => p.type === 'day' || p.type === 'month')
    return order[0]?.type === 'month'
  } catch {
    return false
  }
}

export function devourDocument(file: File, mode: 'sort' | 'keep') {
  const form = new FormData()
  form.append('file', file)
  form.append('mode', mode)
  form.append('timezoneOffsetMinutes', String(new Date().getTimezoneOffset()))
  form.append('monthFirst', String(localeWritesMonthFirst()))
  return api.upload<DevourResponse>('/documents', form)
}

export function fetchDocument(id: string) {
  return api.get<{
    document: VaultDocument
    suggestions: DocumentSuggestion[]
  }>(`/documents/${id}`)
}

export function fetchSortingDocuments() {
  return api.get<{ documents: VaultDocument[] }>(
    '/documents?retention=temporary',
  )
}

export function finishDevouring(id: string) {
  return api.post<{ devoured: boolean; saved: number }>(
    `/documents/${id}/finish`,
    {},
  )
}

export function undoAutoAdded(id: string) {
  return api.post<{ undone: number; suggestions: DocumentSuggestion[] }>(
    `/documents/${id}/undo-auto`,
    {},
  )
}

export function keepDocumentInstead(id: string) {
  return api.post<{ document: VaultDocument }>(`/documents/${id}/keep`, {})
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
    keptBytes: number
    keptAllowanceBytes: number
  }>(`/documents${q ? `?${q}` : ''}`)
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
  input?: {
    title?: string
    type?: string
    dueDate?: string | null
    startTime?: string | null
    allowDuplicate?: boolean
  },
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

export type StudyDayAvailability = {
  date: string
  availableMinutes: number
  committedMinutes?: number
  blocked?: boolean
}

export type StudyPathwayPreview = {
  preview: {
    sessions: Array<{
      stepId: string
      goalId: string
      title: string
      date: string
      minutes: number
      sequence: number
    }>
    warnings: Array<{
      stepId: string
      remainingMinutes: number
      reason: string
    }>
    unscheduledMinutes: number
    estimates: Array<{ stepId: string; minutes: number; inferred: true }>
    unschedulable: unknown[]
  }
  assumptions: { taskMinutes: number; appointmentMinutes: number; note: string }
  applied: false
}

/** Returns a proposal only; never creates or changes tasks or calendar entries. */
export function previewStudyPathway(
  documentId: string,
  availability: StudyDayAvailability[],
  completedStepIds: string[] = [],
) {
  const offset = new Date().getTimezoneOffset()
  return api.post<StudyPathwayPreview>(
    `/documents/${encodeURIComponent(documentId)}/pathway-preview?timezoneOffsetMinutes=${offset}`,
    { availability, completedStepIds },
  )
}

/** Approve exactly the sessions displayed in the most recent preview. */
export function approveStudyPathway(
  documentId: string,
  availability: StudyDayAvailability[],
  expectedSessions: StudyPathwayPreview['preview']['sessions'],
) {
  const offset = new Date().getTimezoneOffset()
  return api.post<{ pathwayId: string; alreadySaved: boolean }>(
    `/documents/${encodeURIComponent(documentId)}/pathway-approve?timezoneOffsetMinutes=${offset}`,
    { availability, expectedSessions },
  )
}

/** Undo tasks created by an approved document pathway. */
export function undoStudyPathway(documentId: string) {
  return api.post<{ undone: number; alreadyUndone: boolean }>(
    `/documents/${encodeURIComponent(documentId)}/pathway-undo`,
  )
}

/** Change a saved study session's planned day and effort, not its assessment deadline. */
export function editStudyPathwaySession(
  documentId: string,
  sessionId: string,
  date: string,
  minutes: number,
) {
  return api.patch<{ sessionId: string; date: string; minutes: number }>(
    `/documents/${encodeURIComponent(documentId)}/pathway-sessions/${encodeURIComponent(sessionId)}`,
    { date, minutes },
  )
}

export type SavedStudyPathway = {
  pathway: {
    id: string
    status: 'active' | 'cancelled'
    approvedAt: string
  } | null
  sessions: Array<{
    id: string
    stepId: string
    title: string
    date: string
    minutes: number
    sequence: number
    status: string
    taskId: string | null
    taskStatus: string | null
  }>
}

/** Read the actual saved sessions, including edits and task completion. */
export function getSavedStudyPathway(documentId: string) {
  return api.get<SavedStudyPathway>(
    `/documents/${encodeURIComponent(documentId)}/pathway`,
  )
}

export type StudyReplanResponse = {
  today: string
  missedCount: number
  moves: Array<{ sessionId: string; date: string; minutes: number }>
  warnings: Array<{
    sessionId: string
    reason:
      | 'missing_deadline'
      | 'deadline_passed'
      | 'insufficient_capacity'
      | 'dependency_order'
  }>
  applied: boolean
}

/** Preview missed-day changes; passing expectedMoves explicitly approves them. */
export function replanMissedStudySessions(
  documentId: string,
  availability: StudyDayAvailability[],
  expectedMoves?: StudyReplanResponse['moves'],
) {
  const offset = new Date().getTimezoneOffset()
  return api.post<StudyReplanResponse>(
    `/documents/${encodeURIComponent(documentId)}/pathway-replan?timezoneOffsetMinutes=${offset}`,
    {
      availability,
      apply: expectedMoves !== undefined,
      ...(expectedMoves !== undefined ? { expectedMoves } : {}),
    },
  )
}
