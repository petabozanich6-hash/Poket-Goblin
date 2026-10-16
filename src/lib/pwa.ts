/**
 * Progressive Web App plumbing: service-worker registration, update
 * handling and the browser's own install prompt.
 *
 * Nothing here claims an install happened: "installed" is only reported
 * when the browser says so (display-mode standalone, or `appinstalled`).
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type PwaState = {
  /** The browser offered an install prompt we can show (Chromium browsers). */
  canPrompt: boolean
  /** Running as an installed app right now. */
  standalone: boolean
  /** The browser fired `appinstalled` in this session. */
  justInstalled: boolean
  /** A new version is waiting to take over. */
  updateReady: boolean
}

let deferred: BeforeInstallPromptEvent | null = null
let waiting: ServiceWorker | null = null
let state: PwaState = {
  canPrompt: false,
  standalone: false,
  justInstalled: false,
  updateReady: false,
}
const listeners = new Set<() => void>()

function set(patch: Partial<PwaState>) {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

export function subscribePwa(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function getPwaState(): PwaState {
  return state
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // iOS Safari home-screen apps.
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export type Platform =
  | 'ios-safari'
  | 'ios-other'
  | 'android'
  | 'samsung'
  | 'desktop-chromium'
  | 'desktop-safari'
  | 'firefox'
  | 'other'

export function detectPlatform(ua = navigator.userAgent): Platform {
  const iOS =
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) &&
      typeof navigator !== 'undefined' &&
      navigator.maxTouchPoints > 1)
  if (iOS) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-other' : 'ios-safari'
  if (/SamsungBrowser/.test(ua)) return 'samsung'
  if (/Android/.test(ua)) return /Firefox/.test(ua) ? 'firefox' : 'android'
  if (/Firefox/.test(ua)) return 'firefox'
  if (/Edg\/|Chrome\//.test(ua)) return 'desktop-chromium'
  if (/Safari\//.test(ua)) return 'desktop-safari'
  return 'other'
}

/** Ask the browser to show its install dialog. Returns the person's choice. */
export async function promptInstall(): Promise<
  'accepted' | 'dismissed' | 'unavailable'
> {
  if (!deferred) return 'unavailable'
  const event = deferred
  deferred = null
  set({ canPrompt: false })
  await event.prompt()
  const choice = await event.userChoice
  return choice.outcome
}

/** Let the waiting version take over, then reload once it has. */
export function applyUpdate() {
  if (!waiting) return
  navigator.serviceWorker.addEventListener(
    'controllerchange',
    () => window.location.reload(),
    {
      once: true,
    },
  )
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

function track(registration: ServiceWorkerRegistration) {
  const mark = (worker: ServiceWorker | null) => {
    // Only an *update* matters: the first install has no controller yet.
    if (worker && navigator.serviceWorker.controller) {
      waiting = worker
      set({ updateReady: true })
    }
  }
  if (registration.waiting) mark(registration.waiting)
  registration.addEventListener('updatefound', () => {
    const incoming = registration.installing
    incoming?.addEventListener('statechange', () => {
      if (incoming.state === 'installed') mark(incoming)
    })
  })
}

export function initPwa() {
  if (typeof window === 'undefined') return
  set({ standalone: isStandalone() })
  window
    .matchMedia?.('(display-mode: standalone)')
    .addEventListener?.('change', () => set({ standalone: isStandalone() }))
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    set({ canPrompt: true })
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    set({ canPrompt: false, justInstalled: true })
  })

  // Service workers need a secure context; dev (Vite) skips them so hot
  // reload is never served from a cache.
  if (
    !import.meta.env.PROD ||
    !('serviceWorker' in navigator) ||
    !window.isSecureContext
  )
    return
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        track(registration)
        // Check for a new version when the app comes back to the foreground.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible')
            void registration.update().catch(() => {})
        })
      })
      .catch((error) => console.warn('Service worker not registered', error))
  })
}
