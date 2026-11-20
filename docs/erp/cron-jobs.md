# Scheduled jobs (cron)

Started with the server (`node-cron`). Switch off with `ENABLE_CRON=0` (for example when running several copies). Every run is stored in `cron_runs`. See and trigger them at **System → Scheduled jobs**. Times follow the server's `TZ`.

| Job | Schedule | What it does |
|---|---|---|
| `fee-reminders` | daily 08:00 | Notifies families N days before the due date (*reminder days* setting), on the due date, and weekly while overdue. SMS copy goes to the outbox |
| `late-fees` | daily 00:10 | Adds the late fee % (fee head or school default) once to invoices past due. Admin-waived late fees are never re-applied |
| `attendance-reminder` | Mon–Sat 11:30 | Reminds class teachers who have not marked today's attendance |
| `payroll-draft` | 1st of month 01:00 | Creates a draft payroll for the previous month |
| `db-backup` | daily 02:30 | Online SQLite backup to `BACKUP_DIR`, keeps the latest 7 |
| `expiry-alerts` | Mon 09:00 | Warns **admins** about driver licences, vehicle insurance and fitness certificates expiring within 30 days |
| `maintenance` | Sun 03:00 | Prunes GPS history (7 days), read notifications (90 days), outbox and job logs (60 days), then WAL checkpoint and `PRAGMA optimize` |

Jobs are idempotent. Running one twice does not duplicate reminders, late fees or payroll lines.

To add a job, add an entry to `JOBS` in `server/src/jobs/index.js` (id, `schedule`, title, description, function).
