// ── Service Worker TeknisiApp ─────────────────────────────────────
const CACHE_NAME = 'teknisiapp-v2';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(self.clients.claim());
});

// ── PUSH: Terima notifikasi dari server ───────────────────────────
self.addEventListener('push', function(event) {
  let data = {
    title: 'TeknisiApp',
    body: 'Ada notifikasi baru',
    tag: 'default',
    url: '/',
    requireInteraction: false
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch(e) {
    try { data.body = event.data ? event.data.text() : 'Notifikasi baru'; } catch(e2) {}
  }

  const options = {
    body:    data.body,
    tag:     data.tag || 'teknisiapp',
    icon:    '/icon-192.png',
    badge:   '/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    data:    { url: data.url || '/' },
    requireInteraction: data.requireInteraction === true,
    silent:  false,
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── NOTIFICATIONCLICK: Buka/fokus app saat notif diklik ──────────
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url)
    ? new URL(event.notification.data.url, self.location.origin).href
    : self.location.origin;

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        // Cari tab yang sudah buka app
        for (const client of clientList) {
          if (client.url.startsWith(self.location.origin)) {
            client.postMessage({ type: 'NOTIF_CLICK', url: targetUrl });
            return client.focus();
          }
        }
        // Tidak ada tab terbuka — buka baru
        return self.clients.openWindow(targetUrl);
      })
  );
});

// ── PUSHSUBSCRIPTIONCHANGE: Re-subscribe otomatis jika expired ────
self.addEventListener('pushsubscriptionchange', function(event) {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: event.oldSubscription
        ? event.oldSubscription.options.applicationServerKey
        : null
    }).then(function(sub) {
      // Kirim subscription baru ke server
      return fetch('/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() })
      });
    }).catch(function(e) {
      console.warn('Re-subscribe gagal:', e);
    })
  );
});
