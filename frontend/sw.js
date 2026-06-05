// sw.js — Service Worker para Web Push nativo

self.addEventListener('push', (event) => {
  let data = { title: '🔔 Puerta a Puerta', body: 'Tenés una notificación nueva', icon: '/icons/icon-192.png' };
  try { data = JSON.parse(event.data.text()); } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      // Open commerce panel; ensure path matches repo: /comercio/comercio.html
      data: { url: self.location.origin + '/comercio/comercio.html' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || '/comercio.html'));
});
