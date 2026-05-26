/* IXC Lookup PWA — service worker.
 * Cacheia o "app shell" (UI) para instalar/abrir offline; nunca cacheia chamadas de API.
 */
const CACHE = 'ixc-lookup-pwa-v6';
const SHELL = [
  './', './index.html', './chrome-shim.js', './auth.js', './logger.js', './popup.js', './permissoes.js',
  './relatorio.html', './relatorio.js', './manifest.webmanifest',
  './icons/icon128.png', './icons/icon192.png', './icons/icon512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = e.request.url;
  // APIs (n8n/Supabase/IXC/OLT) sempre pela rede — não interceptar
  if (e.request.method !== 'GET' ||
      /easypanel\.host|supabase|oltcloud|ixc\.carajasnet/.test(url)) {
    return;
  }
  // App shell: cache-first com atualização em segundo plano
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(resp => {
        const cp = resp.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp)).catch(() => {});
        return resp;
      }).catch(() => cached || caches.match('./index.html'));
      return cached || net;
    })
  );
});
