/**
 * Quiet hours wrap overnight (e.g. 21:00–08:00).
 * `minutes` is minutes since local midnight.
 */
export function parseHm(hm: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hm.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

export function isInQuietHours(
  nowMinutes: number,
  startHm: string,
  endHm: string,
  enabled: boolean,
): boolean {
  if (!enabled) return false
  const start = parseHm(startHm)
  const end = parseHm(endHm)
  if (start === null || end === null) return false
  if (start === end) return true
  if (start < end) {
    return nowMinutes >= start && nowMinutes < end
  }
  // Overnight window
  return nowMinutes >= start || nowMinutes < end
}

/**
 * Minutes since the person's local midnight. Pass the browser's
 * getTimezoneOffset(): the Worker runs in UTC, so its own clock is wrong
 * for everyone outside UTC (an Australian 9pm is 11am on the server).
 */
export function localMinutes(
  now = new Date(),
  timezoneOffsetMinutes?: number,
): number {
  if (timezoneOffsetMinutes === undefined)
    return now.getHours() * 60 + now.getMinutes()
  const local = new Date(now.getTime() - timezoneOffsetMinutes * 60_000)
  return local.getUTCHours() * 60 + local.getUTCMinutes()
}
