/**
 * Combine a user wall-clock date/time into an ISO UTC string.
 * `offsetMinutes` should be `Date.prototype.getTimezoneOffset()` from the
 * user's browser (minutes to add to local to reach UTC).
 */
export function localDateTimeToIso(
  date: string,
  time: string | null,
  allDay = false,
  offsetMinutes = 0,
): string {
  const clock = allDay || !time ? '12:00' : time
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = clock.split(':').map(Number)
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    throw new Error('Invalid date or time')
  }
  const utcMs =
    Date.UTC(year, month - 1, day, hour, minute, 0) + offsetMinutes * 60_000
  return new Date(utcMs).toISOString()
}

export function addHoursIso(iso: string, hours: number): string {
  const d = new Date(iso)
  d.setUTCHours(d.getUTCHours() + hours)
  return d.toISOString()
}

export function todayLocalIso(now = new Date()): string {
  const offset = now.getTimezoneOffset()
  const local = new Date(now.getTime() - offset * 60_000)
  return local.toISOString().slice(0, 10)
}

export function readOffsetMinutes(
  body: Record<string, unknown> | null,
): number {
  if (
    body &&
    typeof body.timezoneOffsetMinutes === 'number' &&
    Number.isFinite(body.timezoneOffsetMinutes)
  ) {
    return Math.round(body.timezoneOffsetMinutes)
  }
  return 0
}
