import { Phone, Clock, MapPin, Bus as BusIcon, Navigation } from 'lucide-react';
import { useFetch, useInterval } from '../lib/hooks.js';
import { useChild } from '../lib/child.jsx';
import { Alert, Badge, Card, Empty, ErrorBox, Loading, PageHead, Stat } from '../components/ui.jsx';
import RouteMap from '../components/RouteMap.jsx';
import { ago } from '../lib/format.js';

export default function Bus() {
  const { child } = useChild(); const { data, loading, error, reload } = useFetch(child ? `/transport/live/student/${child.id}` : null, [child?.id]);
  useInterval(reload, 8000, !!child);
  if (!child) return <Empty title="No child selected" />; if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data?.assigned) return <><PageHead title="Bus tracking" sub={child.name} /><Card><Empty title="Not using school transport" icon={BusIcon}>If this is wrong, raise a support ticket and the admin will assign a route.</Empty></Card></>;
  const running = !!data.trip; const stale = data.location && data.location.age_seconds > 120;
  return (
    <>
      <PageHead title="Bus tracking" sub={`${child.name} · ${data.route.name}`}><Badge tone={running ? 'ok' : 'gray'}>{running ? `Trip running · ${data.trip.kind}` : 'No trip running'}</Badge></PageHead>
      {!running && <Alert>The bus has not started yet. You will be notified when the driver starts the trip.</Alert>}
      <div className="grid g3" style={{ margin: '14px 0' }}>
        <Stat icon={Navigation} label="Distance to your stop" value={data.distance_to_stop_m == null ? '-' : data.distance_to_stop_m >= 1000 ? `${(data.distance_to_stop_m / 1000).toFixed(1)} km` : `${data.distance_to_stop_m} m`} sub={data.my_stop?.name || 'No stop assigned'} tone={data.distance_to_stop_m != null && data.distance_to_stop_m < 500 ? 'ok' : undefined} />
        <Stat icon={Clock} label="Last location update" value={data.location ? ago(data.location.updated_at) : '-'} sub={stale ? 'Signal looks stale' : data.location ? `${Math.round(data.location.speed || 0)} km/h` : ''} tone={stale ? 'warn' : undefined} />
        <Stat icon={MapPin} label="Your pickup time" value={data.my_stop?.pickup_time || data.route.start_time || '-'} sub={data.route.via ? `via ${data.route.via}` : ''} /></div>
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.7fr) minmax(0,1fr)', alignItems: 'start' }}>
        <Card title="Live map" action={<span className="muted small">refreshes every 8 s</span>}><RouteMap stops={data.stops} highlight={data.my_stop?.id} buses={data.location ? [{ ...data.location, label: data.vehicle?.reg_no }] : []} height={340} /></Card>
        <div className="stack">
          <Card title="Vehicle & crew">{data.vehicle ? <dl className="kv"><dt>Bus</dt><dd><b>{data.vehicle.reg_no}</b> {data.vehicle.model}</dd><dt>Driver</dt><dd>{data.vehicle.driver_name || '-'} {data.vehicle.driver_mobile && <a className="link" href={`tel:${data.vehicle.driver_mobile}`}><Phone size={12} /> {data.vehicle.driver_mobile}</a>}</dd><dt>Co-driver</dt><dd>{data.vehicle.co_driver_name || '-'} {data.vehicle.co_driver_mobile && <a className="link" href={`tel:${data.vehicle.co_driver_mobile}`}><Phone size={12} /> {data.vehicle.co_driver_mobile}</a>}</dd></dl> : <Empty title="No vehicle assigned yet" />}</Card>
          <Card title="Stops"><ol className="stops">{data.stops.map((s) => <li key={s.id} className={s.id === data.my_stop?.id ? 'mine' : ''}><b>{s.name}</b>{s.id === data.my_stop?.id && <Badge tone="warn">Your stop</Badge>}<span className="muted small">{s.pickup_time}</span></li>)}</ol></Card></div></div>
    </>
  );
}
