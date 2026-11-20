import { Router } from 'express';
import { all, get } from '../db/index.js';
import { ah, bad, date, today, addDays, oneOf, money } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { sendRows } from '../utils/csv.js';

const r = Router();
r.use(authenticate, requireRole('admin', 'finance'));

r.get('/fee-collection', ah((req, res) => {
  const to = date(req.query.to || today(), 'to'), from = date(req.query.from || addDays(to, -30), 'from');
  const group = oneOf(req.query.group || 'day', ['day', 'month', 'method', 'class', 'fee_head'], 'group');
  const expr = {
    day: 'date(p.paid_at)', month: 'substr(p.paid_at,1,7)', method: 'p.method',
    class: "COALESCE(c.name || '-' || c.section, 'Unassigned')", fee_head: 'COALESCE(f.name, i.description)',
  }[group];
  const rows = all(`SELECT ${expr} AS label, COUNT(*) AS payments, ROUND(SUM(p.amount),2) AS total
    FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN students s ON s.id = p.student_id
    LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN fee_structures f ON f.id = i.structure_id
    WHERE p.status = 'success' AND date(p.paid_at) BETWEEN ? AND ? GROUP BY 1 ORDER BY ${group === 'day' || group === 'month' ? '1' : '3 DESC'}`, from, to);
  if (req.query.format === 'csv') return sendRows(req, res, rows, `fee-collection-${group}`);
  res.json({ from, to, group, rows, total: money(rows.reduce((a, b) => a + b.total, 0)) });
}));

r.get('/outstanding', ah((req, res) => {
  const where = ["b.status IN ('unpaid','partial')"]; const p = [];
  if (req.query.class_id) { where.push('s.class_id = ?'); p.push(Number(req.query.class_id)); }
  if (req.query.overdue === '1') where.push("b.due_date < date('now')");
  const rows = all(`SELECT s.id AS student_id, s.name AS student, s.admission_no, s.mobile, c.name || '-' || c.section AS class,
      COUNT(*) AS invoices, ROUND(SUM(b.total),2) AS billed, ROUND(SUM(b.paid),2) AS paid, ROUND(SUM(b.balance),2) AS balance,
      MIN(b.due_date) AS oldest_due, CAST(julianday('now') - julianday(MIN(b.due_date)) AS INTEGER) AS days_overdue
    FROM v_invoice_balance b JOIN students s ON s.id = b.student_id LEFT JOIN classes c ON c.id = s.class_id
    WHERE ${where.join(' AND ')} GROUP BY s.id ORDER BY balance DESC`, ...p);
  rows.forEach((x) => { if (x.days_overdue < 0) x.days_overdue = 0; });
  return sendRows(req, res, rows, 'outstanding-fees');
}));

r.get('/expenses', ah((req, res) => {
  const to = date(req.query.to || today(), 'to'), from = date(req.query.from || addDays(to, -90), 'from');
  const rows = all(`SELECT category, COUNT(*) AS entries, ROUND(SUM(amount),2) AS total FROM expenses WHERE expense_date BETWEEN ? AND ? GROUP BY category ORDER BY total DESC`, from, to);
  return sendRows(req, res, rows, 'expense-summary');
}));

r.get('/strength', ah((_req, res) => {
  res.json({ rows: all(`SELECT c.name || '-' || c.section AS class, c.capacity, COUNT(s.id) AS students,
     SUM(s.gender = 'male') AS boys, SUM(s.gender = 'female') AS girls
     FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status = 'active' GROUP BY c.id ORDER BY c.name, c.section`) });
}));

export default r;
