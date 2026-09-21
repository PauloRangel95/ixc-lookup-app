/* IXC Lookup PWA — service worker.
 * Cacheia o "app shell" (UI) para instalar/abrir offline; nunca cacheia chamadas de API.
 */
const CACHE = 'ixc-lookup-pwa-v12';
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
  // App shell: NETWORK-FIRST (online sempre pega a versao nova; cache = fallback offline)
  e.respondWith(
    fetch(e.request).then(resp => {
      const cp = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, cp)).catch(() => {});
      return resp;
    }).catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
  );
});
