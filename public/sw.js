const CACHE = 'ucweb-shell-v1';
const SHELL = '/';
const LIVE = new Set(['/events', '/healthz']);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

function cacheable(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return !url.pathname.startsWith('/api/') && !LIVE.has(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!cacheable(request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request);
      if (response.ok) event.waitUntil(cache.put(request, response.clone()));
      return response;
    } catch (error) {
      const saved = (await cache.match(request)) ?? (request.mode === 'navigate' ? await cache.match(SHELL) : undefined);
      if (saved) return saved;
      throw error;
    }
  })());
});
