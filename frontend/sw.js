self.addEventListener('push', (event) => {
  let data = { title: 'Puerta a Puerta', body: 'Tenes una notificacion nueva' };
  try { data = event.data.json(); } catch {
    try { data = JSON.parse(event.data.text()); } catch {}
  }

  const urlMap = {
    cadete:   '/cadete/cadete.html',
    comercio: '/comercio/comercio.html',
    cliente:  '/cliente/index.html',
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Puerta a Puerta', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      tag: data.tag || 'pap-default',
      renotify: true,
      data: { url: data.url || urlMap[data.rol] || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(url) && 'focus' in c) return c.focus();
      }
      return clients.openWindow(url);
    })
  );
});
