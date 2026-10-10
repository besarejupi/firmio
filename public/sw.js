/* Firmio – Service Worker: macht die App installierbar und offline startfähig.
   Wird nur im Absender-Modus registriert. Speichert nur die App-Dateien, keine Dokumente. */
const CACHE = 'firmio-v4';
const SHELL = ['./', './index.html', './app.js', './app.css', './config.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './vendor/pdf-lib.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(r => { clearTimeout(t); resolve(r); }, err => { clearTimeout(t); reject(err); });
  });
}

// Immer zuerst aus dem Netz (damit Updates sofort ankommen), ohne Netz aus dem Speicher.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // Server-Anfragen nie zwischenspeichern
  if (url.pathname.endsWith('/version.txt')) return; // Versionsprüfung immer frisch
  const isPage = req.mode === 'navigate';
  if (isPage && !/\/(index\.html)?$/.test(url.pathname)) return;
  const key = isPage ? './index.html' : req;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await withTimeout(fetch(req), isPage ? 4000 : 10000);
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(key, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
