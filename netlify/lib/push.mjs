/*
 * Firmio – Web Push für den Absender (gemeinsam für api.mjs und remind.mjs)
 * Die Benachrichtigungen enthalten nur zufällige Kennungen, keine Namen oder Inhalte.
 */
import { getStore } from '@netlify/blobs';
import webpush from 'web-push';

export const conf = () => getStore({ name: 'firmio-config', consistency: 'strong' });

const PUSH_HOSTS = ['fcm.googleapis.com', 'android.googleapis.com', 'push.services.mozilla.com', 'web.push.apple.com', 'notify.windows.com'];
const pushHostOk = h => PUSH_HOSTS.some(x => h === x || h.endsWith('.' + x));
const B64U = /^[A-Za-z0-9_-]+={0,2}$/;

export async function vapidKeys() {
  const c = conf();
  let k = await c.get('vapid', { type: 'json' });
  if (k && k.publicKey && k.privateKey) return k;
  const fresh = Object.assign(webpush.generateVAPIDKeys(), { created: Date.now() });
  const res = await c.setJSON('vapid', fresh, { onlyIfNew: true });
  if (res && res.modified === false) k = await c.get('vapid', { type: 'json' });
  return k && k.publicKey ? k : fresh;
}

export function subOk(sub) {
  if (!sub || typeof sub.endpoint !== 'string' || sub.endpoint.length > 1024 || !sub.keys) return null;
  const { p256dh, auth } = sub.keys;
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !B64U.test(p256dh) || !B64U.test(auth) || p256dh.length < 80 || p256dh.length > 100 || auth.length < 16 || auth.length > 32) return null;
  let u;
  try { u = new URL(sub.endpoint); } catch (e) { return null; }
  const devOk = process.env.FIRMIO_DEV_PUSH && u.hostname === '127.0.0.1'; // nur für lokale Tests
  if (u.protocol !== 'https:' || !(devOk || pushHostOk(u.hostname))) return null;
  return { endpoint: sub.endpoint, keys: { p256dh, auth } };
}

export const getSubs = async () => (await conf().get('push-subs', { type: 'json' })) || [];

export async function notifyAll(data, origin) {
  const subs = await getSubs();
  if (!subs.length) return { sent: 0, failed: 0 };
  const k = await vapidKeys();
  const subject = /^https:\/\//.test(origin || '') && !/\/\/(localhost|127\.)/.test(origin) ? origin : 'mailto:firmio@example.org';
  const opts = { vapidDetails: { subject, publicKey: k.publicKey, privateKey: k.privateKey }, TTL: 86400, urgency: 'high', timeout: 6000 };
  const payload = JSON.stringify(data);
  let sent = 0, failed = 0;
  const gone = [];
  await Promise.all(subs.map(async sub => {
    try { await webpush.sendNotification(sub, payload, opts); sent++; } catch (e) {
      failed++;
      if (e && (e.statusCode === 404 || e.statusCode === 410)) gone.push(sub.endpoint);
      else console.error('firmio push', e && e.statusCode, e && e.body);
    }
  }));
  if (gone.length) await conf().setJSON('push-subs', (await getSubs()).filter(x => !gone.includes(x.endpoint)));
  return { sent, failed };
}
