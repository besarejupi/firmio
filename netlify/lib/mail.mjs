/*
 * Firmio – Kopie per E-Mail (freiwillig, vom Absender in den Einstellungen eingeschaltet)
 *
 * Versand über das eigene Gmail-Konto des Absenders (SMTP mit App-Passwort) oder über
 * die Brevo-API. Zugangsdaten und Zieladresse liegen nur hier im Server-Speicher
 * (firmio-config/mail), nie im Browser und nie in einer Sicherung. Das PDF wird nur
 * durchgereicht und nicht gespeichert. Pro Anfrage höchstens eine Mail (Vermerk
 * <id>/mailed), dazu ein Tageslimit gegen Missbrauch.
 */
import { conf } from './push.mjs';

// nodemailer erst laden, wenn wirklich gemailt wird (ein Fehler dort legt nie den Rest der API lahm)
let mailerP = null;
const mailer = () => (mailerP || (mailerP = import('nodemailer').then(m => m.default || m)));

const BREVO = process.env.FIRMIO_DEV_BREVO || 'https://api.brevo.com/v3'; // nur für lokale Tests umlenkbar
const DEV_SMTP = /^127\.0\.0\.1:\d{2,5}$/.test(process.env.FIRMIO_DEV_SMTP || '') ? process.env.FIRMIO_DEV_SMTP : ''; // dito
export const MAIL_MAX_PDF = 3 * 1024 * 1024; // größere PDFs: Mail ohne Anhang mit Hinweis
const DAY_LIMIT = 150;
export const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,180}\.[A-Za-z]{2,24}$/;
export const KEY_RE = /^[A-Za-z0-9_-]{20,200}$/;
export const APPPW_RE = /^[A-Za-z]{16}$/;

export async function getMailConf() {
  const c = await conf().get('mail', { type: 'json' });
  if (!c || !c.on || !c.to) return null;
  if (c.provider === 'brevo') return c.key && c.sender && c.sender.email ? c : null;
  return c.user && c.pass ? c : null;
}

/* ---------- Gmail (SMTP mit App-Passwort) ---------- */
async function gmail(user, pass) {
  return (await mailer()).createTransport({
    host: DEV_SMTP ? '127.0.0.1' : 'smtp.gmail.com',
    port: DEV_SMTP ? Number(DEV_SMTP.split(':')[1]) : 465,
    secure: true,
    auth: { user, pass },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 20000,
    tls: DEV_SMTP ? { rejectUnauthorized: false } : undefined
  });
}

/* ---------- Brevo (API) ---------- */
async function brevo(key, method, path, body) {
  let res;
  try {
    res = await fetch(BREVO + path, {
      method,
      headers: { 'api-key': key, accept: 'application/json', 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000)
    });
  } catch (e) {
    const err = new Error('brevo_offline'); err.status = 0; err.msg = String(e && e.message || e); throw err;
  }
  let j = null;
  try { j = await res.json(); } catch (e) { j = null; }
  if (!res.ok) {
    const err = new Error('brevo ' + res.status);
    err.status = res.status;
    err.msg = (j && (j.message || j.code)) || '';
    throw err;
  }
  return j || {};
}

// Fehler in kurze Codes für die App übersetzen
export function mailError(e) {
  if (!e) return 'mail_failed';
  if (e.status === 429 && e.msg === 'limit') return 'mail_limit';
  // Gmail / SMTP
  const resp = String(e.response || '');
  if (e.code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534) {
    return /application-specific|app password|534/i.test(resp + ' ' + e.responseCode) ? 'mail_apppw' : 'mail_auth';
  }
  if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'EDNS', 'ECONNREFUSED'].includes(e.code)) return 'mail_conn';
  // Brevo
  const msg = String(e.msg || '');
  if (e.status === 401) return /\bip\b|ip address/i.test(msg) ? 'mail_ip' : 'mail_key';
  if ((e.status === 400 || e.status === 403) && /sender/i.test(msg)) return 'mail_sender';
  if (e.status === 402) return 'mail_quota';
  return 'mail_failed';
}

// Zugang prüfen und speichern
export async function setupGmail(to, user, pass) {
  await (await gmail(user, pass)).verify();
  const cfg = { on: true, provider: 'gmail', to, user, pass, created: Date.now() };
  await conf().setJSON('mail', cfg);
  return cfg;
}
export async function setupBrevo(to, key) {
  const acc = await brevo(key, 'GET', '/account');
  let sender = null;
  try {
    const s = await brevo(key, 'GET', '/senders');
    sender = (Array.isArray(s.senders) ? s.senders : []).find(x => x && x.active && typeof x.email === 'string') || null;
  } catch (e) { if (e.status === 401) throw e; }
  const email = (sender && sender.email) || (acc && acc.email) || '';
  if (!email) { const err = new Error('no sender'); err.status = 400; err.msg = 'sender'; throw err; }
  const cfg = { on: true, provider: 'brevo', to, key, sender: { name: 'Firmio', email }, created: Date.now() };
  await conf().setJSON('mail', cfg);
  return cfg;
}
export const senderOf = cfg => cfg.provider === 'brevo' ? cfg.sender.email : cfg.user;

async function countToday() {
  const d = new Date().toISOString().slice(0, 10);
  const c = (await conf().get('mail-day', { type: 'json' })) || {};
  const n = c.d === d ? (c.n || 0) + 1 : 1;
  await conf().setJSON('mail-day', { d, n });
  return n;
}

// m = { subject, text, html, pdf (Buffer, optional), name }
export async function sendMail(cfg, m) {
  if ((await countToday()) > DAY_LIMIT) { const err = new Error('limit'); err.status = 429; err.msg = 'limit'; throw err; }
  if (cfg.provider === 'brevo') {
    const body = { sender: cfg.sender, to: [{ email: cfg.to }], subject: m.subject, textContent: m.text, htmlContent: m.html };
    if (m.pdf) body.attachment = [{ content: m.pdf.toString('base64'), name: m.name }];
    return brevo(cfg.key, 'POST', '/smtp/email', body);
  }
  return (await gmail(cfg.user, cfg.pass)).sendMail({
    from: { name: 'Firmio', address: cfg.user },
    to: cfg.to,
    subject: m.subject,
    text: m.text,
    html: m.html,
    attachments: m.pdf ? [{ filename: m.name, content: m.pdf, contentType: 'application/pdf' }] : []
  });
}

/* ---------- Inhalt der Mail ---------- */
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function fileName(v) {
  let n = clean(v, 120).replace(/[\\/:*?"<>|]+/g, '_');
  if (!n) n = 'Dokument_unterschrieben.pdf';
  if (!/\.pdf$/i.test(n)) n += '.pdf';
  return n;
}
function when(ts) {
  const d = new Date(Number(ts) || Date.now());
  try {
    return new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d) + ' Uhr';
  } catch (e) { return d.toISOString(); }
}

// PDF aus Base64 prüfen: muss ein PDF sein, sonst kein Anhang
export function pdfFromB64(b64) {
  if (typeof b64 !== 'string' || !b64 || b64.length > Math.ceil(MAIL_MAX_PDF / 3) * 4 + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const buf = Buffer.from(b64, 'base64');
  const head = buf.subarray(0, 1024).toString('latin1');
  return buf.length && head.includes('%PDF') ? buf : null;
}

export function signedMail(info, attached) {
  const s1 = clean(info.signer, 80), s2 = clean(info.signer2, 80);
  const two = !!(s1 && s2);
  const signer = two ? s1 + ' und ' + s2 : (s1 || s2 || 'Ihr Kunde');
  const doc = fileName(info.name);
  const base = clean(info.title, 80) || doc.replace(/\.pdf$/i, '').replace(/[_ -]unterschrieben$/i, '') || 'Dokument';
  const ort = clean(info.ort, 60);
  const way = info.via === 'local' ? 'vor Ort auf Ihrem Handy' : 'per Link (Firmio)';
  const size = Number(info.size) || 0;
  const note = attached ? 'Das unterschriebene PDF hängt an.'
    : 'Das PDF ist zu groß für eine E-Mail' + (size ? ' (' + (size / 1048576).toFixed(1).replace('.', ',') + ' MB)' : '') + '. Es liegt in Ihrer Firmio-Übersicht.';
  const rows = [['Zeitpunkt', when(info.at)], ort ? ['Ort', ort] : null, ['Weg', way]].filter(Boolean);
  const verb = two ? ' haben ' : ' hat ';
  const text = signer + verb + '„' + base + '“ unterschrieben.\n\n' + rows.map(r => r[0] + ': ' + r[1]).join('\n') + '\n\n' + note + '\n\n– Firmio';
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f1a2c">' +
    '<p style="margin:0 0 12px">' + (two ? '<b>' + esc(s1) + '</b> und <b>' + esc(s2) + '</b>' : '<b>' + esc(signer) + '</b>') + verb + '<b>„' + esc(base) + '“</b> unterschrieben.</p>' +
    '<table style="border-collapse:collapse;font-size:14px;margin:0 0 12px">' +
    rows.map(r => '<tr><td style="padding:2px 14px 2px 0;color:#5a677c">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td></tr>').join('') +
    '</table><p style="margin:0 0 12px">' + esc(note) + '</p><p style="margin:0;color:#5a677c;font-size:13px">– Firmio</p></div>';
  return { subject: 'Unterschrieben: ' + signer + ' – ' + base, text, html, name: doc };
}

export function testMail() {
  const text = 'Die Kopie per E-Mail ist eingerichtet. Ab jetzt kommt jedes unterschriebene Dokument zusätzlich hierher.\n\n– Firmio';
  return {
    subject: 'Firmio: Kopie per E-Mail ist eingerichtet',
    text,
    html: '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0f1a2c"><p style="margin:0 0 12px">Die Kopie per E-Mail ist eingerichtet. Ab jetzt kommt jedes unterschriebene Dokument zusätzlich hierher.</p><p style="margin:0;color:#5a677c;font-size:13px">– Firmio</p></div>'
  };
}
