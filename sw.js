// ── Service Worker TeknisiApp ─────────────────────────────────────
// Handles Web Push Notifications for Android & Desktop

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// Terima push dari server
self.addEventListener('push', function(event) {
  let data = { title: 'TeknisiApp', body: 'Ada notifikasi baru', tag: 'default', url: '/' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch(e) {}

  const options = {
    body:    data.body,
    tag:     data.tag || 'default',
    icon:    '/icon-192.png',
    badge:   '/badge-72.png',
    vibrate: [200, 100, 200],
    data:    { url: data.url || '/' },
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Klik notifikasi — buka/fokus tab app
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'NOTIF_CLICK', url: targetUrl });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
