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

  db.run(`CREATE TABLE IF NOT EXISTS secondment_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_department_id INTEGER NOT NULL,
    to_department_id INTEGER NOT NULL,
    nurse_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    shifts TEXT NOT NULL DEFAULT 'all',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reason TEXT,
    approver_remark TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_department_id) REFERENCES departments(id),
    FOREIGN KEY (to_department_id) REFERENCES departments(id),
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

  db.run(`CREATE TABLE IF NOT EXISTS assessment_weight_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    attendance_weight REAL NOT NULL DEFAULT 25,
    operation_weight REAL NOT NULL DEFAULT 25,
    satisfaction_weight REAL NOT NULL DEFAULT 25,
    teamwork_weight REAL NOT NULL DEFAULT 25,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    UNIQUE(department_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS quality_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    nurse_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    attendance_score REAL NOT NULL DEFAULT 0,
    operation_score REAL NOT NULL DEFAULT 0,
    satisfaction_score REAL NOT NULL DEFAULT 0,
    teamwork_score REAL NOT NULL DEFAULT 0,
    attendance_adjustment REAL NOT NULL DEFAULT 0,
    operation_adjustment REAL NOT NULL DEFAULT 0,
    satisfaction_adjustment REAL NOT NULL DEFAULT 0,
    teamwork_adjustment REAL NOT NULL DEFAULT 0,
    final_attendance REAL NOT NULL DEFAULT 0,
    final_operation REAL NOT NULL DEFAULT 0,
    final_satisfaction REAL NOT NULL DEFAULT 0,
    final_teamwork REAL NOT NULL DEFAULT 0,
    weighted_total REAL NOT NULL DEFAULT 0,
    adverse_event_count INTEGER NOT NULL DEFAULT 0,
    is_full_attendance INTEGER NOT NULL DEFAULT 0,
    remark TEXT,
    evaluator_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (nurse_id) REFERENCES nurses(id),
    FOREIGN KEY (evaluator_id) REFERENCES nurses(id),
    UNIQUE(nurse_id, month)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS assessment_appeals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL,
    department_id INTEGER NOT NULL,
    nurse_id INTEGER NOT NULL,
    month TEXT NOT NULL,
    appeal_reason TEXT NOT NULL,
    expected_dimension TEXT NOT NULL,
    expected_score REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'maintained', 'adjusted')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    handled_at DATETIME,
    handled_by INTEGER,
    handle_result TEXT CHECK(handle_result IN ('maintain', 'adjust')),
    handle_reason TEXT,
    adjusted_attendance REAL,
    adjusted_operation REAL,
    adjusted_satisfaction REAL,
    adjusted_teamwork REAL,
    FOREIGN KEY (assessment_id) REFERENCES quality_assessments(id),
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (nurse_id) REFERENCES nurses(id),
    FOREIGN KEY (handled_by) REFERENCES nurses(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS medical_supplies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    spec TEXT,
    unit TEXT NOT NULL DEFAULT '个',
    safety_threshold INTEGER NOT NULL DEFAULT 10,
    category TEXT DEFAULT 'general',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    UNIQUE(department_id, name, spec)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS supply_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supply_id INTEGER NOT NULL,
    batch_no TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    remaining INTEGER NOT NULL,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    operator_id INTEGER,
    is_expired INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (supply_id) REFERENCES medical_supplies(id),
    FOREIGN KEY (operator_id) REFERENCES nurses(id),
    UNIQUE(supply_id, batch_no)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS supply_requisitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    supply_id INTEGER NOT NULL,
    nurse_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    requisition_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    schedule_id INTEGER,
    shift TEXT,
    date TEXT,
    remark TEXT,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (supply_id) REFERENCES medical_supplies(id),
    FOREIGN KEY (nurse_id) REFERENCES nurses(id),
    FOREIGN KEY (schedule_id) REFERENCES schedules(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS supply_requisition_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requisition_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY (requisition_id) REFERENCES supply_requisitions(id),
    FOREIGN KEY (batch_id) REFERENCES supply_batches(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS supply_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department_id INTEGER NOT NULL,
    supply_id INTEGER NOT NULL,
    warning_type TEXT NOT NULL CHECK(warning_type IN ('low_stock', 'expired', 'near_expiry')),
    current_stock INTEGER,
    threshold INTEGER,
    expiry_date TEXT,
    batch_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    is_resolved INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (supply_id) REFERENCES medical_supplies(id),
    FOREIGN KEY (batch_id) REFERENCES supply_batches(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS care_path_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    department_id INTEGER NOT NULL,
    applicable_disease TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS care_path_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    stage_order INTEGER NOT NULL,
    name TEXT NOT NULL,
    duration_hours REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES care_path_templates(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS care_path_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_id INTEGER NOT NULL,
    operation_order INTEGER NOT NULL,
    name TEXT NOT NULL,
    is_critical INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stage_id) REFERENCES care_path_stages(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS patient_care_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    department_id INTEGER NOT NULL,
    patient_bed TEXT NOT NULL,
    patient_name TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed')),
    current_stage_index INTEGER NOT NULL DEFAULT 0,
    start_time DATETIME NOT NULL,
    completed_time DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES care_path_templates(id),
    FOREIGN KEY (department_id) REFERENCES departments(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS care_path_stage_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_path_id INTEGER NOT NULL,
    stage_id INTEGER NOT NULL,
    stage_index INTEGER NOT NULL,
    deadline_time DATETIME NOT NULL,
    actual_start_time DATETIME,
    actual_end_time DATETIME,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_path_id) REFERENCES patient_care_paths(id),
    FOREIGN KEY (stage_id) REFERENCES care_path_stages(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS care_path_operation_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_execution_id INTEGER NOT NULL,
    operation_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
    signed_by INTEGER,
    signed_by_name TEXT,
    signed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stage_execution_id) REFERENCES care_path_stage_executions(id),
    FOREIGN KEY (operation_id) REFERENCES care_path_operations(id),
    FOREIGN KEY (signed_by) REFERENCES nurses(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS care_path_warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_path_id INTEGER NOT NULL,
    department_id INTEGER NOT NULL,
    operation_execution_id INTEGER NOT NULL,
    patient_bed TEXT NOT NULL,
    operation_name TEXT NOT NULL,
    overdue_minutes INTEGER NOT NULL DEFAULT 0,
    is_handled INTEGER NOT NULL DEFAULT 0,
    handled_by INTEGER,
    handled_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (patient_path_id) REFERENCES patient_care_paths(id),
    FOREIGN KEY (department_id) REFERENCES departments(id),
    FOREIGN KEY (operation_execution_id) REFERENCES care_path_operation_executions(id),
    FOREIGN KEY (handled_by) REFERENCES nurses(id)
  )`);
});

module.exports = db;
