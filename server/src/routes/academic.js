import { Router } from 'express';
import { get, all, run, tx } from '../db/index.js';
import { ah, bad, notFound, conflict, str, int, oneOf, flag } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { childIds, teacherClasses } from '../utils/access.js';
import { generateTimetable } from '../utils/timetable.js';

const r = Router();
r.use(authenticate);

// ------------------------------------------------------------------ classes
r.get('/classes', ah((req, res) => {
  let where = '1=1'; const p = [];
  if (req.user.role === 'parent' || req.user.role === 'student') {
    const ids = childIds(req.user);
    where = `c.id IN (SELECT class_id FROM students WHERE id IN (${ids.map(() => '?').join(',') || 'NULL'}))`; p.push(...ids);
  } else if (req.user.role === 'driver') where = '0=1';
  const rows = all(`SELECT c.id, c.name, c.section, c.name || '-' || c.section AS label, c.room, c.capacity, c.class_teacher_id,
    u.name AS class_teacher, (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status='active') AS students
    FROM classes c LEFT JOIN users u ON u.id = c.class_teacher_id WHERE ${where} ORDER BY c.name, c.section`, ...p);
  if (req.user.role === 'teacher' && req.query.mine) {
    const mine = teacherClasses(req.user.id);
    return res.json({ rows: rows.filter((c) => mine.all.includes(c.id)).map((c) => ({ ...c, is_ct: mine.ct.includes(c.id) })) });
  }
  res.json({ rows });
}));

function classBody(b, ex = {}) {
  const name = str(b.name ?? ex.name, 'Class name', { max: 30 });
  const section = str(b.section ?? ex.section ?? 'A', 'Section', { max: 10 });
  const ct = int(b.class_teacher_id === '' ? null : (b.class_teacher_id ?? ex.class_teacher_id), 'class teacher', { required: false });
  if (ct && !get("SELECT id FROM users WHERE id = ? AND role = 'teacher' AND status = 'active'", ct)) throw bad('Class teacher must be an active teacher account');
  return { name, section, ct, room: str(b.room ?? ex.room, 'room', { required: false, max: 30 }), capacity: int(b.capacity ?? ex.capacity ?? 40, 'capacity', { min: 1, max: 200 }) };
}
r.post('/classes', requireRole('admin'), ah((req, res) => {
  const v = classBody(req.body);
  const id = run('INSERT INTO classes(name, section, class_teacher_id, room, capacity) VALUES (?,?,?,?,?)', v.name, v.section, v.ct, v.room, v.capacity).lastInsertRowid;
  audit(req, 'create_class', 'class', id); res.status(201).json({ id });
}));
r.put('/classes/:id', requireRole('admin'), ah((req, res) => {
  const ex = get('SELECT * FROM classes WHERE id = ?', req.params.id); if (!ex) throw notFound();
  const v = classBody(req.body, ex);
  run('UPDATE classes SET name=?, section=?, class_teacher_id=?, room=?, capacity=? WHERE id=?', v.name, v.section, v.ct, v.room, v.capacity, ex.id);
  audit(req, 'update_class', 'class', ex.id, { class_teacher_id: v.ct }); res.json({ ok: true });
}));
r.delete('/classes/:id', requireRole('admin'), ah((req, res) => {
  if (get('SELECT 1 x FROM students WHERE class_id = ?', req.params.id)) throw conflict('Move or remove the students of this class first');
  run('DELETE FROM classes WHERE id = ?', req.params.id); audit(req, 'delete_class', 'class', req.params.id); res.json({ ok: true });
}));

// ----------------------------------------------------------------- subjects
r.get('/subjects', ah((_req, res) => res.json({ rows: all('SELECT * FROM subjects ORDER BY name') })));
r.post('/subjects', requireRole('admin'), ah((req, res) => {
  const id = run('INSERT INTO subjects(name, code) VALUES (?,?)', str(req.body.name, 'Name', { max: 60 }), str(req.body.code, 'Code', { max: 12 }).toUpperCase()).lastInsertRowid;
  res.status(201).json({ id });
}));
r.put('/subjects/:id', requireRole('admin'), ah((req, res) => {
  run('UPDATE subjects SET name = ?, code = ? WHERE id = ?', str(req.body.name, 'Name', { max: 60 }), str(req.body.code, 'Code', { max: 12 }).toUpperCase(), req.params.id);
  res.json({ ok: true });
}));
r.delete('/subjects/:id', requireRole('admin'), ah((req, res) => {
  if (get('SELECT 1 x FROM marks WHERE subject_id = ?', req.params.id)) throw conflict('Marks exist for this subject');
  run('DELETE FROM subjects WHERE id = ?', req.params.id); res.json({ ok: true });
}));

r.get('/classes/:id/subjects', ah((req, res) => {
  res.json({ rows: all(`SELECT cs.id, cs.subject_id, s.name AS subject, s.code, cs.teacher_id, u.name AS teacher, cs.periods_per_week
    FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id LEFT JOIN users u ON u.id = cs.teacher_id
    WHERE cs.class_id = ? ORDER BY s.name`, req.params.id) });
}));
r.put('/classes/:id/subjects', requireRole('admin'), ah((req, res) => {
  const cid = int(req.params.id, 'class');
  if (!get('SELECT id FROM classes WHERE id = ?', cid)) throw notFound('Class not found');
  const list = Array.isArray(req.body.subjects) ? req.body.subjects : [];
  tx(() => {
    run('DELETE FROM class_subjects WHERE class_id = ?', cid);
    for (const s of list) {
      const tid = int(s.teacher_id || null, 'teacher', { required: false });
      if (tid && !get("SELECT 1 x FROM users WHERE id = ? AND role = 'teacher'", tid)) throw bad('Teacher not found');
      run('INSERT INTO class_subjects(class_id, subject_id, teacher_id, periods_per_week) VALUES (?,?,?,?)',
        cid, int(s.subject_id, 'subject'), tid, int(s.periods_per_week ?? 4, 'periods per week', { min: 0, max: 12 }));
    }
  });
  audit(req, 'set_class_subjects', 'class', cid, { count: list.length });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ periods
r.get('/periods', ah((_req, res) => res.json({ rows: all('SELECT * FROM periods ORDER BY seq') })));
function periodBody(b) {
  const t = /^([01]\d|2[0-3]):[0-5]\d$/;
  const start = str(b.start_time, 'Start time'), end = str(b.end_time, 'End time');
  if (!t.test(start) || !t.test(end) || end <= start) throw bad('Enter valid start/end times (HH:MM) with end after start');
  return [str(b.name, 'Name', { max: 30 }), int(b.seq, 'Order', { min: 1, max: 20 }), start, end, flag(b.is_break)];
}
r.post('/periods', requireRole('admin'), ah((req, res) => {
  const id = run('INSERT INTO periods(name, seq, start_time, end_time, is_break) VALUES (?,?,?,?,?)', ...periodBody(req.body)).lastInsertRowid; res.status(201).json({ id });
}));
r.put('/periods/:id', requireRole('admin'), ah((req, res) => {
  run('UPDATE periods SET name=?, seq=?, start_time=?, end_time=?, is_break=? WHERE id=?', ...periodBody(req.body), req.params.id); res.json({ ok: true });
}));
r.delete('/periods/:id', requireRole('admin'), ah((req, res) => { run('DELETE FROM periods WHERE id = ?', req.params.id); res.json({ ok: true }); }));

// ---------------------------------------------------------------- timetable
const TT = `SELECT t.id, t.class_id, t.day, t.period_id, t.subject_id, t.teacher_id, s.name AS subject, s.code, u.name AS teacher,
  c.name || '-' || c.section AS class_label FROM timetable t JOIN subjects s ON s.id = t.subject_id
  JOIN classes c ON c.id = t.class_id LEFT JOIN users u ON u.id = t.teacher_id`;

r.get('/timetable', ah((req, res) => {
  const { role, id } = req.user;
  let rows;
  if (req.query.teacher === 'me' || (role === 'teacher' && !req.query.class_id)) rows = all(`${TT} WHERE t.teacher_id = ?`, id);
  else {
    let cid = int(req.query.class_id, 'class_id', { required: false });
    if (role === 'parent' || role === 'student') {
      const kids = childIds(req.user);
      const cls = all(`SELECT DISTINCT class_id FROM students WHERE id IN (${kids.map(() => '?').join(',') || 'NULL'})`, ...kids).map((x) => x.class_id);
      if (!cid) cid = cls[0];
      if (!cls.includes(cid)) throw bad('Class not available');
    }
    if (!cid) throw bad('class_id is required');
    rows = all(`${TT} WHERE t.class_id = ?`, cid);
  }
  res.json({ rows, periods: all('SELECT * FROM periods ORDER BY seq') });
}));

r.post('/timetable/generate', requireRole('admin'), ah((req, res) => {
  const days = int(req.body.days ?? 5, 'days', { min: 5, max: 6 });
  const apply = !!req.body.apply;
  const ids = Array.isArray(req.body.class_ids) && req.body.class_ids.length ? req.body.class_ids.map(Number) : all('SELECT id FROM classes').map((c) => c.id);
  const periods = all('SELECT * FROM periods WHERE is_break = 0 ORDER BY seq');
  if (!periods.length) throw bad('Define at least one teaching period first');
  const classes = ids.map((cid) => ({
    id: cid, subjects: all('SELECT subject_id, teacher_id, periods_per_week FROM class_subjects WHERE class_id = ?', cid),
  })).filter((c) => c.subjects.length);
  if (!classes.length) throw bad('Assign subjects (with periods per week) to the classes first');
  // teachers already booked by classes we are NOT regenerating
  const busy = new Set(all(`SELECT teacher_id, day, period_id FROM timetable WHERE teacher_id IS NOT NULL AND class_id NOT IN (${ids.map(() => '?').join(',')})`, ...ids)
    .map((x) => `${x.teacher_id}:${x.day}:${x.period_id}`));
  const { entries, unplaced } = generateTimetable({ classes, periods, days, busy });
  if (apply) {
    tx(() => {
      for (const c of classes) run('DELETE FROM timetable WHERE class_id = ?', c.id);
      for (const e of entries) run('INSERT INTO timetable(class_id, day, period_id, subject_id, teacher_id) VALUES (?,?,?,?,?)', e.class_id, e.day, e.period_id, e.subject_id, e.teacher_id);
    });
    audit(req, 'generate_timetable', 'timetable', null, { classes: classes.length, lessons: entries.length, unplaced: unplaced.length });
  }
  res.json({ applied: apply, lessons: entries.length, classes: classes.length, unplaced, entries: apply ? undefined : entries });
}));

r.put('/timetable/slot', requireRole('admin'), ah((req, res) => {
  const cid = int(req.body.class_id, 'class'), day = int(req.body.day, 'day', { min: 1, max: 6 }), pid = int(req.body.period_id, 'period'), sid = int(req.body.subject_id, 'subject');
  const tid = get('SELECT teacher_id FROM class_subjects WHERE class_id = ? AND subject_id = ?', cid, sid)?.teacher_id ?? null;
  if (tid) {
    const clash = get('SELECT c.name || \'-\' || c.section AS cls FROM timetable t JOIN classes c ON c.id = t.class_id WHERE t.teacher_id = ? AND t.day = ? AND t.period_id = ? AND t.class_id <> ?', tid, day, pid, cid);
    if (clash) throw conflict(`Teacher is already teaching ${clash.cls} in that period`);
  }
  run(`INSERT INTO timetable(class_id, day, period_id, subject_id, teacher_id) VALUES (?,?,?,?,?)
       ON CONFLICT(class_id, day, period_id) DO UPDATE SET subject_id = excluded.subject_id, teacher_id = excluded.teacher_id`, cid, day, pid, sid, tid);
  audit(req, 'edit_timetable_slot', 'class', cid); res.json({ ok: true });
}));
r.delete('/timetable/slot', requireRole('admin'), ah((req, res) => {
  run('DELETE FROM timetable WHERE class_id = ? AND day = ? AND period_id = ?', int(req.query.class_id, 'class'), int(req.query.day, 'day'), int(req.query.period_id, 'period'));
  res.json({ ok: true });
}));

export default r;
