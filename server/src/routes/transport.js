import { Router } from 'express';
import { get, all, run, tx } from '../db/index.js';
import { ah, bad, notFound, forbidden, conflict, str, int, num, date, oneOf } from '../utils/http.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { audit } from '../utils/audit.js';
import { notify, parentIdsOf } from '../utils/notify.js';
import { childIds, driverVehicle, studentAccess } from '../utils/access.js';
import { haversine } from '../utils/geo.js';

const r = Router();
r.use(authenticate);
const admin = requireRole('admin');

// Stops we already announced for a running trip: tripId -> Set(stopId)
const announced = new Map();

// ----------------------------------------------------------------- vehicles
const VEH = `SELECT v.*, d.name AS driver_name, d.mobile AS driver_mobile, d.license_no, d.license_expiry, d.user_id AS driver_user_id,
   cd.name AS co_driver_name, cd.mobile AS co_driver_mobile,
   (SELECT r.name FROM routes r WHERE r.vehicle_id = v.id LIMIT 1) AS route_name,
   (SELECT COUNT(*) FROM trips t WHERE t.vehicle_id = v.id AND t.status = 'running') AS running
   FROM vehicles v LEFT JOIN employees d ON d.id = v.driver_employee_id LEFT JOIN employees cd ON cd.id = v.co_driver_employee_id`;

r.get('/vehicles', requireRole('admin', 'finance'), ah((_req, res) => res.json({ rows: all(`${VEH} ORDER BY v.reg_no`) })));
function vehBody(b) {
  const d = int(b.driver_employee_id || null, 'driver', { required: false }), cd = int(b.co_driver_employee_id || null, 'co-driver', { required: false });
  if (d && !get("SELECT 1 x FROM employees WHERE id = ? AND type = 'driver'", d)) throw bad('Selected driver is not a driver employee');
  if (cd && !get("SELECT 1 x FROM employees WHERE id = ? AND type = 'co_driver'", cd)) throw bad('Selected co-driver is not a co-driver employee');
  return [str(b.reg_no, 'Registration no', { max: 20 }).toUpperCase(), str(b.model, 'Model', { required: false, max: 60 }), int(b.capacity ?? 40, 'Capacity', { min: 1, max: 100 }),
    date(b.insurance_expiry || null, 'insurance expiry', { required: false }), date(b.fitness_expiry || null, 'fitness expiry', { required: false }), d, cd, oneOf(b.status || 'active', ['active', 'maintenance', 'inactive'], 'status')];
}
r.post('/vehicles', admin, ah((req, res) => {
  const id = run('INSERT INTO vehicles(reg_no, model, capacity, insurance_expiry, fitness_expiry, driver_employee_id, co_driver_employee_id, status) VALUES (?,?,?,?,?,?,?,?)', ...vehBody(req.body)).lastInsertRowid;
  audit(req, 'create_vehicle', 'vehicle', id); res.status(201).json({ id });
}));
r.put('/vehicles/:id', admin, ah((req, res) => {
  const ex = get('SELECT * FROM vehicles WHERE id = ?', req.params.id); if (!ex) throw notFound();
  run('UPDATE vehicles SET reg_no=?, model=?, capacity=?, insurance_expiry=?, fitness_expiry=?, driver_employee_id=?, co_driver_employee_id=?, status=? WHERE id=?', ...vehBody({ ...ex, ...req.body }), ex.id);
  audit(req, 'update_vehicle', 'vehicle', ex.id); res.json({ ok: true });
}));
r.delete('/vehicles/:id', admin, ah((req, res) => {
  if (get('SELECT 1 x FROM trips WHERE vehicle_id = ?', req.params.id)) throw conflict('This vehicle has trip history. Mark it inactive instead.');
  run('DELETE FROM vehicles WHERE id = ?', req.params.id); res.json({ ok: true });
}));

// ------------------------------------------------------------------- routes
r.get('/routes', requireRole('admin', 'finance', 'teacher'), ah((_req, res) => {
  const rows = all(`SELECT r.*, v.reg_no, d.name AS driver_name, (SELECT COUNT(*) FROM student_transport st WHERE st.route_id = r.id) AS riders
    FROM routes r LEFT JOIN vehicles v ON v.id = r.vehicle_id LEFT JOIN employees d ON d.id = v.driver_employee_id ORDER BY r.name`);
  for (const x of rows) x.stops = all('SELECT * FROM route_stops WHERE route_id = ? ORDER BY seq', x.id);
  res.json({ rows });
}));
r.post('/routes', admin, ah((req, res) => {
  const b = req.body;
  const id = tx(() => {
    const rid = run('INSERT INTO routes(name, via, vehicle_id, start_time, end_time, fare) VALUES (?,?,?,?,?,?)', str(b.name, 'Route name', { max: 80 }), str(b.via, 'Via details', { required: false, max: 300 }),
      int(b.vehicle_id || null, 'vehicle', { required: false }), str(b.start_time, 'start', { required: false, max: 5 }), str(b.end_time, 'end', { required: false, max: 5 }), num(b.fare ?? 0, 'Fare', { min: 0 })).lastInsertRowid;
    (b.stops || []).forEach((s, i) => run('INSERT INTO route_stops(route_id, name, lat, lng, seq, pickup_time) VALUES (?,?,?,?,?,?)', rid, str(s.name, 'Stop name', { max: 80 }), num(s.lat ?? null, 'lat', { required: false, min: -90, max: 90 }), num(s.lng ?? null, 'lng', { required: false, min: -180, max: 180 }), i + 1, s.pickup_time || null));
    return rid;
  });
  audit(req, 'create_route', 'route', id); res.status(201).json({ id });
}));
r.put('/routes/:id', admin, ah((req, res) => {
  const ex = get('SELECT * FROM routes WHERE id = ?', req.params.id); if (!ex) throw notFound();
  const b = { ...ex, ...req.body };
  tx(() => {
    run('UPDATE routes SET name=?, via=?, vehicle_id=?, start_time=?, end_time=?, fare=? WHERE id=?', str(b.name, 'Route name', { max: 80 }), str(b.via, 'Via', { required: false, max: 300 }), int(b.vehicle_id || null, 'vehicle', { required: false }), b.start_time || null, b.end_time || null, num(b.fare ?? 0, 'Fare', { min: 0 }), ex.id);
    if (Array.isArray(req.body.stops)) {
      // keep student assignments pointing at stops that survive (matched by name)
      const keep = new Map(all('SELECT id, name FROM route_stops WHERE route_id = ?', ex.id).map((s) => [s.name, s.id]));
      const assigned = all('SELECT student_id, stop_id FROM student_transport WHERE route_id = ?', ex.id);
      const oldName = new Map([...keep].map(([n, id]) => [id, n]));
      run('UPDATE student_transport SET stop_id = NULL WHERE route_id = ?', ex.id);
      run('DELETE FROM route_stops WHERE route_id = ?', ex.id);
      const newIds = new Map();
      req.body.stops.forEach((s, i) => { const id = run('INSERT INTO route_stops(route_id, name, lat, lng, seq, pickup_time) VALUES (?,?,?,?,?,?)', ex.id, str(s.name, 'Stop name', { max: 80 }), num(s.lat ?? null, 'lat', { required: false }), num(s.lng ?? null, 'lng', { required: false }), i + 1, s.pickup_time || null).lastInsertRowid; newIds.set(s.name, id); });
      for (const a of assigned) { const nid = newIds.get(oldName.get(a.stop_id)); if (nid) run('UPDATE student_transport SET stop_id = ? WHERE student_id = ?', nid, a.student_id); }
    }
  });
  audit(req, 'update_route', 'route', ex.id); res.json({ ok: true });
}));
r.delete('/routes/:id', admin, ah((req, res) => { run('DELETE FROM routes WHERE id = ?', req.params.id); audit(req, 'delete_route', 'route', req.params.id); res.json({ ok: true }); }));

// riders
r.get('/routes/:id/riders', requireRole('admin', 'finance'), ah((req, res) => {
  res.json({ rows: all(`SELECT s.id, s.name, s.admission_no, s.mobile, c.name || '-' || c.section AS class_label, rs.name AS stop_name, st.stop_id
    FROM student_transport st JOIN students s ON s.id = st.student_id LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN route_stops rs ON rs.id = st.stop_id
    WHERE st.route_id = ? ORDER BY rs.seq, s.name`, req.params.id) });
}));
r.put('/students/:sid/transport', admin, ah((req, res) => {
  const sid = int(req.params.sid, 'student'); if (!get('SELECT 1 x FROM students WHERE id = ?', sid)) throw notFound('Student not found');
  if (!req.body.route_id) { run('DELETE FROM student_transport WHERE student_id = ?', sid); return res.json({ ok: true }); }
  const rid = int(req.body.route_id, 'route'); const stop = int(req.body.stop_id || null, 'stop', { required: false });
  if (stop && !get('SELECT 1 x FROM route_stops WHERE id = ? AND route_id = ?', stop, rid)) throw bad('Stop does not belong to the route');
  const veh = get('SELECT v.capacity FROM routes r JOIN vehicles v ON v.id = r.vehicle_id WHERE r.id = ?', rid);
  const riders = get('SELECT COUNT(*) n FROM student_transport WHERE route_id = ? AND student_id <> ?', rid, sid).n;
  if (veh && riders >= veh.capacity) throw conflict(`Vehicle is full (${veh.capacity} seats)`);
  run('INSERT INTO student_transport(student_id, route_id, stop_id) VALUES (?,?,?) ON CONFLICT(student_id) DO UPDATE SET route_id = excluded.route_id, stop_id = excluded.stop_id', sid, rid, stop);
  audit(req, 'assign_transport', 'student', sid, { route: rid }); res.json({ ok: true });
}));

// ------------------------------------------------------------ driver portal
r.get('/driver/me', requireRole('driver'), ah((req, res) => {
  const emp = get('SELECT * FROM employees WHERE user_id = ?', req.user.id);
  const vehicle = driverVehicle(req.user.id);
  if (!vehicle) return res.json({ employee: emp, vehicle: null });
  const route = get('SELECT * FROM routes WHERE vehicle_id = ?', vehicle.id);
  const stops = route ? all('SELECT * FROM route_stops WHERE route_id = ? ORDER BY seq', route.id) : [];
  const students = route ? all(`SELECT s.id, s.name, s.mobile, c.name || '-' || c.section AS class_label, rs.name AS stop_name FROM student_transport st
      JOIN students s ON s.id = st.student_id LEFT JOIN classes c ON c.id = s.class_id LEFT JOIN route_stops rs ON rs.id = st.stop_id WHERE st.route_id = ? AND s.status = 'active' ORDER BY rs.seq, s.name`, route.id) : [];
  const coDriver = vehicle.co_driver_employee_id ? get('SELECT name, mobile FROM employees WHERE id = ?', vehicle.co_driver_employee_id) : null;
  const trip = get("SELECT * FROM trips WHERE vehicle_id = ? AND status = 'running'", vehicle.id);
  const last = get('SELECT * FROM bus_locations WHERE vehicle_id = ?', vehicle.id);
  res.json({ employee: emp, vehicle, route, stops, students, co_driver: coDriver, trip, location: last });
}));

r.post('/trips/start', requireRole('driver'), ah((req, res) => {
  const v = driverVehicle(req.user.id); if (!v) throw bad('No vehicle is assigned to you yet. Please contact the admin.');
  if (v.status !== 'active') throw conflict(`Vehicle is ${v.status}`);
  const route = get('SELECT * FROM routes WHERE vehicle_id = ?', v.id); if (!route) throw bad('No route is assigned to your vehicle');
  const kind = oneOf(req.body.kind || 'pickup', ['pickup', 'drop'], 'kind');
  const id = run('INSERT INTO trips(vehicle_id, route_id, driver_user_id, kind) VALUES (?,?,?,?)', v.id, route.id, req.user.id, kind).lastInsertRowid;   // unique index blocks a 2nd running trip
  const parents = all('SELECT student_id FROM student_transport WHERE route_id = ?', route.id).flatMap((x) => parentIdsOf(x.student_id));
  notify(parents, { title: kind === 'pickup' ? 'Bus has started (morning pickup)' : 'Bus has started (evening drop)', body: `${route.name} - ${v.reg_no}`, kind: 'transport', link: '/bus', sms: true });
  audit(req, 'trip_start', 'trip', id); res.status(201).json({ id });
}));
r.post('/trips/end', requireRole('driver'), ah((req, res) => {
  const v = driverVehicle(req.user.id); if (!v) throw bad('No vehicle assigned');
  const t = get("SELECT * FROM trips WHERE vehicle_id = ? AND status = 'running'", v.id); if (!t) throw conflict('No trip is running');
  run("UPDATE trips SET status = 'completed', ended_at = datetime('now') WHERE id = ?", t.id);
  announced.delete(t.id);
  const parents = all('SELECT student_id FROM student_transport WHERE route_id = ?', t.route_id).flatMap((x) => parentIdsOf(x.student_id));
  notify(parents, { title: t.kind === 'pickup' ? 'Bus has reached school' : 'Bus trip completed', body: v.reg_no, kind: 'transport', link: '/bus' });
  audit(req, 'trip_end', 'trip', t.id); res.json({ ok: true });
}));

// location ping from the driver's phone
r.post('/location', requireRole('driver'), ah((req, res) => {
  const v = driverVehicle(req.user.id); if (!v) throw bad('No vehicle assigned');
  const t = get("SELECT * FROM trips WHERE vehicle_id = ? AND status = 'running'", v.id); if (!t) throw conflict('Start a trip before sharing location');
  const lat = num(req.body.lat, 'lat', { min: -90, max: 90 }), lng = num(req.body.lng, 'lng', { min: -180, max: 180 });
  const speed = num(req.body.speed ?? null, 'speed', { required: false, min: 0, max: 250 }), heading = num(req.body.heading ?? null, 'heading', { required: false, min: 0, max: 360 });
  run(`INSERT INTO bus_locations(vehicle_id, trip_id, lat, lng, speed, heading, updated_at) VALUES (?,?,?,?,?,?, datetime('now'))
       ON CONFLICT(vehicle_id) DO UPDATE SET trip_id = excluded.trip_id, lat = excluded.lat, lng = excluded.lng, speed = excluded.speed, heading = excluded.heading, updated_at = excluded.updated_at`, v.id, t.id, lat, lng, speed, heading);
  run('INSERT INTO bus_location_history(vehicle_id, trip_id, lat, lng, speed) VALUES (?,?,?,?,?)', v.id, t.id, lat, lng, speed);
  // "bus is arriving" alert (~200 m) for the parents at that stop, once per stop per trip
  const seen = announced.get(t.id) || new Set(); announced.set(t.id, seen);
  for (const s of all('SELECT * FROM route_stops WHERE route_id = ? AND lat IS NOT NULL AND lng IS NOT NULL', t.route_id)) {
    if (seen.has(s.id) || haversine(lat, lng, s.lat, s.lng) > 200) continue;
    seen.add(s.id);
    const parents = all('SELECT student_id FROM student_transport WHERE stop_id = ?', s.id).flatMap((x) => parentIdsOf(x.student_id));
    notify(parents, { title: `Bus is arriving at ${s.name}`, body: v.reg_no, kind: 'transport', link: '/bus', sms: true });
  }
  res.json({ ok: true });
}));

// ------------------------------------------------------------- live tracking (school + parents)
function liveFor(vehicleId) {
  const v = get('SELECT v.id, v.reg_no, v.model, v.status FROM vehicles v WHERE v.id = ?', vehicleId);
  const loc = get('SELECT lat, lng, speed, heading, updated_at, CAST((julianday(\'now\') - julianday(updated_at)) * 86400 AS INTEGER) AS age_seconds FROM bus_locations WHERE vehicle_id = ?', vehicleId);
  const trip = get("SELECT t.id, t.kind, t.started_at, r.name AS route_name FROM trips t LEFT JOIN routes r ON r.id = t.route_id WHERE t.vehicle_id = ? AND t.status = 'running'", vehicleId);
  return { vehicle: v, location: loc || null, trip: trip || null };
}
r.get('/fleet', requireRole('admin'), ah((_req, res) => {
  const rows = all('SELECT id FROM vehicles ORDER BY reg_no').map((v) => ({
    ...liveFor(v.id), route: get('SELECT r.id, r.name FROM routes r WHERE r.vehicle_id = ?', v.id),
    stops: all('SELECT rs.* FROM route_stops rs JOIN routes r ON r.id = rs.route_id WHERE r.vehicle_id = ? ORDER BY rs.seq', v.id),
  }));
  res.json({ rows });
}));
r.get('/live/student/:id', ah((req, res) => {
  const { student } = studentAccess(req.user, req.params.id);
  const t = get(`SELECT st.route_id, st.stop_id, r.name AS route_name, r.via, r.vehicle_id, r.start_time, r.end_time FROM student_transport st JOIN routes r ON r.id = st.route_id WHERE st.student_id = ?`, student.id);
  if (!t) return res.json({ assigned: false });
  const stops = all('SELECT * FROM route_stops WHERE route_id = ? ORDER BY seq', t.route_id);
  const veh = t.vehicle_id ? get(`SELECT v.reg_no, v.model, d.name AS driver_name, d.mobile AS driver_mobile, cd.name AS co_driver_name, cd.mobile AS co_driver_mobile
     FROM vehicles v LEFT JOIN employees d ON d.id = v.driver_employee_id LEFT JOIN employees cd ON cd.id = v.co_driver_employee_id WHERE v.id = ?`, t.vehicle_id) : null;
  const live = t.vehicle_id ? liveFor(t.vehicle_id) : { location: null, trip: null };
  const myStop = stops.find((s) => s.id === t.stop_id) || null;
  const distance = live.location && myStop?.lat != null ? Math.round(haversine(live.location.lat, live.location.lng, myStop.lat, myStop.lng)) : null;
  res.json({ assigned: true, route: { id: t.route_id, name: t.route_name, via: t.via, start_time: t.start_time, end_time: t.end_time }, stops, my_stop: myStop, vehicle: veh, ...live, distance_to_stop_m: distance });
}));

export default r;
