/*
 * Firmio – tägliche Erinnerung an offene Anfragen
 * Morgens eine Benachrichtigung an den Absender, wenn eine Anfrage seit 2 Tagen
 * offen ist oder ihr Link bald abläuft – jede Anfrage höchstens einmal pro Anlass.
 * Die Benachrichtigung enthält nur die zufälligen Kennungen, keine Namen oder Inhalte;
 * das Handy des Absenders setzt Kunde und Notiz aus seiner eigenen Übersicht ein.
 */
import { getStore } from '@netlify/blobs';
import { conf, getSubs, notifyAll } from '../lib/push.mjs';

const HOUR = 60 * 60 * 1000;

export default async function remind() {
  if (!(await getSubs()).length) return new Response('keine Geräte angemeldet');
  const s = getStore({ name: 'firmio-docs', consistency: 'strong' });
  const ids = new Set();
  for await (const page of s.list({ paginate: true })) {
    page.blobs.forEach(b => { if (b.key.endsWith('/meta')) ids.add(b.key.slice(0, -5)); });
  }
  const now = Date.now();
  const before = (await conf().get('reminded', { type: 'json' })) || {};
  const keep = {}, open = [], soon = [];
  for (const id of ids) {
    const meta = await s.get(id + '/meta', { type: 'json' });
    if (!meta || meta.status === 'signed' || now > meta.expires) continue;
    const r = Object.assign({}, before[id]);
    if (meta.expires - now <= 36 * HOUR) {
      if (!r.soon) { soon.push(id); r.soon = now; }
    } else if (now - meta.created >= 44 * HOUR && !r.open) {
      open.push(id);
      r.open = now;
    }
    if (r.open || r.soon) keep[id] = r;
  }
  await conf().setJSON('reminded', keep);
  if (!open.length && !soon.length) return new Response('nichts zu erinnern');
  const res = await notifyAll({ t: 'remind', open: open.slice(0, 40), soon: soon.slice(0, 40) }, process.env.URL || '');
  console.log('firmio remind: ' + open.length + ' seit 2 Tagen offen, ' + soon.length + ' laufen bald ab, ' + res.sent + ' gesendet');
  return new Response('ok');
}

export const config = { schedule: '0 7 * * *' };
