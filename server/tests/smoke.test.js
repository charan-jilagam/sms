// Run with:  npm test   (uses an in-memory SQLite database, no files touched)
process.env.DB_PATH = ':memory:';
process.env.ENABLE_CRON = '0';
process.env.NODE_ENV = 'test';

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const { migrate } = await import('../src/db/migrate.js');
const { db, get, all, run } = await import('../src/db/index.js');
const { seedDemo } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');
const { JOBS, runJob } = await import('../src/jobs/index.js');

let server, base;
const tokens = {};
async function api(method, path, token, body) {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let data = null; try { data = await res.json(); } catch { /* none */ }
  return { status: res.status, data };
}
const login = async (identifier, password) => (await api('POST', '/api/auth/login', null, { identifier, password }));

before(async () => {
  migrate({ quiet: true });
  db.transaction(seedDemo)();
  server = createApp().listen(0); await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [k, id, pw] of [['admin', 'admin@school.test', 'Admin@123'], ['ct', 'anita@school.test', 'Teacher@123'], ['ct2', 'rahul@school.test', 'Teacher@123'], ['sub', 'meera@school.test', 'Teacher@123'],
    ['fin', 'finance@school.test', 'Finance@123'], ['parent', '9000000001', 'Parent@123'], ['parent2', '9000000002', 'Parent@123'], ['student', 'ADM2026-0001', 'Student@123'], ['driver', 'driver1@school.test', 'Driver@123']]) {
    const r = await login(id, pw); assert.equal(r.status, 200, `login ${k}: ${JSON.stringify(r.data)}`); tokens[k] = r.data.token;
  }
});
after(() => server.close());

test('login: wrong password, pending and unknown accounts are rejected', async () => {
  assert.equal((await login('admin@school.test', 'nope')).status, 401);
  const p = await login('9444444401', 'Parent@123'); assert.equal(p.status, 403); assert.match(p.data.error, /approval/i);
  assert.equal((await api('GET', '/api/dashboard')).status, 401);
});

test('dashboards load for every role', async () => {
  for (const k of ['admin', 'ct', 'fin', 'parent', 'student', 'driver']) { const r = await api('GET', '/api/dashboard', tokens[k]); assert.equal(r.status, 200, k); }
  const a = (await api('GET', '/api/dashboard', tokens.admin)).data; assert.ok(a.counts.students >= 24); assert.equal(a.pending.approvals, 2);
});

test('RBAC: families see only their own children; staff areas are closed to others', async () => {
  const kid = get('SELECT id FROM students WHERE admission_no = ?', 'ADM2026-0001').id;
  const other = get('SELECT id FROM students WHERE admission_no = ?', 'ADM2026-0003').id;
  assert.equal((await api('GET', `/api/students/${kid}`, tokens.parent)).status, 200);
  assert.equal((await api('GET', `/api/students/${other}`, tokens.parent)).status, 403);
  assert.equal((await api('GET', `/api/students/${other}`, tokens.student)).status, 403);
  assert.equal((await api('GET', '/api/finance/overview', tokens.parent)).status, 403);
  assert.equal((await api('GET', '/api/finance/overview', tokens.ct)).status, 403);
  assert.equal((await api('GET', '/api/users', tokens.ct)).status, 403);
  assert.equal((await api('GET', '/api/hr/employees', tokens.driver)).status, 403);
  assert.equal((await api('GET', '/api/students', tokens.driver)).status, 200);
  const list = (await api('GET', '/api/students', tokens.parent)).data; assert.equal(list.rows.length, 1);
  assert.equal((await api('GET', '/api/students', tokens.parent2)).data.rows.length, 2);        // two children, two classes
  assert.ok((await api('GET', '/api/students', tokens.ct)).data.rows.length >= 8);
  assert.equal((await api('GET', '/api/students/lookup?mobile=9000000001', tokens.parent)).status, 403);   // lookup is staff-only
});

test('students: mobile+name is unique, lookup works, FTS search works', async () => {
  const dup = await api('POST', '/api/students', tokens.admin, { name: 'Aarav Rao', mobile: '9000000001', class_id: 1 });
  const ex = get("SELECT name, mobile FROM students WHERE id = 1");
  const r = await api('POST', '/api/students', tokens.admin, { name: ex.name, mobile: ex.mobile, class_id: 1 });
  assert.equal(r.status, 409); assert.match(r.data.error, /already exists/);
  assert.notEqual(dup.status, 500);
  const lk = await api('GET', `/api/students/lookup?mobile=${ex.mobile}&name=${encodeURIComponent(ex.name)}`, tokens.admin); assert.equal(lk.data.rows.length, 1);
  const q = await api('GET', `/api/students?q=${encodeURIComponent(ex.name.slice(0, 4))}`, tokens.admin); assert.ok(q.data.rows.length >= 1);
  const c = await api('POST', '/api/students', tokens.admin, { name: 'Test Child', mobile: '9555555501', class_id: 1, create_parent: true, guardian_name: 'Test Parent' });
  assert.equal(c.status, 201); assert.ok(c.data.student_login.temp_password); assert.ok(c.data.parent_login.temp_password);
  assert.equal((await login('9555555501', c.data.parent_login.temp_password)).status, 200);
});

test('attendance: only class teacher marks; absent alerts; approved leave shows as L', async () => {
  const cls = get("SELECT id FROM classes WHERE name='6' AND section='A'").id;
  const roster = (await api('GET', `/api/attendance/class/${cls}`, tokens.ct)).data;
  const recs = roster.rows.map((s, i) => ({ student_id: s.student_id, status: i === 0 ? 'A' : 'P' }));
  assert.equal((await api('POST', `/api/attendance/class/${cls}`, tokens.ct2, { date: roster.date, records: recs })).status, 403);   // another class's teacher (only subject-teaches here)
  assert.equal((await api('POST', `/api/attendance/class/${cls}`, tokens.sub, { date: roster.date, records: recs })).status, 403);    // subject teacher cannot mark
  const ok = await api('POST', `/api/attendance/class/${cls}`, tokens.ct, { date: roster.date, records: recs }); assert.equal(ok.status, 200); assert.equal(ok.data.absent_alerts, 1);
  const n = get("SELECT COUNT(*) n FROM notifications WHERE kind='attendance' AND title='Absent today'").n; assert.ok(n >= 1);
  assert.equal((await api('POST', `/api/attendance/class/${cls}`, tokens.ct, { date: '2999-01-01', records: recs })).status, 400);
  const s = await api('GET', `/api/attendance/student/${roster.rows[1].student_id}`, tokens.parent); assert.equal(s.status, 200); assert.ok(s.data.summary.total > 30);
});

test('leave: parent -> class teacher -> attendance register', async () => {
  const kid = get('SELECT id FROM students WHERE admission_no = ?', 'ADM2026-0001').id;
  const bad = await api('POST', '/api/leaves', tokens.parent, { student_id: kid, from_date: '2026-01-01', to_date: '2026-01-02', reason: 'x y z' }); assert.equal(bad.status, 400);
  const from = new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10);
  const mk = await api('POST', '/api/leaves', tokens.parent, { student_id: kid, from_date: from, to_date: from, reason: 'Wedding' }); assert.equal(mk.status, 201);
  const ct = get("SELECT id FROM users WHERE email='anita@school.test'").id; assert.equal(mk.data.routed_to, ct);
  assert.equal((await api('POST', `/api/leaves/${mk.data.id}/decide`, tokens.ct2, { decision: 'approved' })).status, 403);
  assert.equal((await api('POST', `/api/leaves/${mk.data.id}/decide`, tokens.parent, { decision: 'approved' })).status, 403);
  assert.equal((await api('POST', `/api/leaves/${mk.data.id}/decide`, tokens.ct, { decision: 'approved', note: 'ok' })).status, 200);
  const dow = new Date(`${from}T00:00:00Z`).getUTCDay();
  if (dow !== 0) assert.equal(get('SELECT status FROM attendance WHERE student_id = ? AND date = ?', kid, from)?.status, 'L');
});

test('change requests: only the class teacher approves soft fields; name changes need admin', async () => {
  const kid = get('SELECT id FROM students WHERE admission_no = ?', 'ADM2026-0002').id;
  const p = tokens.parent2;
  const a = await api('POST', '/api/change-requests', p, { student_id: kid, field: 'blood_group', new_value: 'B-' }); assert.equal(a.status, 201); assert.equal(a.data.goes_to, 'class teacher');
  const nm = await api('POST', '/api/change-requests', p, { student_id: kid, field: 'name', new_value: 'Diya Nair-Menon' }); assert.equal(nm.data.goes_to, 'admin');
  assert.equal((await api('POST', `/api/change-requests/${nm.data.id}/decide`, tokens.ct2, { decision: 'approved' })).status, 403);
  assert.equal((await api('POST', `/api/change-requests/${a.data.id}/decide`, tokens.ct2, { decision: 'approved' })).status, 403);   // not this class's teacher
  assert.equal((await api('POST', `/api/change-requests/${a.data.id}/decide`, tokens.ct, { decision: 'approved' })).status, 200);
  assert.equal(get('SELECT blood_group b FROM students WHERE id = ?', kid).b, 'B-');
  assert.equal((await api('POST', `/api/change-requests/${nm.data.id}/decide`, tokens.admin, { decision: 'approved' })).status, 200);
  assert.equal(get('SELECT name FROM students WHERE id = ?', kid).name, 'Diya Nair-Menon');
});

test('deactivation: CT or admin; admin decision wins; locked-out immediately', async () => {
  const s = get('SELECT id, user_id FROM students WHERE admission_no = ?', 'ADM2026-0003');
  const stuTok = (await login('ADM2026-0003', 'Student@123')).data.token;
  assert.equal((await api('GET', '/api/dashboard', stuTok)).status, 200);
  assert.equal((await api('POST', `/api/students/${s.id}/deactivate`, tokens.sub, { reason: 'left' })).status, 403);          // subject teacher
  assert.equal((await api('POST', `/api/students/${s.id}/deactivate`, tokens.ct, { reason: 'Transferred out' })).status, 200);
  assert.equal((await api('GET', '/api/dashboard', stuTok)).status, 403);                                                       // existing token dead
  assert.equal((await login('ADM2026-0003', 'Student@123')).status, 403);
  assert.equal((await api('POST', `/api/students/${s.id}/activate`, tokens.ct, {})).status, 200);                               // CT undoes own action
  assert.equal((await api('POST', `/api/students/${s.id}/deactivate`, tokens.admin, { reason: 'Fee default' })).status, 200);
  assert.equal((await api('POST', `/api/students/${s.id}/activate`, tokens.ct, {})).status, 403);                               // admin decision wins
  assert.equal((await api('POST', `/api/students/${s.id}/activate`, tokens.admin, {})).status, 200);
  assert.equal((await login('ADM2026-0003', 'Student@123')).status, 200);
});

test('fees: counter payment, no overpay, idempotency, immutable payments, refund', async () => {
  const inv = get("SELECT b.* FROM v_invoice_balance b JOIN invoices i ON i.id = b.invoice_id WHERE b.status = 'unpaid' AND i.student_id IN (SELECT id FROM students WHERE class_id = 1) LIMIT 1");
  const over = await api('POST', '/api/fees/pay', tokens.fin, { invoice_id: inv.invoice_id, amount: inv.balance + 100, method: 'cash' }); assert.equal(over.status, 400);
  assert.equal((await api('POST', '/api/fees/pay', tokens.parent, { invoice_id: inv.invoice_id, amount: 10, method: 'cash' })).status, 403);
  const key = 'k-1';
  const p1 = await api('POST', '/api/fees/pay', tokens.fin, { invoice_id: inv.invoice_id, amount: 1000, method: 'cash', idempotency_key: key }); assert.equal(p1.status, 201);
  const p2 = await api('POST', '/api/fees/pay', tokens.fin, { invoice_id: inv.invoice_id, amount: 1000, method: 'cash', idempotency_key: key }); assert.equal(p2.status, 200); assert.equal(p2.data.duplicate, true);
  assert.equal(get('SELECT COUNT(*) n FROM payments WHERE invoice_id = ?', inv.invoice_id).n, 1);
  assert.equal(get('SELECT status FROM invoices WHERE id = ?', inv.invoice_id).status, 'partial');
  assert.match(p1.data.payment.receipt_no, /^RCT-\d{4}$/);
  assert.throws(() => run('DELETE FROM payments WHERE id = ?', p1.data.payment.id), /cannot be deleted/);
  assert.throws(() => run('UPDATE payments SET amount = 1 WHERE id = ?', p1.data.payment.id), /immutable/);
  assert.equal((await api('POST', `/api/fees/payments/${p1.data.payment.id}/refund`, tokens.fin, {})).status, 403);
  assert.equal((await api('POST', `/api/fees/payments/${p1.data.payment.id}/refund`, tokens.admin, {})).status, 200);
  assert.equal(get('SELECT status FROM invoices WHERE id = ?', inv.invoice_id).status, 'unpaid');
});

test('payment portal: parent pays online once, declined payment takes nothing, retries are safe', async () => {
  const kid = get('SELECT id FROM students WHERE admission_no = ?', 'ADM2026-0001').id;
  const inv = get("SELECT * FROM v_invoice_balance WHERE student_id = ? AND balance > 0 AND status <> 'cancelled' ORDER BY due_date LIMIT 1", kid);
  const o = await api('POST', '/api/fees/portal/order', tokens.parent, { invoice_id: inv.invoice_id, amount: 500 }); assert.equal(o.status, 201);
  const fail = await api('POST', '/api/fees/portal/confirm', tokens.parent, { order_ref: o.data.order_ref, method: 'card', outcome: 'fail' }); assert.equal(fail.status, 402);
  assert.equal(get('SELECT COUNT(*) n FROM payments WHERE idempotency_key = ?', `order:${o.data.order_ref}`).n, 0);
  const o2 = await api('POST', '/api/fees/portal/order', tokens.parent, { invoice_id: inv.invoice_id, amount: 500 });
  const ok = await api('POST', '/api/fees/portal/confirm', tokens.parent, { order_ref: o2.data.order_ref, method: 'upi' }); assert.equal(ok.status, 200);
  const again = await api('POST', '/api/fees/portal/confirm', tokens.parent, { order_ref: o2.data.order_ref, method: 'upi' }); assert.equal(again.data.duplicate, true);
  assert.equal(get('SELECT COUNT(*) n FROM payments WHERE idempotency_key = ?', `order:${o2.data.order_ref}`).n, 1);
  const other = get('SELECT id FROM students WHERE admission_no = ?', 'ADM2026-0003').id;
  const oi = get('SELECT invoice_id FROM v_invoice_balance WHERE student_id = ? LIMIT 1', other).invoice_id;
  assert.equal((await api('POST', '/api/fees/portal/order', tokens.parent, { invoice_id: oi })).status, 403);   // someone else's child
  const led = await api('GET', `/api/fees/ledger/${kid}`, tokens.parent); assert.equal(led.status, 200);
  assert.equal(Math.round(led.data.closing_balance * 100), Math.round(get('SELECT SUM(balance) b FROM v_invoice_balance WHERE student_id = ?', kid).b * 100));
});

test('cron jobs: late fee is applied once, waived by admin only, reminders go out, every job runs', async () => {
  run("UPDATE settings SET value = '10' WHERE key = 'late_fee_percent'");
  const inv = get("SELECT i.id, i.amount FROM invoices i WHERE i.status = 'unpaid' AND i.due_date < date('now') AND i.late_fee = 0 LIMIT 1");
  assert.ok(inv, 'seed should contain an overdue invoice');
  await runJob('late-fees'); const after1 = get('SELECT late_fee, status FROM invoices WHERE id = ?', inv.id); assert.ok(after1.late_fee > 0);
  await runJob('late-fees'); assert.equal(get('SELECT late_fee FROM invoices WHERE id = ?', inv.id).late_fee, after1.late_fee);
  assert.equal((await api('POST', `/api/fees/invoices/${inv.id}/waive-late-fee`, tokens.fin, {})).status, 403);
  assert.equal((await api('POST', `/api/fees/invoices/${inv.id}/waive-late-fee`, tokens.admin, {})).status, 200);
  await runJob('late-fees'); assert.equal(get('SELECT late_fee FROM invoices WHERE id = ?', inv.id).late_fee, 0);
  run("UPDATE invoices SET due_date = date('now','+3 days'), reminder_sent_on = NULL WHERE id = (SELECT id FROM invoices WHERE status='unpaid' LIMIT 1)");
  const r = await runJob('fee-reminders'); assert.equal(r.status, 'ok'); assert.match(r.message, /[1-9]\d* reminder/);
  for (const name of Object.keys(JOBS)) assert.equal((await runJob(name)).status, 'ok', name);
  assert.equal((await api('GET', '/api/system/jobs', tokens.admin)).data.rows.length, Object.keys(JOBS).length);
  assert.equal((await api('GET', '/api/system/jobs', tokens.fin)).status, 403);
});

test('timetable generator: fills the week with no teacher double-booking', async () => {
  const g = await api('POST', '/api/timetable/generate', tokens.admin, { days: 6, apply: true }); assert.equal(g.status, 200);
  assert.equal(g.data.unplaced.length, 0, JSON.stringify(g.data.unplaced));
  const clash = get('SELECT COUNT(*) n FROM (SELECT teacher_id, day, period_id, COUNT(*) c FROM timetable WHERE teacher_id IS NOT NULL GROUP BY 1,2,3 HAVING c > 1)').n; assert.equal(clash, 0);
  const per = get('SELECT COUNT(*) n FROM timetable WHERE class_id = 1').n; assert.equal(per, 28);                       // 5+6+5+4+4+2+2
  assert.equal((await api('GET', '/api/timetable?class_id=1', tokens.parent)).status, 200);
  assert.equal((await api('GET', '/api/timetable?class_id=2', tokens.parent)).status, 400);                            // not their class
  assert.equal((await api('POST', '/api/timetable/generate', tokens.ct, { apply: true })).status, 403);
});

test('transport: driver trip, GPS, parent live view, arrival alerts', async () => {
  const kid = get('SELECT s.id FROM students s JOIN student_transport st ON st.student_id = s.id WHERE s.admission_no = ?', 'ADM2026-0001').id;
  assert.equal((await api('POST', '/api/transport/location', tokens.driver, { lat: 17.7, lng: 83.3 })).status, 409);       // no trip yet
  assert.equal((await api('POST', '/api/transport/trips/start', tokens.driver, { kind: 'pickup' })).status, 201);
  assert.equal((await api('POST', '/api/transport/trips/start', tokens.driver, { kind: 'pickup' })).status, 409);          // already running
  const before_ = get("SELECT COUNT(*) n FROM notifications WHERE kind='transport'").n;
  assert.equal((await api('POST', '/api/transport/location', tokens.driver, { lat: 17.7371, lng: 83.3331, speed: 30 })).status, 200);   // at stop 1
  assert.ok(get("SELECT COUNT(*) n FROM notifications WHERE kind='transport'").n > before_);
  const live = await api('GET', `/api/transport/live/student/${kid}`, tokens.parent); assert.equal(live.status, 200);
  assert.equal(live.data.trip.kind, 'pickup'); assert.ok(live.data.location.lat);
  const notMine = get('SELECT id FROM students WHERE admission_no = ?', 'ADM2026-0003').id;
  assert.equal((await api('GET', `/api/transport/live/student/${notMine}`, tokens.parent)).status, 403);
  assert.equal((await api('GET', '/api/transport/fleet', tokens.admin)).data.rows.length, 2);
  assert.equal((await api('GET', '/api/transport/fleet', tokens.parent)).status, 403);
  assert.equal((await api('POST', '/api/transport/trips/end', tokens.driver, {})).status, 200);
});

test('approvals: self-registered parent waits for admin, children get linked', async () => {
  const r = await api('POST', '/api/auth/register', null, { role: 'parent', name: 'New Parent', mobile: '9666666601', password: 'Passw0rd!x', children: [{ admission_no: 'ADM2026-0004', relation: 'father' }] });
  assert.equal(r.status, 201);
  assert.equal((await login('9666666601', 'Passw0rd!x')).status, 403);
  const u = get('SELECT id FROM users WHERE mobile = ?', '9666666601');
  assert.equal((await api('POST', `/api/users/${u.id}/approve`, tokens.ct, {})).status, 403);
  const ap = await api('POST', `/api/users/${u.id}/approve`, tokens.admin, {}); assert.equal(ap.data.children_linked, 1);
  const l = await login('9666666601', 'Passw0rd!x'); assert.equal(l.status, 200);
  assert.equal((await api('GET', '/api/students', l.data.token)).data.rows.length, 1);
  assert.equal((await api('POST', `/api/users/${u.id}/deactivate`, tokens.admin, {})).status, 200);
  assert.equal((await api('GET', '/api/students', l.data.token)).status, 403);
});

test('payroll: generate -> finalize -> pay books an expense and notifies staff', async () => {
  const month = '2031-01';
  const g = await api('POST', '/api/hr/payroll/runs', tokens.fin, { month }); assert.equal(g.status, 201); assert.ok(g.data.created >= 10);
  const again = await api('POST', '/api/hr/payroll/runs', tokens.fin, { month }); assert.equal(again.data.created, 0);
  assert.equal((await api('POST', `/api/hr/payroll/runs/${g.data.id}/pay`, tokens.fin, {})).status, 409);                    // must finalize first
  assert.equal((await api('POST', `/api/hr/payroll/runs/${g.data.id}/finalize`, tokens.fin, {})).status, 200);
  const exp0 = get('SELECT COUNT(*) n FROM expenses').n;
  assert.equal((await api('POST', `/api/hr/payroll/runs/${g.data.id}/pay`, tokens.admin, {})).status, 200);
  assert.equal(get('SELECT COUNT(*) n FROM expenses').n, exp0 + 1);
  const mine = await api('GET', '/api/hr/my/payslips', tokens.driver); assert.ok(mine.data.rows.some((x) => x.month === month));
  assert.equal((await api('GET', '/api/hr/payroll/runs', tokens.driver)).status, 403);
});

test('support tickets, diary, announcements and community respect audiences', async () => {
  const kid = get('SELECT id FROM students WHERE admission_no = ?', 'ADM2026-0001').id;
  const t = await api('POST', '/api/tickets', tokens.parent, { student_id: kid, subject: 'Bus timing', message: 'Is the bus late today?' }); assert.equal(t.status, 201);
  assert.equal((await api('GET', `/api/tickets/${t.data.id}`, tokens.ct2)).status, 403);
  assert.equal((await api('POST', `/api/tickets/${t.data.id}/messages`, tokens.ct, { message: 'Checking now' })).status, 201);
  assert.equal(get('SELECT status FROM tickets WHERE id = ?', t.data.id).status, 'in_progress');
  assert.equal((await api('PUT', `/api/tickets/${t.data.id}/status`, tokens.ct, { status: 'resolved' })).status, 200);
  const staffOnly = await api('POST', '/api/announcements', tokens.admin, { title: 'Staff only secret', audience: 'staff' }); assert.equal(staffOnly.status, 201);
  const seen = (await api('GET', '/api/announcements', tokens.parent)).data.rows; assert.equal(seen.some((a) => a.title === 'Staff only secret'), false);
  assert.equal((await api('GET', '/api/announcements', tokens.sub)).data.rows.some((a) => a.title === 'Staff only secret'), true);
  assert.equal((await api('POST', '/api/diary', tokens.parent, { class_id: 1, title: 'x' })).status, 403);
  assert.equal((await api('POST', '/api/diary', tokens.sub, { class_id: 1, title: 'Subject teacher note' })).status, 201);
  assert.equal((await api('POST', '/api/diary', tokens.ct, { class_id: 1, title: 'Revise tables', homework_due: '2030-01-01' })).status, 201);
  const feed = (await api('GET', '/api/community', tokens.parent)).data.rows; assert.ok(feed.length >= 2);
  assert.equal((await api('GET', '/api/community', tokens.driver)).status, 403);
});

test('finance: deposits flow, budgets and expense guard-rails', async () => {
  const undep = (await api('GET', '/api/finance/deposits', tokens.fin)).data.undeposited;
  assert.ok(undep.length > 0, 'seed leaves some cash undeposited');
  const d = await api('POST', '/api/finance/deposits', tokens.fin, { payment_ids: [undep[0].id] }); assert.equal(d.status, 201);
  assert.equal((await api('POST', '/api/finance/deposits', tokens.fin, { payment_ids: [undep[0].id] })).status, 409);       // cannot bank twice
  const adv = (s, b = {}) => api('POST', `/api/finance/deposits/${d.data.id}/advance`, tokens.fin, { status: s, ...b });
  assert.equal((await adv('verified')).status, 409);
  assert.equal((await adv('handed_to_clerk')).status, 200);
  assert.equal((await adv('slip_submitted')).status, 400);                                                                   // slip reference required
  assert.equal((await adv('slip_submitted', { slip_ref: 'SLIP-1' })).status, 200);
  assert.equal((await adv('verified')).status, 403);                                                                         // only admin verifies
  assert.equal((await api('POST', `/api/finance/deposits/${d.data.id}/advance`, tokens.admin, { status: 'verified' })).status, 200);
  const e = await api('POST', '/api/finance/expenses', tokens.fin, { category: 'Events', amount: 999999, vendor: 'Big Stage Co' }); assert.equal(e.status, 201); assert.match(e.data.warning, /over budget/);
  const b = (await api('GET', '/api/finance/budgets', tokens.fin)).data; assert.ok(b.rows.find((x) => x.category === 'Events').used_percent > 100);
  const rep = await api('GET', '/api/reports/outstanding', tokens.fin); assert.ok(rep.data.rows.length > 0);
  const csv = await fetch(`${base}/api/reports/outstanding?format=csv`, { headers: { Authorization: `Bearer ${tokens.fin}` } }); assert.match(await csv.text(), /^student_id,student/);
});

test('exams: subject teacher can only enter marks for own subject; results hidden until published', async () => {
  const exam = get("SELECT id FROM exams WHERE name='Mid Term' AND class_id = 1").id;
  const grid = (await api('GET', `/api/exams/${exam}/marks`, tokens.sub)).data;
  const mine = grid.subjects.find((s) => s.editable), notMine = grid.subjects.find((s) => !s.editable);
  assert.ok(mine && notMine);
  const st = grid.students[0].id;
  assert.equal((await api('PUT', `/api/exams/${exam}/marks`, tokens.sub, { entries: [{ student_id: st, subject_id: notMine.subject_id, marks: 50 }] })).status, 403);
  assert.equal((await api('PUT', `/api/exams/${exam}/marks`, tokens.sub, { entries: [{ student_id: st, subject_id: mine.subject_id, marks: 101 }] })).status, 400);
  assert.equal((await api('PUT', `/api/exams/${exam}/marks`, tokens.sub, { entries: [{ student_id: st, subject_id: mine.subject_id, marks: 88 }] })).status, 200);
  const kid = get('SELECT id FROM students WHERE admission_no = ?', 'ADM2026-0001').id;
  const hidden = (await api('GET', `/api/results/student/${kid}`, tokens.parent)).data.results; assert.equal(hidden.some((r) => r.exam.name === 'Mid Term'), false);
  assert.equal((await api('POST', `/api/exams/${exam}/publish`, tokens.sub, {})).status, 403);
  assert.equal((await api('POST', `/api/exams/${exam}/publish`, tokens.ct, {})).status, 200);
  const shown = (await api('GET', `/api/results/student/${kid}`, tokens.parent)).data.results; assert.equal(shown.some((r) => r.exam.name === 'Mid Term'), true);
});
