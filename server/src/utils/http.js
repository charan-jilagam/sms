export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (m = 'Bad request', extra) => new HttpError(400, m, extra);
export const unauthorized = (m = 'Authentication required') => new HttpError(401, m);
export const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m = 'Conflict') => new HttpError(409, m);

/** Wrap async/sync handlers so thrown errors reach the error middleware. */
export const ah = (fn) => (req, res, next) => {
  try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); }
};

// ---- tiny validators ---------------------------------------------------
export function str(v, name, { required = true, max = 500, min = 0 } = {}) {
  if (v === undefined || v === null || String(v).trim() === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw bad(`${name} is too long (max ${max})`);
  if (s.length < min) throw bad(`${name} must be at least ${min} characters`);
  return s;
}
export function int(v, name, { required = true, min = -Infinity, max = Infinity } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name} is invalid`);
  return n;
}
export function num(v, name, { required = true, min = -Infinity, max = Infinity } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${name} is invalid`);
  return n;
}
export function oneOf(v, list, name, { required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  if (!list.includes(v)) throw bad(`${name} must be one of: ${list.join(', ')}`);
  return v;
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function date(v, name, { required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw bad(`${name} is required`);
    return null;
  }
  if (!DATE_RE.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${name} must be YYYY-MM-DD`);
  return v;
}
export function mobile(v, name = 'mobile', { required = true } = {}) {
  const s = str(v, name, { required, max: 20 });
  if (s === null) return null;
  const digits = s.replace(/[\s\-()]/g, '');
  if (!/^\+?\d{7,15}$/.test(digits)) throw bad(`${name} must be a valid phone number`);
  return digits;
}
export const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const monthOf = (d = today()) => d.slice(0, 7);
export const money = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function paginate(req, { max = 200, def = 50 } = {}) {
  const limit = Math.min(max, Math.max(1, parseInt(req.query.limit, 10) || def));
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  return { limit, offset: (page - 1) * limit, page };
}
