-- =====================================================================
-- 002_views_triggers_fts.sql
-- Views for reporting, triggers for integrity, FTS5 for fast search.
-- =====================================================================

-- ---------- Views ----------------------------------------------------
CREATE VIEW v_invoice_balance AS
SELECT i.id                                         AS invoice_id,
       i.invoice_no, i.student_id, i.description, i.due_date, i.status,
       i.amount, i.discount, i.late_fee,
       (i.amount - i.discount + i.late_fee)         AS total,
       COALESCE(SUM(CASE WHEN p.status = 'success' THEN p.amount END), 0) AS paid,
       (i.amount - i.discount + i.late_fee)
         - COALESCE(SUM(CASE WHEN p.status = 'success' THEN p.amount END), 0) AS balance
FROM invoices i
LEFT JOIN payments p ON p.invoice_id = i.id
GROUP BY i.id;

-- Student ledger: debits (invoices) and credits (payments) in one timeline
CREATE VIEW v_student_ledger AS
SELECT student_id, date(created_at) AS entry_date, created_at AS ts,
       'invoice' AS entry_type, invoice_no AS ref, description AS particulars,
       (amount - discount) AS debit, 0 AS credit
FROM invoices WHERE status <> 'cancelled'
UNION ALL
SELECT student_id, date(due_date, '+1 day'), due_date || ' 23:59:59',
       'late_fee', invoice_no, 'Late fee - ' || description, late_fee, 0
FROM invoices WHERE late_fee > 0 AND status <> 'cancelled'
UNION ALL
SELECT p.student_id, date(p.paid_at), p.paid_at,
       'payment', p.receipt_no, 'Payment (' || p.method || ')', 0, p.amount
FROM payments p WHERE p.status = 'success';

CREATE VIEW v_attendance_summary AS
SELECT student_id,
       substr(date, 1, 7) AS month,
       SUM(status = 'P') AS present,
       SUM(status = 'A') AS absent,
       SUM(status = 'L') AS on_leave,
       COUNT(*)          AS total
FROM attendance GROUP BY student_id, substr(date, 1, 7);

-- ---------- Triggers -------------------------------------------------
CREATE TRIGGER trg_users_updated AFTER UPDATE ON users
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE users SET updated_at = datetime('now') WHERE id = NEW.id; END;

CREATE TRIGGER trg_students_updated AFTER UPDATE ON students
FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN UPDATE students SET updated_at = datetime('now') WHERE id = NEW.id; END;

-- Financial records are append-only: receipts can be refunded, never deleted.
CREATE TRIGGER trg_payments_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'Payments cannot be deleted; refund them instead'); END;

-- Receipt amount / invoice can never be edited after the fact
CREATE TRIGGER trg_payments_immutable BEFORE UPDATE OF amount, invoice_id, student_id, receipt_no ON payments
BEGIN SELECT RAISE(ABORT, 'Payment amount, invoice and receipt number are immutable'); END;

-- Payment may never exceed what is still owed (belt-and-braces on top of app logic)
CREATE TRIGGER trg_payments_no_overpay BEFORE INSERT ON payments
WHEN NEW.status = 'success' AND NEW.amount > (
  SELECT balance FROM v_invoice_balance WHERE invoice_id = NEW.invoice_id) + 0.005
BEGIN SELECT RAISE(ABORT, 'Payment exceeds outstanding balance'); END;

-- Audit log is tamper-evident: no edits, no deletes
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Audit log is append-only'); END;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'Audit log is append-only'); END;

-- Only one default ID template at a time
CREATE TRIGGER trg_idtpl_default AFTER UPDATE OF is_default ON id_templates
FOR EACH ROW WHEN NEW.is_default = 1
BEGIN UPDATE id_templates SET is_default = 0 WHERE id <> NEW.id; END;

-- ---------- Full text search over students ---------------------------
CREATE VIRTUAL TABLE students_fts USING fts5(
  name, mobile, admission_no, guardian_name,
  content = 'students', content_rowid = 'id', tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER trg_students_ai AFTER INSERT ON students BEGIN
  INSERT INTO students_fts(rowid, name, mobile, admission_no, guardian_name)
  VALUES (NEW.id, NEW.name, NEW.mobile, NEW.admission_no, NEW.guardian_name);
END;
CREATE TRIGGER trg_students_ad AFTER DELETE ON students BEGIN
  INSERT INTO students_fts(students_fts, rowid, name, mobile, admission_no, guardian_name)
  VALUES ('delete', OLD.id, OLD.name, OLD.mobile, OLD.admission_no, OLD.guardian_name);
END;
CREATE TRIGGER trg_students_au AFTER UPDATE OF name, mobile, admission_no, guardian_name ON students BEGIN
  INSERT INTO students_fts(students_fts, rowid, name, mobile, admission_no, guardian_name)
  VALUES ('delete', OLD.id, OLD.name, OLD.mobile, OLD.admission_no, OLD.guardian_name);
  INSERT INTO students_fts(rowid, name, mobile, admission_no, guardian_name)
  VALUES (NEW.id, NEW.name, NEW.mobile, NEW.admission_no, NEW.guardian_name);
END;
