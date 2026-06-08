const express = require('express');
const cors = require('cors');
const db = require('./db');
const { generateSchedule, validateScheduleChange, getDaysInMonth } = require('./scheduler');
const trainingRouter = require('./training');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use('/api', trainingRouter);

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
  db.all('SELECT * FROM nurses WHERE department_id = ? ORDER BY id', [id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/nurses', (req, res) => {
  const { name, department_id, level } = req.body;
  db.run('INSERT INTO nurses (name, department_id, level) VALUES (?, ?, ?)', [name, department_id, level], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, name, department_id, level });
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
    ? 'SELECT s.*, n.name as nurse_name, n.level FROM schedules s JOIN nurses n ON s.nurse_id = n.id WHERE s.department_id = ? AND s.month = ? ORDER BY s.date, s.shift'
    : 'SELECT s.*, n.name as nurse_name, n.level FROM schedules s JOIN nurses n ON s.nurse_id = n.id WHERE s.department_id = ? ORDER BY s.date, s.shift';
  const params = month ? [id, month] : [id];
  
  db.all(query, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

app.post('/api/departments/:id/generate-schedule', (req, res) => {
  const { id } = req.params;
  const { month } = req.body;

  if (!month) {
    return res.status(400).json({ error: '请提供月份参数' });
  }

  db.all('SELECT * FROM nurses WHERE department_id = ?', [id], (err, nurses) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (nurses.length === 0) {
      return res.status(400).json({ error: '该科室暂无护士' });
    }

    const nurseIds = nurses.map(n => n.id);
    const placeholders = nurseIds.map(() => '?').join(',');
    
    db.all(`SELECT * FROM unavailable_dates WHERE nurse_id IN (${placeholders})`, nurseIds, (err, unavailableDates) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      const result = generateSchedule(id, nurses, month, unavailableDates);

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
          res.json({ success: true, schedule: result.schedule, shiftCounts: result.shiftCounts });
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

        db.run('UPDATE schedules SET nurse_id = ? WHERE id = ?', [nurse_id, id], function(err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json({ success: true });
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
                                res.json({ success: true });
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
        res.json({ success: true });
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
                      
                      return {
                        nurse_id: nurse.id,
                        nurse_name: nurse.name,
                        nurse_level: nurse.level,
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
                    
                    res.json(report);
                  });
              });
          });
      });
  });
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

  db.get('SELECT * FROM leave_requests WHERE nurse_id = ? AND date = ? AND status != ?', [nurse_id, date, 'rejected'], (err, existing) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (existing) {
      return res.status(400).json({ error: '该日期已有请假申请' });
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
          res.json({ success: true, has_schedule: false });
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
                          res.json({ success: true, has_schedule: true, substitute: updated });
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
                          res.json({ success: true, has_schedule: true, substitute: null, leave: updated, need_manual: true });
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
        res.json({ success: true });
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
        res.json({ success: true });
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
