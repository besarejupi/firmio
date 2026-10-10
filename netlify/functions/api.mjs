/*
 * Firmio – Server-Teil
 *
 * Speichert Dokumente nur VERSCHLÜSSELT. Der Schlüssel steckt im Link
 * (hinter dem #) und kommt nie beim Server an. Der Server sieht also nur
 * unlesbare Daten.
 *
 * Ablauf: Der Absender lädt das Original hoch (PIN). Der Kunde lädt es,
 * unterschreibt und lädt das unterschriebene PDF verschlüsselt zurück
 * (Lösch-Token aus dem Link). Dann wird das Original gelöscht. Der Absender
 * holt das unterschriebene PDF mit seiner PIN ab und löscht es danach hier.
 * Übrig bleibt nur ein leerer Vermerk (Zeitpunkte, keine Inhalte), damit der
 * Kunde beim erneuten Öffnen des Links „bereits unterschrieben“ sieht.
 *
 * Aufbewahrung: offene Anfragen 7 Tage, unterschriebene höchstens 30 Tage.
 *
 *   GET    /api/status                      -> { ok, pin, v }
 *   POST   /api/pin                         -> PIN festlegen (beim ersten Mal) oder prüfen
 *   POST   /api/state               (PIN)   -> Status mehrerer Anfragen { ids: [...] }
 *   POST   /api/doc                 (PIN)   -> neues Dokument anlegen
 *   PUT    /api/doc/:id/:n          (PIN)   -> Teil n des Originals hochladen
 *   GET    /api/doc/:id                     -> Infos (Status, Teile, Ablauf)
 *   GET    /api/doc/:id/:n                  -> Teil n des Originals
 *   POST   /api/doc/:id/signed      (Token) -> Rückgabe beginnen { size, chunks }
 *   PUT    /api/doc/:id/signed/:n   (Token) -> Teil n des unterschriebenen PDFs
 *   POST   /api/doc/:id/signed/done (Token) -> Rückgabe abschließen
 *   GET    /api/doc/:id/signed/:n   (PIN)   -> Teil n des unterschriebenen PDFs
 *   DELETE /api/doc/:id             (PIN, Token nur solange offen) -> alles löschen
 */
import { getStore } from '@netlify/blobs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const MAX_CHUNK = 3 * 1024 * 1024 + 1024; // Bytes pro Teil
const MAX_CHUNKS = 12;                     // zusammen gut 36 MB
const DAY = 24 * 60 * 60 * 1000;
const TTL_OPEN = 7 * DAY;
const TTL_SIGNED = 30 * DAY;
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

const docs = () => getStore({ name: 'firmio-docs', consistency: 'strong' });
const conf = () => getStore({ name: 'firmio-config', consistency: 'strong' });

const HEAD = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex' };
const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, HEAD)
});
const binary = data => new Response(data, { status: 200, headers: Object.assign({ 'content-type': 'application/octet-stream' }, HEAD) });
const randId = () => randomBytes(16).toString('base64url');
const sha256 = s => createHash('sha256').update(s).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

async function pinIsSet() {
  if (process.env.FIRMIO_PIN) return true;
  return !!(await conf().get('pin', { type: 'json' }));
}
async function pinOk(pin) {
  pin = String(pin || '');
  if (pin.length < 6 || pin.length > 128) return false;
  if (process.env.FIRMIO_PIN) return same(pin, process.env.FIRMIO_PIN);
  const c = await conf().get('pin', { type: 'json' });
  return !!c && same(sha256(c.salt + pin), c.hash);
}
async function needPin(req) {
  if (await pinOk(req.headers.get('x-firmio-pin'))) return null;
  await sleep(900);
  return json(403, { error: 'pin_wrong' });
}
const tokenOk = (req, meta) => {
  const t = req.headers.get('x-firmio-del');
  return !!t && !!meta.del && same(sha256(t), meta.del);
};
const statusOf = meta => meta.status === 'signed' ? 'signed' : 'open';

async function removeParts(s, id, prefix, count) {
  const jobs = [];
  for (let i = 0; i < count; i++) jobs.push(s.delete(id + prefix + i));
  await Promise.all(jobs);
}
// Alles zu einer Anfrage löschen (Original, Rückgabe, Meta)
async function removeDoc(id) {
  const s = docs();
  const { blobs } = await s.list({ prefix: id + '/' });
  const keys = blobs.map(b => b.key).filter(k => k !== id + '/meta');
  await Promise.all(keys.map(k => s.delete(k)));
  await s.delete(id + '/meta');
}
function sizeOk(body) {
  const chunks = Number(body && body.chunks), size = Number(body && body.size);
  return Number.isInteger(chunks) && chunks >= 1 && chunks <= MAX_CHUNKS && size > 0 && size <= MAX_CHUNK * chunks ? { chunks, size } : null;
}
async function readPart(req) {
  const buf = await req.arrayBuffer();
  return buf.byteLength && buf.byteLength <= MAX_CHUNK ? buf : null;
}
const partNo = (v, max) => {
  const n = Number(v);
  return /^\d{1,2}$/.test(String(v)) && n < max ? n : -1;
};

export default async function handler(req) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  try {
    if (parts[0] === 'status' && method === 'GET') {
      return json(200, { ok: true, pin: await pinIsSet(), v: 2, ttlDays: 7, keepDays: 30, maxBytes: MAX_CHUNK * MAX_CHUNKS });
    }

    if (parts[0] === 'pin' && method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const pin = String(body.pin || '');
      if (pin.length < 6 || pin.length > 128) return json(400, { error: 'pin_short' });
      if (!(await pinIsSet())) {
        const salt = randId();
        await conf().setJSON('pin', { salt, hash: sha256(salt + pin), created: Date.now() });
        return json(200, { ok: true, created: true });
      }
      if (await pinOk(pin)) return json(200, { ok: true });
      await sleep(900);
      return json(403, { error: 'pin_wrong' });
    }

    // Status mehrerer Anfragen auf einmal (für die Übersicht des Absenders)
    if (parts[0] === 'state' && method === 'POST') {
      const denied = await needPin(req);
      if (denied) return denied;
      const body = await req.json().catch(() => ({}));
      const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String).filter(i => ID_RE.test(i)))].slice(0, 200) : [];
      const s = docs(), now = Date.now(), states = {};
      for (let i = 0; i < ids.length; i += 10) {
        await Promise.all(ids.slice(i, i + 10).map(async id => {
          const meta = await s.get(id + '/meta', { type: 'json' });
          if (!meta || now > meta.expires) { states[id] = null; return; }
          const st = statusOf(meta);
          states[id] = st === 'signed'
            ? { status: st, expires: meta.expires, signedAt: meta.signedAt, chunks: meta.sChunks, size: meta.sSize }
            : { status: st, expires: meta.expires };
        }));
      }
      return json(200, { states });
    }

    if (parts[0] !== 'doc') return json(404, { error: 'not_found' });

    // Neues Dokument anlegen (Absender)
    if (parts.length === 1 && method === 'POST') {
      const denied = await needPin(req);
      if (denied) return denied;
      const ok = sizeOk(await req.json().catch(() => ({})));
      if (!ok) return json(400, { error: 'too_large' });
      const id = randId(), del = randId(), now = Date.now();
      await docs().setJSON(id + '/meta', { chunks: ok.chunks, size: ok.size, created: now, expires: now + TTL_OPEN, del: sha256(del), status: 'open' });
      return json(200, { id, del, expires: now + TTL_OPEN });
    }

    const id = parts[1];
    if (!ID_RE.test(id || '')) return json(404, { error: 'not_found' });
    const s = docs();
    const meta = await s.get(id + '/meta', { type: 'json' });
    if (!meta) return json(404, { error: 'not_found' });
    if (Date.now() > meta.expires) {
      await removeDoc(id);
      return json(410, { error: 'expired' });
    }
    const status = statusOf(meta);
    const signedPath = parts[2] === 'signed';

    // Infos
    if (parts.length === 2 && method === 'GET') {
      return json(200, status === 'signed'
        ? { status, chunks: 0, expires: meta.expires, signedAt: meta.signedAt }
        : { status, chunks: meta.chunks, size: meta.size, expires: meta.expires });
    }

    // Original hochladen (Absender)
    if (parts.length === 3 && !signedPath && method === 'PUT') {
      const denied = await needPin(req);
      if (denied) return denied;
      const n = partNo(parts[2], meta.chunks);
      if (status !== 'open' || n < 0) return json(400, { error: 'bad_part' });
      const buf = await readPart(req);
      if (!buf) return json(413, { error: 'too_large' });
      await s.set(id + '/' + n, buf);
      return json(200, { ok: true });
    }

    // Original abrufen (Kunde)
    if (parts.length === 3 && !signedPath && method === 'GET') {
      if (status !== 'open') return json(409, { error: 'signed' });
      const n = partNo(parts[2], meta.chunks);
      if (n < 0) return json(400, { error: 'bad_part' });
      const data = await s.get(id + '/' + n, { type: 'arrayBuffer' });
      return data ? binary(data) : json(404, { error: 'not_found' });
    }

    // Rückgabe beginnen (Kunde, Token aus dem Link). Geht nur, solange noch nicht unterschrieben.
    if (signedPath && parts.length === 3 && method === 'POST') {
      if (!tokenOk(req, meta)) return json(403, { error: 'forbidden' });
      if (status !== 'open') return json(409, { error: 'signed' });
      const ok = sizeOk(await req.json().catch(() => ({})));
      if (!ok) return json(400, { error: 'too_large' });
      if (meta.sChunks) await removeParts(s, id, '/s/', meta.sChunks); // Reste eines abgebrochenen Versuchs
      meta.sChunks = ok.chunks;
      meta.sSize = ok.size;
      await s.setJSON(id + '/meta', meta);
      return json(200, { ok: true });
    }

    // Rückgabe abschließen (Kunde). Mehrfacher Aufruf ist unschädlich.
    if (signedPath && parts[3] === 'done' && parts.length === 4 && method === 'POST') {
      if (!tokenOk(req, meta)) return json(403, { error: 'forbidden' });
      if (status === 'signed') return json(200, { ok: true, signedAt: meta.signedAt, again: true });
      if (!meta.sChunks) return json(400, { error: 'incomplete' });
      for (let i = 0; i < meta.sChunks; i++) {
        if (!(await s.getMetadata(id + '/s/' + i))) return json(400, { error: 'incomplete' });
      }
      await removeParts(s, id, '/', meta.chunks); // Original wird nicht mehr gebraucht
      const now = Date.now();
      Object.assign(meta, { status: 'signed', signedAt: now, expires: now + TTL_SIGNED, chunks: 0 });
      await s.setJSON(id + '/meta', meta);
      return json(200, { ok: true, signedAt: now });
    }

    // Teil des unterschriebenen PDFs hochladen (Kunde)
    if (signedPath && parts.length === 4 && method === 'PUT') {
      if (!tokenOk(req, meta)) return json(403, { error: 'forbidden' });
      if (status !== 'open') return json(409, { error: 'signed' });
      const n = partNo(parts[3], meta.sChunks || 0);
      if (n < 0) return json(400, { error: 'bad_part' });
      const buf = await readPart(req);
      if (!buf) return json(413, { error: 'too_large' });
      await s.set(id + '/s/' + n, buf);
      return json(200, { ok: true });
    }

    // Unterschriebenes PDF abholen (Absender)
    if (signedPath && parts.length === 4 && method === 'GET') {
      const denied = await needPin(req);
      if (denied) return denied;
      const n = partNo(parts[3], meta.sChunks || 0);
      if (status !== 'signed' || n < 0) return json(400, { error: 'bad_part' });
      const data = await s.get(id + '/s/' + n, { type: 'arrayBuffer' });
      return data ? binary(data) : json(404, { error: 'not_found' });
    }

    // Löschen: Absender immer (PIN), Kunde nur solange noch nicht unterschrieben
    if (parts.length === 2 && method === 'DELETE') {
      const allowed = (status === 'open' && tokenOk(req, meta)) || (await pinOk(req.headers.get('x-firmio-pin')));
      if (!allowed) { await sleep(400); return json(403, { error: 'forbidden' }); }
      if (status === 'signed') {
        // Abgeholt: Inhalt löschen, nur einen leeren Vermerk (ohne Daten) bis zum Ablauf behalten,
        // damit der Kunde beim erneuten Öffnen „bereits unterschrieben“ sieht.
        const { blobs } = await s.list({ prefix: id + '/s/' });
        await Promise.all(blobs.map(b => s.delete(b.key)));
        Object.assign(meta, { sChunks: 0, sSize: 0, fetched: meta.fetched || Date.now() });
        await s.setJSON(id + '/meta', meta);
        return json(200, { ok: true, note: true });
      }
      await removeDoc(id);
      return json(200, { ok: true });
    }

    return json(405, { error: 'method' });
  } catch (err) {
    console.error('firmio api', err);
    return json(500, { error: 'server' });
  }
}

export const config = { path: '/api/*' };
