-- =====================================================================
-- 001_init.sql  -  Core schema (SQLite)
-- Techniques used: STRICT-ish CHECK constraints, FK enforcement, composite
-- unique keys, partial unique indexes, covering indexes, soft status flags.
-- =====================================================================

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE counters (            -- gap-free sequences (receipts, invoices, tickets)
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------- users
CREATE TABLE users (
  id                   INTEGER PRIMARY KEY,
  name                 TEXT    NOT NULL,
  email                TEXT    COLLATE NOCASE,
  mobile               TEXT,
  password_hash        TEXT    NOT NULL,
  role                 TEXT    NOT NULL CHECK (role IN ('admin','teacher','finance','parent','student','driver')),
  status               TEXT    NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','active','inactive','rejected')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  token_version        INTEGER NOT NULL DEFAULT 0,   -- bump to kill every issued JWT
  meta                 TEXT,                         -- JSON (e.g. children requested at sign-up)
  last_login_at        TEXT,
  created_by           INTEGER REFERENCES users(id),
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (email IS NOT NULL OR mobile IS NOT NULL)
);
CREATE UNIQUE INDEX ux_users_email  ON users(email)  WHERE email  IS NOT NULL;
CREATE UNIQUE INDEX ux_users_mobile ON users(mobile) WHERE mobile IS NOT NULL;
CREATE INDEX ix_users_role_status ON users(role, status);

-- ------------------------------------------------------------- academics
CREATE TABLE classes (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  section          TEXT NOT NULL DEFAULT 'A',
  class_teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  room             TEXT,
  capacity         INTEGER NOT NULL DEFAULT 40,
  UNIQUE (name, section)
);
CREATE INDEX ix_classes_ct ON classes(class_teacher_id);

CREATE TABLE subjects (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE
);

CREATE TABLE class_subjects (
  id               INTEGER PRIMARY KEY,
  class_id         INTEGER NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
  subject_id       INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  periods_per_week INTEGER NOT NULL DEFAULT 4 CHECK (periods_per_week BETWEEN 0 AND 12),
  UNIQUE (class_id, subject_id)
);
CREATE INDEX ix_cs_teacher ON class_subjects(teacher_id);

CREATE TABLE periods (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  seq        INTEGER NOT NULL UNIQUE,
  start_time TEXT NOT NULL,
  end_time   TEXT NOT NULL,
  is_break   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE timetable (
  id         INTEGER PRIMARY KEY,
  class_id   INTEGER NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
  day        INTEGER NOT NULL CHECK (day BETWEEN 1 AND 6),     -- 1=Mon .. 6=Sat
  period_id  INTEGER NOT NULL REFERENCES periods(id)  ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (class_id, day, period_id)
);
-- a teacher can never be in two classes in the same slot
CREATE UNIQUE INDEX ux_timetable_teacher_slot ON timetable(teacher_id, day, period_id) WHERE teacher_id IS NOT NULL;

-- -------------------------------------------------------------- students
CREATE TABLE students (
  id                 INTEGER PRIMARY KEY,
  admission_no       TEXT    NOT NULL UNIQUE,
  name               TEXT    NOT NULL COLLATE NOCASE,
  mobile             TEXT    NOT NULL,                      -- guardian primary mobile
  dob                TEXT,
  gender             TEXT    CHECK (gender IN ('male','female','other')),
  blood_group        TEXT,
  address            TEXT,
  guardian_name      TEXT,
  class_id           INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  roll_no            INTEGER,
  user_id            INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,   -- student login
  id_card_no         TEXT    UNIQUE,
  admitted_on        TEXT    NOT NULL DEFAULT (date('now')),
  status             TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  deactivated_by     INTEGER REFERENCES users(id),
  deactivated_role   TEXT,
  deactivation_reason TEXT,
  deactivated_at     TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- "Mobile + Name -> PK": natural composite identity of a student
CREATE UNIQUE INDEX ux_students_mobile_name ON students(mobile, name);
CREATE INDEX ix_students_class_status ON students(class_id, status);
CREATE UNIQUE INDEX ux_students_class_roll ON students(class_id, roll_no) WHERE roll_no IS NOT NULL AND class_id IS NOT NULL;

CREATE TABLE parent_students (
  parent_user_id INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relation       TEXT    NOT NULL DEFAULT 'guardian',
  PRIMARY KEY (parent_user_id, student_id)
) WITHOUT ROWID;
CREATE INDEX ix_ps_student ON parent_students(student_id);

CREATE TABLE id_templates (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  orientation      TEXT NOT NULL DEFAULT 'portrait' CHECK (orientation IN ('portrait','landscape')),
  primary_color    TEXT NOT NULL DEFAULT '#4f46e5',
  accent_color     TEXT NOT NULL DEFAULT '#f59e0b',
  show_blood_group INTEGER NOT NULL DEFAULT 1,
  show_address     INTEGER NOT NULL DEFAULT 1,
  show_guardian    INTEGER NOT NULL DEFAULT 1,
  footer_text      TEXT DEFAULT 'If found, please return to school office.',
  is_default       INTEGER NOT NULL DEFAULT 0
);

-- ------------------------------------------------------- attendance/marks
CREATE TABLE attendance (
  id         INTEGER PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id   INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  date       TEXT    NOT NULL,
  status     TEXT    NOT NULL CHECK (status IN ('P','A','L')),   -- Present / Absent / Leave
  note       TEXT,
  marked_by  INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (student_id, date)
);
CREATE INDEX ix_att_class_date ON attendance(class_id, date);

CREATE TABLE exams (
  id         INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  start_date TEXT,
  end_date   TEXT,
  max_marks  INTEGER NOT NULL DEFAULT 100 CHECK (max_marks > 0),
  published  INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_exams_class ON exams(class_id);

CREATE TABLE marks (
  id         INTEGER PRIMARY KEY,
  exam_id    INTEGER NOT NULL REFERENCES exams(id)    ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  marks      REAL    NOT NULL CHECK (marks >= 0),
  remarks    TEXT,
  entered_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (exam_id, student_id, subject_id)
);
CREATE INDEX ix_marks_student ON marks(student_id);

CREATE TABLE papers (
  id                  INTEGER PRIMARY KEY,
  title               TEXT    NOT NULL,
  class_id            INTEGER NOT NULL REFERENCES classes(id)  ON DELETE CASCADE,
  subject_id          INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  exam_id             INTEGER REFERENCES exams(id)    ON DELETE SET NULL,
  file_name           TEXT    NOT NULL,
  file_path           TEXT    NOT NULL,
  visible_to_students INTEGER NOT NULL DEFAULT 0,
  release_at          TEXT,
  uploaded_by         INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------- fees
CREATE TABLE fee_structures (
  id                   INTEGER PRIMARY KEY,
  class_id             INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name                 TEXT    NOT NULL,
  term                 TEXT,
  amount               REAL    NOT NULL CHECK (amount >= 0),
  due_date             TEXT    NOT NULL,
  late_fee_percent     REAL,                 -- NULL => use global setting
  active               INTEGER NOT NULL DEFAULT 1,
  UNIQUE (class_id, name, term)
);

CREATE TABLE invoices (
  id           INTEGER PRIMARY KEY,
  invoice_no   TEXT    NOT NULL UNIQUE,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  structure_id INTEGER REFERENCES fee_structures(id) ON DELETE SET NULL,
  description  TEXT    NOT NULL,
  amount       REAL    NOT NULL CHECK (amount >= 0),
  discount     REAL    NOT NULL DEFAULT 0 CHECK (discount >= 0),
  late_fee     REAL    NOT NULL DEFAULT 0 CHECK (late_fee >= 0),
  late_fee_waived INTEGER NOT NULL DEFAULT 0,
  due_date     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','partial','paid','cancelled')),
  reminder_sent_on TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- generating invoices twice for the same structure is impossible
CREATE UNIQUE INDEX ux_invoice_student_structure ON invoices(student_id, structure_id) WHERE structure_id IS NOT NULL;
CREATE INDEX ix_invoice_student ON invoices(student_id, status);
CREATE INDEX ix_invoice_due ON invoices(due_date, status);

CREATE TABLE deposits (
  id           INTEGER PRIMARY KEY,
  deposit_no   TEXT NOT NULL UNIQUE,
  amount       REAL NOT NULL CHECK (amount >= 0),
  status       TEXT NOT NULL DEFAULT 'collected'
               CHECK (status IN ('collected','handed_to_clerk','slip_submitted','verified','rejected')),
  slip_ref     TEXT,
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id),
  verified_by  INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE payments (
  id              INTEGER PRIMARY KEY,
  receipt_no      TEXT    NOT NULL UNIQUE,
  invoice_id      INTEGER NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  student_id      INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
  amount          REAL    NOT NULL CHECK (amount > 0),
  method          TEXT    NOT NULL CHECK (method IN ('cash','upi','card','netbanking','cheque','online')),
  reference       TEXT,
  idempotency_key TEXT    UNIQUE,            -- guards against double submits / gateway retries
  status          TEXT    NOT NULL DEFAULT 'success' CHECK (status IN ('success','refunded')),
  collected_by    INTEGER REFERENCES users(id),
  deposit_id      INTEGER REFERENCES deposits(id) ON DELETE SET NULL,
  paid_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_pay_invoice ON payments(invoice_id);
CREATE INDEX ix_pay_student ON payments(student_id, paid_at);
CREATE INDEX ix_pay_date    ON payments(paid_at);

CREATE TABLE gateway_orders (            -- online payment portal
  id          INTEGER PRIMARY KEY,
  order_ref   TEXT    NOT NULL UNIQUE,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  student_id  INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  amount      REAL    NOT NULL CHECK (amount > 0),
  status      TEXT    NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed')),
  created_by  INTEGER REFERENCES users(id),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE budgets (
  id          INTEGER PRIMARY KEY,
  category    TEXT NOT NULL,
  fiscal_year TEXT NOT NULL,
  amount      REAL NOT NULL CHECK (amount >= 0),
  UNIQUE (category, fiscal_year)
);

CREATE TABLE expenses (
  id             INTEGER PRIMARY KEY,
  expense_date   TEXT NOT NULL,
  category       TEXT NOT NULL,
  vendor         TEXT,
  description    TEXT,
  amount         REAL NOT NULL CHECK (amount > 0),
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid','pending')),
  added_by       INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_exp_date_cat ON expenses(expense_date, category);

-- --------------------------------------------------------------- requests
CREATE TABLE leaves (
  id            INTEGER PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  requested_by  INTEGER NOT NULL REFERENCES users(id),
  from_date     TEXT NOT NULL,
  to_date       TEXT NOT NULL,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  routed_to     INTEGER REFERENCES users(id),        -- the class teacher at time of request
  decided_by    INTEGER REFERENCES users(id),
  decision_note TEXT,
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (to_date >= from_date)
);
CREATE INDEX ix_leaves_route ON leaves(routed_to, status);
CREATE INDEX ix_leaves_student ON leaves(student_id);

CREATE TABLE change_requests (
  id            INTEGER PRIMARY KEY,
  student_id    INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  requested_by  INTEGER NOT NULL REFERENCES users(id),
  field         TEXT NOT NULL CHECK (field IN ('name','mobile','dob','address','guardian_name','blood_group')),
  old_value     TEXT,
  new_value     TEXT NOT NULL,
  reason        TEXT,
  approver_role TEXT NOT NULL DEFAULT 'teacher' CHECK (approver_role IN ('teacher','admin')),
  routed_to     INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by    INTEGER REFERENCES users(id),
  decision_note TEXT,
  decided_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_cr_route ON change_requests(routed_to, status);

-- ------------------------------------------------------------ communication
CREATE TABLE announcements (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'notice' CHECK (kind IN ('notice','event','holiday','circular')),
  title      TEXT NOT NULL,
  body       TEXT,
  start_date TEXT NOT NULL DEFAULT (date('now')),
  end_date   TEXT,
  audience   TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','parents','students','staff','drivers','class')),
  class_id   INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_ann_dates ON announcements(start_date, kind);

CREATE TABLE diary (
  id           INTEGER PRIMARY KEY,
  class_id     INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id   INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  date         TEXT NOT NULL DEFAULT (date('now')),
  title        TEXT NOT NULL,
  body         TEXT,
  homework_due TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_diary_class_date ON diary(class_id, date);

CREATE TABLE tickets (
  id             INTEGER PRIMARY KEY,
  ticket_no      TEXT NOT NULL UNIQUE,
  student_id     INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  raised_by      INTEGER NOT NULL REFERENCES users(id),
  assigned_to    INTEGER REFERENCES users(id),     -- class teacher
  subject        TEXT NOT NULL,
  category       TEXT NOT NULL DEFAULT 'general',
  priority       TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_tickets_assignee ON tickets(assigned_to, status);

CREATE TABLE ticket_messages (
  id         INTEGER PRIMARY KEY,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_tm_ticket ON ticket_messages(ticket_id);

CREATE TABLE community_posts (
  id         INTEGER PRIMARY KEY,
  class_id   INTEGER REFERENCES classes(id) ON DELETE CASCADE,   -- NULL => whole school
  author_id  INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_cp_class ON community_posts(class_id, created_at);

CREATE TABLE community_comments (
  id         INTEGER PRIMARY KEY,
  post_id    INTEGER NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_cc_post ON community_comments(post_id);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT,
  kind       TEXT NOT NULL DEFAULT 'info',
  link       TEXT,
  is_read    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_notif_user ON notifications(user_id, is_read, id DESC);

CREATE TABLE outbox (                  -- SMS / e-mail gateway stub: every outbound message is logged
  id         INTEGER PRIMARY KEY,
  channel    TEXT NOT NULL CHECK (channel IN ('sms','email')),
  to_addr    TEXT NOT NULL,
  subject    TEXT,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------ HRMS / payroll
CREATE TABLE employees (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  emp_code          TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  mobile            TEXT,
  type              TEXT NOT NULL CHECK (type IN ('teacher','admin_staff','finance','driver','co_driver','other')),
  designation       TEXT,
  department        TEXT,
  join_date         TEXT,
  address           TEXT,
  id_proof          TEXT,
  emergency_contact TEXT,
  bank_account      TEXT,
  basic_salary      REAL NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
  allowances        REAL NOT NULL DEFAULT 0 CHECK (allowances >= 0),
  deductions        REAL NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  license_no        TEXT,
  license_expiry    TEXT,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE staff_attendance (
  id          INTEGER PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('P','A','L','H')),   -- Present/Absent/Leave/Half-day
  marked_by   INTEGER REFERENCES users(id),
  UNIQUE (employee_id, date)
);

CREATE TABLE staff_leaves (
  id            INTEGER PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  leave_type    TEXT NOT NULL DEFAULT 'casual' CHECK (leave_type IN ('casual','sick','earned','unpaid')),
  from_date     TEXT NOT NULL,
  to_date       TEXT NOT NULL,
  reason        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by    INTEGER REFERENCES users(id),
  decision_note TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (to_date >= from_date)
);

CREATE TABLE payroll_runs (
  id         INTEGER PRIMARY KEY,
  month      TEXT NOT NULL UNIQUE,                    -- YYYY-MM
  status     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','paid')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE payslips (
  id              INTEGER PRIMARY KEY,
  run_id          INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id     INTEGER NOT NULL REFERENCES employees(id)    ON DELETE CASCADE,
  working_days    INTEGER NOT NULL,
  present_days    REAL    NOT NULL,
  basic           REAL    NOT NULL,
  allowances      REAL    NOT NULL,
  deductions      REAL    NOT NULL,
  leave_deduction REAL    NOT NULL DEFAULT 0,
  bonus           REAL    NOT NULL DEFAULT 0,
  net             REAL    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized','paid')),
  paid_on         TEXT,
  UNIQUE (run_id, employee_id)
);

-- --------------------------------------------------------------- transport
CREATE TABLE vehicles (
  id                    INTEGER PRIMARY KEY,
  reg_no                TEXT NOT NULL UNIQUE,
  model                 TEXT,
  capacity              INTEGER NOT NULL DEFAULT 40,
  insurance_expiry      TEXT,
  fitness_expiry        TEXT,
  driver_employee_id    INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  co_driver_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','inactive'))
);

CREATE TABLE routes (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  via        TEXT,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  start_time TEXT,
  end_time   TEXT,
  fare       REAL NOT NULL DEFAULT 0
);

CREATE TABLE route_stops (
  id          INTEGER PRIMARY KEY,
  route_id    INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  lat         REAL,
  lng         REAL,
  seq         INTEGER NOT NULL,
  pickup_time TEXT,
  UNIQUE (route_id, seq)
);

CREATE TABLE student_transport (
  student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  route_id   INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  stop_id    INTEGER REFERENCES route_stops(id) ON DELETE SET NULL
);
CREATE INDEX ix_st_route ON student_transport(route_id);

CREATE TABLE trips (
  id          INTEGER PRIMARY KEY,
  vehicle_id  INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  route_id    INTEGER REFERENCES routes(id) ON DELETE SET NULL,
  driver_user_id INTEGER REFERENCES users(id),
  kind        TEXT NOT NULL DEFAULT 'pickup' CHECK (kind IN ('pickup','drop')),
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed')),
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at    TEXT
);
-- only one running trip per vehicle
CREATE UNIQUE INDEX ux_trip_running ON trips(vehicle_id) WHERE status = 'running';

CREATE TABLE bus_locations (           -- latest fix per vehicle (upserted)
  vehicle_id INTEGER PRIMARY KEY REFERENCES vehicles(id) ON DELETE CASCADE,
  trip_id    INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  speed      REAL,
  heading    REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE bus_location_history (
  id         INTEGER PRIMARY KEY,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  trip_id    INTEGER,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  speed      REAL,
  ts         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_blh_vehicle_ts ON bus_location_history(vehicle_id, ts);

-- -------------------------------------------------------------- operations
CREATE TABLE cron_runs (
  id          INTEGER PRIMARY KEY,
  job         TEXT NOT NULL,
  started_at  TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','ok','error')),
  message     TEXT
);
CREATE INDEX ix_cron_job ON cron_runs(job, id DESC);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER,
  user_name  TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  TEXT,
  details    TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX ix_audit_created ON audit_log(created_at DESC);
CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id);
