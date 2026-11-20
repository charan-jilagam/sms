import { Router } from 'express';
import { get, all, run, tx } from '../db/index.js';
import { ah, bad, forbidden, date, today, addDays, int, oneOf } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notifyFamily } from '../utils/notify.js';
import { studentAccess, ownClassOrAdmin } from '../utils/access.js';
import { sendRows } from '../utils/csv.js';

const r = Router();
r.use(authenticate);

// Class roster for a date (CT / admin mark; subject teachers read-only)
r.get('/class/:classId', requireRole('admin', 'teacher'), ah((req, res) => {
  const level = ownClassOrAdmin(req.user, req.params.classId);
  const d = date(req.query.date || today(), 'date');
  const rows = all(`SELECT s.id AS student_id, s.name, s.roll_no, s.admission_no, a.status, a.note,
      EXISTS(SELECT 1 FROM leaves l WHERE l.student_id = s.id AND l.status = 'approved' AND ? BETWEEN l.from_date AND l.to_date) AS on_approved_leave
    FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.date = ?
    WHERE s.class_id = ? AND s.status = 'active' ORDER BY s.roll_no, s.name`, d, d, req.params.classId);
  res.json({ date: d, can_mark: level === 'admin' || level === 'ct', marked: rows.some((x) => x.status), rows });
}));

r.post('/class/:classId', requireRole('admin', 'teacher'), ah((req, res) => {
  const cid = int(req.params.classId, 'class');
  const level = ownClassOrAdmin(req.user, cid);
  if (level === 'teacher') throw forbidden('Only the class teacher can mark attendance for this class');
  const d = date(req.body.date, 'date');
  if (d > today()) throw bad('Cannot mark attendance for a future date');
  if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) throw bad('Sunday is not a school day');
  const records = Array.isArray(req.body.records) ? req.body.records : [];
  if (!records.length) throw bad('No records supplied');
  const valid = new Set(all("SELECT id FROM students WHERE class_id = ? AND status = 'active'", cid).map((x) => x.id));
  const newlyAbsent = [];
  tx(() => {
    for (const rec of records) {
      const sid = int(rec.student_id, 'student_id');
      if (!valid.has(sid)) throw bad(`Student ${sid} is not an active student of this class`);
      const st = oneOf(rec.status, ['P', 'A', 'L'], 'status');
      const prev = get('SELECT status FROM attendance WHERE student_id = ? AND date = ?', sid, d)?.status;
      run(`INSERT INTO attendance(student_id, class_id, date, status, note, marked_by) VALUES (?,?,?,?,?,?)
           ON CONFLICT(student_id, date) DO UPDATE SET status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, class_id = excluded.class_id`,
      sid, cid, d, st, rec.note ? String(rec.note).slice(0, 200) : null, req.user.id);
      if (st === 'A' && prev !== 'A') newlyAbsent.push(sid);
    }
  });
  for (const sid of newlyAbsent) {
    const s = get('SELECT name FROM students WHERE id = ?', sid);
    notifyFamily(sid, { title: 'Absent today', body: `${s.name} was marked absent on ${d}.`, kind: 'attendance', link: '/attendance', sms: true });
  }
  audit(req, 'mark_attendance', 'class', cid, { date: d, count: records.length });
  res.json({ ok: true, saved: records.length, absent_alerts: newlyAbsent.length });
}));

// A student's attendance - defaults to the last 3 months
r.get('/student/:id', ah((req, res) => {
  const { student } = studentAccess(req.user, req.params.id);
  const to = date(req.query.to || today(), 'to');
  const from = date(req.query.from || addDays(to, -92), 'from');
  const records = all('SELECT date, status, note FROM attendance WHERE student_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC', student.id, from, to);
  const summary = get(`SELECT COALESCE(SUM(status='P'),0) present, COALESCE(SUM(status='A'),0) absent, COALESCE(SUM(status='L'),0) on_leave, COUNT(*) total
     FROM attendance WHERE student_id = ? AND date BETWEEN ? AND ?`, student.id, from, to);
  const counted = summary.present + summary.absent;
  const monthly = all(`SELECT substr(date,1,7) month, SUM(status='P') present, SUM(status='A') absent, SUM(status='L') on_leave
     FROM attendance WHERE student_id = ? AND date BETWEEN ? AND ? GROUP BY 1 ORDER BY 1`, student.id, from, to);
  res.json({ from, to, summary: { ...summary, percent: counted ? Math.round((summary.present / counted) * 1000) / 10 : null }, monthly, records });
}));

// Per-student % for a class over a range (admin / teachers of the class)
r.get('/report', requireRole('admin', 'teacher'), ah((req, res) => {
  const cid = int(req.query.class_id, 'class_id');
  ownClassOrAdmin(req.user, cid);
  const to = date(req.query.to || today(), 'to');
  const from = date(req.query.from || addDays(to, -30), 'from');
  const rows = all(`SELECT s.id AS student_id, s.roll_no, s.admission_no, s.name,
      COALESCE(SUM(a.status='P'),0) AS present, COALESCE(SUM(a.status='A'),0) AS absent, COALESCE(SUM(a.status='L'),0) AS on_leave,
      CASE WHEN SUM(a.status IN ('P','A')) > 0 THEN ROUND(100.0 * SUM(a.status='P') / SUM(a.status IN ('P','A')), 1) END AS percent
    FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.date BETWEEN ? AND ?
    WHERE s.class_id = ? AND s.status = 'active' GROUP BY s.id ORDER BY s.roll_no, s.name`, from, to, cid);
  return sendRows(req, res, rows, `attendance-${cid}-${from}-${to}`);
}));

export default r;
