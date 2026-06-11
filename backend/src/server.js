const express = require('express');
const cors = require('cors');
const dayjs = require('dayjs');
const db = require('./db');
const { generateSchedule, validateScheduleChange, getDaysInMonth } = require('./scheduler');
const trainingRouter = require('./training');
const adverseEventRouter = require('./adverseEvent');
const handoverRouter = require('./handover');
const secondmentRouter = require('./secondment');
const assessmentRouter = require('./assessment');
const suppliesRouter = require('./supplies');
const carePathRouter = require('./carePath');

const SHIFT_HOURS = { morning: 8, afternoon: 8, night: 8 };
const SHIFT_NAMES = {
  morning: '早班',
  afternoon: '中班',
  night: '夜班'
};
const FATIGUE_THRESHOLD = 48;

const LEAVE_TYPE_NAMES_CN = { personal: '事假', sick: '病假', annual: '年假' };

function computeAnnualDays(yearsOfService) {
  if (yearsOfService < 5) return 5;
  if (yearsOfService < 10) return 10;
  return 15;
}

function getYearsOfService(hireDate, referenceDate) {
  if (!hireDate) return 0;
  const hire = dayjs(hireDate);
  const ref = dayjs(referenceDate);
  let years = ref.year() - hire.year();
  if (ref.isBefore(hire.add(years, 'year'))) years--;
  return Math.max(0, years);
}

function getLeaveBalance(db, nurseId, year) {
  return new Promise((resolve, reject) => {
    db.get('SELECT n.*, d.id as dept_id FROM nurses n JOIN departments d ON n.department_id = d.id WHERE n.id = ?', [nurseId], (err, nurse) => {
      if (err) return reject(err);
      if (!nurse) return reject(new Error('护士不存在'));

      const janFirst = `${year}-01-01`;
      const yearsOfService = getYearsOfService(nurse.hire_date, janFirst);
      const annualTotal = computeAnnualDays(yearsOfService);

      db.get('SELECT * FROM leave_quota_config WHERE department_id = ? AND year = ?', [nurse.department_id, String(year)], (err, config) => {
        if (err) return reject(err);

        const sickTotal = config ? config.sick_days : 15;
        const personalTotal = config ? config.personal_days : 5;

        const yearPrefix = `${year}-`;
        db.all(
          "SELECT leave_type, COUNT(*) as used_days FROM leave_requests WHERE nurse_id = ? AND date LIKE ? AND status = 'approved' GROUP BY leave_type",
          [nurseId, `${yearPrefix}%`],
          (err, usedRows) => {
            if (err) return reject(err);

            const usedMap = {};
            usedRows.forEach(r => { usedMap[r.leave_type] = r.used_days; });

            const balance = {
              nurse_id: nurseId,
              year,
              years_of_service: yearsOfService,
              annual: { total: annualTotal, used: usedMap.annual || 0, remaining: annualTotal - (usedMap.annual || 0) },
              sick: { total: sickTotal, used: usedMap.sick || 0, remaining: sickTotal - (usedMap.sick || 0) },
              personal: { total: personalTotal, used: usedMap.personal || 0, remaining: personalTotal - (usedMap.personal || 0) }
            };

            resolve(balance);
          }
        );
      });
    });
  });
}

function compute7DayHours(db, departmentId, referenceDate) {
  return new Promise((resolve, reject) => {
    const endDate = referenceDate;
    const startDate = dayjs(referenceDate).subtract(6, 'day').format('YYYY-MM-DD');

    db.all('SELECT * FROM nurses WHERE department_id = ?', [departmentId], (err, nurses) => {
      if (err) return reject(err);

      const nurseIds = nurses.map(n => n.id);
      if (nurseIds.length === 0) return resolve([]);

      const placeholders = nurseIds.map(() => '?').join(',');

      db.all(
        `SELECT nurse_id, date, shift FROM schedules WHERE department_id = ? AND date >= ? AND date <= ? AND nurse_id IN (${placeholders})`,
        [departmentId, startDate, endDate, ...nurseIds],
        (err, schedules) => {
          if (err) return reject(err);

          db.all(
            `SELECT nurse_id, date, hours FROM overtime_requests WHERE department_id = ? AND date >= ? AND date <= ? AND status = 'approved' AND nurse_id IN (${placeholders})`,
            [departmentId, startDate, endDate, ...nurseIds],
            (err, overtimes) => {
              if (err) return reject(err);

              db.all(
                `SELECT substitute_nurse_id, date FROM leave_requests WHERE department_id = ? AND date >= ? AND date <= ? AND status = 'approved' AND substitute_status = 'confirmed' AND substitute_nurse_id IN (${placeholders})`,
                [departmentId, startDate, endDate, ...nurseIds],
                (err, substitutes) => {
                  if (err) return reject(err);

                  db.all(
                    `SELECT nurse_id, date FROM leave_requests WHERE department_id = ? AND date >= ? AND date <= ? AND status = 'approved' AND nurse_id IN (${placeholders})`,
                    [departmentId, startDate, endDate, ...nurseIds],
                    (err, leaves) => {
                      if (err) return reject(err);

                      const leaveSet = new Set(leaves.map(l => `${l.nurse_id}_${l.date}`));
                      const substituteSet = new Set(substitutes.map(s => `${s.substitute_nurse_id}_${s.date}`));

                      const result = nurses.map(nurse => {
                        let totalHours = 0;

                        const nurseSchedules = schedules.filter(s => s.nurse_id === nurse.id);
                        nurseSchedules.forEach(s => {
                          const isLeave = leaveSet.has(`${s.nurse_id}_${s.date}`);
                          if (!isLeave) {
                            totalHours += SHIFT_HOURS[s.shift] || 8;
                          }
                        });

                        const nurseSubstitutes = substitutes.filter(s => s.substitute_nurse_id === nurse.id);
                        nurseSubstitutes.forEach(() => {
                          totalHours += 8;
                        });

                        const nurseOvertimes = overtimes.filter(o => o.nurse_id === nurse.id);
                        nurseOvertimes.forEach(o => {
                          totalHours += o.hours;
                        });

                        totalHours = Math.round(totalHours * 100) / 100;

                        return {
                          nurse_id: nurse.id,
                          nurse_name: nurse.name,
                          nurse_level: nurse.level,
                          total_hours: totalHours,
                          is_fatigue_warning: totalHours > FATIGUE_THRESHOLD,
                          period_start: startDate,
                          period_end: endDate
                        };
                      });

                      resolve(result);
                    }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
}

function compute7DayHoursForNurses(db, nurseIds, departmentId, referenceDate) {
  return new Promise((resolve, reject) => {
    if (nurseIds.length === 0) return resolve([]);

    const endDate = referenceDate;
    const startDate = dayjs(referenceDate).subtract(6, 'day').format('YYYY-MM-DD');
    const placeholders = nurseIds.map(() => '?').join(',');

    db.all(
      `SELECT id, name, level FROM nurses WHERE id IN (${placeholders})`,
      nurseIds,
      (err, nurses) => {
        if (err) return reject(err);

        db.all(
          `SELECT nurse_id, date, shift FROM schedules WHERE department_id = ? AND date >= ? AND date <= ? AND nurse_id IN (${placeholders})`,
          [departmentId, startDate, endDate, ...nurseIds],
          (err, schedules) => {
            if (err) return reject(err);

            db.all(
              `SELECT nurse_id, date, hours FROM overtime_requests WHERE department_id = ? AND date >= ? AND date <= ? AND status = 'approved' AND nurse_id IN (${placeholders})`,
              [departmentId, startDate, endDate, ...nurseIds],
              (err, overtimes) => {
                if (err) return reject(err);

                db.all(
                  `SELECT substitute_nurse_id, date FROM leave_requests WHERE department_id = ? AND date >= ? AND date <= ? AND status = 'approved' AND substitute_status = 'confirmed' AND substitute_nurse_id IN (${placeholders})`,
                  [departmentId, startDate, endDate, ...nurseIds],
                  (err, substitutes) => {
                    if (err) return reject(err);

                    db.all(
                      `SELECT nurse_id, date FROM leave_requests WHERE department_id = ? AND date >= ? AND date <= ? AND status = 'approved' AND nurse_id IN (${placeholders})`,
                      [departmentId, startDate, endDate, ...nurseIds],
                      (err, leaves) => {
                        if (err) return reject(err);

                        const leaveSet = new Set(leaves.map(l => `${l.nurse_id}_${l.date}`));

                        const result = nurses.map(nurse => {
                          let totalHours = 0;

                          schedules.filter(s => s.nurse_id === nurse.id).forEach(s => {
                            if (!leaveSet.has(`${s.nurse_id}_${s.date}`)) {
                              totalHours += SHIFT_HOURS[s.shift] || 8;
                            }
                          });

                          substitutes.filter(s => s.substitute_nurse_id === nurse.id).forEach(() => {
                            totalHours += 8;
                          });

                          overtimes.filter(o => o.nurse_id === nurse.id).forEach(o => {
                            totalHours += o.hours;
                          });

                          totalHours = Math.round(totalHours * 100) / 100;

                          return {
                            nurse_id: nurse.id,
                            nurse_name: nurse.name,
                            nurse_level: nurse.level,
                            total_hours: totalHours,
                            is_fatigue_warning: totalHours > FATIGUE_THRESHOLD
                          };
                        });

                        resolve(result);
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  });
}

const OPERATION_TYPE_NAMES_CN = {
  auto_generate: '自动生成',
  manual_adjust: '手动调整',
  swap_effective: '换班生效',
  substitute_effective: '补班生效',
  version_rollback: '版本回溯'
};

function getNextVersionNumber(db, departmentId, month) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT COALESCE(MAX(version_number), 0) as max_version FROM schedule_versions WHERE department_id = ? AND month = ?',
      [departmentId, month],
      (err, row) => {
        if (err) return reject(err);
        resolve((row?.max_version || 0) + 1);
      }
    );
  });
}

function createScheduleVersion(db, departmentId, month, operationType, operatorId, operatorName, remark, prebuiltSnapshot) {
  return new Promise((resolve, reject) => {
    const saveVersion = (snapshotJson) => {
      getNextVersionNumber(db, departmentId, month).then(versionNumber => {
        db.run(
          `INSERT INTO schedule_versions (department_id, month, version_number, operation_type, operator_id, operator_name, remark, snapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [departmentId, month, versionNumber, operationType, operatorId || null, operatorName || null, remark || null, snapshotJson],
          function(err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, version_number: versionNumber });
          }
        );
      }).catch(reject);
    };

    if (prebuiltSnapshot !== undefined && prebuiltSnapshot !== null) {
      const snapshotJson = typeof prebuiltSnapshot === 'string'
        ? prebuiltSnapshot
        : JSON.stringify(prebuiltSnapshot);
      saveVersion(snapshotJson);
    } else {
      db.all(
        'SELECT id, department_id, nurse_id, date, shift, month FROM schedules WHERE department_id = ? AND month = ? ORDER BY date, nurse_id',
        [departmentId, month],
        (err, schedules) => {
          if (err) return reject(err);
          saveVersion(JSON.stringify(schedules));
        }
      );
    }
  });
}

function getScheduleVersionsList(db, departmentId, month) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, department_id, month, version_number, operation_type, operator_id, operator_name, remark, created_at
       FROM schedule_versions
       WHERE department_id = ? AND month = ?
       ORDER BY version_number DESC`,
      [departmentId, month],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows.map(r => ({
          ...r,
          operation_type_name: OPERATION_TYPE_NAMES_CN[r.operation_type] || r.operation_type
        })));
      }
    );
  });
}

function getScheduleVersionById(db, versionId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM schedule_versions WHERE id = ?',
      [versionId],
      (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(null);
        resolve({
          ...row,
          snapshot_data: JSON.parse(row.snapshot || '[]')
        });
      }
    );
  });
}

function compareScheduleVersions(versionA, versionB, nurses) {
  const nurseMap = {};
  (nurses || []).forEach(n => { nurseMap[n.id] = n.name; });

  const mapA = {};
  versionA.forEach(s => { mapA[`${s.nurse_id}_${s.date}`] = s; });

  const mapB = {};
  versionB.forEach(s => { mapB[`${s.nurse_id}_${s.date}`] = s; });

  const allKeys = new Set([...Object.keys(mapA), ...Object.keys(mapB)]);
  const differences = [];

  allKeys.forEach(key => {
    const a = mapA[key];
    const b = mapB[key];
    if (!a && b) {
      differences.push({
        nurse_id: b.nurse_id,
        nurse_name: nurseMap[b.nurse_id] || `护士${b.nurse_id}`,
        date: b.date,
        from_shift: null,
        from_shift_name: null,
        to_shift: b.shift,
        to_shift_name: SHIFT_NAMES[b.shift] || b.shift,
        change_type: 'added'
      });
    } else if (a && !b) {
      differences.push({
        nurse_id: a.nurse_id,
        nurse_name: nurseMap[a.nurse_id] || `护士${a.nurse_id}`,
        date: a.date,
        from_shift: a.shift,
        from_shift_name: SHIFT_NAMES[a.shift] || a.shift,
        to_shift: null,
        to_shift_name: null,
        change_type: 'removed'
      });
    } else if (a && b && a.shift !== b.shift) {
      differences.push({
        nurse_id: a.nurse_id,
        nurse_name: nurseMap[a.nurse_id] || `护士${a.nurse_id}`,
        date: a.date,
        from_shift: a.shift,
        from_shift_name: SHIFT_NAMES[a.shift] || a.shift,
        to_shift: b.shift,
        to_shift_name: SHIFT_NAMES[b.shift] || b.shift,
        change_type: 'changed'
      });
    }
  });

  differences.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.nurse_id - b.nurse_id;
  });

  return differences;
}

function findConflictingSwapAndSubstitute(db, departmentId, month, targetVersionCreatedAt) {
  return new Promise((resolve, reject) => {
    const result = {
      swap_conflicts: [],
      substitute_conflicts: []
    };

    const monthPrefix = month + '-';

    db.all(
      `SELECT sr.*, 
              r.name as requester_name, 
              t.name as target_name
       FROM swap_requests sr
       JOIN nurses r ON sr.requester_id = r.id
       JOIN nurses t ON sr.target_id = t.id
       WHERE sr.department_id = ? AND sr.status = 'approved' 
         AND sr.created_at > ? AND sr.date LIKE ?
       ORDER BY sr.created_at DESC`,
      [departmentId, targetVersionCreatedAt, monthPrefix + '%'],
      (err, swaps) => {
        if (err) return reject(err);
        result.swap_conflicts = swaps;

        db.all(
          `SELECT lr.*, n.name as nurse_name, sn.name as substitute_name
           FROM leave_requests lr
           JOIN nurses n ON lr.nurse_id = n.id
           LEFT JOIN nurses sn ON lr.substitute_nurse_id = sn.id
           WHERE lr.department_id = ? AND lr.status = 'approved' 
             AND lr.substitute_status = 'confirmed' AND lr.created_at > ?
             AND lr.date LIKE ?
           ORDER BY lr.created_at DESC`,
          [departmentId, targetVersionCreatedAt, monthPrefix + '%'],
          (err, subs) => {
            if (err) return reject(err);
            result.substitute_conflicts = subs;
            resolve(result);
          }
        );
      }
    );
  });
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/departments/:id/skill-tags', (req, res) => {
  const { id } = req.params;
  db.all('SELECT * FROM skill_tags WHERE department_id = ? ORDER BY id', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/departments/:id/skill-tags', (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '技能名称不能为空' });
  db.run('INSERT INTO skill_tags (department_id, name) VALUES (?, ?)', [id, name.trim()], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) return res.status(400).json({ error: '该技能标签已存在' });
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, department_id: parseInt(id), name: name.trim() });
  });
});

app.delete('/api/skill-tags/:id', (req, res) => {
  const { id } = req.params;
  db.serialize(() => {
    db.run('DELETE FROM nurse_skills WHERE skill_id = ?', [id]);
    db.run('DELETE FROM shift_skill_requirements WHERE skill_id = ?', [id]);
    db.run('DELETE FROM skill_tags WHERE id = ?', [id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  });
});

app.get('/api/nurses/:id/skills', (req, res) => {
  const { id } = req.params;
  db.all('SELECT ns.*, st.name as skill_name FROM nurse_skills ns JOIN skill_tags st ON ns.skill_id = st.id WHERE ns.nurse_id = ? ORDER BY st.name', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.put('/api/nurses/:id/skills', (req, res) => {
  const { id } = req.params;
  const { skill_ids } = req.body;
  if (!Array.isArray(skill_ids)) return res.status(400).json({ error: 'skill_ids必须为数组' });
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run('DELETE FROM nurse_skills WHERE nurse_id = ?', [id], (err) => {
      if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
    });
    if (skill_ids.length > 0) {
      const stmt = db.prepare('INSERT INTO nurse_skills (nurse_id, skill_id) VALUES (?, ?)');
      let completed = 0;
      skill_ids.forEach(skillId => {
        stmt.run(id, skillId, (err) => {
          if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
          completed++;
          if (completed === skill_ids.length) {
            stmt.finalize((err) => {
              if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
              db.run('COMMIT', (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
              });
            });
          }
        });
      });
    } else {
      db.run('COMMIT', (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    }
  });
});

app.get('/api/departments/:id/shift-skill-requirements', (req, res) => {
  const { id } = req.params;
  db.all('SELECT ssr.*, st.name as skill_name FROM shift_skill_requirements ssr JOIN skill_tags st ON ssr.skill_id = st.id WHERE ssr.department_id = ? ORDER BY ssr.shift, st.name', [id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.put('/api/departments/:id/shift-skill-requirements', (req, res) => {
  const { id } = req.params;
  const { requirements } = req.body;
  if (!Array.isArray(requirements)) return res.status(400).json({ error: 'requirements必须为数组' });
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    db.run('DELETE FROM shift_skill_requirements WHERE department_id = ?', [id], (err) => {
      if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
    });
    if (requirements.length > 0) {
      const stmt = db.prepare('INSERT INTO shift_skill_requirements (department_id, shift, skill_id) VALUES (?, ?, ?)');
      let completed = 0;
      requirements.forEach(r => {
        stmt.run(id, r.shift, r.skill_id, (err) => {
          if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
          completed++;
          if (completed === requirements.length) {
            stmt.finalize((err) => {
              if (err) { db.run('ROLLBACK'); return res.status(500).json({ error: err.message }); }
              db.run('COMMIT', (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ success: true });
              });
            });
          }
        });
      });
    } else {
      db.run('COMMIT', (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true });
      });
    }
  });
});

app.get('/api/departments/:id/skill-coverage-report', (req, res) => {
  const { id } = req.params;
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: '请提供月份参数' });

  db.all('SELECT ssr.shift, ssr.skill_id, st.name as skill_name FROM shift_skill_requirements ssr JOIN skill_tags st ON ssr.skill_id = st.id WHERE ssr.department_id = ? ORDER BY ssr.shift', [id], (err, requirements) => {
    if (err) return res.status(500).json({ error: err.message });

    if (requirements.length === 0) {
      return res.json({ month, requirements: [], unmet: [], total_shifts: 0, met_count: 0, unmet_count: 0 });
    }

    db.all('SELECT s.date, s.shift, s.nurse_id FROM schedules s WHERE s.department_id = ? AND s.month = ?', [id, month], (err, schedules) => {
      if (err) return res.status(500).json({ error: err.message });

      db.all('SELECT ns.nurse_id, ns.skill_id FROM nurse_skills ns JOIN nurses n ON ns.nurse_id = n.id WHERE n.department_id = ?', [id], (err, nurseSkills) => {
        if (err) return res.status(500).json({ error: err.message });

        const nurseSkillMap = {};
        nurseSkills.forEach(ns => {
          if (!nurseSkillMap[ns.nurse_id]) nurseSkillMap[ns.nurse_id] = new Set();
          nurseSkillMap[ns.nurse_id].add(ns.skill_id);
        });

        const shiftReqs = {};
        requirements.forEach(r => {
          const key = r.shift;
          if (!shiftReqs[key]) shiftReqs[key] = [];
          shiftReqs[key].push({ skill_id: r.skill_id, skill_name: r.skill_name });
        });

        const dates = [...new Set(schedules.map(s => s.date))].sort();
        const unmet = [];
        let totalShifts = 0;

        dates.forEach(date => {
          Object.keys(shiftReqs).forEach(shift => {
            totalShifts++;
            const nursesInShift = schedules.filter(s => s.date === date && s.shift === shift);
            const nurseSkillIds = new Set();
            nursesInShift.forEach(s => {
              if (nurseSkillMap[s.nurse_id]) {
                nurseSkillMap[s.nurse_id].forEach(sid => nurseSkillIds.add(sid));
              }
            });

            shiftReqs[shift].forEach(req => {
              if (!nurseSkillIds.has(req.skill_id)) {
                unmet.push({
                  date,
                  shift,
                  shift_name: shift === 'morning' ? '早班' : shift === 'afternoon' ? '中班' : '夜班',
                  skill_id: req.skill_id,
                  skill_name: req.skill_name
                });
              }
            });
          });
        });

        res.json({
          month,
          requirements: requirements.map(r => ({
            shift: r.shift,
            shift_name: r.shift === 'morning' ? '早班' : r.shift === 'afternoon' ? '中班' : '夜班',
            skill_id: r.skill_id,
            skill_name: r.skill_name
          })),
          unmet,
          total_shifts: totalShifts,
          met_count: totalShifts - unmet.length,
          unmet_count: unmet.length
        });
      });
    });
  });
});

app.use('/api', trainingRouter);
app.use('/api', adverseEventRouter);
app.use('/api', handoverRouter);
app.use('/api', secondmentRouter);
app.use('/api', assessmentRouter);
app.use('/api', suppliesRouter);
app.use('/api', carePathRouter);

app.get('/api/departments', (req, res) => {
  db.all('SELECT * FROM departments ORDER BY id', [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/departments', (req, res) => {
  const { name } = req.body;
  db.run('INSERT INTO departments (name) VALUES (?)', [name], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, name });
  });
});

app.get('/api/departments/:id/nurses', (req, res) => {
  const { id } = req.params;
  const { month } = req.query;

  db.all('SELECT * FROM nurses WHERE department_id = ? ORDER BY id', [id], (err, nurses) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const ownNurseIds = nurses.map(n => n.id);

    let secondmentQuery = `SELECT sr.nurse_id, sr.start_date, sr.end_date, sr.shifts,
                                  n.id as nid, n.name, n.department_id, n.level, n.hire_date,
                                  fd.name as from_department_name
                           FROM secondment_requests sr
                           JOIN nurses n ON sr.nurse_id = n.id
                           JOIN departments fd ON sr.from_department_id = fd.id
                           WHERE sr.to_department_id = ? AND sr.status = 'approved'`;
    const secondmentParams = [id];

    if (month) {
      const [year, monthNum] = month.split('-').map(Number);
      const monthEnd = dayjs(`${year}-${String(monthNum).padStart(2, '0')}-01`).endOf('month').format('YYYY-MM-DD');
      const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`;
      secondmentQuery += ' AND sr.start_date <= ? AND sr.end_date >= ?';
      secondmentParams.push(monthEnd, monthStart);
    } else {
      const today = dayjs().format('YYYY-MM-DD');
      secondmentQuery += ' AND sr.start_date <= ? AND sr.end_date >= ?';
      secondmentParams.push(today, today);
    }

    db.all(secondmentQuery, secondmentParams, (err, secondedNurses) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      const borrowedNurses = secondedNurses.filter(s => !ownNurseIds.includes(s.nurse_id)).map(s => ({
        id: s.nurse_id,
        name: s.name,
        department_id: s.department_id,
        level: s.level,
        hire_date: s.hire_date,
        is_secondment: true,
        secondment_info: {
          from_department_name: s.from_department_name,
          start_date: s.start_date,
          end_date: s.end_date,
          shifts: s.shifts
        }
      }));

      const allNurses = [
        ...nurses.map(n => ({ ...n, is_secondment: false })),
        ...borrowedNurses
      ];

      const allNurseIds = allNurses.map(n => n.id);
      if (allNurseIds.length === 0) return res.json(allNurses);

      const placeholders = allNurseIds.map(() => '?').join(',');
      db.all(`SELECT ns.nurse_id, ns.skill_id, st.name as skill_name FROM nurse_skills ns JOIN skill_tags st ON ns.skill_id = st.id WHERE ns.nurse_id IN (${placeholders}) ORDER BY st.name`, allNurseIds, (err, skills) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        const skillMap = {};
        skills.forEach(s => {
          if (!skillMap[s.nurse_id]) skillMap[s.nurse_id] = [];
          skillMap[s.nurse_id].push({ skill_id: s.skill_id, skill_name: s.skill_name });
        });
        const result = allNurses.map(n => ({
          ...n,
          skills: skillMap[n.id] || []
        }));
        res.json(result);
      });
    });
  });
});

app.post('/api/nurses', (req, res) => {
  const { name, department_id, level, hire_date } = req.body;
  db.run('INSERT INTO nurses (name, department_id, level, hire_date) VALUES (?, ?, ?, ?)', [name, department_id, level, hire_date || null], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, name, department_id, level, hire_date: hire_date || null });
  });
});

app.get('/api/nurses/:id/unavailable', (req, res) => {
  const { id } = req.params;
  db.all('SELECT * FROM unavailable_dates WHERE nurse_id = ? ORDER BY date', [id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/nurses/:id/unavailable', (req, res) => {
  const { id } = req.params;
  const { date } = req.body;
  db.run('INSERT OR IGNORE INTO unavailable_dates (nurse_id, date) VALUES (?, ?)', [id, date], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

app.delete('/api/nurses/:id/unavailable/:date', (req, res) => {
  const { id, date } = req.params;
  db.run('DELETE FROM unavailable_dates WHERE nurse_id = ? AND date = ?', [id, date], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

app.get('/api/departments/:id/schedule', (req, res) => {
  const { id } = req.params;
  const { month } = req.query;
  const query = month 
    ? 'SELECT s.*, n.name as nurse_name, n.level, n.department_id as nurse_original_dept FROM schedules s JOIN nurses n ON s.nurse_id = n.id WHERE s.department_id = ? AND s.month = ? ORDER BY s.date, s.shift'
    : 'SELECT s.*, n.name as nurse_name, n.level, n.department_id as nurse_original_dept FROM schedules s JOIN nurses n ON s.nurse_id = n.id WHERE s.department_id = ? ORDER BY s.date, s.shift';
  const params = month ? [id, month] : [id];
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const secondmentCondition = month
      ? `sr.status = 'approved' AND sr.to_department_id = ? AND sr.start_date <= ? AND sr.end_date >= ?`
      : `sr.status = 'approved' AND sr.to_department_id = ?`;
    const secondmentParams = month
      ? [id, `${month}-31`, `${month}-01`]
      : [id];

    db.all(
      `SELECT sr.nurse_id, sr.start_date, sr.end_date, sr.from_department_id, fd.name as from_department_name
       FROM secondment_requests sr
       JOIN departments fd ON sr.from_department_id = fd.id
       WHERE ${secondmentCondition}`,
      secondmentParams,
      (err, secondments) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        const secondmentMap = {};
        secondments.forEach(s => {
          secondmentMap[s.nurse_id] = s;
        });

        const enrichedRows = rows.map(r => ({
          ...r,
          is_secondment: r.nurse_original_dept !== parseInt(id) || !!secondmentMap[r.nurse_id],
          secondment_info: secondmentMap[r.nurse_id] || null
        }));

        db.all('SELECT ssr.shift, ssr.skill_id, st.name as skill_name FROM shift_skill_requirements ssr JOIN skill_tags st ON ssr.skill_id = st.id WHERE ssr.department_id = ? ORDER BY ssr.shift', [id], (err, requirements) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json({ schedules: enrichedRows, shift_skill_requirements: requirements, secondments });
        });
      }
    );
  });
});

app.post('/api/departments/:id/generate-schedule', (req, res) => {
  const { id } = req.params;
  const { month } = req.body;

  if (!month) {
    return res.status(400).json({ error: '请提供月份参数' });
  }

  db.all('SELECT * FROM nurses WHERE department_id = ?', [id], (err, ownNurses) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const [year, monthNum] = month.split('-').map(Number);
    const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const monthEnd = dayjs(monthStart).endOf('month').format('YYYY-MM-DD');

    db.all(
      `SELECT sr.nurse_id, sr.start_date, sr.end_date, sr.shifts as secondment_shifts,
              n.id, n.name, n.department_id, n.level, n.hire_date
       FROM secondment_requests sr
       JOIN nurses n ON sr.nurse_id = n.id
       WHERE sr.to_department_id = ? AND sr.status = 'approved'
       AND sr.start_date <= ? AND sr.end_date >= ?`,
      [id, monthEnd, monthStart],
      (err, secondedRows) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        const ownNurseIds = new Set(ownNurses.map(n => n.id));
        const borrowedNurses = secondedRows.filter(s => !ownNurseIds.has(s.nurse_id)).map(s => ({
          id: s.nurse_id,
          name: s.name,
          department_id: s.department_id,
          level: s.level,
          hire_date: s.hire_date,
          is_secondment: true,
          secondment_info: {
            start_date: s.start_date,
            end_date: s.end_date,
            shifts: s.secondment_shifts
          }
        }));

        const nurses = [
          ...ownNurses.map(n => ({ ...n, is_secondment: false })),
          ...borrowedNurses
        ];

        if (nurses.length === 0) {
          return res.status(400).json({ error: '该科室暂无护士' });
        }

        const nurseIds = nurses.map(n => n.id);
        const placeholders = nurseIds.map(() => '?').join(',');

        db.all(`SELECT * FROM unavailable_dates WHERE nurse_id IN (${placeholders})`, nurseIds, (err, unavailableDates) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          db.all(`SELECT ns.nurse_id, ns.skill_id FROM nurse_skills ns WHERE ns.nurse_id IN (${placeholders})`, nurseIds, (err, nurseSkills) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            db.all('SELECT ssr.shift, ssr.skill_id, st.name as skill_name FROM shift_skill_requirements ssr JOIN skill_tags st ON ssr.skill_id = st.id WHERE ssr.department_id = ?', [id], (err, shiftRequirements) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }

              const result = generateSchedule(id, nurses, month, unavailableDates, nurseSkills, shiftRequirements);

              if (!result.success) {
                return res.status(400).json({ error: result.reason });
              }

              db.run('DELETE FROM schedules WHERE department_id = ? AND month = ?', [id, month], function(err) {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }

                const stmt = db.prepare('INSERT INTO schedules (department_id, nurse_id, date, shift, month) VALUES (?, ?, ?, ?, ?)');
                result.schedule.forEach(s => {
                  stmt.run(s.department_id, s.nurse_id, s.date, s.shift, s.month);
                });
            stmt.finalize((err) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              createScheduleVersion(db, id, month, 'auto_generate', null, '系统', '自动生成排班')
                .catch(err => console.error('保存版本快照失败:', err.message))
                .finally(() => {
                  const today = dayjs().format('YYYY-MM-DD');
                  compute7DayHours(db, id, today).then(fatigueData => {
                    const fatigue_warnings = fatigueData.filter(f => f.is_fatigue_warning);
                    res.json({ success: true, schedule: result.schedule, shiftCounts: result.shiftCounts, fatigue_warnings, skill_warnings: result.skillWarnings || [] });
                  }).catch(() => {
                    res.json({ success: true, schedule: result.schedule, shiftCounts: result.shiftCounts, fatigue_warnings: [], skill_warnings: result.skillWarnings || [] });
                  });
                });
            });
          });
        });
      });
    });
  });
  });
});

app.put('/api/schedules/:id', (req, res) => {
  const { id } = req.params;
  const { nurse_id } = req.body;

  db.get('SELECT * FROM schedules WHERE id = ?', [id], (err, schedule) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!schedule) {
      return res.status(404).json({ error: '排班记录不存在' });
    }

    db.all('SELECT * FROM schedules WHERE department_id = ? AND month = ?', [schedule.department_id, schedule.month], (err, allSchedules) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      db.all('SELECT * FROM nurses WHERE department_id = ?', [schedule.department_id], (err, nurses) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        const validation = validateScheduleChange(allSchedules, nurses, {
          nurse_id,
          date: schedule.date,
          shift: schedule.shift
        });

        if (!validation.valid) {
          return res.status(400).json({ error: validation.reason });
        }

        db.all('SELECT ns.nurse_id, ns.skill_id FROM nurse_skills ns JOIN nurses n ON ns.nurse_id = n.id WHERE n.department_id = ?', [schedule.department_id], (err, nurseSkills) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          db.all('SELECT ssr.shift, ssr.skill_id, st.name as skill_name FROM shift_skill_requirements ssr JOIN skill_tags st ON ssr.skill_id = st.id WHERE ssr.department_id = ?', [schedule.department_id], (err, shiftRequirements) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            const skillValidation = validateScheduleChange(allSchedules, nurses, {
              nurse_id,
              date: schedule.date,
              shift: schedule.shift
            }, nurseSkills, shiftRequirements);

            if (!skillValidation.valid) {
              return res.status(400).json({ error: skillValidation.reason });
            }

            db.run('UPDATE schedules SET nurse_id = ? WHERE id = ?', [nurse_id, id], function(err) {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              createScheduleVersion(db, schedule.department_id, schedule.month, 'manual_adjust', null, '管理员', '手动调整排班')
                .catch(err => console.error('保存版本快照失败:', err.message))
                .finally(() => {
                  res.json({ success: true });
                });
            });
          });
        });
      });
    });
  });
});

app.get('/api/departments/:id/swap-requests', (req, res) => {
  const { id } = req.params;
  const { status } = req.query;
  
  let query = `
    SELECT sr.*, 
           r.name as requester_name, 
           t.name as target_name,
           r.level as requester_level,
           t.level as target_level
    FROM swap_requests sr
    JOIN nurses r ON sr.requester_id = r.id
    JOIN nurses t ON sr.target_id = t.id
    WHERE sr.department_id = ?
  `;
  const params = [id];
  
  if (status) {
    query += ' AND sr.status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY sr.created_at DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/swap-requests', (req, res) => {
  const { department_id, requester_id, target_id, date, requester_shift, target_shift } = req.body;
  
  db.run(`
    INSERT INTO swap_requests (department_id, requester_id, target_id, date, requester_shift, target_shift, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `, [department_id, requester_id, target_id, date, requester_shift, target_shift], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, success: true });
  });
});

app.put('/api/swap-requests/:id/confirm', (req, res) => {
  const { id } = req.params;
  const { nurse_id } = req.body;

  db.get('SELECT * FROM swap_requests WHERE id = ?', [id], (err, request) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!request) {
      return res.status(404).json({ error: '换班申请不存在' });
    }

    if (nurse_id !== request.target_id) {
      return res.status(400).json({ error: '只有被申请人可以确认' });
    }

    db.run('UPDATE swap_requests SET status = ? WHERE id = ?', ['confirmed', id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true });
    });
  });
});

app.put('/api/swap-requests/:id/approve', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM swap_requests WHERE id = ?', [id], (err, request) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!request) {
      return res.status(404).json({ error: '换班申请不存在' });
    }
    if (request.status !== 'confirmed') {
      return res.status(400).json({ error: '换班申请尚未确认，无法审批' });
    }

    const { department_id, requester_id, target_id, date, requester_shift, target_shift } = request;
    const month = date.substring(0, 7);

    db.all(
      'SELECT * FROM schedules WHERE department_id = ? AND month = ?',
      [department_id, month],
      (err, schedules) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        db.all('SELECT * FROM nurses WHERE department_id = ?', [department_id], (err, nurses) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          const { validateSwap } = require('./scheduler');
          const validation = validateSwap(schedules, nurses, requester_id, target_id, date, requester_shift, target_shift);
          
          if (!validation.valid) {
            return res.status(400).json({ error: validation.reason });
          }

          db.all('SELECT ns.nurse_id, ns.skill_id FROM nurse_skills ns JOIN nurses n ON ns.nurse_id = n.id WHERE n.department_id = ?', [department_id], (err, nurseSkills) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            db.all('SELECT ssr.shift, ssr.skill_id, st.name as skill_name FROM shift_skill_requirements ssr JOIN skill_tags st ON ssr.skill_id = st.id WHERE ssr.department_id = ?', [department_id], (err, shiftRequirements) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }

              const skillValidation = validateSwap(schedules, nurses, requester_id, target_id, date, requester_shift, target_shift, nurseSkills, shiftRequirements);
              
              if (!skillValidation.valid) {
                return res.status(400).json({ error: skillValidation.reason });
              }

              db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                db.run(
                  'DELETE FROM schedules WHERE department_id = ? AND date = ? AND nurse_id = ? AND shift = ?',
                  [department_id, date, requester_id, requester_shift],
                  function(err) {
                    if (err) {
                      db.run('ROLLBACK');
                      return res.status(500).json({ error: err.message });
                    }

                    db.run(
                      'DELETE FROM schedules WHERE department_id = ? AND date = ? AND nurse_id = ? AND shift = ?',
                      [department_id, date, target_id, target_shift],
                      function(err) {
                        if (err) {
                          db.run('ROLLBACK');
                          return res.status(500).json({ error: err.message });
                        }

                        db.run(
                          'INSERT INTO schedules (department_id, nurse_id, date, shift, month) VALUES (?, ?, ?, ?, ?)',
                          [department_id, target_id, date, requester_shift, month],
                          function(err) {
                            if (err) {
                              db.run('ROLLBACK');
                              return res.status(500).json({ error: err.message });
                            }

                            db.run(
                              'INSERT INTO schedules (department_id, nurse_id, date, shift, month) VALUES (?, ?, ?, ?, ?)',
                              [department_id, requester_id, date, target_shift, month],
                              function(err) {
                                if (err) {
                                  db.run('ROLLBACK');
                                  return res.status(500).json({ error: err.message });
                                }

                                db.run('UPDATE swap_requests SET status = ? WHERE id = ?', ['approved', id], function(err) {
                                  if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ error: err.message });
                                  }

                                  db.run('COMMIT', (err) => {
                                    if (err) {
                                      return res.status(500).json({ error: err.message });
                                    }
                                    createScheduleVersion(db, department_id, month, 'swap_effective', null, '管理员', `换班生效: ${request.requester_name || requester_id}与${request.target_name || target_id}`)
                                      .catch(err => console.error('保存版本快照失败:', err.message))
                                      .finally(() => {
                                        const today = dayjs().format('YYYY-MM-DD');
                                        compute7DayHoursForNurses(db, [requester_id, target_id], department_id, today).then(fatigueData => {
                                          const fatigue_warnings = fatigueData.filter(f => f.is_fatigue_warning);
                                          res.json({ success: true, fatigue_warnings });
                                        }).catch(() => {
                                          res.json({ success: true, fatigue_warnings: [] });
                                        });
                                      });
                                  });
                                });
                              }
                            );
                          }
                        );
                      }
                    );
                  }
                );
              });
            });
          });
        });
      }
    );
  });
});

app.put('/api/swap-requests/:id/reject', (req, res) => {
  const { id } = req.params;

  db.run('UPDATE swap_requests SET status = ? WHERE id = ?', ['rejected', id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ success: true });
  });
});

const SHIFT_TIMES = {
  morning: { start: '08:00', end: '16:00' },
  afternoon: { start: '14:00', end: '22:00' },
  night: { start: '22:00', end: '08:00' }
};

const checkTimeOverlap = (start1, end1, start2, end2) => {
  const toMinutes = (time) => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  };
  
  let s1 = toMinutes(start1);
  let e1 = toMinutes(end1);
  let s2 = toMinutes(start2);
  let e2 = toMinutes(end2);
  
  if (e1 < s1) e1 += 24 * 60;
  if (e2 < s2) e2 += 24 * 60;
  
  return !(e1 <= s2 || e2 <= s1);
};

app.get('/api/departments/:id/overtime-requests', (req, res) => {
  const { id } = req.params;
  const { status, month } = req.query;
  
  let query = `
    SELECT orr.*, n.name as nurse_name, n.level
    FROM overtime_requests orr
    JOIN nurses n ON orr.nurse_id = n.id
    WHERE orr.department_id = ?
  `;
  const params = [id];
  
  if (status) {
    query += ' AND orr.status = ?';
    params.push(status);
  }
  
  if (month) {
    query += ' AND orr.month = ?';
    params.push(month);
  }
  
  query += ' ORDER BY orr.created_at DESC';
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/overtime-requests', (req, res) => {
  const { department_id, nurse_id, date, start_time, end_time, reason } = req.body;
  
  if (!department_id || !nurse_id || !date || !start_time || !end_time) {
    return res.status(400).json({ error: '请填写完整的加班信息' });
  }
  
  const start = new Date(`2000-01-01T${start_time}`);
  const end = new Date(`2000-01-01T${end_time}`);
  let hours = (end - start) / (1000 * 60 * 60);
  if (hours < 0) hours += 24;
  if (hours <= 0) {
    return res.status(400).json({ error: '加班时长必须大于0' });
  }
  
  const month = date.substring(0, 7);
  
  db.get('SELECT * FROM schedules WHERE nurse_id = ? AND date = ?', [nurse_id, date], (err, schedule) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (schedule) {
      const shiftTime = SHIFT_TIMES[schedule.shift];
      if (checkTimeOverlap(start_time, end_time, shiftTime.start, shiftTime.end)) {
        return res.status(400).json({ error: '加班时段不能与当天已有排班重叠' });
      }
    }
    
    db.run(`
      INSERT INTO overtime_requests (department_id, nurse_id, date, start_time, end_time, hours, reason, status, month)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `, [department_id, nurse_id, date, start_time, end_time, hours, reason, month], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, success: true });
    });
  });
});

app.put('/api/overtime-requests/:id/approve', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM overtime_requests WHERE id = ?', [id], (err, request) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!request) {
      return res.status(404).json({ error: '加班申请不存在' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: '该申请已处理' });
    }
    
    db.get('SELECT * FROM schedules WHERE nurse_id = ? AND date = ?', [request.nurse_id, request.date], (err, schedule) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      
      if (schedule) {
        const shiftTime = SHIFT_TIMES[schedule.shift];
        if (checkTimeOverlap(request.start_time, request.end_time, shiftTime.start, shiftTime.end)) {
          return res.status(400).json({ error: '加班时段与当天排班重叠，无法审批通过' });
        }
      }
      
      db.run('UPDATE overtime_requests SET status = ? WHERE id = ?', ['approved', id], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        const today = dayjs().format('YYYY-MM-DD');
        compute7DayHoursForNurses(db, [request.nurse_id], request.department_id, today).then(fatigueData => {
          const fatigue_warnings = fatigueData.filter(f => f.is_fatigue_warning);
          res.json({ success: true, fatigue_warnings });
        }).catch(() => {
          res.json({ success: true, fatigue_warnings: [] });
        });
      });
    });
  });
});

app.put('/api/overtime-requests/:id/reject', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM overtime_requests WHERE id = ?', [id], (err, request) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!request) {
      return res.status(404).json({ error: '加班申请不存在' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: '该申请已处理' });
    }

    db.run('UPDATE overtime_requests SET status = ? WHERE id = ?', ['rejected', id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true });
    });
  });
});

app.get('/api/departments/:id/monthly-report', (req, res) => {
  const { id } = req.params;
  const { month } = req.query;
  
  if (!month) {
    return res.status(400).json({ error: '请提供月份参数' });
  }

  const [year, monthNum] = month.split('-').map(Number);
  const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`;
  const monthEnd = dayjs(monthStart).endOf('month').format('YYYY-MM-DD');
  
  db.all('SELECT * FROM nurses WHERE department_id = ?', [id], (err, nurses) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    db.all(
      'SELECT nurse_id, COUNT(*) as shift_count FROM schedules WHERE department_id = ? AND month = ? GROUP BY nurse_id',
      [id, month],
      (err, scheduleCounts) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        db.all(
          "SELECT nurse_id, COUNT(*) as overtime_count, SUM(hours) as overtime_hours FROM overtime_requests WHERE department_id = ? AND month = ? AND status = 'approved' GROUP BY nurse_id",
          [id, month],
          (err, overtimeStats) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            db.all(
              "SELECT lr.nurse_id, COUNT(*) as leave_count FROM leave_requests lr INNER JOIN schedules s ON s.nurse_id = lr.nurse_id AND s.date = lr.date WHERE lr.department_id = ? AND lr.month = ? AND lr.status = 'approved' GROUP BY lr.nurse_id",
              [id, month],
              (err, leaveStats) => {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }

                db.all(
                  "SELECT substitute_nurse_id, COUNT(*) as substitute_count FROM leave_requests WHERE department_id = ? AND month = ? AND status = 'approved' AND substitute_status = 'confirmed' GROUP BY substitute_nurse_id",
                  [id, month],
                  (err, subStats) => {
                    if (err) {
                      return res.status(500).json({ error: err.message });
                    }

                    db.all(
                      `SELECT sr.*, n.name as nurse_name, n.level as nurse_level,
                              fd.name as from_department_name,
                              td.name as to_department_name
                       FROM secondment_requests sr
                       JOIN nurses n ON sr.nurse_id = n.id
                       JOIN departments fd ON sr.from_department_id = fd.id
                       JOIN departments td ON sr.to_department_id = td.id
                       WHERE sr.status = 'approved'
                       AND ((sr.from_department_id = ? OR sr.to_department_id = ?)
                       AND sr.start_date <= ? AND sr.end_date >= ?)
                       ORDER BY n.name`,
                      [id, id, monthEnd, monthStart],
                      (err, secondments) => {
                        if (err) {
                          return res.status(500).json({ error: err.message });
                        }

                        const borrowedSecondments = secondments.filter(s => s.to_department_id === parseInt(id));
                        const lentOutSecondments = secondments.filter(s => s.from_department_id === parseInt(id));
                        const lentOutNurseIds = new Set(lentOutSecondments.map(s => s.nurse_id));

                        const report = nurses.map(nurse => {
                          const scheduleStat = scheduleCounts.find(s => s.nurse_id === nurse.id) || { shift_count: 0 };
                          const overtimeStat = overtimeStats.find(o => o.nurse_id === nurse.id) || { overtime_count: 0, overtime_hours: 0 };
                          const leaveStat = leaveStats.find(l => l.nurse_id === nurse.id) || { leave_count: 0 };
                          const subStat = subStats.find(s => s.substitute_nurse_id === nurse.id) || { substitute_count: 0 };
                          
                          const leave_count = leaveStat.leave_count || 0;
                          const substitute_shifts = subStat.substitute_count || 0;
                          const normal_hours = (scheduleStat.shift_count - leave_count) * 8;
                          const substitute_hours = substitute_shifts * 8;
                          const overtime_hours = Math.round((overtimeStat.overtime_hours || 0) * 100) / 100;
                          const total_hours = Math.round((normal_hours + substitute_hours + overtime_hours) * 100) / 100;

                          const isLentOut = lentOutNurseIds.has(nurse.id);
                          const lentOutInfo = lentOutSecondments.find(s => s.nurse_id === nurse.id);
                          
                          return {
                            nurse_id: nurse.id,
                            nurse_name: nurse.name,
                            nurse_level: nurse.level,
                            nurse_type: isLentOut ? 'lent_out' : 'own',
                            lent_out_to: isLentOut ? lentOutInfo.to_department_name : null,
                            lent_out_period: isLentOut ? `${lentOutInfo.start_date} ~ ${lentOutInfo.end_date}` : null,
                            normal_shift_count: scheduleStat.shift_count,
                            leave_count,
                            substitute_shifts,
                            effective_shift_count: scheduleStat.shift_count - leave_count + substitute_shifts,
                            overtime_count: overtimeStat.overtime_count,
                            normal_hours,
                            substitute_hours,
                            overtime_hours,
                            total_hours
                          };
                        });

                        const borrowedReport = borrowedSecondments.map(sec => {
                          const scheduleStat = scheduleCounts.find(s => s.nurse_id === sec.nurse_id) || { shift_count: 0 };
                          const overtimeStat = overtimeStats.find(o => o.nurse_id === sec.nurse_id) || { overtime_count: 0, overtime_hours: 0 };
                          
                          const normal_hours = (scheduleStat.shift_count) * 8;
                          const overtime_hours = Math.round((overtimeStat.overtime_hours || 0) * 100) / 100;
                          const total_hours = Math.round((normal_hours + overtime_hours) * 100) / 100;

                          return {
                            nurse_id: sec.nurse_id,
                            nurse_name: sec.nurse_name,
                            nurse_level: sec.nurse_level,
                            nurse_type: 'borrowed',
                            borrowed_from: sec.from_department_name,
                            borrowed_period: `${sec.start_date} ~ ${sec.end_date}`,
                            normal_shift_count: scheduleStat.shift_count,
                            leave_count: 0,
                            substitute_shifts: 0,
                            effective_shift_count: scheduleStat.shift_count,
                            overtime_count: overtimeStat.overtime_count || 0,
                            normal_hours,
                            substitute_hours: 0,
                            overtime_hours,
                            total_hours
                          };
                        });

                        res.json([...report, ...borrowedReport]);
                      }
                    );
                  });
              });
          });
      });
  });
});

app.get('/api/nurses/:id/leave-balance', (req, res) => {
  const { id } = req.params;
  const year = req.query.year || dayjs().year();
  getLeaveBalance(db, id, parseInt(year))
    .then(balance => res.json(balance))
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/departments/:id/leave-quota-overview', (req, res) => {
  const { id } = req.params;
  const year = req.query.year || dayjs().year();
  const yearInt = parseInt(year);

  db.all('SELECT * FROM nurses WHERE department_id = ?', [id], (err, nurses) => {
    if (err) return res.status(500).json({ error: err.message });

    db.get('SELECT * FROM leave_quota_config WHERE department_id = ? AND year = ?', [id, String(yearInt)], (err, config) => {
      if (err) return res.status(500).json({ error: err.message });

      const sickTotal = config ? config.sick_days : 15;
      const personalTotal = config ? config.personal_days : 5;

      const yearPrefix = `${yearInt}-`;
      const nurseIds = nurses.map(n => n.id);
      if (nurseIds.length === 0) return res.json([]);

      const placeholders = nurseIds.map(() => '?').join(',');
      db.all(
        `SELECT nurse_id, leave_type, COUNT(*) as used_days FROM leave_requests WHERE nurse_id IN (${placeholders}) AND date LIKE ? AND status = 'approved' GROUP BY nurse_id, leave_type`,
        [...nurseIds, `${yearPrefix}%`],
        (err, usedRows) => {
          if (err) return res.status(500).json({ error: err.message });

          const usedMap = {};
          usedRows.forEach(r => {
            if (!usedMap[r.nurse_id]) usedMap[r.nurse_id] = {};
            usedMap[r.nurse_id][r.leave_type] = r.used_days;
          });

          const overview = nurses.map(nurse => {
            const yearsOfService = getYearsOfService(nurse.hire_date, `${yearInt}-01-01`);
            const annualTotal = computeAnnualDays(yearsOfService);
            const nurseUsed = usedMap[nurse.id] || {};

            return {
              nurse_id: nurse.id,
              nurse_name: nurse.name,
              nurse_level: nurse.level,
              years_of_service: yearsOfService,
              annual: { total: annualTotal, used: nurseUsed.annual || 0, remaining: annualTotal - (nurseUsed.annual || 0) },
              sick: { total: sickTotal, used: nurseUsed.sick || 0, remaining: sickTotal - (nurseUsed.sick || 0) },
              personal: { total: personalTotal, used: nurseUsed.personal || 0, remaining: personalTotal - (nurseUsed.personal || 0) }
            };
          });

          res.json(overview);
        }
      );
    });
  });
});

app.get('/api/departments/:id/leave-quota-config', (req, res) => {
  const { id } = req.params;
  const year = req.query.year || dayjs().year();
  db.get('SELECT * FROM leave_quota_config WHERE department_id = ? AND year = ?', [id, String(year)], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) {
      return res.json({ department_id: parseInt(id), year: String(year), sick_days: 15, personal_days: 5 });
    }
    res.json(row);
  });
});

app.put('/api/departments/:id/leave-quota-config', (req, res) => {
  const { id } = req.params;
  const { year, sick_days, personal_days } = req.body;
  if (!year) return res.status(400).json({ error: '请提供年份' });

  db.run(
    `INSERT INTO leave_quota_config (department_id, year, sick_days, personal_days) VALUES (?, ?, ?, ?)
     ON CONFLICT(department_id, year) DO UPDATE SET sick_days = excluded.sick_days, personal_days = excluded.personal_days`,
    [id, String(year), sick_days || 15, personal_days || 5],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, department_id: parseInt(id), year: String(year), sick_days: sick_days || 15, personal_days: personal_days || 5 });
    }
  );
});

app.get('/api/departments/:id/leave-requests', (req, res) => {
  const { id } = req.params;
  const { status, month } = req.query;

  let query = `
    SELECT lr.*, n.name as nurse_name, n.level as nurse_level,
           sn.name as substitute_name, sn.level as substitute_level
    FROM leave_requests lr
    JOIN nurses n ON lr.nurse_id = n.id
    LEFT JOIN nurses sn ON lr.substitute_nurse_id = sn.id
    WHERE lr.department_id = ?
  `;
  const params = [id];

  if (status) {
    query += ' AND lr.status = ?';
    params.push(status);
  }

  if (month) {
    query += ' AND lr.month = ?';
    params.push(month);
  }

  query += ' ORDER BY lr.created_at DESC';

  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/leave-requests', (req, res) => {
  const { department_id, nurse_id, date, leave_type, reason } = req.body;

  if (!department_id || !nurse_id || !date || !leave_type) {
    return res.status(400).json({ error: '请填写完整的请假信息' });
  }

  if (!['personal', 'sick', 'annual'].includes(leave_type)) {
    return res.status(400).json({ error: '无效的请假类型' });
  }

  const month = date.substring(0, 7);
  const year = parseInt(date.substring(0, 4));

  db.get('SELECT * FROM leave_requests WHERE nurse_id = ? AND date = ? AND status != ?', [nurse_id, date, 'rejected'], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (existing) {
      return res.status(400).json({ error: '该日期已有请假申请' });
    }

    getLeaveBalance(db, nurse_id, year).then(balance => {
      const quota = balance[leave_type];
      if (quota.remaining <= 0) {
        return res.status(400).json({ error: `${LEAVE_TYPE_NAMES_CN[leave_type]}已用完（总额度${quota.total}天，已使用${quota.used}天）` });
      }

      db.run(`
        INSERT INTO leave_requests (department_id, nurse_id, date, leave_type, status, month, reason)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)
      `, [department_id, nurse_id, date, leave_type, month, reason || null], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({ id: this.lastID, success: true });
      });
    }).catch(err => {
      res.status(500).json({ error: err.message });
    });
  });
});

app.put('/api/leave-requests/:id/approve', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM leave_requests WHERE id = ?', [id], (err, request) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!request) {
      return res.status(404).json({ error: '请假申请不存在' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: '该申请已处理' });
    }

    db.get('SELECT * FROM schedules WHERE nurse_id = ? AND date = ?', [request.nurse_id, request.date], (err, schedule) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!schedule) {
        db.run('UPDATE leave_requests SET status = ? WHERE id = ?', ['approved', id], function(err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          const today = dayjs().format('YYYY-MM-DD');
          compute7DayHoursForNurses(db, [request.nurse_id], request.department_id, today).then(fatigueData => {
            const fatigue_warnings = fatigueData.filter(f => f.is_fatigue_warning);
            res.json({ success: true, has_schedule: false, fatigue_warnings });
          }).catch(() => {
            res.json({ success: true, has_schedule: false, fatigue_warnings: [] });
          });
        });
        return;
      }

      const { department_id, nurse_id, date } = request;

      db.all('SELECT * FROM nurses WHERE department_id = ? AND id != ?', [department_id, nurse_id], (err, nurses) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        const nurseIds = nurses.map(n => n.id);
        const placeholders = nurseIds.map(() => '?').join(',');

        db.all(`SELECT nurse_id, COUNT(*) as shift_count FROM schedules WHERE department_id = ? AND month = ? AND nurse_id IN (${placeholders}) GROUP BY nurse_id`, [department_id, request.month, ...nurseIds], (err, shiftCounts) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          db.all(`SELECT nurse_id FROM schedules WHERE date = ? AND nurse_id IN (${placeholders})`, [date, ...nurseIds], (err, scheduledNurses) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            const scheduledSet = new Set(scheduledNurses.map(s => s.nurse_id));

            db.all(`SELECT nurse_id FROM unavailable_dates WHERE date = ? AND nurse_id IN (${placeholders})`, [date, ...nurseIds], (err, unavailableNurses) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }

              const unavailableSet = new Set(unavailableNurses.map(u => u.nurse_id));

              db.all(`SELECT substitute_nurse_id FROM leave_requests WHERE date = ? AND status = 'approved' AND substitute_status = 'confirmed' AND substitute_nurse_id IN (${placeholders})`, [date, ...nurseIds], (err, alreadySubstituting) => {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }

                const substitutingSet = new Set(alreadySubstituting.map(s => s.substitute_nurse_id));

                db.all(`SELECT nurse_id FROM leave_requests WHERE date = ? AND status = 'approved' AND nurse_id IN (${placeholders})`, [date, ...nurseIds], (err, leaveNurses) => {
                  if (err) {
                    return res.status(500).json({ error: err.message });
                  }

                  const leaveSet = new Set(leaveNurses.map(l => l.nurse_id));

                  const availableNurses = nurses.filter(n =>
                    !scheduledSet.has(n.id) &&
                    !unavailableSet.has(n.id) &&
                    !substitutingSet.has(n.id) &&
                    !leaveSet.has(n.id)
                  );

                  const countMap = {};
                  shiftCounts.forEach(sc => {
                    countMap[sc.nurse_id] = sc.shift_count;
                  });

                  availableNurses.sort((a, b) => (countMap[a.id] || 0) - (countMap[b.id] || 0));

                  const substitute = availableNurses.length > 0 ? availableNurses[0] : null;

                  if (substitute) {
                    db.run('UPDATE leave_requests SET status = ?, substitute_nurse_id = ?, substitute_status = ? WHERE id = ?',
                      ['approved', substitute.id, 'pending', id], function(err) {
                        if (err) {
                          return res.status(500).json({ error: err.message });
                        }
                        db.get(`SELECT lr.*, n.name as nurse_name, sn.name as substitute_name
                          FROM leave_requests lr
                          JOIN nurses n ON lr.nurse_id = n.id
                          LEFT JOIN nurses sn ON lr.substitute_nurse_id = sn.id
                          WHERE lr.id = ?`, [id], (err, updated) => {
                          if (err) {
                            return res.status(500).json({ error: err.message });
                          }
                          const today = dayjs().format('YYYY-MM-DD');
                          compute7DayHoursForNurses(db, [substitute.id], department_id, today).then(fatigueData => {
                            const fatigue_warnings = fatigueData.filter(f => f.is_fatigue_warning);
                            res.json({ success: true, has_schedule: true, substitute: updated, fatigue_warnings });
                          }).catch(() => {
                            res.json({ success: true, has_schedule: true, substitute: updated, fatigue_warnings: [] });
                          });
                        });
                      });
                  } else {
                    db.run('UPDATE leave_requests SET status = ?, substitute_status = ? WHERE id = ?',
                      ['approved', 'none', id], function(err) {
                        if (err) {
                          return res.status(500).json({ error: err.message });
                        }
                        db.get(`SELECT lr.*, n.name as nurse_name, sn.name as substitute_name
                          FROM leave_requests lr
                          JOIN nurses n ON lr.nurse_id = n.id
                          LEFT JOIN nurses sn ON lr.substitute_nurse_id = sn.id
                          WHERE lr.id = ?`, [id], (err, updated) => {
                          if (err) {
                            return res.status(500).json({ error: err.message });
                          }
                          res.json({ success: true, has_schedule: true, substitute: null, leave: updated, need_manual: true, fatigue_warnings: [] });
                        });
                      });
                  }
                });
              });
            });
          });
        });
      });
    });
  });
});

app.put('/api/leave-requests/:id/reject', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM leave_requests WHERE id = ?', [id], (err, request) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!request) {
      return res.status(404).json({ error: '请假申请不存在' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: '该申请已处理' });
    }

    db.run('UPDATE leave_requests SET status = ? WHERE id = ?', ['rejected', id], function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true });
    });
  });
});

app.put('/api/leave-requests/:id/confirm-substitute', (req, res) => {
  const { id } = req.params;
  const { substitute_nurse_id } = req.body;

  db.get('SELECT * FROM leave_requests WHERE id = ?', [id], (err, request) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!request) {
      return res.status(404).json({ error: '请假申请不存在' });
    }
    if (request.status !== 'approved') {
      return res.status(400).json({ error: '请假申请未审批通过' });
    }
    if (request.substitute_status === 'confirmed') {
      return res.status(400).json({ error: '补班已确认' });
    }

    const finalSubId = substitute_nurse_id || request.substitute_nurse_id;

    if (!finalSubId) {
      db.run('UPDATE leave_requests SET substitute_status = ? WHERE id = ?', ['manual', id], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, manual: true });
      });
      return;
    }

    db.run('UPDATE leave_requests SET substitute_nurse_id = ?, substitute_status = ? WHERE id = ?',
      [finalSubId, 'confirmed', id], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        createScheduleVersion(db, request.department_id, request.month, 'substitute_effective', null, '管理员', `补班生效: 护士${request.nurse_id}请假，${finalSubId}补班`)
          .catch(err => console.error('保存版本快照失败:', err.message))
          .finally(() => {
            const today = dayjs().format('YYYY-MM-DD');
            compute7DayHoursForNurses(db, [finalSubId], request.department_id, today).then(fatigueData => {
              const fatigue_warnings = fatigueData.filter(f => f.is_fatigue_warning);
              res.json({ success: true, fatigue_warnings });
            }).catch(() => {
              res.json({ success: true, fatigue_warnings: [] });
            });
          });
      });
  });
});

app.put('/api/leave-requests/:id/manual-substitute', (req, res) => {
  const { id } = req.params;
  const { substitute_nurse_id } = req.body;

  if (!substitute_nurse_id) {
    return res.status(400).json({ error: '请选择补班护士' });
  }

  db.get('SELECT * FROM leave_requests WHERE id = ?', [id], (err, request) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!request) {
      return res.status(404).json({ error: '请假申请不存在' });
    }
    if (request.status !== 'approved') {
      return res.status(400).json({ error: '请假申请未审批通过' });
    }

    db.run('UPDATE leave_requests SET substitute_nurse_id = ?, substitute_status = ? WHERE id = ?',
      [substitute_nurse_id, 'confirmed', id], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        createScheduleVersion(db, request.department_id, request.month, 'substitute_effective', null, '管理员', `手动补班生效: 护士${request.nurse_id}请假，${substitute_nurse_id}补班`)
          .catch(err => console.error('保存版本快照失败:', err.message))
          .finally(() => {
            const today = dayjs().format('YYYY-MM-DD');
            compute7DayHoursForNurses(db, [substitute_nurse_id], request.department_id, today).then(fatigueData => {
              const fatigue_warnings = fatigueData.filter(f => f.is_fatigue_warning);
              res.json({ success: true, fatigue_warnings });
            }).catch(() => {
              res.json({ success: true, fatigue_warnings: [] });
            });
          });
      });
  });
});

app.get('/api/departments/:id/leave-summary', (req, res) => {
  const { id } = req.params;
  const { month } = req.query;

  if (!month) {
    return res.status(400).json({ error: '请提供月份参数' });
  }

  db.all('SELECT * FROM nurses WHERE department_id = ?', [id], (err, nurses) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    db.all(
      `SELECT nurse_id, leave_type, COUNT(*) as days FROM leave_requests
       WHERE department_id = ? AND month = ? AND status = 'approved'
       GROUP BY nurse_id, leave_type`,
      [id, month],
      (err, leaveStats) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        db.all(
          `SELECT substitute_nurse_id, COUNT(*) as substitute_count FROM leave_requests
           WHERE department_id = ? AND month = ? AND status = 'approved' AND substitute_status = 'confirmed'
           GROUP BY substitute_nurse_id`,
          [id, month],
          (err, subStats) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            const report = nurses.map(nurse => {
              const personalDays = leaveStats.filter(l => l.nurse_id === nurse.id && l.leave_type === 'personal').reduce((sum, l) => sum + l.days, 0);
              const sickDays = leaveStats.filter(l => l.nurse_id === nurse.id && l.leave_type === 'sick').reduce((sum, l) => sum + l.days, 0);
              const annualDays = leaveStats.filter(l => l.nurse_id === nurse.id && l.leave_type === 'annual').reduce((sum, l) => sum + l.days, 0);
              const totalLeaveDays = personalDays + sickDays + annualDays;

              const subStat = subStats.find(s => s.substitute_nurse_id === nurse.id);
              const substituteCount = subStat ? subStat.substitute_count : 0;

              return {
                nurse_id: nurse.id,
                nurse_name: nurse.name,
                nurse_level: nurse.level,
                personal_days: personalDays,
                sick_days: sickDays,
                annual_days: annualDays,
                total_leave_days: totalLeaveDays,
                substitute_count: substituteCount
              };
            });

            res.json(report);
          }
        );
      }
    );
  });
});

app.get('/api/departments/:id/available-substitutes', (req, res) => {
  const { id } = req.params;
  const { date, exclude_nurse_id } = req.query;

  if (!date || !exclude_nurse_id) {
    return res.status(400).json({ error: '请提供日期和排除护士ID' });
  }

  const month = date.substring(0, 7);

  db.all('SELECT * FROM nurses WHERE department_id = ? AND id != ?', [id, exclude_nurse_id], (err, nurses) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    const nurseIds = nurses.map(n => n.id);
    if (nurseIds.length === 0) {
      return res.json([]);
    }

    const placeholders = nurseIds.map(() => '?').join(',');

    db.all(`SELECT nurse_id, COUNT(*) as shift_count FROM schedules WHERE department_id = ? AND month = ? AND nurse_id IN (${placeholders}) GROUP BY nurse_id`, [id, month, ...nurseIds], (err, shiftCounts) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      db.all(`SELECT nurse_id FROM schedules WHERE date = ? AND nurse_id IN (${placeholders})`, [date, ...nurseIds], (err, scheduledNurses) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        const scheduledSet = new Set(scheduledNurses.map(s => s.nurse_id));

        db.all(`SELECT nurse_id FROM unavailable_dates WHERE date = ? AND nurse_id IN (${placeholders})`, [date, ...nurseIds], (err, unavailableNurses) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          const unavailableSet = new Set(unavailableNurses.map(u => u.nurse_id));

          db.all(`SELECT nurse_id FROM leave_requests WHERE date = ? AND status = 'approved' AND nurse_id IN (${placeholders})`, [date, ...nurseIds], (err, leaveNurses) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            const leaveSet = new Set(leaveNurses.map(l => l.nurse_id));

            const countMap = {};
            shiftCounts.forEach(sc => {
              countMap[sc.nurse_id] = sc.shift_count;
            });

            const available = nurses
              .filter(n => !scheduledSet.has(n.id) && !unavailableSet.has(n.id) && !leaveSet.has(n.id))
              .map(n => ({
                id: n.id,
                name: n.name,
                level: n.level,
                shift_count: countMap[n.id] || 0
              }))
              .sort((a, b) => a.shift_count - b.shift_count);

            res.json(available);
          });
        });
      });
    });
  });
});

app.get('/api/departments/:id/fatigue-status', (req, res) => {
  const { id } = req.params;
  const { date } = req.query;
  const referenceDate = date || dayjs().format('YYYY-MM-DD');

  compute7DayHours(db, id, referenceDate).then(fatigueData => {
    res.json({
      department_id: parseInt(id),
      reference_date: referenceDate,
      threshold: FATIGUE_THRESHOLD,
      nurses: fatigueData,
      warning_count: fatigueData.filter(f => f.is_fatigue_warning).length
    });
  }).catch(err => {
    res.status(500).json({ error: err.message });
  });
});

app.get('/api/departments/:id/schedule-versions', (req, res) => {
  const { id } = req.params;
  const { month } = req.query;

  if (!month) {
    return res.status(400).json({ error: '请提供月份参数' });
  }

  getScheduleVersionsList(db, id, month)
    .then(versions => res.json(versions))
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/schedule-versions/:id', (req, res) => {
  const { id } = req.params;

  getScheduleVersionById(db, id)
    .then(version => {
      if (!version) {
        return res.status(404).json({ error: '版本不存在' });
      }
      delete version.snapshot;
      version.operation_type_name = OPERATION_TYPE_NAMES_CN[version.operation_type] || version.operation_type;
      res.json(version);
    })
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/departments/:id/schedule-versions/compare', (req, res) => {
  const { id } = req.params;
  const { version_a_id, version_b_id } = req.query;
  const { month } = req.query;

  if (!version_a_id || !version_b_id) {
    return res.status(400).json({ error: '请提供两个版本ID' });
  }

  Promise.all([
    getScheduleVersionById(db, version_a_id),
    getScheduleVersionById(db, version_b_id),
    db.all ? new Promise((resolve, reject) => {
      db.all('SELECT id, name FROM nurses WHERE department_id = ?', [id], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    }) : Promise.resolve([])
  ]).then(([versionA, versionB, nurses]) => {
    if (!versionA || !versionB) {
      return res.status(404).json({ error: '版本不存在' });
    }
    if (versionA.department_id !== parseInt(id) || versionB.department_id !== parseInt(id)) {
      return res.status(400).json({ error: '版本不属于该科室' });
    }

    const differences = compareScheduleVersions(versionA.snapshot_data, versionB.snapshot_data, nurses);
    const summary = {
      version_a: {
        id: versionA.id,
        version_number: versionA.version_number,
        operation_type: versionA.operation_type,
        operation_type_name: OPERATION_TYPE_NAMES_CN[versionA.operation_type],
        operator_name: versionA.operator_name,
        created_at: versionA.created_at
      },
      version_b: {
        id: versionB.id,
        version_number: versionB.version_number,
        operation_type: versionB.operation_type,
        operation_type_name: OPERATION_TYPE_NAMES_CN[versionB.operation_type],
        operator_name: versionB.operator_name,
        created_at: versionB.created_at
      },
      differences,
      difference_count: differences.length,
      added_count: differences.filter(d => d.change_type === 'added').length,
      removed_count: differences.filter(d => d.change_type === 'removed').length,
      changed_count: differences.filter(d => d.change_type === 'changed').length
    };
    res.json(summary);
  }).catch(err => res.status(500).json({ error: err.message }));
});

app.post('/api/departments/:id/schedule-versions/:versionId/rollback', (req, res) => {
  const { id, versionId } = req.params;
  const { force } = req.body || {};

  getScheduleVersionById(db, versionId).then(targetVersion => {
    if (!targetVersion) {
      return res.status(404).json({ error: '目标版本不存在' });
    }
    if (targetVersion.department_id !== parseInt(id)) {
      return res.status(400).json({ error: '版本不属于该科室' });
    }

    findConflictingSwapAndSubstitute(db, id, targetVersion.month, targetVersion.created_at).then(conflicts => {
      const hasConflicts = conflicts.swap_conflicts.length > 0 || conflicts.substitute_conflicts.length > 0;
      if (hasConflicts && !force) {
        return res.status(409).json({
          error: '存在冲突的已审批记录，请先处理后再回溯',
          conflicts: {
            swap_count: conflicts.swap_conflicts.length,
            substitute_count: conflicts.substitute_conflicts.length,
            swap_conflicts: conflicts.swap_conflicts,
            substitute_conflicts: conflicts.substitute_conflicts
          }
        });
      }

      const schedules = targetVersion.snapshot_data;
      const month = targetVersion.month;

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run('DELETE FROM schedules WHERE department_id = ? AND month = ?', [id, month], (err) => {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err.message });
          }

          if (schedules.length === 0) {
            db.run('COMMIT', (err) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              createScheduleVersion(db, id, month, 'version_rollback', null, '管理员', `回溯至V${targetVersion.version_number}版本`, targetVersion.snapshot)
                .then(versionInfo => {
                  res.json({
                    success: true,
                    new_version: versionInfo,
                    restored_count: 0,
                    target_version: {
                      id: targetVersion.id,
                      version_number: targetVersion.version_number
                    }
                  });
                })
                .catch(err => res.status(500).json({ error: `回溯成功但保存新版本失败: ${err.message}` }));
            });
            return;
          }

          const stmt = db.prepare('INSERT INTO schedules (department_id, nurse_id, date, shift, month) VALUES (?, ?, ?, ?, ?)');
          let completed = 0;
          let insertError = null;

          schedules.forEach(s => {
            stmt.run(s.department_id, s.nurse_id, s.date, s.shift, s.month, (err) => {
              if (err && !insertError) insertError = err;
              completed++;
              if (completed === schedules.length) {
                stmt.finalize((finalizeErr) => {
                  if (insertError || finalizeErr) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: (insertError || finalizeErr).message });
                  }
                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      return res.status(500).json({ error: commitErr.message });
                    }
                    createScheduleVersion(db, id, month, 'version_rollback', null, '管理员', `回溯至V${targetVersion.version_number}版本`, targetVersion.snapshot)
                      .then(versionInfo => {
                        res.json({
                          success: true,
                          new_version: versionInfo,
                          restored_count: schedules.length,
                          target_version: {
                            id: targetVersion.id,
                            version_number: targetVersion.version_number
                          }
                        });
                      })
                      .catch(err => res.status(500).json({ error: `回溯成功但保存新版本失败: ${err.message}` }));
                  });
                });
              }
            });
          });
        });
      });
    }).catch(err => res.status(500).json({ error: err.message }));
  }).catch(err => res.status(500).json({ error: err.message }));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
