import { Router } from 'express';
import { get, all, run, tx } from '../db/index.js';
import { ah, bad, notFound, forbidden, conflict, str, int, date, oneOf, mobile as vMobile, today, addDays } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notify, notifyAdmins, notifyFamily, classTeacherOf } from '../utils/notify.js';
import { studentAccess, canManage, teacherClasses, childIds } from '../utils/access.js';

const r = Router();
r.use(authenticate);

// ======================================================================= STUDENT LEAVE  (Parent -> Class Teacher)
const LEAVE = `SELECT l.*, s.name AS student_name, s.admission_no, c.name || '-' || c.section AS class_label,
   ru.name AS requested_by_name, ct.name AS routed_to_name, du.name AS decided_by_name
   FROM leaves l JOIN students s ON s.id = l.student_id LEFT JOIN classes c ON c.id = s.class_id
   LEFT JOIN users ru ON ru.id = l.requested_by LEFT JOIN users ct ON ct.id = l.routed_to LEFT JOIN users du ON du.id = l.decided_by`;

r.get('/leaves', ah((req, res) => {
  const where = []; const p = [];
  const { role, id } = req.user;
  if (role === 'parent' || role === 'student') {
    const kids = childIds(req.user); where.push(`l.student_id IN (${kids.map(() => '?').join(',') || 'NULL'})`); p.push(...kids);
  } else if (role === 'teacher') {
    const ct = teacherClasses(id).ct; where.push(`(l.routed_to = ? OR s.class_id IN (${ct.map(() => '?').join(',') || 'NULL'}))`); p.push(id, ...ct);
  } else if (role !== 'admin') throw forbidden();
  if (req.query.status) { where.push('l.status = ?'); p.push(req.query.status); }
  if (req.query.student_id) { where.push('l.student_id = ?'); p.push(Number(req.query.student_id)); }
  res.json({ rows: all(`${LEAVE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE l.status WHEN 'pending' THEN 0 ELSE 1 END, l.id DESC LIMIT 300`, ...p) });
}));

r.post('/leaves', ah((req, res) => {
  const sid = int(req.body.student_id, 'student');
  const { student, level } = studentAccess(req.user, sid);
  if (!(level === 'family' || canManage(level))) throw forbidden();
  if (student.status !== 'active') throw bad('This student is inactive');
  const from = date(req.body.from_date, 'From date'), to = date(req.body.to_date, 'To date');
  if (to < from) throw bad('To date must be on or after From date');
  if (from < addDays(today(), -7)) throw bad('Leave cannot start more than 7 days in the past');
  if (get(`SELECT 1 x FROM leaves WHERE student_id = ? AND status IN ('pending','approved') AND from_date <= ? AND to_date >= ?`, sid, to, from)) throw conflict('A leave request already covers some of these dates');
  const ct = student.class_id ? classTeacherOf(student.class_id) : null;
  const reason = str(req.body.reason, 'Reason', { max: 300, min: 3 });
  const id = run('INSERT INTO leaves(student_id, requested_by, from_date, to_date, reason, routed_to) VALUES (?,?,?,?,?,?)', sid, req.user.id, from, to, reason, ct).lastInsertRowid;
  if (ct) notify(ct, { title: 'New leave request', body: `${student.name}: ${from} to ${to} - ${reason}`, kind: 'leave', link: '/leaves' });
  else notifyAdmins({ title: 'Leave request (no class teacher assigned)', body: `${student.name}: ${from} to ${to}`, kind: 'leave', link: '/leaves' });
  audit(req, 'request_leave', 'leave', id); res.status(201).json({ id, routed_to: ct });
}));

r.post('/leaves/:id/decide', requireRole('admin', 'teacher'), ah((req, res) => {
  const l = get('SELECT * FROM leaves WHERE id = ?', req.params.id); if (!l) throw notFound();
  const { student, level } = studentAccess(req.user, l.student_id);
  if (!canManage(level)) throw forbidden('Only the class teacher or admin can decide leave requests');
  if (l.status !== 'pending') throw conflict(`Already ${l.status}`);
  const decision = oneOf(req.body.decision, ['approved', 'rejected'], 'decision');
  tx(() => {
    run("UPDATE leaves SET status = ?, decided_by = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?", decision, req.user.id, str(req.body.note, 'note', { required: false, max: 200 }), l.id);
    if (decision === 'approved') { // reflect approved leave in the attendance register (never overwrites a real mark)
      for (let d = l.from_date; d <= l.to_date; d = addDays(d, 1)) {
        if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) continue;
        run("INSERT OR IGNORE INTO attendance(student_id, class_id, date, status, note, marked_by) VALUES (?,?,?,'L','Approved leave',?)", student.id, student.class_id, d, req.user.id);
      }
    }
  });
  notifyFamily(student.id, { title: `Leave ${decision}`, body: `${l.from_date} to ${l.to_date}${req.body.note ? ' - ' + req.body.note : ''}`, kind: 'leave', link: '/leaves', sms: true });
  audit(req, `leave_${decision}`, 'leave', l.id); res.json({ ok: true });
}));

r.post('/leaves/:id/cancel', ah((req, res) => {
  const l = get('SELECT * FROM leaves WHERE id = ?', req.params.id); if (!l) throw notFound();
  if (l.requested_by !== req.user.id && req.user.role !== 'admin') throw forbidden();
  if (l.status !== 'pending') throw conflict('Only pending requests can be cancelled');
  run("UPDATE leaves SET status = 'cancelled' WHERE id = ?", l.id); res.json({ ok: true });
}));

// ======================================================================= CHANGE / MODIFICATION REQUESTS  (Parent -> CT / Admin)
const ADMIN_ONLY_FIELDS = new Set(['name', 'dob']);
const CR = `SELECT cr.*, s.name AS student_name, s.admission_no, c.name || '-' || c.section AS class_label, ru.name AS requested_by_name, du.name AS decided_by_name
  FROM change_requests cr JOIN students s ON s.id = cr.student_id LEFT JOIN classes c ON c.id = s.class_id
  LEFT JOIN users ru ON ru.id = cr.requested_by LEFT JOIN users du ON du.id = cr.decided_by`;

r.get('/change-requests', ah((req, res) => {
  const where = []; const p = [];
  const { role, id } = req.user;
  if (role === 'parent' || role === 'student') { const kids = childIds(req.user); where.push(`cr.student_id IN (${kids.map(() => '?').join(',') || 'NULL'})`); p.push(...kids); }
  else if (role === 'teacher') { const ct = teacherClasses(id).ct; where.push(`(cr.routed_to = ? OR s.class_id IN (${ct.map(() => '?').join(',') || 'NULL'}))`); p.push(id, ...ct); }
  else if (role !== 'admin') throw forbidden();
  if (req.query.status) { where.push('cr.status = ?'); p.push(req.query.status); }
  res.json({ rows: all(`${CR} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE cr.status WHEN 'pending' THEN 0 ELSE 1 END, cr.id DESC LIMIT 300`, ...p) });
}));

r.post('/change-requests', ah((req, res) => {
  const sid = int(req.body.student_id, 'student');
  const { student, level } = studentAccess(req.user, sid);
  if (level !== 'family') throw forbidden('Parents and students raise change requests');
  const field = oneOf(req.body.field, ['name', 'mobile', 'dob', 'address', 'guardian_name', 'blood_group'], 'field');
  let value = str(req.body.new_value, 'New value', { max: 300 });
  if (field === 'mobile') value = vMobile(value, 'New mobile');
  if (field === 'dob') value = date(value, 'New date of birth');
  if (value === String(student[field] ?? '')) throw bad('That is already the current value');
  if (get("SELECT 1 x FROM change_requests WHERE student_id = ? AND field = ? AND status = 'pending'", sid, field)) throw conflict('A pending request for this field already exists');
  const approverRole = ADMIN_ONLY_FIELDS.has(field) ? 'admin' : 'teacher';
  const ct = student.class_id ? classTeacherOf(student.class_id) : null;
  const routed = approverRole === 'teacher' ? ct : null;
  const id = run('INSERT INTO change_requests(student_id, requested_by, field, old_value, new_value, reason, approver_role, routed_to) VALUES (?,?,?,?,?,?,?,?)',
    sid, req.user.id, field, student[field] ?? null, value, str(req.body.reason, 'Reason', { required: false, max: 200 }), approverRole, routed).lastInsertRowid;
  const msg = { title: 'Student detail change request', body: `${student.name}: change ${field.replace('_', ' ')}`, kind: 'request', link: '/requests' };
  if (routed) notify(routed, msg); else notifyAdmins(msg);
  audit(req, 'request_change', 'change_request', id, { field }); res.status(201).json({ id, goes_to: routed ? 'class teacher' : 'admin' });
}));

r.post('/change-requests/:id/decide', requireRole('admin', 'teacher'), ah((req, res) => {
  const c = get('SELECT * FROM change_requests WHERE id = ?', req.params.id); if (!c) throw notFound();
  const { student, level } = studentAccess(req.user, c.student_id);
  if (!canManage(level)) throw forbidden();
  if (c.approver_role === 'admin' && req.user.role !== 'admin') throw forbidden('This change needs admin approval');
  if (c.status !== 'pending') throw conflict(`Already ${c.status}`);
  const decision = oneOf(req.body.decision, ['approved', 'rejected'], 'decision');
  tx(() => {
    if (decision === 'approved') {
      run(`UPDATE students SET ${c.field} = ? WHERE id = ?`, c.new_value, c.student_id); // field is whitelisted by CHECK + oneOf
      if (c.field === 'name' && student.user_id) run('UPDATE users SET name = ? WHERE id = ?', c.new_value, student.user_id);
    }
    run("UPDATE change_requests SET status = ?, decided_by = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?", decision, req.user.id, str(req.body.note, 'note', { required: false, max: 200 }), c.id);
  });
  notifyFamily(c.student_id, { title: `Change request ${decision}`, body: `${c.field.replace('_', ' ')}: ${c.new_value}`, kind: 'request', link: '/requests' });
  audit(req, `change_${decision}`, 'change_request', c.id, { field: c.field }); res.json({ ok: true });
}));

export default r;
