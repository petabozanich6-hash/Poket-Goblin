/**
 * AUD-first money display for Owner HQ. Never invent cost numbers from AI
 * request counts: only convert an amount that actually exists in USD.
 * Rates are reference rates, not the Cloudflare/Stripe settlement rate.
 */
export type FxQuote = {
  base: 'USD'
  quote: 'AUD'
  rate: number
  date: string
  source: 'Frankfurter'
}
let lastQuote: FxQuote | null = null
let lastFetched = 0
const SIX_HOURS = 6 * 60 * 60 * 1000

export function convertUsdToAud(usd: number, quote: FxQuote): number | null {
  if (!Number.isFinite(usd) || usd < 0 || !Number.isFinite(quote.rate) || quote.rate <= 0) return null
  return Math.round(usd * quote.rate * 100) / 100
}

export async function usdAudQuote(): Promise<FxQuote | null> {
  if (lastQuote && Date.now() - lastFetched < SIX_HOURS) return lastQuote
  try {
    const res = await fetch('https://api.frankfurter.dev/v2/rate/usd/aud', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return lastQuote
    const obj: unknown = await res.json()
    if (!obj || typeof obj !== 'object') return lastQuote
    const data = obj as Record<string, unknown>
    const rate = Number(data.rate)
    const date = String(data.date ?? '')
    if (data.base !== 'USD' || data.quote !== 'AUD' ||
        !Number.isFinite(rate) || rate <= 0 || !/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) {
      return lastQuote
    }
    lastQuote = { base: 'USD', quote: 'AUD', rate, date, source: 'Frankfurter' }
    lastFetched = Date.now()
    return lastQuote
  } catch {
    // Never substitute a fabricated or default FX rate.
    return lastQuote
  }
}
