const CACHE_NAME = 'sign-translator-v3';
const urlsToCache = [
  '/',
  '/index.html',
  '/welcome.html',
  '/translator.html',
  '/letters.html',
  '/gestures.html',
  '/pricing.html',
  '/auth.html',
  '/profile.html',
  '/style2.css',
  '/style1.css',
  '/theme.js',
  '/auth.js',
  '/translator.js',
  '/admin.js',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.pathname.startsWith('/api/')) {
    return;
  }

  const networkFirstDestinations = ['document', 'script', 'style'];
  if (event.request.mode === 'navigate' || networkFirstDestinations.includes(event.request.destination)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
          return response;
        })
        .catch(() => caches.match(event.request).then((response) => {
          return response || caches.match('/welcome.html');
        }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request).catch(() => {
          if (event.request.mode === 'navigate') {
            return caches.match('/welcome.html');
          }
        });
      })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});
