/*
 * Firmio – tägliche Bereinigung
 * Löscht abgelaufene Dokumente (älter als 7 Tage) und Reste abgebrochener Uploads.
 */
import { getStore } from '@netlify/blobs';

export default async function cleanup() {
  const s = getStore({ name: 'firmio-docs', consistency: 'strong' });
  const keys = [];
  for await (const page of s.list({ paginate: true })) {
    page.blobs.forEach(b => keys.push(b.key));
  }
  const byId = new Map();
  keys.forEach(k => {
    const i = k.indexOf('/');
    if (i < 1) return;
    const id = k.slice(0, i);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(k);
  });
  const now = Date.now();
  let removed = 0;
  for (const [id, list] of byId) {
    const meta = list.includes(id + '/meta') ? await s.get(id + '/meta', { type: 'json' }) : null;
    if (meta && now <= meta.expires) continue;
    for (const k of list) await s.delete(k);
    removed++;
  }
  console.log('firmio cleanup: ' + removed + ' entfernt, ' + (byId.size - removed) + ' aktiv');
  return new Response('ok');
}

export const config = { schedule: '@daily' };
