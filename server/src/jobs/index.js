import cron from 'node-cron';
import fs from 'node:fs';
import path from 'node:path';
import { db, get, all, run, getSetting } from '../db/index.js';
import { config } from '../config.js';
import { today, addDays, money } from '../utils/http.js';
import { notify, notifyFamily, notifyAdmins, classTeacherOf } from '../utils/notify.js';
import { recalcInvoice } from '../utils/billing.js';
import { generatePayroll } from '../routes/hr.js';

/**
 * Every background job: id -> { schedule (cron), title, description, fn }
 * Jobs are idempotent (safe to run twice) and every run is recorded in cron_runs.
 */
export const JOBS = {
  'fee-reminders': {
    schedule: '0 8 * * *', title: 'Fee due-date reminders',
    description: 'Notifies parents N days before the due date, on the due date, and weekly while overdue (once per invoice per day).',
    fn() {
      const before = Number(getSetting('reminder_days_before', '3'));
      const t = today(); let sent = 0;
      for (const i of all(`SELECT i.id, i.student_id, i.invoice_no, i.due_date, i.reminder_sent_on, b.balance, i.description FROM invoices i JOIN v_invoice_balance b ON b.invoice_id = i.id
          JOIN students s ON s.id = i.student_id WHERE i.status IN ('unpaid','partial') AND s.status = 'active' AND (i.reminder_sent_on IS NULL OR i.reminder_sent_on <> ?)`, t)) {
        const days = Math.round((Date.parse(i.due_date) - Date.parse(t)) / 86400000);
        let msg = null;
        if (days === before) msg = `Due in ${before} days (${i.due_date})`;
        else if (days === 0) msg = 'Due today';
        else if (days < 0 && (-days) % 7 === 0) msg = `Overdue by ${-days} days`;
        if (!msg) continue;
        notifyFamily(i.student_id, { title: `Fee reminder: ${i.description}`, body: `${msg}. Balance ${money(i.balance)} (${i.invoice_no}).`, kind: 'fee', link: '/fees' });
        // SMS mirror for parents only
        for (const p of all('SELECT u.mobile FROM parent_students ps JOIN users u ON u.id = ps.parent_user_id WHERE ps.student_id = ? AND u.mobile IS NOT NULL', i.student_id))
          run("INSERT INTO outbox(channel, to_addr, subject, body) VALUES ('sms', ?, ?, ?)", p.mobile, 'Fee reminder', `${i.description}: ${msg}. Balance ${money(i.balance)}`);
        run('UPDATE invoices SET reminder_sent_on = ? WHERE id = ?', t, i.id); sent++;
      }
      return `${sent} reminder(s) sent`;
    },
  },
  'late-fees': {
    schedule: '10 0 * * *', title: 'Apply late fees',
    description: 'Adds the configured late-fee % once to invoices that are past their due date. Admin-waived late fees are never re-applied.',
    fn() {
      const global = Number(getSetting('late_fee_percent', '0')); let n = 0;
      db.transaction(() => {
        for (const i of all(`SELECT i.id, i.student_id, i.invoice_no, i.amount, i.discount, f.late_fee_percent AS pct FROM invoices i LEFT JOIN fee_structures f ON f.id = i.structure_id
            WHERE i.status IN ('unpaid','partial') AND i.due_date < date('now') AND i.late_fee = 0 AND i.late_fee_waived = 0`)) {
          const pct = i.pct ?? global; if (!pct) continue;
          const fee = money(((i.amount - i.discount) * pct) / 100); if (fee <= 0) continue;
          run('UPDATE invoices SET late_fee = ? WHERE id = ?', fee, i.id); recalcInvoice(i.id);
          notifyFamily(i.student_id, { title: 'Late fee added', body: `${fee} late fee added to ${i.invoice_no}.`, kind: 'fee', link: '/fees' }); n++;
        }
      })();
      return `${n} late fee(s) applied`;
    },
  },
  'attendance-reminder': {
    schedule: '30 11 * * 1-6', title: 'Attendance not-marked reminder',
    description: 'Reminds class teachers who have not marked attendance by 11:30 (skips holidays).',
    fn() {
      const t = today();
      if (get("SELECT 1 x FROM announcements WHERE kind='holiday' AND ? BETWEEN start_date AND COALESCE(end_date, start_date)", t)) return 'holiday - skipped';
      let n = 0;
      for (const c of all(`SELECT c.id, c.name || '-' || c.section AS label, c.class_teacher_id FROM classes c WHERE c.class_teacher_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM students s WHERE s.class_id = c.id AND s.status='active') AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.class_id = c.id AND a.date = ? AND a.status <> 'L')`, t)) {
        notify(c.class_teacher_id, { title: 'Attendance pending', body: `Please mark today's attendance for ${c.label}.`, kind: 'attendance', link: '/attendance' }); n++;
      }
      return `${n} teacher(s) reminded`;
    },
  },
  'payroll-draft': {
    schedule: '0 1 1 * *', title: 'Draft last month\'s payroll',
    description: 'On the 1st of every month creates a DRAFT payroll run for the previous month from salary structures and staff attendance.',
    fn() {
      const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); const month = d.toISOString().slice(0, 7);
      try { const out = generatePayroll(month, null); notifyAdmins({ title: 'Payroll draft ready', body: `Draft payroll for ${month} has been generated. Review and finalize.`, kind: 'payroll', link: '/hr/payroll' }); return `${month}: ${out.created} payslip(s) drafted`; }
      catch (e) { if (e.status === 409) return `${month}: already processed`; throw e; }
    },
  },
  'db-backup': {
    schedule: '30 2 * * *', title: 'Database backup',
    description: 'Takes a consistent online SQLite backup and keeps the latest 7.',
    async fn() {
      if (config.dbPath === ':memory:') return 'in-memory database - skipped';
      fs.mkdirSync(config.backupDir, { recursive: true });
      const name = `school-${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.db`;
      await db.backup(path.join(config.backupDir, name));
      const files = fs.readdirSync(config.backupDir).filter((f) => f.endsWith('.db')).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 7))) fs.rmSync(path.join(config.backupDir, f), { force: true });
      return `saved ${name}`;
    },
  },
  'expiry-alerts': {
    schedule: '0 9 * * 1', title: 'Licence & vehicle expiry alerts',
    description: 'Every Monday warns admins about driver licences, vehicle insurance and fitness certificates expiring within 30 days.',
    fn() {
      const lim = addDays(today(), 30); const items = [];
      for (const e of all("SELECT name, license_expiry d FROM employees WHERE status='active' AND license_expiry IS NOT NULL AND license_expiry <= ?", lim)) items.push(`Licence - ${e.name}: ${e.d}`);
      for (const v of all("SELECT reg_no, insurance_expiry, fitness_expiry FROM vehicles WHERE status <> 'inactive'")) {
        if (v.insurance_expiry && v.insurance_expiry <= lim) items.push(`Insurance - ${v.reg_no}: ${v.insurance_expiry}`);
        if (v.fitness_expiry && v.fitness_expiry <= lim) items.push(`Fitness - ${v.reg_no}: ${v.fitness_expiry}`);
      }
      if (items.length) notifyAdmins({ title: `${items.length} transport document(s) expiring soon`, body: items.slice(0, 6).join('; '), kind: 'transport', link: '/transport' });
      return `${items.length} item(s) flagged`;
    },
  },
  maintenance: {
    schedule: '0 3 * * 0', title: 'Database maintenance',
    description: 'Prunes old GPS history (7 days), read notifications (90 days), old outbox/job logs, then optimizes SQLite.',
    fn() {
      const a = run("DELETE FROM bus_location_history WHERE ts < datetime('now','-7 days')").changes;
      const b = run("DELETE FROM notifications WHERE is_read = 1 AND created_at < datetime('now','-90 days')").changes;
      const c = run("DELETE FROM outbox WHERE created_at < datetime('now','-60 days')").changes;
      const d = run("DELETE FROM cron_runs WHERE started_at < datetime('now','-60 days')").changes;
      db.pragma('wal_checkpoint(TRUNCATE)'); db.pragma('optimize');
      return `pruned ${a} GPS, ${b} notifications, ${c} outbox, ${d} job logs`;
    },
  },
};

export async function runJob(name, trigger = 'cron') {
  const job = JOBS[name]; if (!job) throw new Error(`unknown job ${name}`);
  const id = run('INSERT INTO cron_runs(job) VALUES (?)', name).lastInsertRowid;
  try {
    const message = await job.fn();
    run("UPDATE cron_runs SET status='ok', finished_at=datetime('now'), message=? WHERE id=?", `${message}${trigger === 'manual' ? ' (manual)' : ''}`, id);
    return { job: name, status: 'ok', message };
  } catch (e) {
    console.error(`[cron] ${name} failed:`, e);
    run("UPDATE cron_runs SET status='error', finished_at=datetime('now'), message=? WHERE id=?", String(e.message).slice(0, 300), id);
    return { job: name, status: 'error', message: e.message };
  }
}

export function jobStatus() {
  return Object.entries(JOBS).map(([name, j]) => ({
    name, title: j.title, description: j.description, schedule: j.schedule,
    last_run: get('SELECT started_at, finished_at, status, message FROM cron_runs WHERE job = ? ORDER BY id DESC LIMIT 1', name) || null,
    runs: all('SELECT started_at, status, message FROM cron_runs WHERE job = ? ORDER BY id DESC LIMIT 5', name),
  }));
}

export function startCron() {
  if (!config.enableCron) { console.log('[cron] scheduler off (set ENABLE_CRON=1 to enable). Jobs can still be run manually.'); return []; }
  const tz = process.env.TZ || undefined;
  const tasks = Object.entries(JOBS).map(([name, j]) => cron.schedule(j.schedule, () => { runJob(name); }, { timezone: tz }));
  // anything left "running" by a crash is closed out
  run("UPDATE cron_runs SET status='error', finished_at=datetime('now'), message='interrupted by restart' WHERE status='running'");
  console.log(`[cron] ${tasks.length} jobs scheduled`);
  return tasks;
}
