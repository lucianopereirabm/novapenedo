// Service worker: guarda o app para abrir sem internet. Sempre tenta a rede primeiro.
const CACHE = 'rota-np-v4';
const ARQS = ['./', './index.html', './gestao.html', './css/app.css', './js/fb.js', './js/promotor.js', './js/gestao.js',
  './manifest.webmanifest', './img/icon-192.png', './img/icon-512.png', './img/logo.png', './img/logo-full.png'];
const LIBS = ['app', 'auth', 'firestore'].map(n => `https://www.gstatic.com/firebasejs/10.12.2/firebase-${n}.js`);
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(ARQS);
    // bibliotecas do Firebase: guardadas já na instalação para o app abrir sem sinal
    await Promise.all(LIBS.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && c.put(u, r)).catch(() => {})));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const local = u.origin === location.origin;
  const lib = /gstatic\.com\/firebasejs|fonts\.(googleapis|gstatic)\.com|unpkg\.com\/leaflet|cdnjs\.cloudflare\.com/.test(u.href);
  if (!local && !lib) return; // Firestore, Auth e mapas passam direto
  // rede primeiro; se o sinal estiver fraco (mais de 4 s) ou sem internet, abre o que está guardado
  const doCache = () => caches.match(e.request).then(r => r || (e.request.mode === 'navigate' ? caches.match('./index.html') : null));
  const rede = fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); } return r; });
  e.respondWith(new Promise(res => {
    let feito = false; const fim = r => { if (!feito && r) { feito = true; res(r); } };
    const t = setTimeout(() => doCache().then(fim), 4000);
    rede.then(r => { clearTimeout(t); fim(r); }, () => { clearTimeout(t); doCache().then(r => r ? fim(r) : fim(Response.error())); });
  }));
});
