import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { get, all, run, tx } from '../db/index.js';
import { ah, bad, notFound, forbidden, str, int, num, date, flag } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notifyFamily } from '../utils/notify.js';
import { studentAccess, ownClassOrAdmin, childIds, teacherClasses } from '../utils/access.js';
import { gradeOf, PASS_PERCENT } from '../utils/grade.js';
import { config } from '../config.js';

const r = Router();
r.use(authenticate);

// ---------------------------------------------------------------- exams
r.get('/exams', ah((req, res) => {
  const where = []; const p = [];
  if (req.query.class_id) { where.push('e.class_id = ?'); p.push(Number(req.query.class_id)); }
  if (req.user.role === 'parent' || req.user.role === 'student') {
    const kids = childIds(req.user);
    where.push(`e.published = 1 AND e.class_id IN (SELECT class_id FROM students WHERE id IN (${kids.map(() => '?').join(',') || 'NULL'}))`); p.push(...kids);
  } else if (req.user.role === 'teacher') {
    const ids = teacherClasses(req.user.id).all; where.push(`e.class_id IN (${ids.map(() => '?').join(',') || 'NULL'})`); p.push(...ids);
  } else if (req.user.role === 'driver' || req.user.role === 'finance') throw forbidden();
  res.json({ rows: all(`SELECT e.*, c.name || '-' || c.section AS class_label FROM exams e JOIN classes c ON c.id = e.class_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY e.start_date DESC, e.id DESC`, ...p) });
}));

function examBody(b) {
  return [str(b.name, 'Exam name', { max: 80 }), int(b.class_id, 'class'), date(b.start_date, 'start date', { required: false }), date(b.end_date, 'end date', { required: false }), int(b.max_marks ?? 100, 'max marks', { min: 1, max: 1000 })];
}
r.post('/exams', requireRole('admin', 'teacher'), ah((req, res) => {
  const v = examBody(req.body);
  const level = ownClassOrAdmin(req.user, v[1]);
  if (level === 'teacher') throw forbidden('Only the class teacher or admin can create exams');
  const id = run('INSERT INTO exams(name, class_id, start_date, end_date, max_marks) VALUES (?,?,?,?,?)', ...v).lastInsertRowid;
  audit(req, 'create_exam', 'exam', id); res.status(201).json({ id });
}));
r.put('/exams/:id', requireRole('admin', 'teacher'), ah((req, res) => {
  const ex = get('SELECT * FROM exams WHERE id = ?', req.params.id); if (!ex) throw notFound();
  if (ownClassOrAdmin(req.user, ex.class_id) === 'teacher') throw forbidden();
  const v = examBody({ ...ex, ...req.body, class_id: ex.class_id });
  run('UPDATE exams SET name=?, start_date=?, end_date=?, max_marks=? WHERE id=?', v[0], v[2], v[3], v[4], ex.id);
  res.json({ ok: true });
}));
r.post('/exams/:id/publish', requireRole('admin', 'teacher'), ah((req, res) => {
  const ex = get('SELECT * FROM exams WHERE id = ?', req.params.id); if (!ex) throw notFound();
  if (ownClassOrAdmin(req.user, ex.class_id) === 'teacher') throw forbidden('Only the class teacher or admin can publish results');
  const pub = flag(req.body.published ?? 1);
  run('UPDATE exams SET published = ? WHERE id = ?', pub, ex.id);
  if (pub && !ex.published) {
    for (const s of all("SELECT id FROM students WHERE class_id = ? AND status = 'active'", ex.class_id))
      notifyFamily(s.id, { title: 'Results published', body: `${ex.name} results are now available.`, kind: 'exam', link: '/results' });
  }
  audit(req, pub ? 'publish_exam' : 'unpublish_exam', 'exam', ex.id); res.json({ ok: true });
}));
r.delete('/exams/:id', requireRole('admin'), ah((req, res) => { run('DELETE FROM exams WHERE id = ?', req.params.id); audit(req, 'delete_exam', 'exam', req.params.id); res.json({ ok: true }); }));

// -------------------------------------------------------------- marks entry grid
r.get('/exams/:id/marks', requireRole('admin', 'teacher'), ah((req, res) => {
  const ex = get('SELECT * FROM exams WHERE id = ?', req.params.id); if (!ex) throw notFound();
  const level = ownClassOrAdmin(req.user, ex.class_id);
  const subjects = all(`SELECT cs.subject_id, s.name, s.code, cs.teacher_id FROM class_subjects cs JOIN subjects s ON s.id = cs.subject_id
    WHERE cs.class_id = ? ORDER BY s.name`, ex.class_id)
    .map((s) => ({ ...s, editable: level !== 'teacher' || s.teacher_id === req.user.id }));
  const students = all("SELECT id, name, roll_no, admission_no FROM students WHERE class_id = ? AND status = 'active' ORDER BY roll_no, name", ex.class_id);
  const marks = all('SELECT student_id, subject_id, marks, remarks FROM marks WHERE exam_id = ?', ex.id);
  res.json({ exam: ex, subjects, students, marks });
}));

r.put('/exams/:id/marks', requireRole('admin', 'teacher'), ah((req, res) => {
  const ex = get('SELECT * FROM exams WHERE id = ?', req.params.id); if (!ex) throw notFound();
  const level = ownClassOrAdmin(req.user, ex.class_id);
  const entries = Array.isArray(req.body.entries) ? req.body.entries : [];
  const teaches = new Map(all('SELECT subject_id, teacher_id FROM class_subjects WHERE class_id = ?', ex.class_id).map((x) => [x.subject_id, x.teacher_id]));
  const valid = new Set(all('SELECT id FROM students WHERE class_id = ?', ex.class_id).map((x) => x.id));
  tx(() => {
    for (const e of entries) {
      const sid = int(e.student_id, 'student_id'), sub = int(e.subject_id, 'subject_id');
      if (!valid.has(sid)) throw bad('Student is not in this class');
      if (!teaches.has(sub)) throw bad('Subject is not taught in this class');
      if (level === 'teacher' && teaches.get(sub) !== req.user.id) throw forbidden('You can only enter marks for your own subjects');
      if (e.marks === '' || e.marks === null || e.marks === undefined) { run('DELETE FROM marks WHERE exam_id=? AND student_id=? AND subject_id=?', ex.id, sid, sub); continue; }
      const m = num(e.marks, 'marks', { min: 0, max: ex.max_marks });
      run(`INSERT INTO marks(exam_id, student_id, subject_id, marks, remarks, entered_by) VALUES (?,?,?,?,?,?)
           ON CONFLICT(exam_id, student_id, subject_id) DO UPDATE SET marks = excluded.marks, remarks = excluded.remarks, entered_by = excluded.entered_by, updated_at = datetime('now')`,
      ex.id, sid, sub, m, e.remarks ? String(e.remarks).slice(0, 100) : null, req.user.id);
    }
  });
  audit(req, 'enter_marks', 'exam', ex.id, { entries: entries.length });
  res.json({ ok: true, saved: entries.length });
}));

// ------------------------------------------------ result card (published only for families)
r.get('/results/student/:id', ah((req, res) => {
  const { student, level } = studentAccess(req.user, req.params.id);
  const family = level === 'family';
  const exams = all(`SELECT e.* FROM exams e WHERE e.class_id = ? ${family ? 'AND e.published = 1' : ''} ORDER BY e.start_date DESC, e.id DESC`, student.class_id);
  const out = exams.map((e) => {
    const rows = all(`SELECT s.name AS subject, s.code, m.marks, m.remarks FROM marks m JOIN subjects s ON s.id = m.subject_id
      WHERE m.exam_id = ? AND m.student_id = ? ORDER BY s.name`, e.id, student.id)
      .map((x) => ({ ...x, max: e.max_marks, ...gradeOf((x.marks / e.max_marks) * 100), passed: (x.marks / e.max_marks) * 100 >= PASS_PERCENT }));
    const total = rows.reduce((a, b) => a + b.marks, 0), maxTotal = rows.length * e.max_marks;
    const percent = maxTotal ? Math.round((total / maxTotal) * 1000) / 10 : null;
    const totals = all('SELECT student_id, SUM(marks) t FROM marks WHERE exam_id = ? GROUP BY student_id ORDER BY t DESC', e.id);
    const rank = rows.length ? totals.findIndex((t) => t.student_id === student.id) + 1 : null;
    return { exam: { id: e.id, name: e.name, start_date: e.start_date, published: e.published, max_marks: e.max_marks },
      subjects: rows, total, max_total: maxTotal, percent, overall: percent === null ? null : gradeOf(percent).grade,
      result: rows.length ? (rows.every((x) => x.passed) ? 'PASS' : 'FAIL') : null, rank, class_size: totals.length };
  });
  res.json({ student: { id: student.id, name: student.name }, results: out });
}));

// -------------------------------------------------------------- question papers
fs.mkdirSync(config.uploadDir, { recursive: true });
const ALLOWED = new Set(['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.ppt', '.pptx', '.txt']);
const upload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => cb(null, config.uploadDir),
    filename: (_q, f, cb) => cb(null, `${crypto.randomBytes(12).toString('hex')}${path.extname(f.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_q, f, cb) => (ALLOWED.has(path.extname(f.originalname).toLowerCase()) ? cb(null, true) : cb(new Error('File type not allowed'))),
});

const PAPER = `SELECT p.id, p.title, p.class_id, p.subject_id, p.exam_id, p.file_name, p.visible_to_students, p.release_at, p.created_at,
  c.name || '-' || c.section AS class_label, s.name AS subject, u.name AS uploaded_by_name
  FROM papers p JOIN classes c ON c.id = p.class_id LEFT JOIN subjects s ON s.id = p.subject_id LEFT JOIN users u ON u.id = p.uploaded_by`;
const released = "p.visible_to_students = 1 AND (p.release_at IS NULL OR p.release_at <= datetime('now'))";

r.get('/papers', ah((req, res) => {
  const where = []; const p = [];
  if (req.query.class_id) { where.push('p.class_id = ?'); p.push(Number(req.query.class_id)); }
  if (req.user.role === 'parent' || req.user.role === 'student') {
    const kids = childIds(req.user);
    where.push(`${released} AND p.class_id IN (SELECT class_id FROM students WHERE id IN (${kids.map(() => '?').join(',') || 'NULL'}))`); p.push(...kids);
  } else if (req.user.role === 'teacher') {
    const ids = teacherClasses(req.user.id).all; where.push(`p.class_id IN (${ids.map(() => '?').join(',') || 'NULL'})`); p.push(...ids);
  } else if (req.user.role !== 'admin') throw forbidden();
  res.json({ rows: all(`${PAPER} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC`, ...p) });
}));

r.post('/papers', requireRole('admin', 'teacher'), upload.single('file'), ah((req, res) => {
  if (!req.file) throw bad('Please choose a file');
  try {
    const cid = int(req.body.class_id, 'class');
    ownClassOrAdmin(req.user, cid);
    const id = run(`INSERT INTO papers(title, class_id, subject_id, exam_id, file_name, file_path, visible_to_students, release_at, uploaded_by) VALUES (?,?,?,?,?,?,?,?,?)`,
      str(req.body.title, 'Title', { max: 120 }), cid, int(req.body.subject_id || null, 'subject', { required: false }), int(req.body.exam_id || null, 'exam', { required: false }),
      req.file.originalname.slice(0, 150), req.file.filename, flag(req.body.visible_to_students), req.body.release_at || null, req.user.id).lastInsertRowid;
    audit(req, 'upload_paper', 'paper', id); res.status(201).json({ id });
  } catch (e) { fs.rm(req.file.path, { force: true }, () => {}); throw e; }
}));

r.post('/papers/:id/release', requireRole('admin', 'teacher'), ah((req, res) => {
  const p = get('SELECT * FROM papers WHERE id = ?', req.params.id); if (!p) throw notFound();
  ownClassOrAdmin(req.user, p.class_id);
  const v = flag(req.body.visible ?? 1);
  run('UPDATE papers SET visible_to_students = ?, release_at = ? WHERE id = ?', v, req.body.release_at || null, p.id);
  if (v) for (const s of all("SELECT id FROM students WHERE class_id = ? AND status = 'active'", p.class_id))
    notifyFamily(s.id, { title: 'Question paper shared', body: p.title, kind: 'paper', link: '/papers' });
  audit(req, v ? 'release_paper' : 'hide_paper', 'paper', p.id); res.json({ ok: true });
}));

r.delete('/papers/:id', requireRole('admin', 'teacher'), ah((req, res) => {
  const p = get('SELECT * FROM papers WHERE id = ?', req.params.id); if (!p) throw notFound();
  if (req.user.role !== 'admin' && p.uploaded_by !== req.user.id) throw forbidden();
  run('DELETE FROM papers WHERE id = ?', p.id); fs.rm(path.join(config.uploadDir, p.file_path), { force: true }, () => {});
  audit(req, 'delete_paper', 'paper', p.id); res.json({ ok: true });
}));

r.get('/papers/:id/download', ah((req, res) => {
  const p = get('SELECT p.* FROM papers p WHERE p.id = ?', req.params.id); if (!p) throw notFound();
  if (req.user.role === 'teacher') ownClassOrAdmin(req.user, p.class_id);
  else if (req.user.role === 'parent' || req.user.role === 'student') {
    const kids = childIds(req.user);
    const ok = get(`SELECT 1 x FROM papers p WHERE p.id = ? AND ${released} AND p.class_id IN (SELECT class_id FROM students WHERE id IN (${kids.map(() => '?').join(',') || 'NULL'}))`, p.id, ...kids);
    if (!ok) throw forbidden('This paper has not been released yet');
  } else if (req.user.role !== 'admin') throw forbidden();
  const full = path.join(config.uploadDir, path.basename(p.file_path));
  if (!fs.existsSync(full)) throw notFound('File is missing on the server');
  res.download(full, p.file_name);
}));

export default r;
