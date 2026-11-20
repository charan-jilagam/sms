import { Router } from 'express';
import { get, all, run, tx, nextSeq, getSetting } from '../db/index.js';
import { ah, bad, notFound, forbidden, conflict, str, int, num, date, oneOf, today, addDays, money, paginate } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notifyFamily, notifyAdmins } from '../utils/notify.js';
import { studentAccess, visibleStudents } from '../utils/access.js';
import { balanceOf, recalcInvoice, recordPayment } from '../utils/billing.js';
import { gateway, newOrderRef } from '../utils/gateway.js';
import { sendRows } from '../utils/csv.js';

const r = Router();
r.use(authenticate);
const staff = requireRole('admin', 'finance');
const METHODS = ['cash', 'upi', 'card', 'netbanking', 'cheque', 'online'];

// -------------------------------------------------------------- fee structure
r.get('/structures', ah((req, res) => {
  const where = []; const p = [];
  if (req.query.class_id) { where.push('f.class_id = ?'); p.push(Number(req.query.class_id)); }
  if (!['admin', 'finance'].includes(req.user.role)) {
    const vis = visibleStudents(req.user);
    where.push(`f.class_id IN (SELECT s.class_id FROM students s WHERE ${vis.sql})`); p.push(...vis.params);
    where.push('f.active = 1');
  }
  res.json({ rows: all(`SELECT f.*, c.name || '-' || c.section AS class_label,
      (SELECT COUNT(*) FROM invoices i WHERE i.structure_id = f.id) AS invoices
    FROM fee_structures f JOIN classes c ON c.id = f.class_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY f.due_date, c.name`, ...p) });
}));

function structBody(b) {
  return [int(b.class_id, 'class'), str(b.name, 'Fee head', { max: 80 }), str(b.term, 'Term', { required: false, max: 40 }),
    num(b.amount, 'Amount', { min: 0 }), date(b.due_date, 'Due date'), num(b.late_fee_percent ?? null, 'Late fee %', { required: false, min: 0, max: 100 })];
}
r.post('/structures', staff, ah((req, res) => {
  const id = run('INSERT INTO fee_structures(class_id, name, term, amount, due_date, late_fee_percent) VALUES (?,?,?,?,?,?)', ...structBody(req.body)).lastInsertRowid;
  audit(req, 'create_fee_structure', 'fee_structure', id); res.status(201).json({ id });
}));
r.put('/structures/:id', staff, ah((req, res) => {
  const ex = get('SELECT * FROM fee_structures WHERE id = ?', req.params.id); if (!ex) throw notFound();
  const v = structBody({ ...ex, ...req.body });
  run('UPDATE fee_structures SET class_id=?, name=?, term=?, amount=?, due_date=?, late_fee_percent=?, active=? WHERE id=?', ...v, req.body.active === 0 || req.body.active === false ? 0 : 1, ex.id);
  res.json({ ok: true });
}));
r.delete('/structures/:id', staff, ah((req, res) => {
  if (get('SELECT 1 x FROM invoices WHERE structure_id = ?', req.params.id)) throw conflict('Invoices exist for this fee. Deactivate it instead.');
  run('DELETE FROM fee_structures WHERE id = ?', req.params.id); res.json({ ok: true });
}));

// Generate invoices for every active student of the class (safe to run repeatedly)
r.post('/structures/:id/generate', staff, ah((req, res) => {
  const f = get('SELECT * FROM fee_structures WHERE id = ?', req.params.id); if (!f) throw notFound();
  const created = [];
  tx(() => {
    for (const s of all("SELECT id FROM students WHERE class_id = ? AND status = 'active'", f.class_id)) {
      if (get('SELECT 1 x FROM invoices WHERE student_id = ? AND structure_id = ?', s.id, f.id)) continue;
      const no = nextSeq('invoice', 'INV', 5);
      run('INSERT INTO invoices(invoice_no, student_id, structure_id, description, amount, due_date) VALUES (?,?,?,?,?,?)',
        no, s.id, f.id, f.term ? `${f.name} (${f.term})` : f.name, f.amount, f.due_date);
      created.push(s.id);
    }
  });
  for (const sid of created) notifyFamily(sid, { title: 'New fee invoice', body: `${f.name}: ${f.amount} due on ${f.due_date}`, kind: 'fee', link: '/fees' });
  audit(req, 'generate_invoices', 'fee_structure', f.id, { created: created.length });
  res.json({ created: created.length, skipped: all("SELECT id FROM students WHERE class_id = ? AND status = 'active'", f.class_id).length - created.length });
}));

// -------------------------------------------------------------------- invoices
r.get('/invoices', ah((req, res) => {
  const { limit, offset } = paginate(req, { max: 500 });
  const vis = visibleStudents(req.user);
  const where = [vis.sql]; const p = [...vis.params];
  if (req.query.student_id) { where.push('b.student_id = ?'); p.push(Number(req.query.student_id)); }
  if (req.query.class_id) { where.push('s.class_id = ?'); p.push(Number(req.query.class_id)); }
  if (req.query.status === 'overdue') where.push("b.status IN ('unpaid','partial') AND b.due_date < date('now')");
  else if (req.query.status) { where.push('b.status = ?'); p.push(req.query.status); }
  if (req.query.q) { where.push('(s.name LIKE ? OR s.admission_no LIKE ? OR b.invoice_no LIKE ? OR s.mobile LIKE ?)'); const l = `%${req.query.q}%`; p.push(l, l, l, l); }
  const w = `WHERE ${where.join(' AND ')}`;
  const rows = all(`SELECT b.*, s.name AS student_name, s.admission_no, s.mobile, c.name || '-' || c.section AS class_label,
      (b.status IN ('unpaid','partial') AND b.due_date < date('now')) AS overdue
    FROM v_invoice_balance b JOIN students s ON s.id = b.student_id LEFT JOIN classes c ON c.id = s.class_id
    ${w} ORDER BY b.due_date DESC, b.invoice_id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  const total = get(`SELECT COUNT(*) n FROM v_invoice_balance b JOIN students s ON s.id = b.student_id ${w}`, ...p).n;
  if (req.query.format === 'csv') return sendRows(req, res, rows, 'invoices');
  res.json({ rows, total });
}));

r.post('/invoices', staff, ah((req, res) => {
  const sid = int(req.body.student_id, 'student');
  if (!get('SELECT id FROM students WHERE id = ?', sid)) throw notFound('Student not found');
  const amount = num(req.body.amount, 'Amount', { min: 0.01 });
  const discount = num(req.body.discount ?? 0, 'Discount', { min: 0, max: amount });
  const id = tx(() => run('INSERT INTO invoices(invoice_no, student_id, description, amount, discount, due_date) VALUES (?,?,?,?,?,?)',
    nextSeq('invoice', 'INV', 5), sid, str(req.body.description, 'Description', { max: 120 }), amount, discount, date(req.body.due_date, 'Due date')).lastInsertRowid);
  notifyFamily(sid, { title: 'New fee invoice', body: `${req.body.description}: ${amount - discount} due ${req.body.due_date}`, kind: 'fee', link: '/fees' });
  audit(req, 'create_invoice', 'invoice', id); res.status(201).json({ id });
}));

// scholarship / concession
r.put('/invoices/:id/discount', staff, ah((req, res) => {
  const inv = get('SELECT * FROM invoices WHERE id = ?', req.params.id); if (!inv) throw notFound();
  const d = num(req.body.discount, 'Discount', { min: 0, max: inv.amount });
  const b = balanceOf(inv.id);
  if (inv.amount - d + inv.late_fee < b.paid - 0.005) throw bad('Discount would make the invoice lower than what is already paid');
  tx(() => { run('UPDATE invoices SET discount = ? WHERE id = ?', d, inv.id); recalcInvoice(inv.id); });
  audit(req, 'set_discount', 'invoice', inv.id, { discount: d, note: req.body.note }); res.json({ ok: true });
}));

// only an administrator may cancel a late fee
r.post('/invoices/:id/waive-late-fee', requireRole('admin'), ah((req, res) => {
  const inv = get('SELECT * FROM invoices WHERE id = ?', req.params.id); if (!inv) throw notFound();
  tx(() => { run('UPDATE invoices SET late_fee = 0, late_fee_waived = 1 WHERE id = ?', inv.id); recalcInvoice(inv.id); });
  notifyFamily(inv.student_id, { title: 'Late fee waived', body: `Late fee on ${inv.invoice_no} has been cancelled.`, kind: 'fee' });
  audit(req, 'waive_late_fee', 'invoice', inv.id, { was: inv.late_fee }); res.json({ ok: true });
}));

r.post('/invoices/:id/cancel', requireRole('admin'), ah((req, res) => {
  const inv = get('SELECT * FROM invoices WHERE id = ?', req.params.id); if (!inv) throw notFound();
  if (balanceOf(inv.id).paid > 0) throw conflict('Payments exist on this invoice. Refund them first.');
  run("UPDATE invoices SET status = 'cancelled' WHERE id = ?", inv.id);
  audit(req, 'cancel_invoice', 'invoice', inv.id); res.json({ ok: true });
}));

// ------------------------------------------------------------ counter payments
r.post('/pay', staff, ah((req, res) => {
  const method = oneOf(req.body.method, METHODS.filter((m) => m !== 'online'), 'method');
  const out = tx(() => recordPayment({
    invoiceId: int(req.body.invoice_id, 'invoice'), amount: num(req.body.amount, 'Amount', { min: 0.01 }), method,
    reference: str(req.body.reference, 'Reference', { required: false, max: 80 }),
    idempotencyKey: str(req.body.idempotency_key, 'key', { required: false, max: 80 }), userId: req.user.id,
  }));
  if (!out.duplicate) {
    notifyFamily(out.payment.student_id, { title: 'Payment received', body: `Receipt ${out.payment.receipt_no} for ${out.payment.amount}`, kind: 'fee', link: '/fees', sms: true });
    audit(req, 'collect_payment', 'payment', out.payment.id, { amount: out.payment.amount, method });
  }
  res.status(out.duplicate ? 200 : 201).json(out);
}));

r.post('/payments/:id/refund', requireRole('admin'), ah((req, res) => {
  const p = get('SELECT * FROM payments WHERE id = ?', req.params.id); if (!p) throw notFound();
  if (p.status === 'refunded') throw conflict('Already refunded');
  if (p.deposit_id) throw conflict('This cash payment is part of a bank deposit and cannot be refunded here');
  tx(() => { run("UPDATE payments SET status = 'refunded' WHERE id = ?", p.id); recalcInvoice(p.invoice_id); });
  notifyFamily(p.student_id, { title: 'Payment refunded', body: `Receipt ${p.receipt_no} (${p.amount}) was refunded.`, kind: 'fee' });
  audit(req, 'refund_payment', 'payment', p.id, { reason: req.body.reason, amount: p.amount }); res.json({ ok: true });
}));

r.get('/payments', ah((req, res) => {
  const { limit, offset } = paginate(req, { max: 500 });
  const vis = visibleStudents(req.user);
  const where = [vis.sql]; const p = [...vis.params];
  if (req.query.student_id) { where.push('p.student_id = ?'); p.push(Number(req.query.student_id)); }
  if (req.query.method) { where.push('p.method = ?'); p.push(req.query.method); }
  if (req.query.from) { where.push('date(p.paid_at) >= ?'); p.push(req.query.from); }
  if (req.query.to) { where.push('date(p.paid_at) <= ?'); p.push(req.query.to); }
  const rows = all(`SELECT p.id, p.receipt_no, p.amount, p.method, p.reference, p.status, p.paid_at, p.deposit_id, i.invoice_no, i.description, s.name AS student_name, s.admission_no
    FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN students s ON s.id = p.student_id
    WHERE ${where.join(' AND ')} ORDER BY p.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  if (req.query.format === 'csv') return sendRows(req, res, rows, 'payments');
  res.json({ rows });
}));

r.get('/receipt/:id', ah((req, res) => {
  const p = get(`SELECT p.*, i.invoice_no, i.description, i.amount AS invoice_amount, i.discount, i.late_fee, u.name AS collected_by_name
     FROM payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN users u ON u.id = p.collected_by WHERE p.id = ?`, req.params.id);
  if (!p) throw notFound('Receipt not found');
  const { student } = studentAccess(req.user, p.student_id);
  const cls = student.class_id ? get("SELECT name || '-' || section AS l FROM classes WHERE id = ?", student.class_id)?.l : null;
  const school = Object.fromEntries(all("SELECT key, value FROM settings WHERE key IN ('school_name','school_address','school_phone','currency')").map((x) => [x.key, x.value]));
  res.json({ payment: p, student: { id: student.id, name: student.name, admission_no: student.admission_no, class_label: cls }, school, balance: balanceOf(p.invoice_id) });
}));

// ------------------------------------------------------------------- ledger (student account)
r.get('/ledger/:studentId', ah((req, res) => {
  const { student } = studentAccess(req.user, req.params.studentId);
  const all_ = req.query.from === 'all';
  const to = date(req.query.to || today(), 'to');
  const from = all_ ? '0000-01-01' : date(req.query.from || addDays(to, -92), 'from');   // default: last 3 months
  const opening = get(`SELECT COALESCE(SUM(debit),0) - COALESCE(SUM(credit),0) AS bal FROM v_student_ledger WHERE student_id = ? AND entry_date < ?`, student.id, from).bal;
  const rows = all(`SELECT entry_date, entry_type, ref, particulars, debit, credit FROM v_student_ledger
    WHERE student_id = ? AND entry_date BETWEEN ? AND ? ORDER BY ts, ref`, student.id, from, to);
  let run_ = opening;
  const entries = rows.map((x) => { run_ = money(run_ + x.debit - x.credit); return { ...x, balance: run_ }; });
  res.json({ student: { id: student.id, name: student.name, admission_no: student.admission_no }, from: all_ ? null : from, to, opening_balance: money(opening),
    total_debit: money(rows.reduce((a, b) => a + b.debit, 0)), total_credit: money(rows.reduce((a, b) => a + b.credit, 0)), closing_balance: money(run_), entries });
}));

// ------------------------------------------------------------- online payment portal (parents)
r.post('/portal/order', requireRole('parent'), ah((req, res) => {
  const inv = get('SELECT * FROM invoices WHERE id = ?', int(req.body.invoice_id, 'invoice')); if (!inv) throw notFound('Invoice not found');
  studentAccess(req.user, inv.student_id);
  const bal = balanceOf(inv.id);
  if (inv.status === 'cancelled' || bal.balance <= 0.005) throw bad('Nothing is due on this invoice');
  const amount = req.body.amount ? num(req.body.amount, 'Amount', { min: 1 }) : bal.balance;
  if (amount > money(bal.balance) + 0.005) throw bad('Amount exceeds the outstanding balance');
  const ref = newOrderRef();
  run('INSERT INTO gateway_orders(order_ref, invoice_id, student_id, amount, created_by) VALUES (?,?,?,?,?)', ref, inv.id, inv.student_id, money(amount), req.user.id);
  res.status(201).json({ order_ref: ref, amount: money(amount), invoice_no: inv.invoice_no, provider: gateway().name, ...gateway().createOrder({ orderRef: ref }) });
}));

r.post('/portal/confirm', requireRole('parent'), ah((req, res) => {
  const ref = str(req.body.order_ref, 'order_ref', { max: 60 });
  const method = oneOf(req.body.method ?? 'upi', ['upi', 'card', 'netbanking'], 'method');
  const result = tx(() => {
    const o = get('SELECT * FROM gateway_orders WHERE order_ref = ?', ref);
    if (!o) throw notFound('Order not found');
    studentAccess(req.user, o.student_id);
    if (o.status === 'paid') return { duplicate: true, payment: get('SELECT * FROM payments WHERE idempotency_key = ?', `order:${ref}`) };
    const v = gateway().verify({ outcome: req.body.outcome });
    if (!v.ok) { run("UPDATE gateway_orders SET status = 'failed' WHERE id = ?", o.id); return { failed: true }; }
    const out = recordPayment({ invoiceId: o.invoice_id, amount: o.amount, method, reference: v.reference, idempotencyKey: `order:${ref}`, userId: req.user.id });
    run("UPDATE gateway_orders SET status = 'paid' WHERE id = ?", o.id);
    return out;
  });
  if (result.failed) return res.status(402).json({ error: 'Payment was declined by the bank. No money was taken. You can try again.' });
  if (!result.duplicate) {
    notifyAdmins({ title: 'Online payment received', body: `${result.payment.receipt_no} - ${result.payment.amount}`, kind: 'fee', link: '/finance' });
    audit(req, 'online_payment', 'payment', result.payment.id, { amount: result.payment.amount });
  }
  res.json({ ok: true, payment: result.payment, duplicate: !!result.duplicate });
}));

export default r;
