import { get, run, nextSeq } from '../db/index.js';
import { bad, notFound, money } from './http.js';

export function balanceOf(invoiceId) {
  return get('SELECT * FROM v_invoice_balance WHERE invoice_id = ?', invoiceId);
}

export function recalcInvoice(invoiceId) {
  const b = balanceOf(invoiceId);
  if (!b) return null;
  const inv = get('SELECT status FROM invoices WHERE id = ?', invoiceId);
  if (inv.status === 'cancelled') return 'cancelled';
  const status = b.balance <= 0.005 ? 'paid' : b.paid > 0 ? 'partial' : 'unpaid';
  run('UPDATE invoices SET status = ? WHERE id = ?', status, invoiceId);
  return status;
}

/**
 * Record a payment. MUST be called inside tx(). Idempotent per idempotencyKey, so a double click,
 * a network retry or a repeated gateway callback can never charge a student twice.
 */
export function recordPayment({ invoiceId, amount, method, reference = null, idempotencyKey = null, userId = null }) {
  if (idempotencyKey) {
    const ex = get('SELECT * FROM payments WHERE idempotency_key = ?', idempotencyKey);
    if (ex) return { payment: ex, duplicate: true };
  }
  const inv = get('SELECT * FROM invoices WHERE id = ?', invoiceId);
  if (!inv) throw notFound('Invoice not found');
  if (inv.status === 'cancelled') throw bad('This invoice was cancelled');
  const amt = money(amount);
  if (!(amt > 0)) throw bad('Enter an amount greater than zero');
  const bal = balanceOf(invoiceId);
  if (bal.balance <= 0.005) throw bad('This invoice is already fully paid');
  if (amt > money(bal.balance) + 0.005) throw bad(`Amount exceeds the outstanding balance (${money(bal.balance)})`);
  const receipt = nextSeq('receipt', 'RCT', 4);
  const info = run(
    `INSERT INTO payments(receipt_no, invoice_id, student_id, amount, method, reference, idempotency_key, collected_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    receipt, invoiceId, inv.student_id, amt, method, reference, idempotencyKey, userId,
  );
  recalcInvoice(invoiceId);
  return { payment: get('SELECT * FROM payments WHERE id = ?', info.lastInsertRowid), duplicate: false };
}
