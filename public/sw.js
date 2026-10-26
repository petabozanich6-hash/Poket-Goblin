/*
 * Pocket Goblin service worker.
 *
 * - Caches the app shell (HTML, built JS/CSS, icons) so the app opens and
 *   quick capture works without a connection.
 * - NEVER caches /api/*: personal data is always fetched live, and nothing
 *   one account sees is kept for another.
 * - Updates wait until the page agrees (the app shows "Update ready"), so a
 *   new version never swaps out under someone mid-sentence.
 */
const VERSION = 'pg-shell-v1'
const SHELL = [
  '/',
  '/offline.html',
  '/offline.css',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k.startsWith('pg-') && k !== VERSION)
          .map((k) => caches.delete(k)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

async function networkFirstPage(request) {
  const cache = await caches.open(VERSION)
  try {
    const response = await fetch(request)
    // Every route is the same SPA shell; keep the freshest copy as '/'.
    if (response.ok && response.type === 'basic')
      await cache.put('/', response.clone())
    return response
  } catch {
    return (
      (await cache.match('/')) ||
      (await cache.match('/offline.html')) ||
      Response.error()
    )
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(VERSION)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok && response.type === 'basic')
    await cache.put(request, response.clone())
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request))
    return
  }
  // Vite's hashed bundles never change content under the same name.
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/')
  ) {
    event.respondWith(cacheFirstAsset(request))
  }
})

/*
 * Notifications. A push carries no text (so nothing personal passes through
 * the browser's push service): it only wakes us, and we ask Pocket Goblin,
 * signed in, what to show. Every push must show something, or browsers
 * (Safari especially) stop delivering.
 */
async function showNotices() {
  const sub = await self.registration.pushManager.getSubscription()
  const query = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : ''
  let notices = []
  try {
    const res = await fetch(`/api/push/notices${query}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (res.status === 401) {
      return self.registration.showNotification('Pocket Goblin', {
        body: 'You’ve been signed out. Sign back in to keep your reminders coming.',
        tag: 'pg-signed-out',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: '/' },
      })
    }
    if (res.ok) notices = (await res.json()).notices || []
  } catch {
    // Offline or the server is busy: fall through to the general nudge.
  }
  if (!notices.length) {
    // Nothing new for this device (another wake already showed it).
    const open = await self.registration.getNotifications()
    if (open.length) return
    return self.registration.showNotification('Pocket Goblin', {
      body: 'Something’s waiting for you in the Den.',
      tag: 'pg-general',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: '/den' },
    })
  }
  await Promise.all(
    notices.map((n) =>
      self.registration.showNotification(n.title, {
        body: n.body,
        tag: n.tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: n.url, reminderId: n.reminderId },
        // Android and desktop only; iPhone shows the notification alone.
        actions: n.reminderId
          ? [
              { action: 'done', title: 'Done' },
              { action: 'snooze', title: 'In 10 min' },
            ]
          : [],
      }),
    ),
  )
}

self.addEventListener('push', (event) => {
  event.waitUntil(showNotices())
})

async function openApp(url) {
  const windows = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  })
  for (const client of windows) {
    if (new URL(client.url).origin === self.location.origin) {
      await client.focus()
      if ('navigate' in client) await client.navigate(url).catch(() => {})
      return
    }
  }
  await self.clients.openWindow(url)
}

self.addEventListener('notificationclick', (event) => {
  const notification = event.notification
  const { url = '/den', reminderId } = notification.data || {}
  notification.close()
  if (reminderId && (event.action === 'done' || event.action === 'snooze')) {
    const path =
      event.action === 'done'
        ? `/api/reminders/${encodeURIComponent(reminderId)}/complete`
        : `/api/reminders/${encodeURIComponent(reminderId)}/snooze`
    event.waitUntil(
      fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event.action === 'snooze' ? { minutes: 10 } : {}),
      }).then(
        (res) => (res.ok ? undefined : openApp(url)),
        () => openApp(url),
      ),
    )
    return
  }
  event.waitUntil(openApp(url))
})

// The browser replaced this device's subscription: register the new one.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch('/api/push', { credentials: 'same-origin' })
      if (!res.ok) return
      const { publicKey } = await res.json()
      if (!publicKey) return
      const raw = atob(publicKey.replace(/-/g, '+').replace(/_/g, '/'))
      const key = Uint8Array.from(raw, (c) => c.charCodeAt(0))
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      })
      await fetch('/api/push/subscriptions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      })
    })(),
  )
})
