import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, all, run, tx } from '../db/index.js';
import { ah, bad, notFound, conflict, str, mobile as vMobile, oneOf, int, paginate } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notify } from '../utils/notify.js';
import { ensureEmployee } from '../utils/hr.js';
import { tempPassword, publicUser } from './auth.js';

const r = Router();
r.use(authenticate);

// Lightweight directory (teachers) used by dropdowns
r.get('/directory/teachers', requireRole('admin', 'teacher', 'finance'), ah((_req, res) => {
  res.json({ rows: all("SELECT id, name, mobile FROM users WHERE role = 'teacher' AND status = 'active' ORDER BY name") });
}));

r.use(requireRole('admin'));

r.get('/', ah((req, res) => {
  const { limit, offset } = paginate(req);
  const where = []; const p = [];
  if (req.query.role) { where.push('role = ?'); p.push(req.query.role); }
  if (req.query.status) { where.push('status = ?'); p.push(req.query.status); }
  if (req.query.q) { where.push('(name LIKE ? OR email LIKE ? OR mobile LIKE ?)'); const l = `%${req.query.q}%`; p.push(l, l, l); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = all(`SELECT id, name, email, mobile, role, status, meta, last_login_at, created_at FROM users ${w} ORDER BY
    CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC LIMIT ? OFFSET ?`, ...p, limit, offset);
  const total = get(`SELECT COUNT(*) n FROM users ${w}`, ...p).n;
  res.json({ rows: rows.map((u) => ({ ...u, meta: u.meta ? JSON.parse(u.meta) : null })), total });
}));

r.post('/', ah((req, res) => {
  const b = req.body;
  const role = oneOf(b.role, ['admin', 'teacher', 'finance', 'parent', 'driver'], 'role');
  const name = str(b.name, 'Name', { max: 100 });
  const email = str(b.email, 'Email', { required: false, max: 120 });
  const mob = vMobile(b.mobile, 'mobile', { required: !email });
  const pwd = b.password ? str(b.password, 'Password', { min: 8 }) : tempPassword();
  const id = tx(() => {
    const info = run(
      "INSERT INTO users(name, email, mobile, password_hash, role, status, must_change_password, created_by) VALUES (?,?,?,?,?, 'active', 1, ?)",
      name, email, mob, bcrypt.hashSync(pwd, 10), role, req.user.id,
    );
    ensureEmployee({ id: info.lastInsertRowid, name, mobile: mob, role });
    return info.lastInsertRowid;
  });
  audit(req, 'create_user', 'user', id, { role });
  res.status(201).json({ id, temp_password: b.password ? undefined : pwd, message: 'Account created and active.' });
}));

r.put('/:id', ah((req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) throw notFound('User not found');
  const name = str(req.body.name ?? u.name, 'Name', { max: 100 });
  const email = str(req.body.email ?? u.email, 'Email', { required: false, max: 120 });
  const mob = vMobile(req.body.mobile ?? u.mobile, 'mobile', { required: !email });
  run('UPDATE users SET name = ?, email = ?, mobile = ? WHERE id = ?', name, email, mob, u.id);
  run('UPDATE employees SET name = ?, mobile = ? WHERE user_id = ?', name, mob, u.id);
  audit(req, 'update_user', 'user', u.id);
  res.json({ ok: true });
}));

r.post('/:id/approve', ah((req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) throw notFound('User not found');
  if (u.status === 'active') throw conflict('Already active');
  const linked = tx(() => {
    run("UPDATE users SET status = 'active' WHERE id = ?", u.id);
    ensureEmployee(u);
    let n = 0;
    if (u.role === 'parent' && u.meta) {
      for (const c of JSON.parse(u.meta)) {
        const s = get('SELECT id FROM students WHERE admission_no = ? COLLATE NOCASE', c.admission_no);
        if (s) { run('INSERT OR IGNORE INTO parent_students(parent_user_id, student_id, relation) VALUES (?,?,?)', u.id, s.id, c.relation || 'guardian'); n++; }
      }
    }
    return n;
  });
  notify(u.id, { title: 'Account approved', body: 'Welcome! Your account is now active.', kind: 'approval', sms: true });
  audit(req, 'approve_user', 'user', u.id);
  res.json({ ok: true, children_linked: linked });
}));

r.post('/:id/reject', ah((req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) throw notFound('User not found');
  run("UPDATE users SET status = 'rejected' WHERE id = ?", u.id);
  audit(req, 'reject_user', 'user', u.id, { reason: req.body.reason });
  res.json({ ok: true });
}));

r.post('/:id/deactivate', ah((req, res) => {
  if (Number(req.params.id) === req.user.id) throw bad('You cannot deactivate your own account');
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) throw notFound('User not found');
  run("UPDATE users SET status = 'inactive' WHERE id = ?", u.id);   // authenticate() re-checks status on every request, so the lock-out is immediate
  audit(req, 'deactivate_user', 'user', u.id);
  res.json({ ok: true });
}));

r.post('/:id/activate', ah((req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) throw notFound('User not found');
  const stu = get("SELECT status FROM students WHERE user_id = ?", u.id);
  if (stu && stu.status === 'inactive') throw conflict('Reactivate the student record instead');
  run("UPDATE users SET status = 'active' WHERE id = ?", u.id);
  ensureEmployee(u);
  audit(req, 'activate_user', 'user', u.id);
  res.json({ ok: true });
}));

r.post('/:id/reset-password', ah((req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) throw notFound('User not found');
  const pwd = tempPassword();
  run('UPDATE users SET password_hash = ?, must_change_password = 1, token_version = token_version + 1 WHERE id = ?', bcrypt.hashSync(pwd, 10), u.id);
  audit(req, 'reset_password', 'user', u.id);
  res.json({ temp_password: pwd });
}));

// parent <-> student links
r.get('/:id/children', ah((req, res) => {
  res.json({ rows: all(`SELECT s.id, s.name, s.admission_no, ps.relation, c.name || '-' || c.section AS class_name
    FROM parent_students ps JOIN students s ON s.id = ps.student_id LEFT JOIN classes c ON c.id = s.class_id
    WHERE ps.parent_user_id = ?`, req.params.id) });
}));
r.post('/:id/children', ah((req, res) => {
  const sid = int(req.body.student_id, 'student_id');
  const rel = str(req.body.relation, 'relation', { required: false, max: 20 }) || 'guardian';
  const u = get("SELECT id FROM users WHERE id = ? AND role = 'parent'", req.params.id);
  if (!u) throw notFound('Parent account not found');
  if (!get('SELECT id FROM students WHERE id = ?', sid)) throw notFound('Student not found');
  run('INSERT OR REPLACE INTO parent_students(parent_user_id, student_id, relation) VALUES (?,?,?)', u.id, sid, rel);
  audit(req, 'link_parent', 'student', sid, { parent: u.id });
  res.status(201).json({ ok: true });
}));
r.delete('/:id/children/:sid', ah((req, res) => {
  run('DELETE FROM parent_students WHERE parent_user_id = ? AND student_id = ?', req.params.id, req.params.sid);
  audit(req, 'unlink_parent', 'student', req.params.sid, { parent: req.params.id });
  res.json({ ok: true });
}));

export default r;
