/* Firmio – Service Worker: macht die App installierbar, offline startfähig und
   zeigt Benachrichtigungen, wenn ein Kunde unterschrieben hat.
   Wird nur im Absender-Modus registriert. Speichert nur die App-Dateien, keine Dokumente. */
const CACHE = 'firmio-v5';
const SHELL = ['./', './index.html', './app.js', './app.css', './config.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/badge-96.png', './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './vendor/pdf-lib.min.js',
  './fonts/source-sans.woff2', './fonts/source-serif-600.woff2'];

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

/* ---------- Benachrichtigungen ---------- */
// Kundennotiz aus der Übersicht lesen (liegt nur auf diesem Gerät). Legt nie selbst eine Datenbank an.
function readRecord(id) {
  return new Promise(resolve => {
    let req;
    try { req = indexedDB.open('firmio'); } catch (e) { resolve(null); return; }
    req.onupgradeneeded = () => { try { req.transaction.abort(); } catch (e) { /* egal */ } };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      try {
        const g = db.transaction('req', 'readonly').objectStore('req').get(id);
        g.onsuccess = () => { db.close(); resolve(g.result || null); };
        g.onerror = () => { db.close(); resolve(null); };
      } catch (e) { db.close(); resolve(null); }
    };
  });
}

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  e.waitUntil((async () => {
    const id = typeof d.id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(d.id) ? d.id : '';
    let title = 'Unterschrieben', body = 'Ein Kunde hat ein Dokument unterschrieben.';
    if (d.t === 'test') {
      title = 'Firmio';
      body = 'Benachrichtigungen sind eingerichtet.';
    } else if (id) {
      const rec = await readRecord(id);
      if (rec) body = rec.label ? rec.label + ' · ' + rec.file : rec.file;
    }
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach(c => c.postMessage({ firmio: d.t === 'test' ? 'test' : 'signed', id: id }));
    await self.registration.showNotification(title, {
      body: body,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: id || 'firmio-test',
      data: { id: id },
      lang: 'de'
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = wins.find(c => /#absender/.test(c.url)) || wins[0];
    if (app) {
      try { await app.focus(); } catch (x) { /* egal */ }
      app.postMessage({ firmio: 'open', id: id });
      return;
    }
    await self.clients.openWindow(new URL('./#absender' + (id ? '&open=' + id : ''), self.registration.scope).href);
  })());
});
