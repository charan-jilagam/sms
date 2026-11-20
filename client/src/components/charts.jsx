import { compact, monthLabel } from '../lib/format.js';

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7', '#ec4899'];
const niceMax = (v) => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

/** Grouped bar chart. series: [{name, color, key}] data: [{label, [key]: n}] */
export function BarChart({ data, series, height = 230, fmt = compact }) {
  if (!data?.length) return null;
  const W = 560, H = height, pad = { l: 46, r: 8, t: 10, b: 28 };
  const max = niceMax(Math.max(...data.flatMap((d) => series.map((s) => d[s.key] || 0))));
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, gw = iw / data.length, bw = Math.min(26, (gw * 0.7) / series.length);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Bar chart">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => { const y = pad.t + ih * (1 - t); return <g key={t}><line x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--border)" strokeDasharray={t ? '3 4' : ''} /><text x={pad.l - 8} y={y + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{fmt(max * t)}</text></g>; })}
        {data.map((d, i) => (
          <g key={i}>
            {series.map((s, j) => { const h = ((d[s.key] || 0) / max) * ih; const x = pad.l + gw * i + (gw - bw * series.length) / 2 + bw * j; return <rect key={s.key} x={x} y={pad.t + ih - h} width={bw - 2} height={Math.max(h, 0)} rx="5" fill={s.color || COLORS[j]}><title>{`${s.name}: ${fmt(d[s.key] || 0)}`}</title></rect>; })}
            <text x={pad.l + gw * i + gw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{d.label}</text>
          </g>))}
      </svg>
      <Legend series={series} />
    </div>
  );
}
export const Legend = ({ series }) => <div className="legend">{series.map((s, i) => <span key={s.key}><i style={{ background: s.color || COLORS[i] }} />{s.name}</span>)}</div>;
export const monthData = (rows) => rows.map((r) => ({ ...r, label: monthLabel(r.month) }));

export function LineChart({ data, height = 200, color = '#4f46e5', suffix = '%', min = 0, max = 100 }) {
  const pts = data.filter((d) => d.value != null);
  if (pts.length < 2) return <div className="muted small">Not enough data yet</div>;
  const W = 560, H = height, pad = { l: 38, r: 10, t: 12, b: 26 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const x = (i) => pad.l + (iw * i) / (data.length - 1), y = (v) => pad.t + ih * (1 - (v - min) / (max - min));
  const path = data.map((d, i) => (d.value == null ? null : `${i && data[i - 1].value != null ? 'L' : 'M'}${x(i)},${y(d.value)}`)).filter(Boolean).join(' ');
  const area = `${path} L${x(data.length - 1)},${pad.t + ih} L${x(0)},${pad.t + ih} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Line chart">
      <defs><linearGradient id="lg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".28" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      {[0, 0.5, 1].map((t) => <g key={t}><line x1={pad.l} x2={W - pad.r} y1={pad.t + ih * (1 - t)} y2={pad.t + ih * (1 - t)} stroke="var(--border)" strokeDasharray="3 4" /><text x={pad.l - 6} y={pad.t + ih * (1 - t) + 4} textAnchor="end" fontSize="10.5" fill="var(--muted)">{Math.round(min + (max - min) * t)}{suffix}</text></g>)}
      <path d={area} fill="url(#lg)" /><path d={path} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => d.value != null && <g key={i}><circle cx={x(i)} cy={y(d.value)} r="4.5" fill="var(--surface)" stroke={color} strokeWidth="2.5"><title>{`${d.label}: ${d.value}${suffix}`}</title></circle><text x={x(i)} y={H - 7} textAnchor="middle" fontSize="10.5" fill="var(--muted)">{d.label}</text></g>)}
    </svg>
  );
}

export function Donut({ data, size = 170, center }) {
  const total = data.reduce((a, b) => a + b.value, 0) || 1; let acc = 0; const r = 62, c = 2 * Math.PI * r;
  return (
    <div className="row" style={{ gap: 22 }}>
      <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label="Donut chart">
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="22" />
        {data.map((d, i) => { const len = (d.value / total) * c; const el = <circle key={i} cx="80" cy="80" r={r} fill="none" stroke={d.color || COLORS[i % COLORS.length]} strokeWidth="22" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-acc} transform="rotate(-90 80 80)"><title>{`${d.label}: ${d.value}`}</title></circle>; acc += len; return el; })}
        <text x="80" y="78" textAnchor="middle" fontSize="22" fontWeight="800" fill="var(--text)">{center ?? total}</text><text x="80" y="96" textAnchor="middle" fontSize="10.5" fill="var(--muted)">total</text>
      </svg>
      <div className="stack" style={{ gap: 8 }}>{data.map((d, i) => <div key={d.label} className="row small" style={{ gap: 8 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: d.color || COLORS[i % COLORS.length] }} /><span>{d.label}</span><b className="mono">{d.value}</b></div>)}</div>
    </div>
  );
}

export function HBars({ data, fmt = (v) => v }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return <div className="stack" style={{ gap: 10 }}>{data.map((d, i) => <div key={d.label}><div className="row between small"><span>{d.label}</span><b className="mono">{fmt(d.value)}</b></div><div className="progress"><i style={{ width: `${(d.value / max) * 100}%`, background: COLORS[i % COLORS.length] }} /></div></div>)}</div>;
}
