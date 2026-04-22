self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Little Wanderers';
  const options = {
    body: data.body || 'It’s quieter now — a great time to stop by!',
    icon: '/logo.png',
    badge: '/logo.png',
    data: {
      url: data.url || '/landing/visit',
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/landing/visit';
  event.waitUntil(clients.openWindow(targetUrl));
});
