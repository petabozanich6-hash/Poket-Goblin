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

export function localMinutes(now = new Date()): number {
  return now.getHours() * 60 + now.getMinutes()
}
