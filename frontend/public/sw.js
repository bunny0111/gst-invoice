/* GST Billing service worker.
 * Purpose: make the app installable and give it a friendly offline page. It deliberately caches NOTHING private:
 * API calls, invoice PDFs, share links and page HTML always go to the network, so one business's data can never be
 * served to another or shown stale. Only the immutable, hashed build files (/assets/*) are cached for speed.
 * Bump VERSION to drop old caches after changing this file.
 */
const VERSION = 'v1'
const SHELL = `gst-shell-${VERSION}`
const ASSETS = `gst-assets-${VERSION}`
const OFFLINE_URL = '/offline.html'
const NEVER_CACHE = /^\/(api|share|admin|media|static)\//
const SHELL_FILES = [OFFLINE_URL, '/icon-192.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, ASSETS].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || NEVER_CACHE.test(url.pathname)) return // network, untouched

  if (request.mode === 'navigate') {
    // pages: always the live server; only when it can't be reached show the offline page
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)))
    return
  }

  if (SHELL_FILES.includes(url.pathname)) {
    // the offline page's own files (so its logo still shows with no connection)
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request)))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    // hashed build files never change: cache-first
    event.respondWith(
      caches.open(ASSETS).then((cache) =>
        cache.match(request).then((hit) => hit || fetch(request).then((res) => {
          if (res.ok) cache.put(request, res.clone())
          return res
        })),
      ),
    )
  }
})
