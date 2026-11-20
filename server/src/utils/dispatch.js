import { all, run, getSetting } from '../db/index.js';
import { config } from '../config.js';

/**
 * Delivers queued outbox rows.
 *  - e-mail through Brevo (BREVO_API_KEY + EMAIL_FROM)
 *  - SMS through TextBee (TEXTBEE_API_KEY + TEXTBEE_DEVICE_ID)
 * A channel that is not configured leaves its rows as "logged" so nothing is lost and nothing crashes.
 */
const phone = (n) => { const d = String(n).replace(/[^\d+]/g, ''); return d.startsWith('+') ? d : d.length === 10 ? `${config.smsCountryCode}${d}` : `+${d}`; };

async function sendEmail(m) {
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'api-key': config.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { name: getSetting('school_name', 'School'), email: config.emailFrom }, to: [{ email: m.to_addr }], subject: m.subject || 'Notification',
      textContent: m.body, htmlContent: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${String(m.body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>` }),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 120)}`);
}
async function sendSms(m) {
  const { apiKey, deviceId } = config.textbee;
  const r = await fetch(`https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/send-sms`, {
    method: 'POST', headers: { 'x-api-key': apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ recipients: [phone(m.to_addr)], message: m.body }),
  });
  if (!r.ok) throw new Error(`TextBee ${r.status}: ${(await r.text()).slice(0, 120)}`);
}

const ready = { email: () => !!(config.brevoApiKey && config.emailFrom), sms: () => !!(config.textbee.apiKey && config.textbee.deviceId) };
let busy = false;
export async function flushOutbox() {
  if (busy) return { sent: 0, failed: 0, logged: 0 };
  busy = true; const out = { sent: 0, failed: 0, logged: 0 };
  try {
    for (const m of all("SELECT * FROM outbox WHERE status IN ('queued','failed') ORDER BY id LIMIT 50")) {
      if (!ready[m.channel]()) { run("UPDATE outbox SET status = 'logged' WHERE id = ?", m.id); out.logged++; continue; }
      try { await (m.channel === 'email' ? sendEmail(m) : sendSms(m)); run("UPDATE outbox SET status = 'sent' WHERE id = ?", m.id); out.sent++; }
      catch (e) { console.error('[outbox]', e.message); run("UPDATE outbox SET status = 'failed' WHERE id = ?", m.id); out.failed++; }
    }
  } finally { busy = false; }
  return out;
}
export const flushSoon = () => setImmediate(() => { flushOutbox().catch((e) => console.error('[outbox]', e.message)); });
export const channels = () => ({ email: ready.email(), sms: ready.sms(), payments: config.paymentProvider });
