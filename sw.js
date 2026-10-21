// Majsto.mk Service Worker
// Верзија 2.0 (Поправено за динамични страници)

const CACHE_NAME = 'majsto-v2'; // Сменивме v1 во v2 за да се избрише стариот кеш
const urlsToCache = [
  '/',
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
  self.skipWaiting(); // Принуди го да се активира веднаш
});

// Активација — избриши ги старите кеширања
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
  self.clients.claim(); // Земете контрола над отворените страници
});

// Fetch — стратегија
self.addEventListener('fetch', (event) => {
  // 1. Не кеширај Supabase барања
  if (event.request.url.includes('supabase.co')) {
    return;
  }

  // 2. Не кеширај HTML страници (majstor.html) за да не се заглавуваат празни страници
  if (event.request.url.includes('.html')) {
    return;
  }

  // 3. Само GET барања
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Кеширај ги само успешните слики и CSS
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Ако мрежата не работи, врати од кеш (само за слики/иконки)
        return caches.match(event.request);
      })
  );
});
