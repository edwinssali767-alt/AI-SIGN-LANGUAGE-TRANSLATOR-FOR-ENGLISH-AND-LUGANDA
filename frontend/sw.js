const CACHE_NAME = 'sign-translator-v1';
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
  );
});

self.addEventListener('fetch', (event) => {
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
    })
  );
});