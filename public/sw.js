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
