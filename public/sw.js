/* Firmio – Service Worker: macht die App installierbar, offline startfähig und
   zeigt Benachrichtigungen, wenn ein Kunde unterschrieben hat.
   Wird nur im Absender-Modus registriert. Speichert nur die App-Dateien, keine Dokumente. */
const CACHE = 'firmio-v10';
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

const okId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{22}$/.test(v);

// Morgendliche Erinnerung: Der Server schickt nur Kennungen. Namen und Notizen kommen aus der Übersicht auf diesem Gerät.
async function remindNote(d) {
  const open = (Array.isArray(d.open) ? d.open : []).filter(okId).slice(0, 40);
  const soon = (Array.isArray(d.soon) ? d.soon : []).filter(okId).slice(0, 40);
  const all = open.concat(soon);
  const recs = (await Promise.all(all.map(readRecord))).filter(r => r && r.status === 'open');
  const label = r => r.label || r.file || 'Dokument';
  const isSoon = r => soon.indexOf(r.id) >= 0;
  let title, body, id = '';
  if (!recs.length) {
    title = 'Noch nicht unterschrieben';
    body = all.length === 1 ? 'Eine Anfrage wartet noch auf die Unterschrift.' : all.length + ' Anfragen warten noch auf eine Unterschrift.';
  } else if (recs.length === 1) {
    const r = recs[0];
    const c = new Date(r.created || Date.now()), n = new Date();
    const days = Math.max(2, Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()) - new Date(c.getFullYear(), c.getMonth(), c.getDate())) / 864e5));
    id = r.id;
    title = isSoon(r) ? 'Link läuft bald ab' : 'Noch nicht unterschrieben';
    body = label(r) + (isSoon(r) ? ' · noch nicht unterschrieben. Jetzt erinnern?' : ' · seit ' + days + ' Tagen offen. Jetzt erinnern?');
  } else {
    const nSoon = recs.filter(isSoon).length;
    title = recs.length + ' Anfragen noch offen';
    body = recs.slice(0, 3).map(label).join(', ') + (recs.length > 3 ? ' und ' + (recs.length - 3) + ' weitere' : '') +
      (nSoon ? '. ' + nSoon + (nSoon === 1 ? ' Link läuft' : ' Links laufen') + ' bald ab.' : '.');
  }
  await self.registration.showNotification(title, {
    body: body,
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: 'firmio-remind',
    data: { id: id, filter: id ? '' : 'open' },
    lang: 'de'
  });
}

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  e.waitUntil((async () => {
    if (d.t === 'remind') { await remindNote(d); return; }
    const id = okId(d.id) ? d.id : '';
    const issue = d.t === 'issue';
    let title = issue ? 'Rückmeldung vom Kunden' : 'Unterschrieben';
    let body = issue ? 'Zu einem Dokument gibt es eine Rückmeldung.' : 'Ein Kunde hat ein Dokument unterschrieben.';
    if (d.t === 'test') {
      title = 'Firmio';
      body = 'Benachrichtigungen sind eingerichtet.';
    } else if (id) {
      // Der Inhalt der Rückmeldung ist verschlüsselt und kommt erst in der App an; hier nur, wozu
      const rec = await readRecord(id);
      if (rec) body = [rec.label, rec.note, rec.title || rec.file].filter(Boolean).join(' · ') + (issue ? ': Bitte ansehen.' : '');
    }
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach(c => c.postMessage({ firmio: d.t === 'test' ? 'test' : issue ? 'issue' : 'signed', id: id }));
    await self.registration.showNotification(title, {
      body: body,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      tag: id ? (issue ? 'issue-' + id : id) : 'firmio-test',
      data: { id: id },
      lang: 'de'
    });
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const data = e.notification.data || {};
  const id = okId(data.id) ? data.id : '';
  const filter = /^(open|signed|all)$/.test(String(data.filter || '')) ? data.filter : '';
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = wins.find(c => /#absender/.test(c.url)) || wins[0];
    if (app) {
      try { await app.focus(); } catch (x) { /* egal */ }
      app.postMessage({ firmio: 'open', id: id, filter: filter });
      return;
    }
    await self.clients.openWindow(new URL('./#absender' + (id ? '&open=' + id : filter ? '&filter=' + filter : ''), self.registration.scope).href);
  })());
});
