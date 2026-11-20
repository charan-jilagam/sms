import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, all, run, tx, nextSeq } from '../db/index.js';
import { ah, bad, notFound, forbidden, conflict, str, mobile as vMobile, oneOf, int, date, paginate } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notify, notifyAdmins, notifyFamily, classTeacherOf } from '../utils/notify.js';
import { studentAccess, canManage, visibleStudents } from '../utils/access.js';
import { tempPassword } from './auth.js';
import { sendRows } from '../utils/csv.js';

const r = Router();
r.use(authenticate);

const BASE = `SELECT s.id, s.admission_no, s.name, s.mobile, s.dob, s.gender, s.blood_group, s.address, s.guardian_name,
  s.class_id, s.roll_no, s.id_card_no, s.status, s.admitted_on, s.deactivation_reason, s.deactivated_role,
  c.name AS class_name, c.section AS section, c.name || '-' || c.section AS class_label
  FROM students s LEFT JOIN classes c ON c.id = s.class_id`;

function ftsQuery(q) {
  const toks = String(q).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return toks.length ? toks.map((t) => `"${t}"*`).join(' ') : null;
}

r.get('/', ah((req, res) => {
  const { limit, offset } = paginate(req, { max: 500 });
  const vis = visibleStudents(req.user);
  const where = [vis.sql]; const p = [...vis.params];
  if (req.query.class_id) { where.push('s.class_id = ?'); p.push(Number(req.query.class_id)); }
  if (req.query.status) { where.push('s.status = ?'); p.push(req.query.status); }
  if (req.query.q) {
    const m = ftsQuery(req.query.q);
    if (m) { where.push('s.id IN (SELECT rowid FROM students_fts WHERE students_fts MATCH ?)'); p.push(m); }
  }
  const w = `WHERE ${where.join(' AND ')}`;
  const rows = all(`${BASE} ${w} ORDER BY c.name, c.section, s.roll_no, s.name LIMIT ? OFFSET ?`, ...p, limit, offset);
  const total = get(`SELECT COUNT(*) n FROM students s ${w}`, ...p).n;
  if (req.query.format === 'csv') return sendRows(req, res, rows, 'students');
  res.json({ rows, total });
}));

// "Mobile + Name" natural key lookup
r.get('/lookup', requireRole('admin', 'teacher', 'finance'), ah((req, res) => {
  const mob = vMobile(req.query.mobile);
  const name = str(req.query.name, 'name', { required: false });
  const vis = visibleStudents(req.user);
  const rows = all(`${BASE} WHERE s.mobile = ? ${name ? 'AND s.name = ? COLLATE NOCASE' : ''} AND ${vis.sql}`,
    ...[mob, ...(name ? [name] : []), ...vis.params]);
  res.json({ rows });
}));

function studentPayload(b, existing = {}) {
  const v = {
    name: str(b.name ?? existing.name, 'Name', { max: 100 }),
    mobile: vMobile(b.mobile ?? existing.mobile),
    dob: date(b.dob ?? existing.dob, 'dob', { required: false }),
    gender: oneOf(b.gender ?? existing.gender, ['male', 'female', 'other'], 'gender', { required: false }),
    blood_group: str(b.blood_group ?? existing.blood_group, 'blood group', { required: false, max: 5 }),
    address: str(b.address ?? existing.address, 'address', { required: false, max: 300 }),
    guardian_name: str(b.guardian_name ?? existing.guardian_name, 'guardian name', { required: false, max: 100 }),
    class_id: int(b.class_id ?? existing.class_id, 'class', { required: false }),
    roll_no: int(b.roll_no ?? existing.roll_no, 'roll no', { required: false, min: 1 }),
  };
  if (v.class_id && !get('SELECT id FROM classes WHERE id = ?', v.class_id)) throw bad('Class does not exist');
  return v;
}

r.post('/', requireRole('admin'), ah((req, res) => {
  const v = studentPayload(req.body);
  const out = tx(() => {
    const adm = str(req.body.admission_no, 'admission no', { required: false, max: 30 })
      || nextSeq('admission', `ADM${new Date().getFullYear()}`, 4);
    const idCard = nextSeq('idcard', `ID${new Date().getFullYear()}`, 4);
    let userId = null; let studentCred = null;
    if (req.body.create_login !== false) {
      const pwd = tempPassword();
      const info = run("INSERT INTO users(name, email, password_hash, role, status, must_change_password, created_by) VALUES (?,?,?,?, 'active', 1, ?)",
        v.name, `${adm.toLowerCase()}@students.local`, bcrypt.hashSync(pwd, 10), 'student', req.user.id);
      userId = info.lastInsertRowid; studentCred = { login: adm, temp_password: pwd };
    }
    const info = run(`INSERT INTO students(admission_no, name, mobile, dob, gender, blood_group, address, guardian_name, class_id, roll_no, user_id, id_card_no, admitted_on)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?, COALESCE(?, date('now')))`,
      adm, v.name, v.mobile, v.dob, v.gender, v.blood_group, v.address, v.guardian_name, v.class_id, v.roll_no, userId, idCard,
      date(req.body.admitted_on, 'admitted_on', { required: false }));
    const sid = info.lastInsertRowid;
    let parentCred = null;
    if (req.body.create_parent) {
      const ex = get("SELECT id FROM users WHERE mobile = ? AND role = 'parent'", v.mobile);
      let pid = ex?.id;
      if (!pid) {
        const pwd = tempPassword();
        pid = run("INSERT INTO users(name, mobile, password_hash, role, status, must_change_password, created_by) VALUES (?,?,?, 'parent', 'active', 1, ?)",
          v.guardian_name || `Parent of ${v.name}`, v.mobile, bcrypt.hashSync(pwd, 10), req.user.id).lastInsertRowid;
        parentCred = { login: v.mobile, temp_password: pwd };
      }
      run('INSERT OR IGNORE INTO parent_students(parent_user_id, student_id, relation) VALUES (?,?,?)', pid, sid, str(req.body.relation, 'relation', { required: false }) || 'guardian');
    }
    return { id: sid, admission_no: adm, id_card_no: idCard, student_login: studentCred, parent_login: parentCred };
  });
  audit(req, 'create_student', 'student', out.id);
  res.status(201).json(out);
}));

r.get('/:id', ah((req, res) => {
  const { student, level } = studentAccess(req.user, req.params.id);
  const row = get(`${BASE} WHERE s.id = ?`, student.id);
  const parents = level === 'family' && req.user.role === 'student' ? [] : all(`SELECT u.id, u.name, u.mobile, u.email, ps.relation FROM parent_students ps
     JOIN users u ON u.id = ps.parent_user_id WHERE ps.student_id = ?`, student.id);
  const ct = row.class_id ? get('SELECT u.id, u.name, u.mobile FROM classes c JOIN users u ON u.id = c.class_teacher_id WHERE c.id = ?', row.class_id) : null;
  const transport = get(`SELECT r.id route_id, r.name route_name, r.via, rs.name stop_name, rs.pickup_time
     FROM student_transport st JOIN routes r ON r.id = st.route_id LEFT JOIN route_stops rs ON rs.id = st.stop_id WHERE st.student_id = ?`, student.id);
  res.json({ ...row, level, parents, class_teacher: ct, transport });
}));

r.put('/:id', ah((req, res) => {
  const { student, level } = studentAccess(req.user, req.params.id);
  if (!canManage(level)) throw forbidden();
  if (level === 'ct') { // class teachers may fix soft details only; identity changes go through the request workflow
    const b = req.body;
    run('UPDATE students SET address = ?, guardian_name = ?, blood_group = ?, roll_no = ? WHERE id = ?',
      str(b.address ?? student.address, 'address', { required: false, max: 300 }),
      str(b.guardian_name ?? student.guardian_name, 'guardian name', { required: false, max: 100 }),
      str(b.blood_group ?? student.blood_group, 'blood group', { required: false, max: 5 }),
      int(b.roll_no ?? student.roll_no, 'roll no', { required: false, min: 1 }), student.id);
  } else {
    const v = studentPayload(req.body, student);
    run(`UPDATE students SET name=?, mobile=?, dob=?, gender=?, blood_group=?, address=?, guardian_name=?, class_id=?, roll_no=? WHERE id=?`,
      v.name, v.mobile, v.dob, v.gender, v.blood_group, v.address, v.guardian_name, v.class_id, v.roll_no, student.id);
    if (student.user_id && v.name !== student.name) run('UPDATE users SET name = ? WHERE id = ?', v.name, student.user_id);
  }
  audit(req, 'update_student', 'student', student.id);
  res.json({ ok: true });
}));

// ---------------------------------------------------- deactivate / reactivate (Admin <-> CT)
r.post('/:id/deactivate', ah((req, res) => {
  const { student, level } = studentAccess(req.user, req.params.id);
  if (!canManage(level)) throw forbidden();
  if (student.status === 'inactive') throw conflict('Student is already inactive');
  const reason = str(req.body.reason, 'Reason', { max: 300, min: 3 });
  tx(() => {
    run(`UPDATE students SET status='inactive', deactivated_by=?, deactivated_role=?, deactivation_reason=?, deactivated_at=datetime('now') WHERE id=?`,
      req.user.id, req.user.role === 'admin' ? 'admin' : 'teacher', reason, student.id);
    if (student.user_id) run("UPDATE users SET status='inactive' WHERE id = ?", student.user_id);
  });
  if (level === 'ct') notifyAdmins({ title: 'Student deactivated by class teacher', body: `${student.name} (${student.admission_no}) - ${reason}`, kind: 'student', link: '/students' });
  else { const ct = student.class_id ? classTeacherOf(student.class_id) : null; if (ct) notify(ct, { title: 'Student deactivated by admin', body: `${student.name} - ${reason}`, kind: 'student' }); }
  notifyFamily(student.id, { title: 'Student record deactivated', body: reason, kind: 'student' });
  audit(req, 'deactivate_student', 'student', student.id, { reason });
  res.json({ ok: true });
}));

r.post('/:id/activate', ah((req, res) => {
  const { student, level } = studentAccess(req.user, req.params.id);
  if (!canManage(level)) throw forbidden();
  if (student.status === 'active') throw conflict('Student is already active');
  // Admin decisions win: a class teacher may only undo a deactivation that was made by a class teacher.
  if (level === 'ct' && student.deactivated_role === 'admin') throw forbidden('This student was deactivated by the admin. Only the admin can reactivate.');
  tx(() => {
    run(`UPDATE students SET status='active', deactivated_by=NULL, deactivated_role=NULL, deactivation_reason=NULL, deactivated_at=NULL WHERE id=?`, student.id);
    if (student.user_id) run("UPDATE users SET status='active' WHERE id = ?", student.user_id);
  });
  if (level === 'ct') notifyAdmins({ title: 'Student reactivated by class teacher', body: `${student.name} (${student.admission_no})`, kind: 'student' });
  notifyFamily(student.id, { title: 'Student record reactivated', kind: 'student' });
  audit(req, 'activate_student', 'student', student.id);
  res.json({ ok: true });
}));

r.post('/:id/reset-login', requireRole('admin'), ah((req, res) => {
  const s = get('SELECT * FROM students WHERE id = ?', req.params.id);
  if (!s) throw notFound('Student not found');
  const pwd = tempPassword();
  if (s.user_id) {
    run('UPDATE users SET password_hash=?, must_change_password=1, token_version = token_version + 1 WHERE id=?', bcrypt.hashSync(pwd, 10), s.user_id);
  } else {
    const uid = run("INSERT INTO users(name, email, password_hash, role, status, must_change_password, created_by) VALUES (?,?,?,'student','active',1,?)",
      s.name, `${s.admission_no.toLowerCase()}@students.local`, bcrypt.hashSync(pwd, 10), req.user.id).lastInsertRowid;
    run('UPDATE students SET user_id = ? WHERE id = ?', uid, s.id);
  }
  audit(req, 'reset_student_login', 'student', s.id);
  res.json({ login: s.admission_no, temp_password: pwd });
}));

// ------------------------------------------------------------------------- ID card
r.get('/:id/idcard', ah((req, res) => {
  const { student } = studentAccess(req.user, req.params.id);
  const tplId = req.query.template_id;
  const template = (tplId ? get('SELECT * FROM id_templates WHERE id = ?', tplId) : null)
    || get('SELECT * FROM id_templates WHERE is_default = 1') || get('SELECT * FROM id_templates LIMIT 1');
  const full = get(`${BASE} WHERE s.id = ?`, student.id);
  const school = Object.fromEntries(all("SELECT key, value FROM settings WHERE key IN ('school_name','school_address','school_phone')").map((x) => [x.key, x.value]));
  res.json({ student: full, template, school, qr: `SMS|${full.id_card_no}|${full.admission_no}|${full.mobile}` });
}));

export default r;
