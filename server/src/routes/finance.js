import { Router } from 'express';
import { get, all, run, tx, nextSeq, getSetting } from '../db/index.js';
import { ah, bad, notFound, conflict, forbidden, str, int, num, date, oneOf, today, addDays, money, paginate } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notifyAdmins } from '../utils/notify.js';
import { sendRows } from '../utils/csv.js';

const r = Router();
r.use(authenticate, requireRole('admin', 'finance'));

/** Fiscal year "2026-27" => 2026-04-01 .. 2027-03-31 (start month configurable in settings). */
export function fiscalRange(fy) {
  const m = String(getSetting('fiscal_start_month', '4')).padStart(2, '0');
  const y = parseInt(String(fy).slice(0, 4), 10);
  const start = `${y}-${m}-01`;
  const end = addDays(`${y + 1}-${m}-01`, -1);
  return { start, end };
}
export function fiscalYearOf(d = today()) {
  const sm = Number(getSetting('fiscal_start_month', '4'));
  const [y, mo] = d.split('-').map(Number);
  const sy = mo >= sm ? y : y - 1;
  return `${sy}-${String((sy + 1) % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- cash book
r.get('/cashbook', ah((req, res) => {
  const d = date(req.query.date || today(), 'date');
  const rows = all(`SELECT p.id, p.receipt_no, p.amount, p.method, p.paid_at, p.deposit_id, s.name AS student_name, i.description
    FROM payments p JOIN students s ON s.id = p.student_id JOIN invoices i ON i.id = p.invoice_id
    WHERE p.status = 'success' AND date(p.paid_at) = ? ORDER BY p.id`, d);
  const byMethod = all(`SELECT method, COUNT(*) n, SUM(amount) total FROM payments WHERE status='success' AND date(paid_at) = ? GROUP BY method`, d);
  const cashTotal = money(rows.filter((x) => x.method === 'cash').reduce((a, b) => a + b.amount, 0));
  const undeposited = get("SELECT COALESCE(SUM(amount),0) t, COUNT(*) n FROM payments WHERE status='success' AND method='cash' AND deposit_id IS NULL");
  res.json({ date: d, rows, by_method: byMethod, total: money(rows.reduce((a, b) => a + b.amount, 0)), cash_total: cashTotal, undeposited });
}));

// ---------------------------------------------------------------- deposits (cash -> clerk -> bank slip -> verified)
r.get('/deposits', ah((_req, res) => {
  res.json({
    rows: all(`SELECT d.*, u.name AS created_by_name, v.name AS verified_by_name,
      (SELECT COUNT(*) FROM payments p WHERE p.deposit_id = d.id) AS payments FROM deposits d
      LEFT JOIN users u ON u.id = d.created_by LEFT JOIN users v ON v.id = d.verified_by ORDER BY d.id DESC LIMIT 200`),
    undeposited: all(`SELECT p.id, p.receipt_no, p.amount, p.paid_at, s.name AS student_name FROM payments p JOIN students s ON s.id = p.student_id
      WHERE p.status='success' AND p.method='cash' AND p.deposit_id IS NULL ORDER BY p.id`),
  });
}));

r.post('/deposits', ah((req, res) => {
  const ids = (Array.isArray(req.body.payment_ids) ? req.body.payment_ids : []).map(Number);
  if (!ids.length) throw bad('Select at least one cash payment');
  const id = tx(() => {
    const rows = all(`SELECT id, amount FROM payments WHERE id IN (${ids.map(() => '?').join(',')}) AND method = 'cash' AND status = 'success' AND deposit_id IS NULL`, ...ids);
    if (rows.length !== ids.length) throw conflict('Some payments are not eligible (already banked, refunded, or not cash)');
    const total = money(rows.reduce((a, b) => a + b.amount, 0));
    const dep = run('INSERT INTO deposits(deposit_no, amount, notes, created_by) VALUES (?,?,?,?)', nextSeq('deposit', 'DEP', 4), total, str(req.body.notes, 'notes', { required: false, max: 200 }), req.user.id).lastInsertRowid;
    run(`UPDATE payments SET deposit_id = ? WHERE id IN (${ids.map(() => '?').join(',')})`, dep, ...ids);
    return dep;
  });
  audit(req, 'create_deposit', 'deposit', id); res.status(201).json({ id });
}));

const NEXT = { collected: ['handed_to_clerk'], handed_to_clerk: ['slip_submitted'], slip_submitted: ['verified', 'rejected'], rejected: ['slip_submitted'], verified: [] };
r.post('/deposits/:id/advance', ah((req, res) => {
  const d = get('SELECT * FROM deposits WHERE id = ?', req.params.id); if (!d) throw notFound();
  const to = oneOf(req.body.status, ['handed_to_clerk', 'slip_submitted', 'verified', 'rejected'], 'status');
  if (!NEXT[d.status].includes(to)) throw conflict(`Cannot move from ${d.status} to ${to}`);
  if ((to === 'verified' || to === 'rejected') && req.user.role !== 'admin') throw forbidden('Only the administrator can verify a bank deposit');
  const slip = to === 'slip_submitted' ? str(req.body.slip_ref, 'Bank slip reference', { max: 60 }) : d.slip_ref;
  run("UPDATE deposits SET status = ?, slip_ref = ?, verified_by = ?, updated_at = datetime('now') WHERE id = ?", to, slip, to === 'verified' ? req.user.id : d.verified_by, d.id);
  if (to === 'slip_submitted') notifyAdmins({ title: 'Bank deposit slip awaiting verification', body: `${d.deposit_no} - ${d.amount}`, kind: 'finance', link: '/finance/deposits' });
  audit(req, `deposit_${to}`, 'deposit', d.id); res.json({ ok: true });
}));

// ---------------------------------------------------------------- budgets & expenses
r.get('/budgets', ah((req, res) => {
  const fy = req.query.fiscal_year || fiscalYearOf();
  const { start, end } = fiscalRange(fy);
  const rows = all(`SELECT b.id, b.category, b.amount AS budget,
     COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.category = b.category AND e.expense_date BETWEEN ? AND ?), 0) AS spent
     FROM budgets b WHERE b.fiscal_year = ? ORDER BY b.category`, start, end, fy)
    .map((x) => ({ ...x, remaining: money(x.budget - x.spent), used_percent: x.budget ? Math.round((x.spent / x.budget) * 1000) / 10 : null }));
  res.json({ fiscal_year: fy, start, end, rows,
    totals: { budget: money(rows.reduce((a, b) => a + b.budget, 0)), spent: money(rows.reduce((a, b) => a + b.spent, 0)) } });
}));
r.post('/budgets', ah((req, res) => {
  const fy = str(req.body.fiscal_year || fiscalYearOf(), 'Fiscal year', { max: 9 });
  if (!/^\d{4}-\d{2}$/.test(fy)) throw bad('Fiscal year must look like 2026-27');
  run(`INSERT INTO budgets(category, fiscal_year, amount) VALUES (?,?,?) ON CONFLICT(category, fiscal_year) DO UPDATE SET amount = excluded.amount`,
    str(req.body.category, 'Category', { max: 60 }), fy, num(req.body.amount, 'Amount', { min: 0 }));
  audit(req, 'set_budget', 'budget', null, { category: req.body.category, fy }); res.status(201).json({ ok: true });
}));
r.delete('/budgets/:id', requireRole('admin'), ah((req, res) => { run('DELETE FROM budgets WHERE id = ?', req.params.id); res.json({ ok: true }); }));

r.get('/expenses', ah((req, res) => {
  const { limit, offset } = paginate(req, { max: 500 });
  const where = []; const p = [];
  if (req.query.category) { where.push('category = ?'); p.push(req.query.category); }
  if (req.query.from) { where.push('expense_date >= ?'); p.push(req.query.from); }
  if (req.query.to) { where.push('expense_date <= ?'); p.push(req.query.to); }
  if (req.query.payment_status) { where.push('payment_status = ?'); p.push(req.query.payment_status); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(`SELECT e.*, u.name AS added_by_name FROM expenses e LEFT JOIN users u ON u.id = e.added_by ${w} ORDER BY expense_date DESC, e.id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  const total = get(`SELECT COALESCE(SUM(amount),0) t FROM expenses ${w}`, ...p).t;
  if (req.query.format === 'csv') return sendRows(req, res, rows, 'expenses');
  res.json({ rows, total: money(total) });
}));
function expBody(b) {
  return [date(b.expense_date || today(), 'Date'), str(b.category, 'Category', { max: 60 }), str(b.vendor, 'Vendor', { required: false, max: 100 }),
    str(b.description, 'Description', { required: false, max: 200 }), num(b.amount, 'Amount', { min: 0.01 }), oneOf(b.payment_status || 'paid', ['paid', 'pending'], 'status')];
}
r.post('/expenses', ah((req, res) => {
  const v = expBody(req.body);
  const id = run('INSERT INTO expenses(expense_date, category, vendor, description, amount, payment_status, added_by) VALUES (?,?,?,?,?,?,?)', ...v, req.user.id).lastInsertRowid;
  // budget guard-rail
  const fy = fiscalYearOf(v[0]); const { start, end } = fiscalRange(fy);
  const b = get('SELECT amount FROM budgets WHERE category = ? AND fiscal_year = ?', v[1], fy);
  let warning = null;
  if (b) {
    const spent = get('SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE category = ? AND expense_date BETWEEN ? AND ?', v[1], start, end).t;
    if (spent > b.amount) { warning = `Category "${v[1]}" is over budget by ${money(spent - b.amount)}`; notifyAdmins({ title: 'Budget exceeded', body: warning, kind: 'finance', link: '/finance/budgets' }); }
  }
  audit(req, 'add_expense', 'expense', id, { amount: v[4] }); res.status(201).json({ id, warning });
}));
r.put('/expenses/:id', ah((req, res) => {
  const ex = get('SELECT * FROM expenses WHERE id = ?', req.params.id); if (!ex) throw notFound();
  const v = expBody({ ...ex, ...req.body });
  run('UPDATE expenses SET expense_date=?, category=?, vendor=?, description=?, amount=?, payment_status=? WHERE id=?', ...v, ex.id);
  audit(req, 'update_expense', 'expense', ex.id); res.json({ ok: true });
}));
r.delete('/expenses/:id', requireRole('admin'), ah((req, res) => {
  const ex = get('SELECT * FROM expenses WHERE id = ?', req.params.id); if (!ex) throw notFound();
  run('DELETE FROM expenses WHERE id = ?', ex.id); audit(req, 'delete_expense', 'expense', ex.id, ex); res.json({ ok: true });
}));

// ---------------------------------------------------------------- overview
r.get('/overview', ah((_req, res) => {
  const month = today().slice(0, 7);
  const sum = (sql, ...p) => money(get(sql, ...p).t);
  const collectedToday = sum("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE status='success' AND date(paid_at) = date('now')");
  const collectedMonth = sum("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE status='success' AND substr(paid_at,1,7) = ?", month);
  const outstanding = sum("SELECT COALESCE(SUM(balance),0) t FROM v_invoice_balance WHERE status IN ('unpaid','partial')");
  const overdue = sum("SELECT COALESCE(SUM(balance),0) t FROM v_invoice_balance WHERE status IN ('unpaid','partial') AND due_date < date('now')");
  const expensesMonth = sum('SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE substr(expense_date,1,7) = ?', month);
  const months = [...Array(6)].map((_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (5 - i)); return d.toISOString().slice(0, 7); });
  const series = months.map((m) => ({
    month: m,
    collected: sum("SELECT COALESCE(SUM(amount),0) t FROM payments WHERE status='success' AND substr(paid_at,1,7) = ?", m),
    expenses: sum('SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE substr(expense_date,1,7) = ?', m),
  }));
  const byMethod = all("SELECT method, SUM(amount) total FROM payments WHERE status='success' AND substr(paid_at,1,7) = ? GROUP BY method", month);
  const undeposited = get("SELECT COALESCE(SUM(amount),0) t, COUNT(*) n FROM payments WHERE status='success' AND method='cash' AND deposit_id IS NULL");
  const pendingDeposits = get("SELECT COUNT(*) n, COALESCE(SUM(amount),0) t FROM deposits WHERE status <> 'verified'");
  res.json({ collectedToday, collectedMonth, outstanding, overdue, expensesMonth, net: money(collectedMonth - expensesMonth), series, byMethod, undeposited, pendingDeposits });
}));

export default r;
