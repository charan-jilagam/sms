import { Router } from 'express';
import { flushOutbox, channels } from '../utils/dispatch.js';
import fs from 'node:fs';
import path from 'node:path';
import { get, all, run, db, getSetting, setSetting } from '../db/index.js';
import { ah, bad, notFound, str, int, num, flag, oneOf, paginate } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { config } from '../config.js';
import { JOBS, runJob, jobStatus } from '../jobs/index.js';

const r = Router();
r.use(authenticate);

// ---- settings
const KEYS = ['school_name', 'school_address', 'school_phone', 'currency', 'academic_year', 'late_fee_percent', 'reminder_days_before', 'fiscal_start_month'];
r.get('/settings', ah((_req, res) => res.json(Object.fromEntries(all('SELECT key, value FROM settings').map((x) => [x.key, x.value])))));
r.put('/settings', requireRole('admin'), ah((req, res) => {
  for (const k of KEYS) if (req.body[k] !== undefined) {
    if (['late_fee_percent', 'reminder_days_before', 'fiscal_start_month'].includes(k)) num(req.body[k], k, { min: 0, max: 100 });
    setSetting(k, str(req.body[k], k, { required: false, max: 200 }) ?? '');
  }
  audit(req, 'update_settings', 'settings'); res.json({ ok: true });
}));

// ---- ID card templates
r.get('/id-templates', ah((_req, res) => res.json({ rows: all('SELECT * FROM id_templates ORDER BY is_default DESC, id') })));
const color = (v, n) => { if (!/^#[0-9a-fA-F]{6}$/.test(String(v))) throw bad(`${n} must be a hex colour like #4f46e5`); return v; };
function tplBody(b) {
  return [str(b.name, 'Name', { max: 50 }), oneOf(b.orientation || 'portrait', ['portrait', 'landscape'], 'orientation'), color(b.primary_color || '#4f46e5', 'Primary colour'), color(b.accent_color || '#f59e0b', 'Accent colour'),
    flag(b.show_blood_group), flag(b.show_address), flag(b.show_guardian), str(b.footer_text, 'Footer', { required: false, max: 120 })];
}
r.post('/id-templates', requireRole('admin'), ah((req, res) => {
  const id = run('INSERT INTO id_templates(name, orientation, primary_color, accent_color, show_blood_group, show_address, show_guardian, footer_text) VALUES (?,?,?,?,?,?,?,?)', ...tplBody(req.body)).lastInsertRowid;
  if (flag(req.body.is_default)) run('UPDATE id_templates SET is_default = 1 WHERE id = ?', id);
  res.status(201).json({ id });
}));
r.put('/id-templates/:id', requireRole('admin'), ah((req, res) => {
  const ex = get('SELECT * FROM id_templates WHERE id = ?', req.params.id); if (!ex) throw notFound();
  run('UPDATE id_templates SET name=?, orientation=?, primary_color=?, accent_color=?, show_blood_group=?, show_address=?, show_guardian=?, footer_text=? WHERE id=?', ...tplBody({ ...ex, ...req.body }), ex.id);
  if (flag(req.body.is_default)) run('UPDATE id_templates SET is_default = 1 WHERE id = ?', ex.id);
  res.json({ ok: true });
}));
r.delete('/id-templates/:id', requireRole('admin'), ah((req, res) => {
  if (get('SELECT COUNT(*) n FROM id_templates').n <= 1) throw bad('Keep at least one template');
  run('DELETE FROM id_templates WHERE id = ?', req.params.id); res.json({ ok: true });
}));

// ---- audit trail
r.get('/audit', requireRole('admin'), ah((req, res) => {
  const { limit, offset } = paginate(req, { max: 200, def: 50 });
  const where = []; const p = [];
  if (req.query.q) { where.push('(action LIKE ? OR user_name LIKE ? OR entity LIKE ? OR details LIKE ?)'); const l = `%${req.query.q}%`; p.push(l, l, l, l); }
  if (req.query.entity) { where.push('entity = ?'); p.push(req.query.entity); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  res.json({ rows: all(`SELECT * FROM audit_log ${w} ORDER BY id DESC LIMIT ? OFFSET ?`, ...p, limit, offset), total: get(`SELECT COUNT(*) n FROM audit_log ${w}`, ...p).n });
}));

// ---- scheduled jobs (cron)
r.get('/jobs', requireRole('admin'), ah((_req, res) => res.json({ rows: jobStatus(), cron_enabled: config.enableCron })));
r.post('/jobs/:name/run', requireRole('admin'), ah(async (req, res) => {
  if (!JOBS[req.params.name]) throw notFound('Unknown job');
  const out = await runJob(req.params.name, 'manual');
  audit(req, 'run_job', 'job', req.params.name); res.json(out);
}));
r.get('/channels', requireRole('admin'), ah((_req, res) => res.json(channels())));
r.post('/outbox/flush', requireRole('admin'), ah(async (_req, res) => res.json(await flushOutbox())));
r.get('/outbox', requireRole('admin'), ah((_req, res) => res.json({ rows: all('SELECT * FROM outbox ORDER BY id DESC LIMIT 100') })));

// ---- database backups
r.get('/backups', requireRole('admin'), ah((_req, res) => {
  fs.mkdirSync(config.backupDir, { recursive: true });
  res.json({ rows: fs.readdirSync(config.backupDir).filter((f) => f.endsWith('.db')).sort().reverse().map((f) => ({ name: f, size: fs.statSync(path.join(config.backupDir, f)).size })) });
}));
r.post('/backups', requireRole('admin'), ah(async (req, res) => {
  const out = await runJob('db-backup', 'manual'); audit(req, 'backup_db', 'backup'); res.json(out);
}));
r.get('/backups/:name', requireRole('admin'), ah((req, res) => {
  const f = path.join(config.backupDir, path.basename(req.params.name));
  if (!f.endsWith('.db') || !fs.existsSync(f)) throw notFound(); res.download(f);
}));

export default r;
