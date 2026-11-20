import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { X, Inbox, Search, CheckCircle2, AlertTriangle, Info, XCircle } from 'lucide-react';
import { initials } from '../lib/format.js';

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, msg, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === 'bad' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.kind === 'ok' ? <CheckCircle2 size={18} /> : <XCircle size={18} />}{t.msg}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- layout bits ---------- */
export const PageHead = ({ title, sub, children }) => (
  <div className="page-head rise"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div><div className="row">{children}</div></div>
);
export const Card = ({ title, action, children, pad = true, className = '' }) => (
  <section className={`card ${className}`}>
    {(title || action) && <div className="card-h"><h3>{title}</h3>{action}</div>}
    <div className={pad ? 'card-b' : ''}>{children}</div>
  </section>
);
export const Stat = ({ label, value, sub, icon: Icon, tone, hero, onClick }) => (
  <div className={`stat rise ${tone ? `tone-${tone}` : ''} ${hero ? 'hero' : ''} ${onClick ? 'link' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
    <div className="label">{Icon && <span className="ico"><Icon /></span>}{label}</div>
    <div className="value mono">{value}</div>{sub && <div className="sub">{sub}</div>}
  </div>
);
export const Badge = ({ tone, children }) => <span className={`badge ${tone ? `b-${tone}` : ''}`}>{children}</span>;
export const Avatar = ({ name, size }) => <div className={`avatar ${size || ''}`}>{initials(name)}</div>;
export const Spinner = () => <span className="spinner" aria-label="Loading" />;
export const Loading = ({ rows = 3 }) => <div className="stack">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ height: 54 }} />)}</div>;
export function Empty({ title = 'Nothing here yet', children, icon: Icon = Inbox }) { return <div className="empty"><Icon /><b>{title}</b><div>{children}</div></div>; }
export function Alert({ tone = '', children }) {
  const I = { warn: AlertTriangle, bad: XCircle, ok: CheckCircle2 }[tone] || Info;
  return <div className={`alert ${tone}`}><I />{<div>{children}</div>}</div>;
}
export const ErrorBox = ({ error, retry }) => error ? <Alert tone="bad">{error} {retry && <button className="btn btn-sm" onClick={retry}>Retry</button>}</Alert> : null;
export const Progress = ({ value, tone }) => { const v = Math.max(0, Math.min(100, value ?? 0)); return <div className={`progress ${tone || (v >= 90 ? 'ok' : v >= 75 ? '' : v >= 60 ? 'warn' : 'bad')}`}><i style={{ width: `${v}%` }} /></div>; };

export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.id} role="tab" aria-selected={value === t.id} className={`tab ${value === t.id ? 'on' : ''}`} onClick={() => onChange(t.id)}>{t.label}{t.count ? ` (${t.count})` : ''}</button>)}</div>;
}

/* ---------- form controls ---------- */
export const Field = ({ label, hint, children, full }) => <div className={`field ${full ? 'full' : ''}`}>{label && <label>{label}</label>}{children}{hint && <span className="hint">{hint}</span>}</div>;
export const Input = ({ label, hint, full, value, onChange, ...p }) => (
  <Field label={label} hint={hint} full={full}><input className="input" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...p} /></Field>
);
export const Select = ({ label, hint, full, value, onChange, options = [], placeholder, ...p }) => (
  <Field label={label} hint={hint} full={full}>
    <select className="input" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
    </select>
  </Field>
);
export const Textarea = ({ label, hint, full, value, onChange, ...p }) => <Field label={label} hint={hint} full={full}><textarea className="input" value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} {...p} /></Field>;
export const SearchBox = ({ value, onChange, placeholder = 'Search…' }) => <div className="search"><Search /><input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div>;

export function Button({ children, variant, loading, icon: Icon, size, ...p }) {
  return <button className={`btn ${variant ? `btn-${variant}` : ''} ${size ? `btn-${size}` : ''}`} disabled={loading || p.disabled} {...p}>{loading ? <Spinner /> : Icon && <Icon />}{children}</button>;
}

/* ---------- modal & confirm ---------- */
export function Modal({ title, onClose, children, footer, size = '' }) {
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose?.(); document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-h"><h3>{title}</h3><button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
  );
}

/** Form modal that handles submit state + server errors */
export function FormModal({ title, onClose, onSubmit, submitLabel = 'Save', children, size, danger }) {
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const go = async (e) => { e?.preventDefault(); setBusy(true); setErr(''); try { await onSubmit(); } catch (x) { setErr(x.message); } finally { setBusy(false); } };
  return (
    <Modal title={title} onClose={onClose} size={size} footer={<><Button onClick={onClose} type="button">Cancel</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={go}>{submitLabel}</Button></>}>
      <form onSubmit={go} className="stack">{err && <Alert tone="bad">{err}</Alert>}{children}<button type="submit" hidden /></form>
    </Modal>
  );
}

export function useConfirm() {
  const [state, setState] = useState(null);
  const ask = (opts) => new Promise((resolve) => setState({ ...opts, resolve }));
  const close = (v) => { state?.resolve(v); setState(null); };
  const node = state ? (
    <Modal title={state.title || 'Are you sure?'} size="narrow" onClose={() => close(false)}
      footer={<><Button onClick={() => close(false)}>Cancel</Button><Button variant={state.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{state.confirm || 'Confirm'}</Button></>}>
      <p style={{ margin: '4px 0 10px' }}>{state.message}</p>
    </Modal>
  ) : null;
  return [ask, node];
}

/* ---------- table ---------- */
export function Table({ columns, rows, onRowClick, empty = 'No records found', loading, rowKey = 'id' }) {
  if (loading) return <Loading />;
  if (!rows?.length) return <Empty title={empty} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr>{columns.map((c) => <th key={c.key || c.title} className={c.align === 'right' ? 'right' : ''}>{c.title}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r[rowKey] ?? i} className={onRowClick ? 'clickable' : ''} onClick={() => onRowClick?.(r)}>
            {columns.map((c) => <td key={c.key || c.title} className={`${c.align === 'right' ? 'right mono' : ''} ${c.nowrap ? 'nowrap' : ''}`}>{c.render ? c.render(r) : r[c.key]}</td>)}
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

export const STATUS_TONE = { active: 'ok', paid: 'ok', approved: 'ok', verified: 'ok', resolved: 'ok', success: 'ok', completed: 'ok', P: 'ok', published: 'ok',
  pending: 'warn', partial: 'warn', unpaid: 'warn', in_progress: 'warn', open: 'warn', slip_submitted: 'warn', handed_to_clerk: 'info', collected: 'info', draft: 'gray', finalized: 'info', running: 'info', L: 'warn',
  inactive: 'bad', rejected: 'bad', cancelled: 'gray', refunded: 'bad', overdue: 'bad', A: 'bad', error: 'bad', closed: 'gray' };
export const StatusBadge = ({ status, label }) => <Badge tone={STATUS_TONE[status] || 'gray'}>{label || String(status).replace(/_/g, ' ')}</Badge>;
