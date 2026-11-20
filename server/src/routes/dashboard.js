import { Router } from 'express';
import { get, all } from '../db/index.js';
import { ah, today, addDays, money } from '../utils/http.js';
import { authenticate } from '../middleware/auth.js';
import { teacherClasses, childIds, driverVehicle } from '../utils/access.js';
import { employeeOfUser } from '../utils/hr.js';

const r = Router();
r.use(authenticate);
const sum = (sql, ...p) => money(get(sql, ...p).t || 0);
const upcoming = (where = '', ...p) => all(`SELECT id, kind, title, start_date, end_date FROM announcements WHERE kind IN ('event','holiday') AND COALESCE(end_date, start_date) >= date('now') ${where} ORDER BY start_date LIMIT 5`, ...p);

r.get('/', ah((req, res) => {
  const { role, id } = req.user; const t = today(); const month = t.slice(0, 7);
  const unread = get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', id).n;
  const base = { role, unread };

  if (role === 'admin') {
    const att7 = [...Array(7)].map((_, i) => addDays(t, i - 6)).map((d) => {
      const x = get("SELECT COALESCE(SUM(status='P'),0) p, COUNT(*) n FROM attendance WHERE date = ? AND status IN ('P','A')", d);
      return { date: d, percent: x.n ? Math.round((x.p / x.n) * 1000) / 10 : null };
    });
    const months = [...Array(6)].map((_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (5 - i)); return d.toISOString().slice(0, 7); });
    return res.json({ ...base,
      counts: {
        students: get("SELECT COUNT(*) n FROM students WHERE status='active'").n, inactive_students: get("SELECT COUNT(*) n FROM students WHERE status='inactive'").n,
        teachers: get("SELECT COUNT(*) n FROM users WHERE role='teacher' AND status='active'").n, parents: get("SELECT COUNT(*) n FROM users WHERE role='parent' AND status='active'").n,
        drivers: get("SELECT COUNT(*) n FROM users WHERE role='driver' AND status='active'").n, classes: get('SELECT COUNT(*) n FROM classes').n,
      },
      pending: {
        approvals: get("SELECT COUNT(*) n FROM users WHERE status='pending'").n, leaves: get("SELECT COUNT(*) n FROM leaves WHERE status='pending'").n,
        staff_leaves: get("SELECT COUNT(*) n FROM staff_leaves WHERE status='pending'").n, change_requests: get("SELECT COUNT(*) n FROM change_requests WHERE status='pending' AND approver_role='admin'").n,
        open_tickets: get("SELECT COUNT(*) n FROM tickets WHERE status IN ('open','in_progress')").n, deposits: get("SELECT COUNT(*) n FROM deposits WHERE status = 'slip_submitted'").n,
      },
      finance: {
        collected_month: sum("SELECT SUM(amount) t FROM payments WHERE status='success' AND substr(paid_at,1,7)=?", month),
        outstanding: sum("SELECT SUM(balance) t FROM v_invoice_balance WHERE status IN ('unpaid','partial')"),
        overdue: sum("SELECT SUM(balance) t FROM v_invoice_balance WHERE status IN ('unpaid','partial') AND due_date < date('now')"),
        expenses_month: sum('SELECT SUM(amount) t FROM expenses WHERE substr(expense_date,1,7)=?', month),
      },
      today_attendance: get("SELECT COALESCE(SUM(status='P'),0) present, COALESCE(SUM(status='A'),0) absent, COALESCE(SUM(status='L'),0) on_leave FROM attendance WHERE date = ?", t),
      classes_unmarked: all("SELECT c.name || '-' || c.section AS label FROM classes c WHERE EXISTS (SELECT 1 FROM students s WHERE s.class_id = c.id AND s.status='active') AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.class_id = c.id AND a.date = ?)", t).map((x) => x.label),
      attendance_trend: att7,
      collection_series: months.map((m) => ({ month: m, collected: sum("SELECT SUM(amount) t FROM payments WHERE status='success' AND substr(paid_at,1,7)=?", m), outstanding: sum("SELECT SUM(balance) t FROM v_invoice_balance WHERE status IN ('unpaid','partial') AND substr(due_date,1,7)=?", m) })),
      class_strength: all("SELECT c.name || '-' || c.section AS label, COUNT(s.id) AS value FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status='active' GROUP BY c.id ORDER BY c.name, c.section"),
      buses_running: get("SELECT COUNT(*) n FROM trips WHERE status='running'").n, upcoming: upcoming(),
    });
  }

  if (role === 'finance') {
    const months = [...Array(6)].map((_, i) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - (5 - i)); return d.toISOString().slice(0, 7); });
    return res.json({ ...base,
      collected_today: sum("SELECT SUM(amount) t FROM payments WHERE status='success' AND date(paid_at)=date('now')"),
      collected_month: sum("SELECT SUM(amount) t FROM payments WHERE status='success' AND substr(paid_at,1,7)=?", month),
      outstanding: sum("SELECT SUM(balance) t FROM v_invoice_balance WHERE status IN ('unpaid','partial')"),
      overdue: sum("SELECT SUM(balance) t FROM v_invoice_balance WHERE status IN ('unpaid','partial') AND due_date < date('now')"),
      expenses_month: sum('SELECT SUM(amount) t FROM expenses WHERE substr(expense_date,1,7)=?', month),
      undeposited_cash: sum("SELECT SUM(amount) t FROM payments WHERE status='success' AND method='cash' AND deposit_id IS NULL"),
      pending_deposits: get("SELECT COUNT(*) n FROM deposits WHERE status <> 'verified'").n,
      overdue_students: get("SELECT COUNT(DISTINCT student_id) n FROM v_invoice_balance WHERE status IN ('unpaid','partial') AND due_date < date('now')").n,
      series: months.map((m) => ({ month: m, collected: sum("SELECT SUM(amount) t FROM payments WHERE status='success' AND substr(paid_at,1,7)=?", m), expenses: sum('SELECT SUM(amount) t FROM expenses WHERE substr(expense_date,1,7)=?', m) })),
      recent_payments: all("SELECT p.receipt_no, p.amount, p.method, p.paid_at, s.name AS student FROM payments p JOIN students s ON s.id = p.student_id WHERE p.status='success' ORDER BY p.id DESC LIMIT 6"),
    });
  }

  if (role === 'teacher') {
    const mine = teacherClasses(id);
    const classes = mine.all.length ? all(`SELECT c.id, c.name || '-' || c.section AS label, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status='active') AS students,
       EXISTS(SELECT 1 FROM attendance a WHERE a.class_id = c.id AND a.date = ?) AS attendance_marked FROM classes c WHERE c.id IN (${mine.all.map(() => '?').join(',')})`, t, ...mine.all).map((c) => ({ ...c, is_ct: mine.ct.includes(c.id) })) : [];
    const dow = new Date().getUTCDay();
    const today_tt = dow >= 1 && dow <= 6 ? all(`SELECT p.name AS period, p.start_time, p.end_time, s.name AS subject, c.name || '-' || c.section AS class_label FROM timetable t JOIN periods p ON p.id = t.period_id
       JOIN subjects s ON s.id = t.subject_id JOIN classes c ON c.id = t.class_id WHERE t.teacher_id = ? AND t.day = ? ORDER BY p.seq`, id, dow) : [];
    const ct = mine.ct; const inCt = ct.map(() => '?').join(',') || 'NULL';
    return res.json({ ...base, classes, today_timetable: today_tt,
      pending: {
        leaves: get(`SELECT COUNT(*) n FROM leaves l JOIN students s ON s.id = l.student_id WHERE l.status='pending' AND (l.routed_to = ? OR s.class_id IN (${inCt}))`, id, ...ct).n,
        change_requests: get(`SELECT COUNT(*) n FROM change_requests c JOIN students s ON s.id = c.student_id WHERE c.status='pending' AND c.approver_role='teacher' AND (c.routed_to = ? OR s.class_id IN (${inCt}))`, id, ...ct).n,
        tickets: get(`SELECT COUNT(*) n FROM tickets t WHERE t.status IN ('open','in_progress') AND (t.assigned_to = ? OR t.student_id IN (SELECT id FROM students WHERE class_id IN (${inCt})))`, id, ...ct).n,
      },
      absent_today: ct.length ? all(`SELECT s.id, s.name, c.name || '-' || c.section AS class_label FROM attendance a JOIN students s ON s.id = a.student_id JOIN classes c ON c.id = a.class_id WHERE a.date = ? AND a.status = 'A' AND a.class_id IN (${inCt})`, t, ...ct) : [],
      upcoming: upcoming() });
  }

  if (role === 'parent' || role === 'student') {
    const kids = childIds(req.user);
    const children = kids.map((sid) => {
      const s = get(`SELECT s.id, s.name, s.admission_no, s.status, s.class_id, c.name || '-' || c.section AS class_label FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = ?`, sid);
      const a = get("SELECT COALESCE(SUM(status='P'),0) p, COALESCE(SUM(status='A'),0) a FROM attendance WHERE student_id = ? AND date >= ?", sid, addDays(t, -92));
      const due = get("SELECT COALESCE(SUM(balance),0) bal, COUNT(*) n, MIN(due_date) next_due FROM v_invoice_balance WHERE student_id = ? AND status IN ('unpaid','partial')", sid);
      const overdue = get("SELECT COUNT(*) n FROM v_invoice_balance WHERE student_id = ? AND status IN ('unpaid','partial') AND due_date < date('now')", sid).n;
      const exam = get(`SELECT e.name, ROUND(100.0 * SUM(m.marks) / (COUNT(m.id) * e.max_marks), 1) AS percent FROM exams e JOIN marks m ON m.exam_id = e.id WHERE e.published = 1 AND m.student_id = ? GROUP BY e.id ORDER BY e.start_date DESC, e.id DESC LIMIT 1`, sid);
      const bus = get('SELECT r.name FROM student_transport st JOIN routes r ON r.id = st.route_id WHERE st.student_id = ?', sid);
      const live = bus ? get("SELECT COUNT(*) n FROM trips t JOIN routes r ON r.id = t.route_id JOIN student_transport st ON st.route_id = r.id WHERE st.student_id = ? AND t.status='running'", sid).n : 0;
      return { ...s, attendance_percent: a.p + a.a ? Math.round((a.p / (a.p + a.a)) * 1000) / 10 : null, fees_due: money(due.bal), invoices_due: due.n, next_due: due.next_due, overdue_invoices: overdue, last_exam: exam || null, bus_route: bus?.name || null, bus_running: !!live,
        diary: s.class_id ? all("SELECT d.title, d.date, d.homework_due, sub.name AS subject FROM diary d LEFT JOIN subjects sub ON sub.id = d.subject_id WHERE d.class_id = ? ORDER BY d.date DESC, d.id DESC LIMIT 3", s.class_id) : [],
        pending_leaves: get("SELECT COUNT(*) n FROM leaves WHERE student_id = ? AND status='pending'", sid).n };
    });
    return res.json({ ...base, children, upcoming: upcoming(), notices: all("SELECT id, title, kind, start_date FROM announcements WHERE kind IN ('notice','circular') AND audience IN ('all', ?) ORDER BY pinned DESC, id DESC LIMIT 4", role === 'parent' ? 'parents' : 'students') });
  }

  if (role === 'driver') {
    const emp = employeeOfUser(id); const v = driverVehicle(id);
    const route = v ? get('SELECT * FROM routes WHERE vehicle_id = ?', v.id) : null;
    return res.json({ ...base, employee: emp, vehicle: v, route, riders: route ? get('SELECT COUNT(*) n FROM student_transport WHERE route_id = ?', route.id).n : 0,
      trip: v ? get("SELECT * FROM trips WHERE vehicle_id = ? AND status='running'", v.id) : null,
      latest_payslip: emp ? get("SELECT p.net, r.month, p.status FROM payslips p JOIN payroll_runs r ON r.id = p.run_id WHERE p.employee_id = ? AND r.status IN ('finalized','paid') ORDER BY r.month DESC LIMIT 1", emp.id) : null });
  }
  res.json(base);
}));

export default r;
