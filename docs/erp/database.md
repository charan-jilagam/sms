# Database techniques

SQLite via `better-sqlite3`. Files: `server/src/db/`.

| Technique | Where / why |
|---|---|
| **Versioned migrations** | `migrations/001_init.sql`, `002_views_triggers_fts.sql`, tracked in `schema_migrations`. Run at boot, each in a transaction. |
| **WAL mode, foreign keys, busy timeout** | `db/index.js`. Readers never block the writer. |
| **Immediate transactions** | `tx()` uses `BEGIN IMMEDIATE`, avoiding "database is locked" upgrades in multi-step writes. |
| **CHECK constraints** | Statuses, roles, attendance codes, amounts ≥ 0, valid dates. |
| **Unique and partial unique indexes** | One class teacher per class, one running trip per vehicle, one default ID template, one attendance row per student and day. |
| **Composite keys** | Student ↔ parent links, route stops. |
| **Views** | `v_invoice_balance` (billed / paid / balance / status), `v_student_ledger`, `v_attendance_summary`. |
| **Triggers** | Payments cannot be updated or deleted. Overpayment is blocked. The audit log is append-only. One default template. `updated_at` maintenance. |
| **FTS5** | Full-text student search (name, admission no, mobile, guardian). |
| **Gap-free sequences** | `counters` table for receipt, invoice, admission and ticket numbers, taken inside the same transaction. |
| **Idempotency keys** | `payments.idempotency_key` UNIQUE. Replays return the original receipt. |
| **Soft deactivation** | `status` columns instead of deleting people. |
| **Online backups** | `db.backup()` while the app is serving traffic. |
| **Prepared-statement cache** | `q()` helper. |
| **Token versioning** | `users.token_version`. A password reset revokes all old JWTs. |

Student primary key rule: *name + mobile* are unique together (see `students` unique index). A student also has a generated `admission_no` and `id_card_no`.
