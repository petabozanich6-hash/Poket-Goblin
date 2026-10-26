/**
 * Web Push without a payload: a signed (VAPID) empty POST to the browser's
 * push service. The service worker then fetches what to show from us, so no
 * personal text ever passes through Google, Apple or Mozilla.
 */
import type { Env } from '../../env'

/** Browser push services we will deliver to. A subscription's endpoint is
 * supplied by the browser, so anything else is refused (no SSRF). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /^push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/,
  /^[a-z0-9-]+\.push\.apple\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
]

export function isPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 1024) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (
    url.protocol === 'https:' &&
    (url.port === '' || url.port === '443') &&
    !url.username &&
    !url.password &&
    PUSH_HOSTS.some((re) => re.test(url.hostname))
  )
}

export function base64UrlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const b of view) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

export type VapidConfig = {
  publicKey: string
  key: CryptoKey
  subject: string
}

const imported = new Map<string, Promise<CryptoKey>>()

/**
 * The keys from `npm run push:keys`: the public key as an uncompressed P-256
 * point and the private scalar, both base64url. Null until both are set.
 */
export async function loadVapid(env: Env): Promise<VapidConfig | null> {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = env.VAPID_PRIVATE_KEY?.trim()
  if (!publicKey || !privateKey) return null
  const cacheKey = `${publicKey}.${privateKey}`
  let key = imported.get(cacheKey)
  if (!key) {
    key = (async () => {
      const point = base64UrlDecode(publicKey)
      if (point.length !== 65 || point[0] !== 4) throw new Error('bad key')
      return crypto.subtle.importKey(
        'jwk',
        {
          kty: 'EC',
          crv: 'P-256',
          d: privateKey,
          x: base64UrlEncode(point.slice(1, 33)),
          y: base64UrlEncode(point.slice(33, 65)),
          ext: false,
        },
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign'],
      )
    })()
    imported.set(cacheKey, key)
  }
  try {
    return {
      publicKey,
      key: await key,
      subject: env.VAPID_SUBJECT?.trim() || 'mailto:support@pocketgoblin.org',
    }
  } catch {
    imported.delete(cacheKey)
    console.error('push: VAPID keys could not be read')
    return null
  }
}

/** The `Authorization` header for one push service (RFC 8292). */
export async function vapidHeader(
  vapid: VapidConfig,
  endpoint: string,
  now = Date.now(),
): Promise<string> {
  const enc = new TextEncoder()
  const header = base64UrlEncode(
    enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })),
  )
  const claims = base64UrlEncode(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: vapid.subject,
      }),
    ),
  )
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapid.key,
    enc.encode(`${header}.${claims}`),
  )
  return `vapid t=${header}.${claims}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`
}

export type PushResult = 'sent' | 'gone' | 'failed'

/** Wake one device. `gone` means the browser dropped the subscription. */
export async function sendEmptyPush(
  vapid: VapidConfig,
  endpoint: string,
  urgency: 'normal' | 'high',
  fetchImpl: typeof fetch = fetch,
): Promise<PushResult> {
  if (!isPushEndpoint(endpoint)) return 'gone'
  try {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: await vapidHeader(vapid, endpoint),
        TTL: '3600',
        Urgency: urgency,
        'Content-Length': '0',
      },
    })
    if (res.status === 404 || res.status === 410) return 'gone'
    return res.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}
