// Service worker: guarda o app para abrir sem internet. Sempre tenta a rede primeiro.
const CACHE = 'rota-np-v1';
const ARQS = ['./', './index.html', './gestao.html', './css/app.css', './js/fb.js', './js/promotor.js', './js/gestao.js',
  './manifest.webmanifest', './img/icon-192.png', './img/icon-512.png', './img/logo.png', './img/logo-full.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const local = u.origin === location.origin;
  const lib = /gstatic\.com\/firebasejs|fonts\.(googleapis|gstatic)\.com|unpkg\.com\/leaflet|cdnjs\.cloudflare\.com/.test(u.href);
  if (!local && !lib) return; // Firestore, Auth e mapas passam direto
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()))));
});
