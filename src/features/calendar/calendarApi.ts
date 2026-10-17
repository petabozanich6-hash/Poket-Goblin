import { api } from '@/lib/api'

export type CalendarFeed = { createdAt: string; lastUsedAt: string | null }

export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** A one-off calendar file of appointments, due dates and reminders. */
export function exportUrl(): string {
  return `/api/calendar/export.ics?tz=${encodeURIComponent(timeZone())}`
}

export function fetchCalendarFeed() {
  return api.get<{ feed: CalendarFeed | null }>('/calendar/feed')
}

export function createCalendarFeed() {
  return api.post<{ url: string; webcalUrl: string }>('/calendar/feed', {
    timezone: timeZone(),
  })
}

export function turnOffCalendarFeed() {
  return api.delete<{ ok: boolean }>('/calendar/feed')
}

/** Links that open each calendar's own "subscribe" screen. */
export function subscribeLinks(url: string, webcalUrl: string) {
  return {
    apple: webcalUrl,
    google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`,
    outlook: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(url)}&name=${encodeURIComponent('Pocket Goblin')}`,
  }
}

export type StudyCalendarSession = {
  id: string
  title: string
  minutes: number
  date: string
  pathwayId: string
  documentId: string
}

/** Approved, still-open study sessions for Pocket Goblin's own calendar. */
export function fetchStudyCalendarSessions(from: string, to: string) {
  const params = new URLSearchParams({ from, to })
  return api.get<{ sessions: StudyCalendarSession[] }>(
    `/documents/study-sessions?${params.toString()}`,
  )
}

export type DatedCalendarTask = {
  id: string
  title: string
  date: string
  priority: string
  studyMinutes: number | null
  documentId: string | null
}

/** All dated, unfinished tasks, whether created by a study pathway or elsewhere. */
export function fetchDatedCalendarTasks(from: string, to: string) {
  const params = new URLSearchParams({ from, to })
  return api.get<{ tasks: DatedCalendarTask[] }>(
    `/calendar/dated-tasks?${params.toString()}`,
  )
}
