import { Router } from 'express';
import { get, all, run, tx, nextSeq } from '../db/index.js';
import { ah, bad, notFound, forbidden, conflict, str, int, date, oneOf, flag, today, addDays } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notify, notifyAdmins, parentIdsOf, classTeacherOf } from '../utils/notify.js';
import { childIds, teacherClasses, studentAccess, ownClassOrAdmin } from '../utils/access.js';

const r = Router();
r.use(authenticate);

/** class ids a user belongs to (for audience filtering) */
function myClassIds(user) {
  if (user.role === 'teacher') return teacherClasses(user.id).all;
  if (user.role === 'parent' || user.role === 'student') {
    const kids = childIds(user);
    return all(`SELECT DISTINCT class_id FROM students WHERE class_id IS NOT NULL AND id IN (${kids.map(() => '?').join(',') || 'NULL'})`, ...kids).map((x) => x.class_id);
  }
  return [];
}
const AUD = { admin: ['all', 'staff', 'parents', 'students', 'drivers', 'class'], teacher: ['all', 'staff', 'class'], finance: ['all', 'staff'], parent: ['all', 'parents'], student: ['all', 'students'], driver: ['all', 'drivers', 'staff'] };

// ================================================================== NOTICES / EVENTS / HOLIDAYS
const ANN = `SELECT a.*, u.name AS author, c.name || '-' || c.section AS class_label FROM announcements a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN classes c ON c.id = a.class_id`;

r.get('/announcements', ah((req, res) => {
  const where = []; const p = [];
  if (req.user.role !== 'admin') {
    const aud = AUD[req.user.role].filter((x) => x !== 'class');
    const cls = myClassIds(req.user);
    where.push(`(a.audience IN (${aud.map(() => '?').join(',')}) OR (a.audience = 'class' AND a.class_id IN (${cls.map(() => '?').join(',') || 'NULL'})))`); p.push(...aud, ...cls);
  }
  if (req.query.kind) { where.push('a.kind = ?'); p.push(req.query.kind); }
  if (req.query.active === '1') { where.push("COALESCE(a.end_date, a.start_date) >= date('now')"); }
  res.json({ rows: all(`${ANN} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.pinned DESC, a.start_date DESC, a.id DESC LIMIT 200`, ...p) });
}));

r.get('/calendar', ah((req, res) => {
  const month = String(req.query.month || today().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) throw bad('month must be YYYY-MM');
  const first = `${month}-01`, last = addDays(`${new Date(Date.UTC(+month.slice(0, 4), +month.slice(5), 1)).toISOString().slice(0, 7)}-01`, -1);
  const where = ["a.kind IN ('event','holiday')", 'a.start_date <= ?', 'COALESCE(a.end_date, a.start_date) >= ?']; const p = [last, first];
  if (req.user.role !== 'admin') {
    const aud = AUD[req.user.role].filter((x) => x !== 'class'); const cls = myClassIds(req.user);
    where.push(`(a.audience IN (${aud.map(() => '?').join(',')}) OR (a.audience = 'class' AND a.class_id IN (${cls.map(() => '?').join(',') || 'NULL'})))`); p.push(...aud, ...cls);
  }
  res.json({ month, rows: all(`${ANN} WHERE ${where.join(' AND ')} ORDER BY a.start_date`, ...p) });
}));

r.post('/announcements', requireRole('admin', 'teacher'), ah((req, res) => {
  const b = req.body;
  const kind = oneOf(b.kind || 'notice', ['notice', 'event', 'holiday', 'circular'], 'kind');
  let audience = oneOf(b.audience || 'all', ['all', 'parents', 'students', 'staff', 'drivers', 'class'], 'audience');
  let classId = int(b.class_id || null, 'class', { required: false });
  if (req.user.role === 'teacher') {          // class teachers post to their own class only
    audience = 'class'; if (!classId) throw bad('Choose a class');
    if (ownClassOrAdmin(req.user, classId) === 'teacher') throw forbidden('Only the class teacher can post to the class');
  }
  if (audience === 'class' && !classId) throw bad('Choose a class');
  const start = date(b.start_date || today(), 'start date'), end = date(b.end_date || null, 'end date', { required: false });
  if (end && end < start) throw bad('End date must be after start date');
  const title = str(b.title, 'Title', { max: 120 });
  const id = run(`INSERT INTO announcements(kind, title, body, start_date, end_date, audience, class_id, pinned, created_by) VALUES (?,?,?,?,?,?,?,?,?)`,
    kind, title, str(b.body, 'Details', { required: false, max: 2000 }), start, end, audience, audience === 'class' ? classId : null, flag(b.pinned), req.user.id).lastInsertRowid;
  // fan-out notifications
  let ids = [];
  if (audience === 'all') ids = all("SELECT id FROM users WHERE status = 'active' AND id <> ?", req.user.id).map((x) => x.id);
  else if (audience === 'class') {
    const kids = all("SELECT id, user_id FROM students WHERE class_id = ? AND status = 'active'", classId);
    ids = [...kids.flatMap((k) => parentIdsOf(k.id)), ...kids.map((k) => k.user_id)];
  } else {
    const roles = { parents: ['parent'], students: ['student'], staff: ['teacher', 'finance', 'admin', 'driver'], drivers: ['driver'] }[audience];
    ids = all(`SELECT id FROM users WHERE status = 'active' AND role IN (${roles.map(() => '?').join(',')})`, ...roles).map((x) => x.id);
  }
  notify(ids, { title: `${{ notice: 'Notice', event: 'Event', holiday: 'Holiday', circular: 'Circular' }[kind]}: ${title}`, body: b.body ? String(b.body).slice(0, 200) : null, kind: 'announcement', link: '/notices' });
  audit(req, 'post_announcement', 'announcement', id, { kind, audience }); res.status(201).json({ id, notified: new Set(ids.filter(Boolean)).size });
}));

r.delete('/announcements/:id', requireRole('admin', 'teacher'), ah((req, res) => {
  const a = get('SELECT * FROM announcements WHERE id = ?', req.params.id); if (!a) throw notFound();
  if (req.user.role !== 'admin' && a.created_by !== req.user.id) throw forbidden();
  run('DELETE FROM announcements WHERE id = ?', a.id); audit(req, 'delete_announcement', 'announcement', a.id); res.json({ ok: true });
}));

// ================================================================== BROADCAST (Admin/CT -> families, transport alerts)
r.post('/broadcast', requireRole('admin', 'teacher'), ah((req, res) => {
  const title = str(req.body.title, 'Title', { max: 120 }), body = str(req.body.body, 'Message', { required: false, max: 500 });
  const target = oneOf(req.body.target, ['class', 'route', 'all_parents', 'staff'], 'target');
  let ids = [];
  if (target === 'class') {
    const cid = int(req.body.class_id, 'class'); if (ownClassOrAdmin(req.user, cid) === 'teacher') throw forbidden();
    const kids = all("SELECT id, user_id FROM students WHERE class_id = ? AND status = 'active'", cid);
    ids = [...kids.flatMap((k) => parentIdsOf(k.id)), ...kids.map((k) => k.user_id)];
  } else if (req.user.role !== 'admin') throw forbidden('Only the admin can send this kind of broadcast');
  else if (target === 'route') {
    const rid = int(req.body.route_id, 'route');
    ids = all('SELECT student_id FROM student_transport WHERE route_id = ?', rid).flatMap((x) => parentIdsOf(x.student_id));
  } else if (target === 'all_parents') ids = all("SELECT id FROM users WHERE role = 'parent' AND status = 'active'").map((x) => x.id);
  else ids = all("SELECT id FROM users WHERE role IN ('teacher','finance','driver') AND status = 'active'").map((x) => x.id);
  const n = notify(ids, { title, body, kind: target === 'route' ? 'transport' : 'announcement', sms: flag(req.body.sms) === 1 });
  audit(req, 'broadcast', null, null, { target, recipients: n }); res.json({ sent: n });
}));

// ================================================================== DIARY
const DIARY = `SELECT d.*, s.name AS subject, u.name AS author, c.name || '-' || c.section AS class_label FROM diary d
  LEFT JOIN subjects s ON s.id = d.subject_id LEFT JOIN users u ON u.id = d.created_by JOIN classes c ON c.id = d.class_id`;
r.get('/diary', ah((req, res) => {
  const where = []; const p = [];
  if (req.user.role === 'admin') { if (req.query.class_id) { where.push('d.class_id = ?'); p.push(Number(req.query.class_id)); } }
  else if (['teacher', 'parent', 'student'].includes(req.user.role)) {
    const cls = myClassIds(req.user); where.push(`d.class_id IN (${cls.map(() => '?').join(',') || 'NULL'})`); p.push(...cls);
    if (req.query.class_id) { where.push('d.class_id = ?'); p.push(Number(req.query.class_id)); }
  } else throw forbidden();
  if (req.query.from) { where.push('d.date >= ?'); p.push(req.query.from); }
  if (req.query.to) { where.push('d.date <= ?'); p.push(req.query.to); }
  res.json({ rows: all(`${DIARY} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.date DESC, d.id DESC LIMIT 200`, ...p) });
}));
r.post('/diary', requireRole('admin', 'teacher'), ah((req, res) => {
  const cid = int(req.body.class_id, 'class'); ownClassOrAdmin(req.user, cid);
  const id = run('INSERT INTO diary(class_id, subject_id, date, title, body, homework_due, created_by) VALUES (?,?,?,?,?,?,?)', cid, int(req.body.subject_id || null, 'subject', { required: false }),
    date(req.body.date || today(), 'date'), str(req.body.title, 'Title', { max: 120 }), str(req.body.body, 'Details', { required: false, max: 2000 }), date(req.body.homework_due || null, 'homework due', { required: false }), req.user.id).lastInsertRowid;
  const kids = all("SELECT id, user_id FROM students WHERE class_id = ? AND status = 'active'", cid);
  notify([...kids.flatMap((k) => parentIdsOf(k.id)), ...kids.map((k) => k.user_id)], { title: `Diary: ${req.body.title}`, body: req.body.homework_due ? `Homework due ${req.body.homework_due}` : null, kind: 'diary', link: '/diary' });
  audit(req, 'diary_entry', 'diary', id); res.status(201).json({ id });
}));
r.delete('/diary/:id', requireRole('admin', 'teacher'), ah((req, res) => {
  const d = get('SELECT * FROM diary WHERE id = ?', req.params.id); if (!d) throw notFound();
  if (req.user.role !== 'admin' && d.created_by !== req.user.id) throw forbidden();
  run('DELETE FROM diary WHERE id = ?', d.id); res.json({ ok: true });
}));

// ================================================================== SUPPORT TICKETS (Parent -> Class Teacher, with status)
const TK = `SELECT t.*, s.name AS student_name, s.admission_no, ru.name AS raised_by_name, au.name AS assigned_to_name,
  (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages FROM tickets t JOIN students s ON s.id = t.student_id
  LEFT JOIN users ru ON ru.id = t.raised_by LEFT JOIN users au ON au.id = t.assigned_to`;
function ticketAccess(user, t) {
  if (user.role === 'admin') return true;
  if (user.role === 'teacher') return t.assigned_to === user.id || teacherClasses(user.id).ct.includes(get('SELECT class_id FROM students WHERE id = ?', t.student_id)?.class_id);
  if (user.role === 'parent' || user.role === 'student') return childIds(user).includes(t.student_id);
  return false;
}
r.get('/tickets', ah((req, res) => {
  const where = []; const p = [];
  if (req.user.role === 'parent' || req.user.role === 'student') { const kids = childIds(req.user); where.push(`t.student_id IN (${kids.map(() => '?').join(',') || 'NULL'})`); p.push(...kids); }
  else if (req.user.role === 'teacher') { const ct = teacherClasses(req.user.id).ct; where.push(`(t.assigned_to = ? OR t.student_id IN (SELECT id FROM students WHERE class_id IN (${ct.map(() => '?').join(',') || 'NULL'})))`); p.push(req.user.id, ...ct); }
  else if (req.user.role !== 'admin') throw forbidden();
  if (req.query.status) { where.push('t.status = ?'); p.push(req.query.status); }
  res.json({ rows: all(`${TK} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END, t.updated_at DESC LIMIT 200`, ...p) });
}));
r.post('/tickets', ah((req, res) => {
  const sid = int(req.body.student_id, 'student'); const { student, level } = studentAccess(req.user, sid);
  if (level !== 'family') throw forbidden('Parents and students raise support tickets');
  const ct = student.class_id ? classTeacherOf(student.class_id) : null;
  const id = tx(() => {
    const tid = run('INSERT INTO tickets(ticket_no, student_id, raised_by, assigned_to, subject, category, priority) VALUES (?,?,?,?,?,?,?)',
      nextSeq('ticket', 'TKT', 4), sid, req.user.id, ct, str(req.body.subject, 'Subject', { max: 120 }), str(req.body.category, 'category', { required: false, max: 30 }) || 'general',
      oneOf(req.body.priority || 'normal', ['low', 'normal', 'high'], 'priority')).lastInsertRowid;
    run('INSERT INTO ticket_messages(ticket_id, user_id, body) VALUES (?,?,?)', tid, req.user.id, str(req.body.message, 'Message', { max: 2000 }));
    return tid;
  });
  const msg = { title: 'New support ticket', body: `${student.name}: ${req.body.subject}`, kind: 'ticket', link: `/tickets/${id}` };
  if (ct) notify(ct, msg); else notifyAdmins(msg);
  audit(req, 'create_ticket', 'ticket', id); res.status(201).json({ id });
}));
r.get('/tickets/:id', ah((req, res) => {
  const t = get(`${TK} WHERE t.id = ?`, req.params.id); if (!t) throw notFound();
  if (!ticketAccess(req.user, t)) throw forbidden();
  res.json({ ticket: t, messages: all('SELECT m.*, u.name AS author, u.role FROM ticket_messages m JOIN users u ON u.id = m.user_id WHERE m.ticket_id = ? ORDER BY m.id', t.id) });
}));
r.post('/tickets/:id/messages', ah((req, res) => {
  const t = get('SELECT * FROM tickets WHERE id = ?', req.params.id); if (!t) throw notFound();
  if (!ticketAccess(req.user, t)) throw forbidden();
  if (t.status === 'closed') throw conflict('This ticket is closed');
  run('INSERT INTO ticket_messages(ticket_id, user_id, body) VALUES (?,?,?)', t.id, req.user.id, str(req.body.message, 'Message', { max: 2000 }));
  const fam = req.user.role === 'parent' || req.user.role === 'student';
  run(`UPDATE tickets SET updated_at = datetime('now'), status = CASE WHEN ? AND status = 'resolved' THEN 'open' WHEN NOT ? AND status = 'open' THEN 'in_progress' ELSE status END WHERE id = ?`, fam ? 1 : 0, fam ? 1 : 0, t.id);
  if (fam) notify(t.assigned_to, { title: `Reply on ${t.ticket_no}`, body: String(req.body.message).slice(0, 120), kind: 'ticket', link: `/tickets/${t.id}` });
  else notify(t.raised_by, { title: `Reply on ${t.ticket_no}`, body: String(req.body.message).slice(0, 120), kind: 'ticket', link: `/tickets/${t.id}`, sms: true });
  res.status(201).json({ ok: true });
}));
r.put('/tickets/:id/status', ah((req, res) => {
  const t = get('SELECT * FROM tickets WHERE id = ?', req.params.id); if (!t) throw notFound();
  if (!ticketAccess(req.user, t)) throw forbidden();
  const st = oneOf(req.body.status, ['open', 'in_progress', 'resolved', 'closed'], 'status');
  const fam = req.user.role === 'parent' || req.user.role === 'student';
  if (fam && !['closed'].includes(st)) throw forbidden('You can close your ticket once your issue is solved');
  run("UPDATE tickets SET status = ?, updated_at = datetime('now') WHERE id = ?", st, t.id);
  if (!fam) notify(t.raised_by, { title: `${t.ticket_no} is now ${st.replace('_', ' ')}`, kind: 'ticket', link: `/tickets/${t.id}` });
  audit(req, 'ticket_status', 'ticket', t.id, { status: st }); res.json({ ok: true });
}));

// ================================================================== COMMUNITY FEED
function canSeeCommunity(user, classId) {
  if (classId == null || user.role === 'admin') return true;
  return myClassIds(user).includes(classId);
}
r.get('/community', ah((req, res) => {
  if (req.user.role === 'driver' || req.user.role === 'finance') throw forbidden();
  const cls = req.user.role === 'admin' ? null : myClassIds(req.user);
  const where = []; const p = [];
  if (cls) { where.push(`(cp.class_id IS NULL OR cp.class_id IN (${cls.map(() => '?').join(',') || 'NULL'}))`); p.push(...cls); }
  if (req.query.class_id) { where.push('cp.class_id = ?'); p.push(Number(req.query.class_id)); }
  const posts = all(`SELECT cp.*, u.name AS author, u.role AS author_role, c.name || '-' || c.section AS class_label,
      (SELECT COUNT(*) FROM community_comments cc WHERE cc.post_id = cp.id) AS comments
    FROM community_posts cp JOIN users u ON u.id = cp.author_id LEFT JOIN classes c ON c.id = cp.class_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY cp.pinned DESC, cp.id DESC LIMIT 100`, ...p);
  res.json({ rows: posts });
}));
r.post('/community', ah((req, res) => {
  if (req.user.role === 'driver' || req.user.role === 'finance') throw forbidden();
  const classId = int(req.body.class_id || null, 'class', { required: false });
  if (!classId && !['admin', 'teacher'].includes(req.user.role)) throw forbidden('Only staff can post school-wide');
  if (classId && !canSeeCommunity(req.user, classId)) throw forbidden('You are not part of that class');
  const id = run('INSERT INTO community_posts(class_id, author_id, body) VALUES (?,?,?)', classId, req.user.id, str(req.body.body, 'Post', { max: 1500 })).lastInsertRowid;
  res.status(201).json({ id });
}));
r.get('/community/:id/comments', ah((req, res) => {
  const p = get('SELECT * FROM community_posts WHERE id = ?', req.params.id); if (!p) throw notFound();
  if (!canSeeCommunity(req.user, p.class_id)) throw forbidden();
  res.json({ rows: all('SELECT cc.*, u.name AS author, u.role AS author_role FROM community_comments cc JOIN users u ON u.id = cc.author_id WHERE post_id = ? ORDER BY cc.id', p.id) });
}));
r.post('/community/:id/comments', ah((req, res) => {
  const p = get('SELECT * FROM community_posts WHERE id = ?', req.params.id); if (!p) throw notFound();
  if (req.user.role === 'driver' || req.user.role === 'finance' || !canSeeCommunity(req.user, p.class_id)) throw forbidden();
  run('INSERT INTO community_comments(post_id, author_id, body) VALUES (?,?,?)', p.id, req.user.id, str(req.body.body, 'Comment', { max: 600 }));
  if (p.author_id !== req.user.id) notify(p.author_id, { title: 'New comment on your post', body: String(req.body.body).slice(0, 100), kind: 'community', link: '/community' });
  res.status(201).json({ ok: true });
}));
r.post('/community/:id/pin', requireRole('admin', 'teacher'), ah((req, res) => {
  const p = get('SELECT * FROM community_posts WHERE id = ?', req.params.id); if (!p) throw notFound();
  if (req.user.role === 'teacher' && (!p.class_id || ownClassOrAdmin(req.user, p.class_id) === 'teacher')) throw forbidden();
  run('UPDATE community_posts SET pinned = ? WHERE id = ?', p.pinned ? 0 : 1, p.id); res.json({ ok: true });
}));
r.delete('/community/:id', ah((req, res) => {
  const p = get('SELECT * FROM community_posts WHERE id = ?', req.params.id); if (!p) throw notFound();
  let ok = req.user.role === 'admin' || p.author_id === req.user.id;
  if (!ok && req.user.role === 'teacher' && p.class_id) ok = teacherClasses(req.user.id).ct.includes(p.class_id);   // CT moderates their class
  if (!ok) throw forbidden();
  run('DELETE FROM community_posts WHERE id = ?', p.id); audit(req, 'delete_post', 'community_post', p.id); res.json({ ok: true });
}));

// ================================================================== NOTIFICATIONS
r.get('/notifications', ah((req, res) => {
  const rows = all(`SELECT * FROM notifications WHERE user_id = ? ${req.query.unread === '1' ? 'AND is_read = 0' : ''} ORDER BY id DESC LIMIT 100`, req.user.id);
  res.json({ rows, unread: get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', req.user.id).n });
}));
r.post('/notifications/read', ah((req, res) => {
  if (req.body.all) run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', req.user.id);
  else for (const id of (req.body.ids || []).map(Number)) run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', id, req.user.id);
  res.json({ ok: true });
}));

export default r;
