import { useRef, useState } from 'react';
import { Play, Square, Navigation, Phone, Users, Satellite, LocateFixed } from 'lucide-react';
import { api } from '../lib/api.js';
import { useFetch, useInterval } from '../lib/hooks.js';
import { Alert, Badge, Button, Card, Empty, Loading, PageHead, Select, Stat, Table, useConfirm, useToast } from '../components/ui.jsx';
import RouteMap from '../components/RouteMap.jsx';
import { ago } from '../lib/format.js';

export default function Drive() {
  const toast = useToast(); const [ask, node] = useConfirm(); const { data, loading, reload } = useFetch('/transport/driver/me'); const [kind, setKind] = useState('pickup'); const [mode, setMode] = useState('gps'); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const sim = useRef(0); const running = !!data?.trip;
  const send = async (lat, lng, speed) => { try { await api.post('/transport/location', { lat, lng, speed }); setMsg(`Shared at ${new Date().toLocaleTimeString()}`); reload(); } catch (e) { setMsg(e.message); } };
  const ping = () => {
    if (!running || !data) return;
    if (mode === 'sim') { const st = data.stops.filter((s) => s.lat != null); if (!st.length) return; const i = Math.min(Math.floor(sim.current / 4), st.length - 1), j = Math.min(i + 1, st.length - 1), f = (sim.current % 4) / 4; sim.current = (sim.current + 1) % (st.length * 4); send(st[i].lat + (st[j].lat - st[i].lat) * f, st[i].lng + (st[j].lng - st[i].lng) * f, 28 + Math.random() * 8); }
    else if (navigator.geolocation) navigator.geolocation.getCurrentPosition((p) => send(p.coords.latitude, p.coords.longitude, (p.coords.speed || 0) * 3.6), (e) => setMsg(`GPS error: ${e.message}. Try simulation mode.`), { enableHighAccuracy: true, timeout: 8000 });
    else setMsg('GPS is not available on this device');
  };
  useInterval(ping, 6000, running);
  const act = async (path, body) => { setBusy(true); try { await api.post(path, body); await reload(); } catch (e) { toast(e.message, 'bad'); } setBusy(false); };
  if (loading && !data) return <Loading />;
  if (!data?.vehicle) return <><PageHead title="Trip console" /><Card><Empty title="No vehicle assigned yet" icon={Navigation}>Please contact the school admin. Parents are notified only after a vehicle and route are linked to you.</Empty></Card></>;
  return (
    <>
      <PageHead title="Trip console" sub={`${data.vehicle.reg_no} · ${data.route?.name || 'No route'}`}><Badge tone={running ? 'ok' : 'gray'}>{running ? 'Trip running' : 'Idle'}</Badge></PageHead>
      <Card>{running ? <div className="row between"><div><b style={{ fontSize: 18 }}>{data.trip.kind === 'pickup' ? 'Morning pickup' : 'Evening drop'} in progress</b><div className="muted small">Started {ago(data.trip.started_at)} · {msg || 'Waiting for first location…'}</div></div>
          <div className="row"><Button icon={LocateFixed} onClick={ping}>Share now</Button><Button variant="danger" icon={Square} loading={busy} onClick={async () => { if (await ask({ message: 'End this trip? Parents will be told the bus has finished.', confirm: 'End trip' })) act('/transport/trips/end'); }}>End trip</Button></div></div>
        : <div className="row between"><div className="row"><div style={{ width: 190 }}><Select label="Trip type" value={kind} onChange={setKind} options={[{ value: 'pickup', label: 'Morning pickup' }, { value: 'drop', label: 'Evening drop' }]} /></div></div><Button variant="primary" icon={Play} loading={busy} onClick={() => act('/transport/trips/start', { kind })}>Start trip & notify parents</Button></div>}
        <div className="row" style={{ marginTop: 14 }}><Satellite size={16} /><span className="small">Location source</span><button className={`chip ${mode === 'gps' ? 'on' : ''}`} onClick={() => setMode('gps')}>Phone GPS</button><button className={`chip ${mode === 'sim' ? 'on' : ''}`} onClick={() => setMode('sim')}>Simulated (demo)</button></div></Card>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', alignItems: 'start', marginTop: 16 }}>
        <Card title="Route"><RouteMap stops={data.stops} buses={data.location ? [{ ...data.location, label: data.vehicle.reg_no }] : []} height={320} /></Card>
        <div className="stack"><Card title="Crew"><dl className="kv"><dt>You</dt><dd>{data.employee?.name}</dd><dt>Co-driver</dt><dd>{data.co_driver ? <>{data.co_driver.name} <a className="link" href={`tel:${data.co_driver.mobile}`}><Phone size={12} /> {data.co_driver.mobile}</a></> : 'Not assigned'}</dd><dt>Seats</dt><dd>{data.students.length} riders / {data.vehicle.capacity}</dd></dl></Card>
          <Alert>Keep this page open while driving so parents see the live position.</Alert></div></div>
      <Card title={`Riders (${data.students.length})`} pad={false} className="mt"><Table rows={data.students} empty="No students assigned" columns={[{ title: 'Student', render: (s) => <div><b>{s.name}</b><div className="muted small">{s.class_label}</div></div> }, { title: 'Stop', key: 'stop_name' }, { title: 'Contact', render: (s) => s.mobile ? <a className="link" href={`tel:${s.mobile}`}>{s.mobile}</a> : '-' }]} /></Card>
      {node}
    </>
  );
}
