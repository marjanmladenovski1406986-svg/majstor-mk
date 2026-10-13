// Majsto.mk Service Worker
// Верзија 1.0

const CACHE_NAME = 'majsto-v1';
const urlsToCache = [
  '/',
  '/index.html',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

// Инсталација
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache).catch((err) => {
        console.log('Cache error (ignored):', err);
      });
    })
  );
  self.skipWaiting();
});

// Активација — избриши стари кеширања
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch — мрежа прво, кеш како fallback
self.addEventListener('fetch', (event) => {
  // Не кеширај Supabase барања
  if (event.request.url.includes('supabase.co')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Кеширај успешни одговори
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Ако мрежата не работи, врати од кеш
        return caches.match(event.request);
      })
  );
});
