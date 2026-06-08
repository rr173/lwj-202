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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id)
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
