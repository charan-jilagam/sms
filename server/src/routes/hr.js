import { Router } from 'express';
import { get, all, run, tx, nextSeq } from '../db/index.js';
import { ah, bad, notFound, forbidden, conflict, str, int, num, date, oneOf, today, addDays, money, mobile as vMobile } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notify, notifyAdmins } from '../utils/notify.js';
import { employeeOfUser } from '../utils/hr.js';
import { sendRows } from '../utils/csv.js';

const r = Router();
r.use(authenticate);
const hrStaff = requireRole('admin', 'finance');

// ============================================================ employees (teaching, non-teaching, drivers, co-drivers)
r.get('/employees', hrStaff, ah((req, res) => {
  const where = []; const p = [];
  if (req.query.type) { where.push('e.type = ?'); p.push(req.query.type); }
  if (req.query.status) { where.push('e.status = ?'); p.push(req.query.status); }
  if (req.query.q) { where.push('(e.name LIKE ? OR e.emp_code LIKE ? OR e.mobile LIKE ?)'); const l = `%${req.query.q}%`; p.push(l, l, l); }
  const rows = all(`SELECT e.*, u.email, u.status AS login_status FROM employees e LEFT JOIN users u ON u.id = e.user_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.status, e.type, e.name`, ...p);
  if (req.user.role === 'finance') { /* finance sees pay data */ }
  return sendRows(req, res, rows, 'employees');
}));
function empBody(b, ex = {}) {
  const m = { ...ex, ...b };
  return [str(m.name, 'Name', { max: 100 }), vMobile(m.mobile || null, 'mobile', { required: false }), oneOf(m.type, ['teacher', 'admin_staff', 'finance', 'driver', 'co_driver', 'other'], 'type'),
    str(m.designation, 'Designation', { required: false, max: 60 }), str(m.department, 'Department', { required: false, max: 60 }), date(m.join_date || null, 'join date', { required: false }),
    str(m.address, 'Address', { required: false, max: 300 }), str(m.id_proof, 'ID proof', { required: false, max: 60 }), str(m.emergency_contact, 'Emergency contact', { required: false, max: 60 }),
    str(m.bank_account, 'Bank account', { required: false, max: 40 }), num(m.basic_salary ?? 0, 'Basic salary', { min: 0 }), num(m.allowances ?? 0, 'Allowances', { min: 0 }), num(m.deductions ?? 0, 'Deductions', { min: 0 }),
    str(m.license_no, 'License no', { required: false, max: 30 }), date(m.license_expiry || null, 'license expiry', { required: false })];
}
r.post('/employees', requireRole('admin'), ah((req, res) => {
  const v = empBody(req.body);
  const id = tx(() => run(`INSERT INTO employees(emp_code, name, mobile, type, designation, department, join_date, address, id_proof, emergency_contact, bank_account, basic_salary, allowances, deductions, license_no, license_expiry)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, nextSeq('employee', 'EMP', 4), ...v).lastInsertRowid);
  audit(req, 'create_employee', 'employee', id); res.status(201).json({ id });
}));
r.put('/employees/:id', requireRole('admin'), ah((req, res) => {
  const ex = get('SELECT * FROM employees WHERE id = ?', req.params.id); if (!ex) throw notFound();
  const v = empBody(req.body, ex);
  run(`UPDATE employees SET name=?, mobile=?, type=?, designation=?, department=?, join_date=?, address=?, id_proof=?, emergency_contact=?, bank_account=?, basic_salary=?, allowances=?, deductions=?, license_no=?, license_expiry=?, status=? WHERE id=?`,
    ...v, oneOf(req.body.status ?? ex.status, ['active', 'inactive'], 'status'), ex.id);
  audit(req, 'update_employee', 'employee', ex.id); res.json({ ok: true });
}));

// ============================================================ staff attendance
r.get('/attendance', requireRole('admin'), ah((req, res) => {
  const d = date(req.query.date || today(), 'date');
  res.json({ date: d, rows: all(`SELECT e.id AS employee_id, e.emp_code, e.name, e.type, a.status,
     EXISTS(SELECT 1 FROM staff_leaves l WHERE l.employee_id = e.id AND l.status = 'approved' AND ? BETWEEN l.from_date AND l.to_date) AS on_approved_leave
     FROM employees e LEFT JOIN staff_attendance a ON a.employee_id = e.id AND a.date = ? WHERE e.status = 'active' ORDER BY e.type, e.name`, d, d) });
}));
r.post('/attendance', requireRole('admin'), ah((req, res) => {
  const d = date(req.body.date, 'date'); if (d > today()) throw bad('Cannot mark a future date');
  const recs = Array.isArray(req.body.records) ? req.body.records : [];
  tx(() => { for (const x of recs) run(`INSERT INTO staff_attendance(employee_id, date, status, marked_by) VALUES (?,?,?,?)
    ON CONFLICT(employee_id, date) DO UPDATE SET status = excluded.status, marked_by = excluded.marked_by`, int(x.employee_id, 'employee'), d, oneOf(x.status, ['P', 'A', 'L', 'H'], 'status'), req.user.id); });
  audit(req, 'staff_attendance', 'employee', null, { date: d, count: recs.length }); res.json({ ok: true, saved: recs.length });
}));

// ============================================================ staff leaves
const SL = `SELECT l.*, e.name AS employee_name, e.emp_code, e.type, du.name AS decided_by_name FROM staff_leaves l JOIN employees e ON e.id = l.employee_id LEFT JOIN users du ON du.id = l.decided_by`;
r.get('/leaves', ah((req, res) => {
  if (req.user.role === 'admin') return res.json({ rows: all(`${SL} ${req.query.status ? 'WHERE l.status = ?' : ''} ORDER BY CASE l.status WHEN 'pending' THEN 0 ELSE 1 END, l.id DESC LIMIT 300`, ...(req.query.status ? [req.query.status] : [])) });
  const emp = employeeOfUser(req.user.id);
  res.json({ rows: emp ? all(`${SL} WHERE l.employee_id = ? ORDER BY l.id DESC`, emp.id) : [] });
}));
r.post('/leaves', requireRole('admin', 'teacher', 'finance', 'driver'), ah((req, res) => {
  const emp = req.user.role === 'admin' && req.body.employee_id ? get('SELECT * FROM employees WHERE id = ?', req.body.employee_id) : employeeOfUser(req.user.id);
  if (!emp) throw bad('No HR record is linked to your account');
  const from = date(req.body.from_date, 'From'), to = date(req.body.to_date, 'To'); if (to < from) throw bad('To date must be after From date');
  if (get(`SELECT 1 x FROM staff_leaves WHERE employee_id = ? AND status IN ('pending','approved') AND from_date <= ? AND to_date >= ?`, emp.id, to, from)) throw conflict('You already have leave covering these dates');
  const id = run('INSERT INTO staff_leaves(employee_id, leave_type, from_date, to_date, reason) VALUES (?,?,?,?,?)', emp.id, oneOf(req.body.leave_type || 'casual', ['casual', 'sick', 'earned', 'unpaid'], 'leave type'), from, to, str(req.body.reason, 'Reason', { required: false, max: 300 })).lastInsertRowid;
  notifyAdmins({ title: 'Staff leave request', body: `${emp.name}: ${from} to ${to}`, kind: 'leave', link: '/hr/leaves' });
  res.status(201).json({ id });
}));
r.post('/leaves/:id/decide', requireRole('admin'), ah((req, res) => {
  const l = get('SELECT l.*, e.user_id FROM staff_leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?', req.params.id); if (!l) throw notFound();
  if (l.status !== 'pending') throw conflict(`Already ${l.status}`);
  const decision = oneOf(req.body.decision, ['approved', 'rejected'], 'decision');
  tx(() => {
    run("UPDATE staff_leaves SET status = ?, decided_by = ?, decision_note = ? WHERE id = ?", decision, req.user.id, str(req.body.note, 'note', { required: false, max: 200 }), l.id);
    if (decision === 'approved') for (let d = l.from_date; d <= l.to_date; d = addDays(d, 1)) {
      if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) continue;
      run("INSERT OR IGNORE INTO staff_attendance(employee_id, date, status, marked_by) VALUES (?,?,'L',?)", l.employee_id, d, req.user.id);
    }
  });
  if (l.user_id) notify(l.user_id, { title: `Leave ${decision}`, body: `${l.from_date} to ${l.to_date}`, kind: 'leave', link: '/hr/leaves', sms: true });
  audit(req, `staff_leave_${decision}`, 'staff_leave', l.id); res.json({ ok: true });
}));
r.post('/leaves/:id/cancel', ah((req, res) => {
  const l = get('SELECT l.*, e.user_id FROM staff_leaves l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?', req.params.id); if (!l) throw notFound();
  if (l.user_id !== req.user.id && req.user.role !== 'admin') throw forbidden();
  if (l.status !== 'pending') throw conflict('Only pending requests can be cancelled');
  run("UPDATE staff_leaves SET status = 'cancelled' WHERE id = ?", l.id); res.json({ ok: true });
}));

// ============================================================ payroll
export function workingDays(month) {
  const [y, m] = month.split('-').map(Number); const n = new Date(Date.UTC(y, m, 0)).getUTCDate(); let c = 0;
  for (let d = 1; d <= n; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() !== 0) c++;
  return c;
}
/** Create (or top-up) a draft payroll run for a month. Safe to call twice. */
export function generatePayroll(month, userId = null) {
  return tx(() => {
    let run_ = get('SELECT * FROM payroll_runs WHERE month = ?', month);
    if (run_ && run_.status !== 'draft') throw conflict(`Payroll for ${month} is already ${run_.status}`);
    if (!run_) run_ = { id: run('INSERT INTO payroll_runs(month, created_by) VALUES (?,?)', month, userId).lastInsertRowid };
    const wd = workingDays(month); let n = 0;
    const from = `${month}-01`, to = `${month}-31`;
    for (const e of all("SELECT * FROM employees WHERE status = 'active'")) {
      if (get('SELECT 1 x FROM payslips WHERE run_id = ? AND employee_id = ?', run_.id, e.id)) continue;
      if (e.join_date && e.join_date.slice(0, 7) > month) continue;
      const a = get(`SELECT COUNT(*) n, COALESCE(SUM(status='P'),0) p, COALESCE(SUM(status='H'),0) h, COALESCE(SUM(status='A'),0) a FROM staff_attendance WHERE employee_id = ? AND date BETWEEN ? AND ?`, e.id, from, to);
      const unpaidLeave = get(`SELECT COALESCE(SUM(julianday(MIN(to_date, ?)) - julianday(MAX(from_date, ?)) + 1), 0) d FROM staff_leaves
         WHERE employee_id = ? AND status = 'approved' AND leave_type = 'unpaid' AND from_date <= ? AND to_date >= ?`, to, from, e.id, to, from).d;
      // No attendance recorded at all => assume full attendance; otherwise absences (and half days) are deducted
      const absentDays = a.n ? a.a + a.h * 0.5 : 0;
      const lossDays = Math.min(wd, absentDays + unpaidLeave);
      const perDay = e.basic_salary / wd;
      const leaveDed = money(perDay * lossDays);
      const net = money(e.basic_salary + e.allowances - e.deductions - leaveDed);
      run(`INSERT INTO payslips(run_id, employee_id, working_days, present_days, basic, allowances, deductions, leave_deduction, net) VALUES (?,?,?,?,?,?,?,?,?)`,
        run_.id, e.id, wd, money(wd - lossDays), e.basic_salary, e.allowances, e.deductions, leaveDed, Math.max(0, net)); n++;
    }
    return { id: run_.id, created: n };
  });
}
const SLIP = `SELECT p.*, e.name, e.emp_code, e.type, e.designation, e.bank_account, r.month, r.status AS run_status FROM payslips p JOIN employees e ON e.id = p.employee_id JOIN payroll_runs r ON r.id = p.run_id`;

r.get('/payroll/runs', hrStaff, ah((_req, res) => res.json({ rows: all(`SELECT r.*, (SELECT COUNT(*) FROM payslips p WHERE p.run_id = r.id) AS slips, (SELECT COALESCE(SUM(net),0) FROM payslips p WHERE p.run_id = r.id) AS total_net FROM payroll_runs r ORDER BY r.month DESC`) })));
r.post('/payroll/runs', hrStaff, ah((req, res) => {
  const month = str(req.body.month, 'Month', { max: 7 }); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('Month must be YYYY-MM');
  const out = generatePayroll(month, req.user.id); audit(req, 'generate_payroll', 'payroll_run', out.id, { month }); res.status(201).json(out);
}));
r.get('/payroll/runs/:id', hrStaff, ah((req, res) => {
  const run_ = get('SELECT * FROM payroll_runs WHERE id = ?', req.params.id); if (!run_) throw notFound();
  res.json({ run: run_, rows: all(`${SLIP} WHERE p.run_id = ? ORDER BY e.type, e.name`, run_.id) });
}));
r.put('/payroll/payslips/:id', hrStaff, ah((req, res) => {
  const p = get('SELECT p.*, r.status AS rs FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.id = ?', req.params.id); if (!p) throw notFound();
  if (p.rs !== 'draft') throw conflict('Only draft payslips can be edited');
  const bonus = num(req.body.bonus ?? p.bonus, 'Bonus', { min: 0 }), ded = num(req.body.deductions ?? p.deductions, 'Deductions', { min: 0 });
  const net = Math.max(0, money(p.basic + p.allowances + bonus - ded - p.leave_deduction));
  run('UPDATE payslips SET bonus = ?, deductions = ?, net = ? WHERE id = ?', bonus, ded, net, p.id); res.json({ ok: true, net });
}));
r.post('/payroll/runs/:id/finalize', hrStaff, ah((req, res) => {
  const run_ = get('SELECT * FROM payroll_runs WHERE id = ?', req.params.id); if (!run_) throw notFound();
  if (run_.status !== 'draft') throw conflict(`Run is already ${run_.status}`);
  tx(() => { run("UPDATE payroll_runs SET status = 'finalized' WHERE id = ?", run_.id); run("UPDATE payslips SET status = 'finalized' WHERE run_id = ?", run_.id); });
  audit(req, 'finalize_payroll', 'payroll_run', run_.id); res.json({ ok: true });
}));
r.post('/payroll/runs/:id/pay', requireRole('admin', 'finance'), ah((req, res) => {
  const run_ = get('SELECT * FROM payroll_runs WHERE id = ?', req.params.id); if (!run_) throw notFound();
  if (run_.status !== 'finalized') throw conflict('Finalize the run before marking it paid');
  const total = tx(() => {
    run("UPDATE payroll_runs SET status = 'paid' WHERE id = ?", run_.id);
    run("UPDATE payslips SET status = 'paid', paid_on = date('now') WHERE run_id = ?", run_.id);
    const t = get('SELECT COALESCE(SUM(net),0) t FROM payslips WHERE run_id = ?', run_.id).t;
    run("INSERT INTO expenses(expense_date, category, vendor, description, amount, payment_status, added_by) VALUES (date('now'),'Payroll','Staff',?,?,'paid',?)", `Salaries for ${run_.month}`, Math.max(0.01, t), req.user.id);   // books itself into finance
    return t;
  });
  for (const x of all('SELECT e.user_id FROM payslips p JOIN employees e ON e.id = p.employee_id WHERE p.run_id = ? AND e.user_id IS NOT NULL', run_.id))
    notify(x.user_id, { title: 'Salary paid', body: `Your salary for ${run_.month} has been paid.`, kind: 'payroll', link: '/my/payslips', sms: true });
  audit(req, 'pay_payroll', 'payroll_run', run_.id, { total }); res.json({ ok: true, total: money(total) });
}));

// my payslips (any employee login: teacher, driver, finance)
r.get('/my/payslips', ah((req, res) => {
  const emp = employeeOfUser(req.user.id);
  res.json({ employee: emp, rows: emp ? all(`${SLIP} WHERE p.employee_id = ? AND r.status IN ('finalized','paid') ORDER BY r.month DESC`, emp.id) : [] });
}));
r.get('/my/profile', ah((req, res) => res.json({ employee: employeeOfUser(req.user.id) })));

export default r;
