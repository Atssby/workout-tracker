const CACHE_NAME = 'workout-tracker-v26';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './firebase-config.js',
  './manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // ページ遷移のときだけ index.html を返す。
        // 以前は種類を問わず index.html を返していたため、オフライン時に
        // <script src> が HTML 文書を JavaScript として受け取り、パースエラーになっていた。
        if (event.request.mode === 'navigate') return caches.match('./');
        return Response.error();
      });
    })
  );
});
