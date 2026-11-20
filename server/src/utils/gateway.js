import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Payment gateway adapter. Only the built-in "mock" provider ships with the project.
 * Razorpay is used automatically when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set; otherwise the demo gateway runs.
 */
const providers = {
  mock: {
    name: 'Demo gateway',
    createOrder: ({ orderRef }) => ({ provider: 'mock', orderRef, checkoutUrl: null }),
    // In demo mode the client tells us whether the "bank" approved; a real adapter verifies a signature instead.
    verify: ({ outcome }) => ({ ok: outcome !== 'fail', reference: `MOCK-${crypto.randomBytes(4).toString('hex').toUpperCase()}` }),
  },
};

const rzpAuth = () => `Basic ${Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64')}`;
const RZP_METHOD = { upi: 'upi', card: 'card', netbanking: 'netbanking' };
providers.razorpay = {
  name: 'Razorpay',
  // Creates a real Razorpay order. The Razorpay order id becomes our order_ref.
  async createOrder({ amount, invoiceNo }) {
    const r = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: rzpAuth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt: String(invoiceNo).slice(0, 40) }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.description || 'Razorpay could not create the order');
    return { provider: 'razorpay', orderRef: j.id, keyId: config.razorpay.keyId, currency: j.currency };
  },
  // Verifies the checkout signature (HMAC-SHA256 of order_id|payment_id) and looks up the real payment method.
  async verify({ orderRef, razorpay_payment_id: pid, razorpay_signature: sig }) {
    if (!pid || !sig) return { ok: false };
    const expected = crypto.createHmac('sha256', config.razorpay.keySecret).update(`${orderRef}|${pid}`).digest('hex');
    const a = Buffer.from(expected), b = Buffer.from(String(sig));
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };
    let method = 'upi';
    try { const r = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(pid)}`, { headers: { Authorization: rzpAuth() } }); const j = await r.json(); method = RZP_METHOD[j.method] || 'netbanking'; } catch { /* keep default */ }
    return { ok: true, reference: pid, method };
  },
};

export function gateway() {
  const p = providers[config.paymentProvider];
  if (!p) throw new Error(`Unknown PAYMENT_PROVIDER "${config.paymentProvider}"`);
  return p;
}
export const newOrderRef = () => `ORD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
