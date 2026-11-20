import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--reset') && config.dbPath !== ':memory:') {
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(config.dbPath + ext, { force: true });
  console.log('database removed');
}
const { db, run, get, all, setSetting, nextSeq } = await import('./index.js');
const { migrate } = await import('./migrate.js');
const { recalcInvoice, recordPayment } = await import('../utils/billing.js');
const { addDays, today } = await import('../utils/http.js');
const { generatePayroll } = await import('../routes/hr.js');

// deterministic PRNG so every demo database is identical
let seed = 20261121; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const hash = (p) => bcrypt.hashSync(p, 10);

export const CREDENTIALS = [
  ['Admin', 'admin@school.test', 'Admin@123'],
  ['Class teacher (6-A)', 'anita@school.test', 'Teacher@123'],
  ['Class teacher (6-B)', 'rahul@school.test', 'Teacher@123'],
  ['Subject teacher', 'meera@school.test', 'Teacher@123'],
  ['Finance / Accountant', 'finance@school.test', 'Finance@123'],
  ['Parent (child in 6-A)', '9000000001', 'Parent@123'],
  ['Parent (2 children)', '9000000002', 'Parent@123'],
  ['Student (6-A)', 'ADM2026-0001', 'Student@123'],
  ['Bus driver', 'driver1@school.test', 'Driver@123'],
];

export function seedBaseline({ adminEmail = 'admin@school.test', adminPassword = 'Admin@123' } = {}) {
  const defaults = { school_name: 'Sunrise Public School', school_address: '12 Lake View Road, Visakhapatnam', school_phone: '+91 891 000 0000', currency: 'INR', academic_year: '2026-27', late_fee_percent: '2', reminder_days_before: '3', fiscal_start_month: '4' };
  for (const [k, v] of Object.entries(defaults)) setSetting(k, v);
  const P = [['Period 1', '09:00', '09:45'], ['Period 2', '09:45', '10:30'], ['Break', '10:30', '10:50', 1], ['Period 3', '10:50', '11:35'], ['Period 4', '11:35', '12:20'], ['Lunch', '12:20', '13:00', 1], ['Period 5', '13:00', '13:45'], ['Period 6', '13:45', '14:30']];
  P.forEach((p, i) => run('INSERT OR IGNORE INTO periods(name, seq, start_time, end_time, is_break) VALUES (?,?,?,?,?)', p[0], i + 1, p[1], p[2], p[3] || 0));
  if (!get('SELECT 1 x FROM id_templates')) {
    run("INSERT INTO id_templates(name, orientation, primary_color, accent_color, is_default) VALUES ('Classic Indigo','portrait','#4f46e5','#f59e0b',1)");
    run("INSERT INTO id_templates(name, orientation, primary_color, accent_color) VALUES ('Fresh Green','landscape','#059669','#f97316')");
  }
  if (!get("SELECT 1 x FROM users WHERE role='admin'")) run("INSERT INTO users(name, email, password_hash, role, status) VALUES ('School Admin', ?, ?, 'admin', 'active')", adminEmail, hash(adminPassword));
}

export function seedDemo() {
  seedBaseline();
  const hT = hash('Teacher@123'), hF = hash('Finance@123'), hP = hash('Parent@123'), hS = hash('Student@123'), hD = hash('Driver@123');
  const user = (name, email, mobile, role, h) => run("INSERT INTO users(name, email, mobile, password_hash, role, status) VALUES (?,?,?,?,?, 'active')", name, email, mobile, h, role).lastInsertRowid;
  const employee = (uid, name, mobile, type, designation, basic, extra = {}) => run(`INSERT INTO employees(user_id, emp_code, name, mobile, type, designation, department, join_date, address, basic_salary, allowances, deductions, license_no, license_expiry, emergency_contact)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, uid, nextSeq('employee', 'EMP', 4), name, mobile, type, designation, extra.dept || null, extra.join || '2023-06-01', extra.address || 'Visakhapatnam', basic, Math.round(basic * 0.2), Math.round(basic * 0.05), extra.license || null, extra.licenseExp || null, extra.emergency || null).lastInsertRowid;

  // ---- staff ----
  const finance = user('Farah Khan', 'finance@school.test', '9111111101', 'finance', hF); employee(finance, 'Farah Khan', '9111111101', 'finance', 'Accountant', 32000, { dept: 'Accounts' });
  const admin = get("SELECT id FROM users WHERE role='admin'").id; employee(admin, 'School Admin', null, 'admin_staff', 'Principal', 70000, { dept: 'Administration' });
  const T = [['Anita Sharma', 'anita@school.test', '9111111111', 'Class Teacher'], ['Rahul Verma', 'rahul@school.test', '9111111112', 'Class Teacher'], ['Meera Nair', 'meera@school.test', '9111111113', 'Teacher'],
    ['Suresh Rao', 'suresh@school.test', '9111111114', 'Teacher'], ['Priya Das', 'priya@school.test', '9111111115', 'Teacher'], ['Imran Ali', 'imran@school.test', '9111111116', 'Teacher'], ['Kavita Joshi', 'kavita@school.test', '9111111117', 'Class Teacher']];
  const teachers = T.map(([n, e, m, d]) => { const id = user(n, e, m, 'teacher', hT); employee(id, n, m, 'teacher', d, 38000 + Math.round(rnd() * 8000), { dept: 'Academics' }); return id; });

  // ---- subjects / classes ----
  const subj = Object.fromEntries([['English', 'ENG'], ['Mathematics', 'MAT'], ['Science', 'SCI'], ['Social Studies', 'SOC'], ['Hindi', 'HIN'], ['Computer', 'COM'], ['Physical Education', 'PED']]
    .map(([n, c]) => [c, run('INSERT INTO subjects(name, code) VALUES (?,?)', n, c).lastInsertRowid]));
  const classes = [['6', 'A', teachers[0]], ['6', 'B', teachers[1]], ['7', 'A', teachers[6]]].map(([n, s, ct], i) => run('INSERT INTO classes(name, section, class_teacher_id, room, capacity) VALUES (?,?,?,?,?)', n, s, ct, `R-${101 + i}`, 40).lastInsertRowid);
  const subjTeacher = { ENG: teachers[0], MAT: teachers[2], SCI: teachers[3], SOC: teachers[4], HIN: teachers[1], COM: teachers[5], PED: teachers[5] };
  const ppw = { ENG: 5, MAT: 6, SCI: 5, SOC: 4, HIN: 4, COM: 2, PED: 2 };
  for (const c of classes) for (const code of Object.keys(subj)) run('INSERT INTO class_subjects(class_id, subject_id, teacher_id, periods_per_week) VALUES (?,?,?,?)', c, subj[code], subjTeacher[code], ppw[code]);

  // ---- transport ----
  const drv = (name, email, mob, lic, exp) => { const uid = user(name, email, mob, 'driver', hD); return employee(uid, name, mob, 'driver', 'Bus Driver', 22000, { dept: 'Transport', license: lic, licenseExp: exp, emergency: '9222222200' }); };
  const d1 = drv('Ramesh Kumar', 'driver1@school.test', '9333333301', 'AP31-2019-004211', addDays(today(), 18));
  const d2 = drv('Salim Sheikh', 'driver2@school.test', '9333333302', 'AP31-2017-001922', addDays(today(), 400));
  const c1 = employee(null, 'Venkat Reddy', '9333333311', 'co_driver', 'Bus Attendant', 14000, { dept: 'Transport', emergency: '9222222211' });
  const c2 = employee(null, 'Lakshmi Devi', '9333333312', 'co_driver', 'Bus Attendant', 14000, { dept: 'Transport' });
  const v1 = run("INSERT INTO vehicles(reg_no, model, capacity, insurance_expiry, fitness_expiry, driver_employee_id, co_driver_employee_id) VALUES ('AP31TZ4521','Tata Starbus 40-seater',40,?,?,?,?)", addDays(today(), 150), addDays(today(), 22), d1, c1).lastInsertRowid;
  const v2 = run("INSERT INTO vehicles(reg_no, model, capacity, insurance_expiry, fitness_expiry, driver_employee_id, co_driver_employee_id) VALUES ('AP31TZ7788','Ashok Leyland 32-seater',32,?,?,?,?)", addDays(today(), 300), addDays(today(), 280), d2, c2).lastInsertRowid;
  const route = (name, via, veh, stops) => { const id = run('INSERT INTO routes(name, via, vehicle_id, start_time, end_time, fare) VALUES (?,?,?,?,?,?)', name, via, veh, '07:00', '08:40', 1200).lastInsertRowid;
    return { id, stops: stops.map((s, i) => ({ id: run('INSERT INTO route_stops(route_id, name, lat, lng, seq, pickup_time) VALUES (?,?,?,?,?,?)', id, s[0], s[1], s[2], i + 1, s[3]).lastInsertRowid, name: s[0] })) }; };
  const r1 = route('Route 1 - MVP Colony', 'MVP Colony - Siripuram - Dwaraka Nagar - School', v1, [['MVP Colony', 17.7370, 83.3330, '07:05'], ['Siripuram Junction', 17.7230, 83.3150, '07:20'], ['Dwaraka Bus Stand', 17.7240, 83.3010, '07:35'], ['Gajuwaka Road', 17.7150, 83.2900, '07:50'], ['School Gate', 17.7050, 83.2780, '08:15']]);
  const r2 = route('Route 2 - Madhurawada', 'Madhurawada - Rushikonda - Beach Road - School', v2, [['Madhurawada', 17.8070, 83.3540, '07:00'], ['Rushikonda', 17.7820, 83.3850, '07:15'], ['Beach Road', 17.7160, 83.3250, '07:40'], ['School Gate', 17.7050, 83.2780, '08:10']]);

  // ---- students & parents ----
  const firsts = ['Aarav', 'Diya', 'Vihaan', 'Anaya', 'Aditya', 'Ishita', 'Krish', 'Myra', 'Reyansh', 'Saanvi', 'Arjun', 'Kiara', 'Rohan', 'Tara', 'Vivaan', 'Navya', 'Dev', 'Riya', 'Kabir', 'Zara', 'Ayaan', 'Pari', 'Neel', 'Sana'];
  const lasts = ['Sharma', 'Reddy', 'Nair', 'Rao', 'Khan', 'Das', 'Patel', 'Joshi', 'Iyer', 'Singh'];
  const students = []; let n = 0, mobileSeed = 9000000001;
  const parents = new Map();
  classes.forEach((cid, ci) => {
    for (let k = 0; k < 8; k++) {
      n++; const name = `${firsts[(n - 1) % firsts.length]} ${lasts[(n * 3) % lasts.length]}`;
      let mobile = String(mobileSeed++); let gname = `${pick(['Mr.', 'Mrs.'])} ${name.split(' ')[1]}`;
      if (n === 2) { mobile = '9000000002'; gname = 'Mrs. Nair'; }
      if (n === 12) { mobile = '9000000002'; gname = 'Mrs. Nair'; }   // sibling: same parent, different name, different class
      const adm = nextSeq('admission', 'ADM2026', 4); const idc = nextSeq('idcard', 'ID2026', 4);
      const suid = run("INSERT INTO users(name, email, password_hash, role, status) VALUES (?,?,?, 'student','active')", name, `${adm.toLowerCase()}@students.local`, hS).lastInsertRowid;
      const sid = run(`INSERT INTO students(admission_no, name, mobile, dob, gender, blood_group, address, guardian_name, class_id, roll_no, user_id, id_card_no, admitted_on) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        adm, name, mobile, `${2014 - ci}-${String(1 + (n % 12)).padStart(2, '0')}-${String(1 + (n % 27)).padStart(2, '0')}`, n % 2 ? 'male' : 'female', pick(['A+', 'B+', 'O+', 'AB+', 'O-']), `${10 + n}, Lake View Colony, Visakhapatnam`, gname, cid, k + 1, suid, idc, '2026-06-10').lastInsertRowid;
      let puid = parents.get(mobile);
      if (!puid) { puid = user(gname, mobile === '9000000001' ? 'parent1@school.test' : null, mobile, 'parent', hP); parents.set(mobile, puid); }
      run('INSERT OR IGNORE INTO parent_students(parent_user_id, student_id, relation) VALUES (?,?,?)', puid, sid, 'guardian');
      students.push({ id: sid, cid, name, k, ci });
    }
  });
  // transport assignments
  students.slice(0, 7).forEach((s, i) => { const r = i < 4 ? r1 : r2; run('INSERT INTO student_transport(student_id, route_id, stop_id) VALUES (?,?,?)', s.id, r.id, r.stops[i % (r.stops.length - 1)].id); });
  students.slice(8, 12).forEach((s, i) => run('INSERT INTO student_transport(student_id, route_id, stop_id) VALUES (?,?,?)', s.id, r2.id, r2.stops[i % 3].id));

  // ---- attendance: last ~75 days, Mon-Sat ----
  const t0 = today();
  for (let off = 75; off >= 1; off--) {
    const d = addDays(t0, -off); if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) continue;
    for (const s of students) { const x = rnd(); run('INSERT INTO attendance(student_id, class_id, date, status, marked_by) VALUES (?,?,?,?,?)', s.id, s.cid, d, x < 0.08 ? 'A' : x < 0.10 ? 'L' : 'P', teachers[s.ci === 2 ? 6 : s.ci]); }
  }
  // today: mark classes 6-B and 7-A, leave 6-A for the demo (teacher can mark it live)
  for (const s of students.filter((x) => x.ci > 0)) run("INSERT OR IGNORE INTO attendance(student_id, class_id, date, status, marked_by) VALUES (?,?,?,?,?)", s.id, s.cid, t0, rnd() < 0.1 ? 'A' : 'P', teachers[s.ci === 2 ? 6 : s.ci]);

  // ---- exams & marks ----
  classes.forEach((cid, ci) => {
    const e1 = run('INSERT INTO exams(name, class_id, start_date, end_date, max_marks, published) VALUES (?,?,?,?,?,1)', 'Unit Test 1', cid, addDays(t0, -50), addDays(t0, -46), 50).lastInsertRowid;
    const e2 = run('INSERT INTO exams(name, class_id, start_date, end_date, max_marks, published) VALUES (?,?,?,?,?,0)', 'Mid Term', cid, addDays(t0, 10), addDays(t0, 18), 100).lastInsertRowid;
    for (const s of students.filter((x) => x.cid === cid)) for (const sub of Object.values(subj).slice(0, 5)) run('INSERT INTO marks(exam_id, student_id, subject_id, marks, entered_by) VALUES (?,?,?,?,?)', e1, s.id, sub, Math.round(18 + rnd() * 31), teachers[ci]);
  });

  // ---- fees ----
  const fs_ = [];
  for (const cid of classes) for (const [name, term, amt, due] of [['Tuition Fee', 'Term 1', 18000, addDays(t0, -25)], ['Tuition Fee', 'Term 2', 18000, addDays(t0, 3)], ['Activity & Lab Fee', 'Annual', 4500, addDays(t0, 20)]]) {
    const sid = run('INSERT INTO fee_structures(class_id, name, term, amount, due_date) VALUES (?,?,?,?,?)', cid, name, term, amt, due).lastInsertRowid; fs_.push({ id: sid, cid, name, term, amt, due });
  }
  for (const f of fs_) for (const s of students.filter((x) => x.cid === f.cid)) run('INSERT INTO invoices(invoice_no, student_id, structure_id, description, amount, due_date) VALUES (?,?,?,?,?,?)', nextSeq('invoice', 'INV', 5), s.id, f.id, `${f.name} (${f.term})`, f.amt, f.due);
  // payments: most Term-1 paid (cash / upi / card), a few partial, some left overdue
  const methods = ['cash', 'upi', 'card', 'netbanking', 'cheque'];
  for (const inv of all("SELECT i.id, i.amount, i.student_id FROM invoices i JOIN fee_structures f ON f.id = i.structure_id WHERE f.term = 'Term 1'")) {
    const x = rnd(); if (x < 0.25) continue;
    db.transaction(() => { const full = x > 0.45; const amt = full ? inv.amount : Math.round(inv.amount * 0.5);
      const p = recordPayment({ invoiceId: inv.id, amount: amt, method: pick(methods), reference: `TXN${Math.floor(rnd() * 1e6)}`, userId: finance }).payment;
      run("UPDATE payments SET paid_at = datetime('now', ?) WHERE id = ?", `-${Math.floor(rnd() * 24)} days`, p.id); })();
  }
  // a concession
  run('UPDATE invoices SET discount = 2000 WHERE id = (SELECT id FROM invoices WHERE student_id = ? AND description LIKE ? LIMIT 1)', students[3].id, 'Activity%');
  all('SELECT id FROM invoices').forEach((i) => recalcInvoice(i.id));
  // bank deposit flow demo
  const cash = all("SELECT id, amount FROM payments WHERE method='cash' AND status='success' ORDER BY id LIMIT 4");
  if (cash.length) { const dep = run("INSERT INTO deposits(deposit_no, amount, status, slip_ref, created_by, verified_by) VALUES (?,?, 'verified', 'SBI-SLIP-88231', ?, ?)", nextSeq('deposit', 'DEP', 4), cash.reduce((a, b) => a + b.amount, 0), finance, admin).lastInsertRowid; cash.forEach((c) => run('UPDATE payments SET deposit_id = ? WHERE id = ?', dep, c.id)); }

  // ---- expenses & budgets ----
  const fy = '2026-27';
  for (const [cat, amt] of [['Maintenance', 120000], ['Stationery', 60000], ['Utilities', 180000], ['Transport Fuel', 150000], ['Events', 80000], ['Payroll', 3000000]]) run('INSERT INTO budgets(category, fiscal_year, amount) VALUES (?,?,?)', cat, fy, amt);
  [['Maintenance', 'Sri Sai Electricals', 'Classroom fans repair', 18500, 12], ['Stationery', 'Vijaya Books', 'Chalk, markers, registers', 9200, 20], ['Utilities', 'APEPDCL', 'Electricity bill', 41200, 9], ['Transport Fuel', 'HP Petrol Pump', 'Diesel for buses', 36800, 6], ['Events', 'Royal Decorators', 'Annual day stage', 22500, 3], ['Utilities', 'GVMC', 'Water charges', 6400, 2], ['Maintenance', 'Cool Air Services', 'AC service', 7800, 1]]
    .forEach(([c, v, d, a, ago]) => run('INSERT INTO expenses(expense_date, category, vendor, description, amount, added_by) VALUES (?,?,?,?,?,?)', addDays(t0, -ago), c, v, d, a, finance));

  // ---- announcements / events / holidays / diary ----
  const ann = (kind, title, body, start, end, aud = 'all', cls = null, pinned = 0) => run('INSERT INTO announcements(kind, title, body, start_date, end_date, audience, class_id, pinned, created_by) VALUES (?,?,?,?,?,?,?,?,?)', kind, title, body, start, end, aud, cls, pinned, admin);
  ann('notice', 'Welcome to the new academic year', 'Classes run 9:00 AM to 2:30 PM. Please keep the school ID card with the student at all times.', addDays(t0, -30), null, 'all', null, 1);
  ann('event', 'Annual Sports Day', 'Parents are welcome from 8:30 AM. Students to wear house colours.', addDays(t0, 12), null);
  ann('event', 'Parent-Teacher Meeting', 'PTM for classes 6 and 7 between 10:00 AM and 1:00 PM.', addDays(t0, 6), null, 'parents');
  ann('holiday', 'Diwali Holidays', 'School closed for Diwali.', addDays(t0, 20), addDays(t0, 23));
  ann('holiday', 'Founders Day', 'School closed.', addDays(t0, 35), null);
  ann('circular', 'Fee payment now available online', 'Parents can pay Term 2 fees securely from the Fees page.', addDays(t0, -2), null, 'parents');
  ann('notice', 'Staff meeting', 'All teaching staff meet in the conference room at 3:00 PM.', addDays(t0, 1), null, 'staff');
  ann('notice', 'Class 6-A: bring art supplies', 'Please bring chart paper and colours on Friday.', t0, null, 'class', classes[0]);
  run('INSERT INTO diary(class_id, subject_id, date, title, body, homework_due, created_by) VALUES (?,?,?,?,?,?,?)', classes[0], subj.MAT, t0, 'Fractions practice', 'Complete exercise 4.2, questions 1-10.', addDays(t0, 2), teachers[2]);
  run('INSERT INTO diary(class_id, subject_id, date, title, body, homework_due, created_by) VALUES (?,?,?,?,?,?,?)', classes[0], subj.ENG, addDays(t0, -1), 'Reading: Chapter 3', 'Read chapter 3 and note down five new words.', addDays(t0, 1), teachers[0]);
  run('INSERT INTO diary(class_id, subject_id, date, title, body, created_by) VALUES (?,?,?,?,?,?)', classes[1], subj.SCI, t0, 'Plant cell diagram', 'Draw and label a plant cell in your notebook.', teachers[3]);

  // ---- leaves, requests, tickets, community ----
  const kid = students[0]; const parent1 = get('SELECT parent_user_id id FROM parent_students WHERE student_id = ?', kid.id).id;
  run('INSERT INTO leaves(student_id, requested_by, from_date, to_date, reason, routed_to) VALUES (?,?,?,?,?,?)', kid.id, parent1, addDays(t0, 2), addDays(t0, 3), 'Family function out of town', teachers[0]);
  run("INSERT INTO leaves(student_id, requested_by, from_date, to_date, reason, routed_to, status, decided_by, decision_note, decided_at) VALUES (?,?,?,?,?,?, 'approved', ?, 'Get well soon', datetime('now'))", kid.id, parent1, addDays(t0, -12), addDays(t0, -11), 'Fever', teachers[0], teachers[0]);
  run('INSERT INTO change_requests(student_id, requested_by, field, old_value, new_value, reason, approver_role, routed_to) VALUES (?,?,?,?,?,?,?,?)', kid.id, parent1, 'address', '11, Lake View Colony, Visakhapatnam', '45, Seaside Apartments, Beach Road, Visakhapatnam', 'We have moved house', 'teacher', teachers[0]);
  const tk = run('INSERT INTO tickets(ticket_no, student_id, raised_by, assigned_to, subject, category, priority, status) VALUES (?,?,?,?,?,?,?,?)', nextSeq('ticket', 'TKT', 4), kid.id, parent1, teachers[0], 'Seating arrangement', 'academic', 'normal', 'in_progress').lastInsertRowid;
  run('INSERT INTO ticket_messages(ticket_id, user_id, body, created_at) VALUES (?,?,?, datetime(\'now\',\'-1 day\'))', tk, parent1, 'My child finds it hard to see the board from the last bench. Could we move the seat forward?');
  run('INSERT INTO ticket_messages(ticket_id, user_id, body) VALUES (?,?,?)', tk, teachers[0], 'Thanks for letting me know. I will move the seat by Monday and check how it goes.');
  run('INSERT INTO community_posts(class_id, author_id, body, pinned) VALUES (?,?,?,1)', null, admin, 'Welcome to the school community. Share achievements, ask questions and stay connected.');
  run('INSERT INTO community_posts(class_id, author_id, body) VALUES (?,?,?)', classes[0], teachers[0], 'Class 6-A: great work on the science charts this week. Pictures from the display wall are on the notice board.');
  run('INSERT INTO community_comments(post_id, author_id, body) VALUES (?,?,?)', 2, parent1, 'Thank you ma\'am, the children loved it.');

  // ---- staff attendance + last month payroll (paid) ----
  const emps = all("SELECT id FROM employees WHERE status='active'");
  for (let off = 40; off >= 1; off--) { const d = addDays(t0, -off); if (new Date(`${d}T00:00:00Z`).getUTCDay() === 0) continue; for (const e of emps) run('INSERT OR IGNORE INTO staff_attendance(employee_id, date, status) VALUES (?,?,?)', e.id, d, rnd() < 0.04 ? 'A' : 'P'); }
  const lm = new Date(); lm.setUTCDate(1); lm.setUTCMonth(lm.getUTCMonth() - 1); const month = lm.toISOString().slice(0, 7);
  const g = generatePayroll(month, admin);
  run("UPDATE payroll_runs SET status='paid' WHERE id = ?", g.id); run("UPDATE payslips SET status='paid', paid_on = date('now','-5 days') WHERE run_id = ?", g.id);
  run("INSERT INTO expenses(expense_date, category, vendor, description, amount, added_by) VALUES (date('now','-5 days'),'Payroll','Staff',?,?,?)", `Salaries for ${month}`, get('SELECT SUM(net) t FROM payslips WHERE run_id = ?', g.id).t, finance);
  run('INSERT INTO staff_leaves(employee_id, leave_type, from_date, to_date, reason) VALUES ((SELECT id FROM employees WHERE name = ?),?,?,?,?)', 'Meera Nair', 'sick', addDays(t0, 1), addDays(t0, 2), 'Viral fever');

  // a few welcome notifications
  run("INSERT INTO notifications(user_id, title, body, kind, link) VALUES (?,?,?,?,?)", parent1, 'Fee reminder: Tuition Fee (Term 2)', 'Due in 3 days. Pay online from the Fees page.', 'fee', '/fees');
  run("INSERT INTO notifications(user_id, title, body, kind, link) VALUES (?,?,?,?,?)", admin, 'Welcome to School ERP', 'Demo data has been loaded.', 'info', '/');
  // pending self-registration for the approval demo
  run("INSERT INTO users(name, email, mobile, password_hash, role, status, meta) VALUES ('Sunita Patel', 'sunita@example.com', '9444444401', ?, 'parent', 'pending', ?)", hP, JSON.stringify([{ admission_no: 'ADM2026-0005', relation: 'mother' }]));
  run("INSERT INTO users(name, email, mobile, password_hash, role, status) VALUES ('Mohan Das', NULL, '9444444402', ?, 'driver', 'pending')", hD);
}

if (isMain) {
  migrate({ quiet: true });
  if (process.argv.includes('--minimal')) {
    seedBaseline({ adminEmail: process.env.ADMIN_EMAIL || 'admin@school.test', adminPassword: process.env.ADMIN_PASSWORD || 'Admin@123' });
    console.log('Baseline created (settings, periods, ID template, admin account).');
  } else if (get('SELECT 1 x FROM students LIMIT 1')) {
    console.log('Database already has data. Use `npm run reset` to rebuild the demo data from scratch.');
  } else {
    db.transaction(seedDemo)();
    console.log('\nDemo data loaded. Sign-in credentials:\n');
    for (const [who, login, pwd] of CREDENTIALS) console.log(`  ${who.padEnd(24)} ${login.padEnd(24)} ${pwd}`);
    console.log('');
  }
}
