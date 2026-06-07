const express = require('express');
const cors = require('cors');
const db = require('./db');
const { generateSchedule, validateScheduleChange, getDaysInMonth } = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
