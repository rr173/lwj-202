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
});

module.exports = db;
