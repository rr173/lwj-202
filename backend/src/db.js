const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'nursing.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS departments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS nurses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    department_id INTEGER NOT NULL,
    level TEXT NOT NULL CHECK(level IN ('senior', 'junior')),
    hire_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS leave_quota_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    year TEXT NOT NULL,
    sick_days INTEGER NOT NULL DEFAULT 15,
    personal_days INTEGER NOT NULL DEFAULT 5,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    UNIQUE(department_id, year)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS unavailable_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nurse_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (nurse_id) REFERENCES nurses(id),
    UNIQUE(nurse_id, date)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    nurse_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    shift TEXT NOT NULL CHECK(shift IN ('morning', 'afternoon', 'night')),
    month TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (nurse_id) REFERENCES nurses(id),
    UNIQUE(nurse_id, date)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS swap_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    requester_id INTEGER NOT NULL,
    target_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    requester_shift TEXT NOT NULL,
    target_shift TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'confirmed', 'approved', 'rejected')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (requester_id) REFERENCES nurses(id),
    FOREIGN KEY (target_id) REFERENCES nurses(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS overtime_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    nurse_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    hours REAL NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    month TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (nurse_id) REFERENCES nurses(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    nurse_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    leave_type TEXT NOT NULL CHECK(leave_type IN ('personal', 'sick', 'annual')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
    substitute_nurse_id INTEGER,
    substitute_status TEXT CHECK(substitute_status IN ('pending', 'confirmed', 'none', 'manual')),
    reason TEXT,
    month TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (nurse_id) REFERENCES nurses(id),
    FOREIGN KEY (substitute_nurse_id) REFERENCES nurses(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS training_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('theory', 'skill', 'comprehensive')),
    hours REAL NOT NULL,
    assessment_method TEXT NOT NULL CHECK(assessment_method IN ('written', 'practical', 'mixed')),
    pass_score REAL NOT NULL DEFAULT 60,
    is_mandatory INTEGER NOT NULL DEFAULT 0,
    instructor TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS training_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id INTEGER NOT NULL,
    nurse_id INTEGER NOT NULL,
    training_date TEXT NOT NULL,
    score REAL,
    passed INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (course_id) REFERENCES training_courses(id),
    FOREIGN KEY (nurse_id) REFERENCES nurses(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS adverse_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    reporter_id INTEGER NOT NULL,
    event_type TEXT NOT NULL CHECK(event_type IN ('medication_error', 'fall', 'pressure_ulcer', 'infection', 'other')),
    event_time TEXT NOT NULL,
    patient_bed TEXT,
    severity INTEGER NOT NULL CHECK(severity IN (1, 2, 3, 4)),
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'reviewing', 'closed')),
    schedule_id INTEGER,
    responsible_nurse_id INTEGER,
    rectification_days INTEGER,
    rectification_deadline TEXT,
    rectification_report TEXT,
    is_overdue INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (reporter_id) REFERENCES nurses(id),
    FOREIGN KEY (responsible_nurse_id) REFERENCES nurses(id),
    FOREIGN KEY (schedule_id) REFERENCES schedules(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS adverse_event_timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    operator_id INTEGER,
    operator_name TEXT,
    remark TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES adverse_events(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS skill_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    UNIQUE(department_id, name)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS nurse_skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nurse_id INTEGER NOT NULL,
    skill_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (nurse_id) REFERENCES nurses(id),
    FOREIGN KEY (skill_id) REFERENCES skill_tags(id),
    UNIQUE(nurse_id, skill_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shift_skill_requirements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    shift TEXT NOT NULL CHECK(shift IN ('morning', 'afternoon', 'night')),
    skill_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (skill_id) REFERENCES skill_tags(id),
    UNIQUE(department_id, shift, skill_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shift_handovers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    from_nurse_id INTEGER NOT NULL,
    to_nurse_id INTEGER NOT NULL,
    handover_date TEXT NOT NULL,
    shift_type TEXT NOT NULL CHECK(shift_type IN ('morning', 'afternoon', 'night')),
    status TEXT NOT NULL DEFAULT 'pending_sign' CHECK(status IN ('pending_sign', 'pending_confirm', 'completed', 'disputed')),
    from_nurse_signed_at TEXT,
    to_nurse_signed_at TEXT,
    head_nurse_id INTEGER,
    head_nurse_remark TEXT,
    head_nurse_confirmed_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (from_nurse_id) REFERENCES nurses(id),
    FOREIGN KEY (to_nurse_id) REFERENCES nurses(id),
    FOREIGN KEY (head_nurse_id) REFERENCES nurses(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS handover_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handover_id INTEGER NOT NULL,
    item_type TEXT NOT NULL CHECK(item_type IN ('abnormal', 'key_patient', 'todo')),
    description TEXT NOT NULL,
    urgency INTEGER NOT NULL CHECK(urgency IN (1, 2, 3)),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (handover_id) REFERENCES shift_handovers(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS handover_signoffs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    nurse_id INTEGER NOT NULL,
    result TEXT NOT NULL CHECK(result IN ('confirmed', 'questioned')),
    remark TEXT,
    signed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (item_id) REFERENCES handover_items(id),
    FOREIGN KEY (nurse_id) REFERENCES nurses(id),
    UNIQUE(item_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS training_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    year TEXT NOT NULL,
    annual_target_hours REAL NOT NULL DEFAULT 40,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    UNIQUE(department_id, year)
  )`);
});

module.exports = db;
