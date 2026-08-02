const CACHE_NAME = 'workout-tracker-v28';

// オフラインで動くために必要なものを全部入れる。
// 以前は外部CDN（Tailwind / Firebase SDK）に依存していたが、クロスオリジンの
// レスポンスは type が 'basic' にならず動的キャッシュの条件から外れるため、
// 構造的に永久にキャッシュされなかった。現在はすべて自己ホストしている。
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './firebase-config.js',
  './manifest.json',
  './tailwind.css',
  './vendor/firebase-app-compat.js',
  './vendor/firebase-auth-compat.js',
  './vendor/firebase-firestore-compat.js',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // 1つでも失敗すると addAll 全体が失敗しインストールできなくなるため、個別に入れる
      Promise.all(ASSETS.map((url) =>
        cache.add(url).catch((e) => console.warn('[sw] precache failed:', url, e))
      ))
    )
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
  const req = event.request;
  if (req.method !== 'GET') return;                       // 書き込み系は素通し
  if (new URL(req.url).origin !== self.location.origin) return;  // 同一オリジンのみ扱う

  // HTMLは stale-while-revalidate（更新を取りこぼさない）。
  // それ以外の静的アセットは cache-first（速い）。
  const isNavigate = req.mode === 'navigate';

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      }).catch(() => {
        // ページ遷移のときだけ index.html を返す。
        // 以前は種類を問わず index.html を返していたため、オフライン時に
        // <script src> が HTML 文書を JavaScript として受け取り、パースエラーになっていた。
        if (isNavigate) return caches.match('./');
        return Response.error();
      });

      if (isNavigate) {
        // キャッシュを即返しつつ裏で更新（更新後は次回リロードで反映）
        return cached ? (network.catch(() => cached), cached) : network;
      }
      return cached || network;
    })
  );
});
