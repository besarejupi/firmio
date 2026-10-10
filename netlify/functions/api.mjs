/*
 * Firmio – Server-Teil
 *
 * Speichert Dokumente nur VERSCHLÜSSELT. Der Schlüssel steckt im Link
 * (hinter dem #) und kommt nie beim Server an. Der Server sieht also nur
 * unlesbare Daten. Nach 7 Tagen oder nach dem Zurückschicken wird gelöscht.
 *
 *   GET    /api/status              -> { ok, pin }
 *   POST   /api/pin                 -> PIN festlegen (beim ersten Mal) oder prüfen
 *   POST   /api/doc                 -> neues Dokument anlegen (PIN nötig)
 *   PUT    /api/doc/:id/:n          -> Teil n hochladen (PIN nötig)
 *   GET    /api/doc/:id             -> Infos (Anzahl Teile, Ablauf)
 *   GET    /api/doc/:id/:n          -> Teil n herunterladen
 *   DELETE /api/doc/:id             -> löschen (Lösch-Schlüssel aus dem Link oder PIN)
 */
import { getStore } from '@netlify/blobs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const MAX_CHUNK = 3 * 1024 * 1024 + 1024; // Bytes pro Teil
const MAX_CHUNKS = 12;                     // zusammen gut 36 MB
const TTL_MS = 7 * 24 * 60 * 60 * 1000;    // 7 Tage
const ID_RE = /^[A-Za-z0-9_-]{22}$/;

const docs = () => getStore({ name: 'firmio-docs', consistency: 'strong' });
const conf = () => getStore({ name: 'firmio-config', consistency: 'strong' });

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' }
});
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

async function removeDoc(id, meta) {
  const s = docs();
  const n = meta && meta.chunks ? meta.chunks : MAX_CHUNKS;
  for (let i = 0; i < n; i++) await s.delete(id + '/' + i);
  await s.delete(id + '/meta');
}

export default async function handler(req) {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = req.method;
  try {
    if (parts[0] === 'status' && method === 'GET') {
      return json(200, { ok: true, pin: await pinIsSet(), ttlDays: 7, maxBytes: MAX_CHUNK * MAX_CHUNKS });
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

    if (parts[0] !== 'doc') return json(404, { error: 'not_found' });

    if (parts.length === 1 && method === 'POST') {
      if (!(await pinOk(req.headers.get('x-firmio-pin')))) { await sleep(900); return json(403, { error: 'pin_wrong' }); }
      const body = await req.json().catch(() => ({}));
      const chunks = Number(body.chunks), size = Number(body.size);
      if (!Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CHUNKS || !(size > 0) || size > MAX_CHUNK * chunks) {
        return json(400, { error: 'too_large' });
      }
      const id = randId(), del = randId(), now = Date.now();
      await docs().setJSON(id + '/meta', { chunks, size, created: now, expires: now + TTL_MS, del: sha256(del) });
      return json(200, { id, del, expires: now + TTL_MS });
    }

    const id = parts[1];
    if (!ID_RE.test(id || '')) return json(404, { error: 'not_found' });
    const meta = await docs().get(id + '/meta', { type: 'json' });
    if (!meta) return json(404, { error: 'not_found' });
    if (Date.now() > meta.expires) {
      await removeDoc(id, meta);
      return json(410, { error: 'expired' });
    }

    if (parts.length === 3 && method === 'PUT') {
      if (!(await pinOk(req.headers.get('x-firmio-pin')))) { await sleep(900); return json(403, { error: 'pin_wrong' }); }
      const n = Number(parts[2]);
      if (!Number.isInteger(n) || n < 0 || n >= meta.chunks) return json(400, { error: 'bad_part' });
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_CHUNK) return json(413, { error: 'too_large' });
      await docs().set(id + '/' + n, buf);
      return json(200, { ok: true });
    }

    if (parts.length === 2 && method === 'GET') {
      return json(200, { chunks: meta.chunks, size: meta.size, expires: meta.expires });
    }

    if (parts.length === 3 && method === 'GET') {
      const n = Number(parts[2]);
      if (!Number.isInteger(n) || n < 0 || n >= meta.chunks) return json(400, { error: 'bad_part' });
      const data = await docs().get(id + '/' + n, { type: 'arrayBuffer' });
      if (!data) return json(404, { error: 'not_found' });
      return new Response(data, { status: 200, headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
    }

    if (parts.length === 2 && method === 'DELETE') {
      const del = req.headers.get('x-firmio-del');
      const allowed = (del && same(sha256(del), meta.del)) || (await pinOk(req.headers.get('x-firmio-pin')));
      if (!allowed) return json(403, { error: 'forbidden' });
      await removeDoc(id, meta);
      return json(200, { ok: true });
    }

    return json(405, { error: 'method' });
  } catch (err) {
    console.error('firmio api', err);
    return json(500, { error: 'server' });
  }
}

export const config = { path: '/api/*' };
