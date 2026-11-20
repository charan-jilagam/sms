import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Payment gateway adapter. Only the built-in "mock" provider ships with the project.
 * To go live, implement createOrder/verify for Razorpay / Stripe / PayU here and set PAYMENT_PROVIDER.
 */
const providers = {
  mock: {
    name: 'Demo gateway',
    createOrder: ({ orderRef }) => ({ provider: 'mock', orderRef, checkoutUrl: null }),
    // In demo mode the client tells us whether the "bank" approved; a real adapter verifies a signature instead.
    verify: ({ outcome }) => ({ ok: outcome !== 'fail', reference: `MOCK-${crypto.randomBytes(4).toString('hex').toUpperCase()}` }),
  },
};

export function gateway() {
  const p = providers[config.paymentProvider];
  if (!p) throw new Error(`Unknown PAYMENT_PROVIDER "${config.paymentProvider}"`);
  return p;
}
export const newOrderRef = () => `ORD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
