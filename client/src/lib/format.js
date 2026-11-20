let currency = 'INR';
export const setCurrency = (c) => { currency = c || 'INR'; };
export const money = (n) => {
  const v = Number(n || 0);
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: v % 1 ? 2 : 0 }).format(v); } catch { return `${v}`; }
};
export const num = (n) => new Intl.NumberFormat('en-IN').format(Number(n || 0));
export const compact = (n) => new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n || 0));
export const fdate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-');
export const fdatetime = (d) => {
  if (!d) return '-';
  const x = new Date(String(d).replace(' ', 'T') + (String(d).includes('T') || String(d).endsWith('Z') ? '' : 'Z'));
  return x.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
export const ago = (d) => {
  if (!d) return '';
  const s = Math.max(0, (Date.now() - new Date(String(d).replace(' ', 'T') + 'Z').getTime()) / 1000);
  if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const monthLabel = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');
export const initials = (n = '') => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('');
export const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const ROLE_LABEL = { admin: 'Administrator', teacher: 'Teacher', finance: 'Finance', parent: 'Parent', student: 'Student', driver: 'Driver' };
