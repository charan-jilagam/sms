import { Bus, School } from 'lucide-react';

/** Lightweight SVG route map. No map tiles needed (works offline).
 *  stops: [{id,name,lat,lng}], buses: [{lat,lng,label}], highlight: stop id */
export default function RouteMap({ stops = [], buses = [], highlight, height = 300 }) {
  const pts = [...stops.filter((s) => s.lat != null), ...buses.filter((b) => b?.lat != null)];
  if (!pts.length) return <div className="map-empty" style={{ height }}>No map coordinates for this route yet</div>;
  const W = 640, H = height, P = 36;
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const minLa = Math.min(...lats), maxLa = Math.max(...lats), minLn = Math.min(...lngs), maxLn = Math.max(...lngs);
  const sx = (maxLn - minLn) || 0.002, sy = (maxLa - minLa) || 0.002; const scale = Math.min((W - 2 * P) / sx, (H - 2 * P) / sy);
  const ox = (W - sx * scale) / 2, oy = (H - sy * scale) / 2;
  const X = (ln) => ox + (ln - minLn) * scale, Y = (la) => H - oy - (la - minLa) * scale;
  const line = stops.filter((s) => s.lat != null).map((s) => `${X(s.lng)},${Y(s.lat)}`).join(' ');
  const last = stops.length - 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="route-map" role="img" aria-label="Route map">
      <defs><pattern id="mg" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="var(--line)" strokeWidth="1" /></pattern></defs>
      <rect width={W} height={H} rx="14" fill="var(--bg-soft)" /><rect width={W} height={H} rx="14" fill="url(#mg)" />
      <polyline points={line} fill="none" stroke="var(--brand)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 9" opacity=".55" />
      <polyline points={line} fill="none" stroke="var(--brand)" strokeWidth="2" opacity=".35" />
      {stops.map((s, i) => s.lat == null ? null : (
        <g key={s.id ?? i} transform={`translate(${X(s.lng)},${Y(s.lat)})`}>
          {i === last ? <><circle r="13" fill="var(--ok)" /><text y="4" textAnchor="middle" fontSize="12" fill="#fff">🏫</text></> : <circle r={s.id === highlight ? 10 : 7} fill={s.id === highlight ? 'var(--warn)' : 'var(--card)'} stroke={s.id === highlight ? 'var(--warn)' : 'var(--brand)'} strokeWidth="3" />}
          <text y={i === last ? -19 : -14} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text)" style={{ paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3 }}>{s.name}</text>
        </g>))}
      {buses.filter((b) => b?.lat != null).map((b, i) => (
        <g key={i} transform={`translate(${X(b.lng)},${Y(b.lat)})`}><circle r="20" fill="var(--bad)" opacity=".18"><animate attributeName="r" values="14;26;14" dur="2s" repeatCount="indefinite" /></circle><circle r="13" fill="var(--bad)" stroke="#fff" strokeWidth="2" /><text y="5" textAnchor="middle" fontSize="13">🚌</text>{b.label && <text y="30" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)" style={{ paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3 }}>{b.label}</text>}</g>))}
    </svg>
  );
}
