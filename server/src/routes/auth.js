import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { get, run, all, tx } from '../db/index.js';
import { ah, bad, str, mobile as vMobile, oneOf, unauthorized, forbidden } from '../utils/http.js';
import { signToken, authenticate } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notifyAdmins } from '../utils/notify.js';

const r = Router();
export const tempPassword = () => crypto.randomBytes(6).toString('base64url').slice(0, 9) + '#7';

// naive in-memory throttle: 8 failures / 10 min per ip+identifier
const fails = new Map();
function throttled(key) {
  const now = Date.now(); const e = fails.get(key);
  if (!e || now - e.t > 600000) return false;
  return e.n >= 8;
}
const markFail = (key) => { const now = Date.now(); const e = fails.get(key); fails.set(key, !e || now - e.t > 600000 ? { n: 1, t: now } : { n: e.n + 1, t: e.t }); };

function findLoginUser(identifier) {
  const id = identifier.trim();
  let u = get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', id) || get('SELECT * FROM users WHERE mobile = ?', id.replace(/[\s\-()]/g, ''));
  if (!u) { // students sign in with their admission number
    const s = get('SELECT user_id FROM students WHERE admission_no = ? COLLATE NOCASE', id);
    if (s?.user_id) u = get('SELECT * FROM users WHERE id = ?', s.user_id);
  }
  return u;
}

export const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, mobile: u.mobile, role: u.role, status: u.status,
  must_change_password: !!u.must_change_password,
});

r.post('/login', ah((req, res) => {
  const identifier = str(req.body.identifier, 'Email / mobile / admission no', { max: 120 });
  const password = str(req.body.password, 'Password', { max: 200 });
  const key = `${req.ip}|${identifier.toLowerCase()}`;
  if (throttled(key)) throw new (class extends Error { status = 429 })('Too many attempts. Try again in a few minutes.');
  const u = findLoginUser(identifier);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) { markFail(key); throw unauthorized('Invalid credentials'); }
  if (u.status === 'pending') throw forbidden('Your account is awaiting admin approval.');
  if (u.status === 'rejected') throw forbidden('Your registration was not approved. Please contact the school.');
  if (u.status === 'inactive') throw forbidden('Your account is deactivated. Please contact the school office.');
  fails.delete(key);
  run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", u.id);
  audit({ user: u, ip: req.ip }, 'login', 'user', u.id);
  res.json({ token: signToken(u), user: publicUser(u) });
}));

r.post('/register', ah((req, res) => {
  const b = req.body;
  const role = oneOf(b.role, ['parent', 'driver', 'teacher', 'finance'], 'role');
  const name = str(b.name, 'Name', { max: 100 });
  const email = str(b.email, 'Email', { required: false, max: 120 });
  const mob = vMobile(b.mobile);
  const password = str(b.password, 'Password', { min: 8, max: 100 });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw bad('Email is not valid');
  const meta = role === 'parent' && Array.isArray(b.children)
    ? JSON.stringify(b.children.slice(0, 6).map((c) => ({ admission_no: String(c.admission_no || '').trim(), relation: String(c.relation || 'guardian').slice(0, 20) })))
    : null;
  const info = run(
    "INSERT INTO users(name, email, mobile, password_hash, role, status, meta) VALUES (?,?,?,?,?, 'pending', ?)",
    name, email, mob, bcrypt.hashSync(password, 10), role, meta,
  );
  notifyAdmins({ title: 'New account awaiting approval', body: `${name} registered as ${role}.`, kind: 'approval', link: '/admin/approvals' });
  audit({ user: { id: info.lastInsertRowid, name }, ip: req.ip }, 'register', 'user', info.lastInsertRowid, { role });
  res.status(201).json({ message: 'Registration received. You can sign in once the school admin approves your account.' });
}));

r.get('/me', authenticate, ah((req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  const unread = get('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND is_read = 0', u.id).n;
  res.json({ user: publicUser(u), unread });
}));

r.post('/change-password', authenticate, ah((req, res) => {
  const cur = str(req.body.current_password, 'Current password');
  const next = str(req.body.new_password, 'New password', { min: 8, max: 100 });
  const u = get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(cur, u.password_hash)) throw bad('Current password is incorrect');
  if (cur === next) throw bad('New password must be different');
  run('UPDATE users SET password_hash = ?, must_change_password = 0, token_version = token_version + 1 WHERE id = ?', bcrypt.hashSync(next, 10), u.id);
  const fresh = get('SELECT * FROM users WHERE id = ?', u.id);
  audit(req, 'change_password', 'user', u.id);
  res.json({ token: signToken(fresh), user: publicUser(fresh) });
}));

r.put('/profile', authenticate, ah((req, res) => {
  const name = str(req.body.name, 'Name', { max: 100 });
  const email = str(req.body.email, 'Email', { required: false, max: 120 });
  run('UPDATE users SET name = ?, email = COALESCE(?, email) WHERE id = ?', name, email, req.user.id);
  res.json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)) });
}));

export default r;
