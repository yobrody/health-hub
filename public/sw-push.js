/* Health Hub — web-push handlers.
 *
 * Imported into the Workbox-generated service worker via vite.config.ts
 * `workbox.importScripts`. Kept separate from the generated precache SW so
 * autoUpdate / skipWaiting keep managing the app shell untouched; this file
 * only adds the `push` + `notificationclick` listeners a real push needs.
 *
 * Payload shape (sent by api/main.py `_push_to_type`):
 *   { title, body, tag?, icon?, url? }
 */

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // Non-JSON / empty payload — fall back to a generic prompt rather than drop.
    payload = { title: 'Health Hub', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || 'Health Hub'
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'health-hub',
    // A fresh readiness ping should replace yesterday's under the same tag,
    // and still surface (not silently coalesce).
    renotify: Boolean(payload.tag),
    data: { url: payload.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // Focus an existing tab if one's open; otherwise open a fresh one.
      for (const client of all) {
        if ('focus' in client) {
          try { await client.navigate(url) } catch { /* cross-origin nav guard */ }
          return client.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url)
    })(),
  )
})
