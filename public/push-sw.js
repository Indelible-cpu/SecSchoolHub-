/* Web Push Service Worker Handler for SecSchoolHub Staff Timebook */
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {
    title: 'SecSchoolHub Staff Timebook',
    body: 'Please record your daily Staff Time In on school premises.',
    tag: 'timebook-reminder',
    url: '/?section=timebook',
  };

  try {
    const parsed = event.data.json();
    payload = {
      title: parsed.title || payload.title,
      body: parsed.body || payload.body,
      tag: parsed.tag || payload.tag,
      url: parsed.url || payload.url,
    };
  } catch {
    const text = event.data.text();
    if (text) {
      payload.body = text;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      tag: payload.tag,
      renotify: true,
      data: { url: payload.url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/?section=timebook';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
