const express = require('express');
const router = express.Router();
const db = require('./db');
const dayjs = require('dayjs');

const SHIFT_NAMES = { morning: '早班', afternoon: '中班', night: '夜班' };

function checkNurseSchedule(nurseId, date) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT shift FROM schedules WHERE nurse_id = ? AND date = ?',
      [Number(nurseId), date],
      (err, row) => {
        if (err) return reject(err);
        resolve(row ? row.shift : null);
      }
    );
  });
}

function checkNurseShiftSchedule(nurseId, date, shiftType) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM schedules WHERE nurse_id = ? AND date = ? AND shift = ?',
      [Number(nurseId), date, shiftType],
      (err, row) => {
        if (err) return reject(err);
        resolve(!!row);
      }
    );
  });
}

function getHandoverDetail(handoverId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT sh.*,
              fn.name as from_nurse_name, fn.level as from_nurse_level,
              tn.name as to_nurse_name, tn.level as to_nurse_level,
              hn.name as head_nurse_name,
              d.name as department_name
       FROM shift_handovers sh
       JOIN nurses fn ON sh.from_nurse_id = fn.id
       JOIN nurses tn ON sh.to_nurse_id = tn.id
       LEFT JOIN nurses hn ON sh.head_nurse_id = hn.id
       JOIN departments d ON sh.department_id = d.id
       WHERE sh.id = ?`,
      [handoverId],
      (err, handover) => {
        if (err) return reject(err);
        if (!handover) return resolve(null);

        db.all(
          `SELECT hi.*,
                  s.result as signoff_result, s.remark as signoff_remark,
                  s.nurse_id as signoff_nurse_id, s.signed_at,
                  sn.name as signoff_nurse_name
           FROM handover_items hi
           LEFT JOIN handover_signoffs s ON s.item_id = hi.id
           LEFT JOIN nurses sn ON s.nurse_id = sn.id
           WHERE hi.handover_id = ?
           ORDER BY hi.id`,
          [handoverId],
          (err2, items) => {
            if (err2) return reject(err2);
            handover.items = items;
            resolve(handover);
          }
        );
      }
    );
  });
}

function recalcHandoverStatus(handoverId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM shift_handovers WHERE id = ?', [handoverId], (err, handover) => {
      if (err) return reject(err);
      if (!handover) return reject(new Error('交接记录不存在'));

      db.all(
        'SELECT hi.id, s.result FROM handover_items hi LEFT JOIN handover_signoffs s ON s.item_id = hi.id WHERE hi.handover_id = ?',
        [handoverId],
        (err2, items) => {
          if (err2) return reject(err2);

          if (items.length === 0) {
            return resolve(handover.status);
          }

          const allSigned = items.every(i => i.result !== null);
          const anyQuestioned = items.some(i => i.result === 'questioned');

          let newStatus = handover.status;
          if (allSigned) {
            newStatus = anyQuestioned ? 'disputed' : 'completed';
          } else {
            const anySigned = items.some(i => i.result !== null);
            if (anySigned && !handover.to_nurse_signed_at) {
              newStatus = 'pending_confirm';
            }
          }

          if (newStatus !== handover.status) {
            const updates = ['status = ?'];
            const params = [newStatus];
            if (newStatus === 'completed') {
              updates.push('to_nurse_signed_at = ?');
              params.push(dayjs().format('YYYY-MM-DD HH:mm:ss'));
            }
            params.push(handoverId);
            db.run(
              `UPDATE shift_handovers SET ${updates.join(', ')} WHERE id = ?`,
              params,
              function (err3) {
                if (err3) return reject(err3);
                resolve(newStatus);
              }
            );
          } else {
            resolve(handover.status);
          }
        }
      );
    });
  });
}

router.post('/handovers', async (req, res) => {
  const { department_id, from_nurse_id, to_nurse_id, handover_date, shift_type, items } = req.body;

  if (!department_id || !from_nurse_id || !to_nurse_id || !handover_date || !shift_type) {
    return res.status(400).json({ error: '请填写完整的交接信息' });
  }
  if (!['morning', 'afternoon', 'night'].includes(shift_type)) {
    return res.status(400).json({ error: '无效的班次类型' });
  }
  if (from_nurse_id === to_nurse_id) {
    return res.status(400).json({ error: '交班人和接班人不能相同' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '请至少添加一条交接事项' });
  }
  for (const item of items) {
    if (!['abnormal', 'key_patient', 'todo'].includes(item.item_type)) {
      return res.status(400).json({ error: `无效的事项类型: ${item.item_type}` });
    }
    if (!item.description || !item.description.trim()) {
      return res.status(400).json({ error: '事项描述不能为空' });
    }
    if (![1, 2, 3].includes(item.urgency)) {
      return res.status(400).json({ error: '紧急程度必须为1-3' });
    }
  }

  try {
    const fromScheduled = await checkNurseShiftSchedule(from_nurse_id, handover_date, shift_type);
    if (!fromScheduled) {
      return res.status(400).json({ error: `交班人当天没有对应的${SHIFT_NAMES[shift_type]}排班，无法创建交接记录` });
    }

    const toNurseShift = await checkNurseSchedule(to_nurse_id, handover_date);
    if (!toNurseShift) {
      return res.status(400).json({ error: '接班人当天没有排班，无法创建交接记录' });
    }

    const shiftOrder = { morning: 1, afternoon: 2, night: 3 };
    if (shiftOrder[toNurseShift] < shiftOrder[shift_type]) {
      return res.status(400).json({ error: `接班人当天排班为${SHIFT_NAMES[toNurseShift]}，不是${SHIFT_NAMES[shift_type]}的接续班次` });
    }

    db.serialize(() => {
      db.run('BEGIN TRANSACTION');

      db.run(
        `INSERT INTO shift_handovers (department_id, from_nurse_id, to_nurse_id, handover_date, shift_type, status, from_nurse_signed_at)
         VALUES (?, ?, ?, ?, ?, 'pending_confirm', ?)`,
        [department_id, from_nurse_id, to_nurse_id, handover_date, shift_type, dayjs().format('YYYY-MM-DD HH:mm:ss')],
        function (err) {
          if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err.message });
          }
          const handoverId = this.lastID;
          const itemStmt = db.prepare('INSERT INTO handover_items (handover_id, item_type, description, urgency) VALUES (?, ?, ?, ?)');
          let completed = 0;
          const itemErr = [];

          items.forEach(item => {
            itemStmt.run(handoverId, item.item_type, item.description.trim(), item.urgency, function (e) {
              if (e) itemErr.push(e);
              completed++;
              if (completed === items.length) {
                itemStmt.finalize(finalErr => {
                  if (finalErr || itemErr.length > 0) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: '创建交接事项失败' });
                  }
                  db.run('COMMIT', commitErr => {
                    if (commitErr) return res.status(500).json({ error: commitErr.message });
                    res.json({ id: handoverId, success: true });
                  });
                });
              }
            });
          });
        }
      );
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/handovers', (req, res) => {
  const { department_id, date, status, month } = req.query;

  let query = `
    SELECT sh.*,
           fn.name as from_nurse_name, fn.level as from_nurse_level,
           tn.name as to_nurse_name, tn.level as to_nurse_level,
           hn.name as head_nurse_name,
           d.name as department_name
    FROM shift_handovers sh
    JOIN nurses fn ON sh.from_nurse_id = fn.id
    JOIN nurses tn ON sh.to_nurse_id = tn.id
    LEFT JOIN nurses hn ON sh.head_nurse_id = hn.id
    JOIN departments d ON sh.department_id = d.id
    WHERE 1=1
  `;
  const params = [];

  if (department_id) {
    query += ' AND sh.department_id = ?';
    params.push(department_id);
  }
  if (date) {
    query += ' AND sh.handover_date = ?';
    params.push(date);
  }
  if (status) {
    query += ' AND sh.status = ?';
    params.push(status);
  }
  if (month) {
    query += ' AND sh.handover_date LIKE ?';
    params.push(month + '%');
  }

  query += ' ORDER BY sh.handover_date DESC, sh.shift_type';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.get('/handovers/:id', async (req, res) => {
  try {
    const detail = await getHandoverDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: '交接记录不存在' });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/handovers/:id/signoff', async (req, res) => {
  const { id } = req.params;
  const { item_id, nurse_id, result, remark } = req.body;

  if (!item_id || !nurse_id || !result) {
    return res.status(400).json({ error: '请提供签收信息' });
  }
  if (!['confirmed', 'questioned'].includes(result)) {
    return res.status(400).json({ error: '无效的签收结果' });
  }

  try {
    const handover = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shift_handovers WHERE id = ?', [id], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
    if (!handover) return res.status(404).json({ error: '交接记录不存在' });
    if (handover.status === 'completed') return res.status(400).json({ error: '交接已完成，无法继续签收' });
    if (nurse_id !== handover.to_nurse_id) {
      return res.status(400).json({ error: '只有接班护士可以签收' });
    }

    const item = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM handover_items WHERE id = ? AND handover_id = ?', [item_id, id], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
    if (!item) return res.status(404).json({ error: '交接事项不存在' });

    const existing = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM handover_signoffs WHERE item_id = ?', [item_id], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
    if (existing) return res.status(400).json({ error: '该事项已签收' });

    await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO handover_signoffs (item_id, nurse_id, result, remark, signed_at) VALUES (?, ?, ?, ?, ?)',
        [item_id, nurse_id, result, remark || null, dayjs().format('YYYY-MM-DD HH:mm:ss')],
        function (err) {
          if (err) return reject(err);
          resolve(this.lastID);
        }
      );
    });

    const newStatus = await recalcHandoverStatus(id);
    const detail = await getHandoverDetail(id);
    res.json({ success: true, status: newStatus, handover: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/handovers/:id/head-nurse-confirm', async (req, res) => {
  const { id } = req.params;
  const { head_nurse_id, remark } = req.body;

  if (!head_nurse_id) {
    return res.status(400).json({ error: '请提供护士长ID' });
  }

  try {
    const handover = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM shift_handovers WHERE id = ?', [id], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
    if (!handover) return res.status(404).json({ error: '交接记录不存在' });
    if (handover.status !== 'disputed') {
      return res.status(400).json({ error: '只有有异议的交接记录需要护士长确认' });
    }

    const nurse = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM nurses WHERE id = ? AND department_id = ? AND level = ?', [head_nurse_id, handover.department_id, 'senior'], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
    if (!nurse) return res.status(400).json({ error: '无效的护士长(需为该科室senior护士)' });

    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE shift_handovers SET status = ?, to_nurse_signed_at = ?, head_nurse_id = ?, head_nurse_remark = ?, head_nurse_confirmed_at = ? WHERE id = ?',
        ['completed', dayjs().format('YYYY-MM-DD HH:mm:ss'), head_nurse_id, remark || null, dayjs().format('YYYY-MM-DD HH:mm:ss'), id],
        function (err) {
          if (err) return reject(err);
          resolve();
        }
      );
    });

    const detail = await getHandoverDetail(id);
    res.json({ success: true, handover: detail });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/handover-statistics', (req, res) => {
  const { department_id, month } = req.query;

  if (!department_id || !month) {
    return res.status(400).json({ error: '请提供科室ID和月份' });
  }

  const monthPrefix = month + '%';

  db.all(
    'SELECT * FROM shift_handovers WHERE department_id = ? AND handover_date LIKE ?',
    [department_id, monthPrefix],
    (err, handovers) => {
      if (err) return res.status(500).json({ error: err.message });

      const total = handovers.length;
      const completed = handovers.filter(h => h.status === 'completed').length;
      const disputed = handovers.filter(h => h.status === 'disputed').length;
      const completion_rate = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;

      const completedIds = handovers.filter(h => h.status === 'completed').map(h => h.id);

      if (completedIds.length === 0) {
        return finishStats({
          total, completed, disputed,
          pending_sign: handovers.filter(h => h.status === 'pending_sign').length,
          pending_confirm: handovers.filter(h => h.status === 'pending_confirm').length,
          completion_rate,
          avg_signoff_minutes: 0,
          item_type_distribution: [],
          urgency_distribution: []
        });
      }

      const placeholders = completedIds.map(() => '?').join(',');

      db.all(
        `SELECT s.item_id, s.signed_at, hi.handover_id
         FROM handover_signoffs s
         JOIN handover_items hi ON s.item_id = hi.id
         WHERE hi.handover_id IN (${placeholders})
         ORDER BY hi.handover_id, s.signed_at DESC`,
        completedIds,
        (err2, signoffs) => {
          if (err2) return res.status(500).json({ error: err2.message });

          const handoverMap = {};
          handovers.forEach(h => { handoverMap[h.id] = h; });

          let totalSignoffMinutes = 0;
          let signoffCount = 0;

          completedIds.forEach(hId => {
            const handover = handoverMap[hId];
            const itemsSignoffs = signoffs.filter(s => s.handover_id === hId);
            if (itemsSignoffs.length === 0) return;

            const fromTime = dayjs(handover.from_nurse_signed_at);
            const lastSignoffTime = dayjs(itemsSignoffs[0].signed_at);

            if (fromTime.isValid() && lastSignoffTime.isValid()) {
              const diffMinutes = Math.abs(lastSignoffTime.diff(fromTime, 'minute'));
              totalSignoffMinutes += diffMinutes;
              signoffCount++;
            }
          });

          const avg_signoff_minutes = signoffCount > 0 ? Math.round(totalSignoffMinutes / signoffCount) : 0;

          db.all(
            `SELECT hi.item_type, COUNT(*) as count
             FROM handover_items hi
             JOIN shift_handovers sh ON hi.handover_id = sh.id
             WHERE sh.department_id = ? AND sh.handover_date LIKE ?
             GROUP BY hi.item_type`,
            [department_id, monthPrefix],
            (err3, typeStats) => {
              if (err3) return res.status(500).json({ error: err3.message });

              db.all(
                `SELECT hi.urgency, COUNT(*) as count
                 FROM handover_items hi
                 JOIN shift_handovers sh ON hi.handover_id = sh.id
                 WHERE sh.department_id = ? AND sh.handover_date LIKE ?
                 GROUP BY hi.urgency`,
                [department_id, monthPrefix],
                (err4, urgencyStats) => {
                  if (err4) return res.status(500).json({ error: err4.message });

                  finishStats({
                    total, completed, disputed,
                    pending_sign: handovers.filter(h => h.status === 'pending_sign').length,
                    pending_confirm: handovers.filter(h => h.status === 'pending_confirm').length,
                    completion_rate,
                    avg_signoff_minutes,
                    item_type_distribution: typeStats,
                    urgency_distribution: urgencyStats
                  });
                }
              );
            }
          );
        }
      );
    }
  );

  function finishStats(data) {
    res.json(data);
  }
});

module.exports = router;
