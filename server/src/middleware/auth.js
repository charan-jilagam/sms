import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { get } from '../db/index.js';
import { unauthorized, forbidden, HttpError } from '../utils/http.js';

export function signToken(user) {
  return jwt.sign({ sub: user.id, v: user.token_version }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/**
 * Verifies the JWT AND re-reads the user row on every request. A deactivated / rejected account,
 * or a bumped token_version (password reset, forced logout), is therefore locked out immediately.
 */
export function authenticate(req, _res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  if (!token) return next(unauthorized());
  let payload;
  try { payload = jwt.verify(token, config.jwtSecret); } catch { return next(unauthorized('Session expired, please sign in again')); }
  const u = get('SELECT id, name, email, mobile, role, status, must_change_password, token_version FROM users WHERE id = ?', payload.sub);
  if (!u || u.token_version !== payload.v) return next(unauthorized('Session expired, please sign in again'));
  if (u.status !== 'active') return next(forbidden(`Your account is ${u.status}. Please contact the school office.`));
  req.user = u;
  next();
}

export const requireRole = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden());

export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.extra ? { details: err.extra } : {}) });
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return res.status(409).json({ error: friendlyConstraint(err.message) });
  }
  if (err?.code?.startsWith?.('SQLITE_CONSTRAINT')) {
    return res.status(400).json({ error: err.code === 'SQLITE_CONSTRAINT_TRIGGER' ? err.message : friendlyConstraint(err.message) });
  }
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File is too large (max 10 MB)' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  console.error(err);
  res.status(500).json({ error: config.isProd ? 'Internal server error' : err.message });
}

function friendlyConstraint(msg = '') {
  if (msg.includes('students.mobile, students.name')) return 'A student with this name and mobile number already exists';
  if (msg.includes('students.admission_no')) return 'Admission number already exists';
  if (msg.includes('users.email')) return 'This email is already registered';
  if (msg.includes('users.mobile')) return 'This mobile number is already registered';
  if (msg.includes('FOREIGN KEY')) return 'This record is linked to other data and cannot be changed this way';
  if (msg.includes('CHECK')) return 'One of the values is not allowed';
  const m = msg.match(/UNIQUE constraint failed: ([\w.]+)/);
  return m ? `Duplicate value for ${m[1].split('.').pop().replace(/_/g, ' ')}` : 'Duplicate or invalid value';
}
