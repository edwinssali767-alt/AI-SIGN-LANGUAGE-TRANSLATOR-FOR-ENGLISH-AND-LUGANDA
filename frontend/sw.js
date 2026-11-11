const CACHE_NAME = 'sign-translator-v13';
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
  '/fonts.css',
  '/style2.css',
  '/brand.css',
  '/a11y-fixes.css',
  '/text-to-sign.html',
  '/privacy.html',
  '/sl-core.js',
  '/recognizer.js',
  '/sentence-builder.js',
  '/text-to-gloss.js',
  '/speech.js',
  '/sign-to-speech.js',
  '/sign-renderer.js',
  '/text-to-sign.js',
  '/nav.js',
  '/data/vocabulary.json',
  '/data/patterns.json',
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
  // JSON (trained model, vocabulary, patterns) changes when retrained/edited, so it is network-first too.
  if (event.request.mode === 'navigate' || networkFirstDestinations.includes(event.request.destination)
      || requestUrl.pathname.endsWith('.json')) {
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

  // Offline engine files (WASM, hand model, sign model, audio, clips) are big and rarely change:
  // cache them on first use so the recognizer keeps working without a connection.
  const cacheOnUse = /^\/(vendor\/mediapipe|models|static\/(audio|signs))\//.test(requestUrl.pathname);

  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) return response;
        return fetch(event.request).then((networkResponse) => {
          if (cacheOnUse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return networkResponse;
        }).catch(() => {
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
