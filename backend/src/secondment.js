const express = require('express');
const router = express.Router();
const db = require('./db');
const dayjs = require('dayjs');

const SHIFT_HOURS = { morning: 8, afternoon: 8, night: 8 };
const SHIFTS = ['morning', 'afternoon', 'night'];

function queryAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function getAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function runAsync(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getDaysBetween(start, end) {
  const days = [];
  let current = dayjs(start);
  const endDate = dayjs(end);
  while (current.isBefore(endDate) || current.isSame(endDate, 'day')) {
    days.push(current.format('YYYY-MM-DD'));
    current = current.add(1, 'day');
  }
  return days;
}

async function checkScheduleConflicts(nurseId, startDate, endDate) {
  const conflicts = [];
  const days = getDaysBetween(startDate, endDate);
  if (days.length === 0) return conflicts;

  const placeholders = days.map(() => '?').join(',');
  const schedules = await queryAsync(
    `SELECT * FROM schedules WHERE nurse_id = ? AND date IN (${placeholders})`,
    [nurseId, ...days]
  );

  schedules.forEach(s => {
    conflicts.push({
      date: s.date,
      shift: s.shift,
      department_id: s.department_id
    });
  });

  return conflicts;
}

async function checkOverlappingSecondment(nurseId, startDate, endDate, excludeId) {
  let sql = `SELECT * FROM secondment_requests WHERE nurse_id = ? AND status = 'approved' AND ((start_date <= ? AND end_date >= ?) OR (start_date <= ? AND end_date >= ?) OR (start_date >= ? AND end_date <= ?))`;
  const params = [nurseId, endDate, startDate, startDate, startDate, startDate, endDate];
  if (excludeId) {
    sql += ' AND id != ?';
    params.push(excludeId);
  }
  const overlapping = await queryAsync(sql, params);
  return overlapping;
}

router.post('/secondment-requests', async (req, res) => {
  try {
    const { from_department_id, to_department_id, nurse_id, start_date, end_date, shifts, reason } = req.body;

    if (!from_department_id || !to_department_id || !nurse_id || !start_date || !end_date) {
      return res.status(400).json({ error: '请填写完整的借调信息' });
    }

    if (from_department_id === to_department_id) {
      return res.status(400).json({ error: '借入和借出科室不能相同' });
    }

    if (dayjs(start_date).isAfter(dayjs(end_date))) {
      return res.status(400).json({ error: '开始日期不能晚于结束日期' });
    }

    const nurse = await getAsync('SELECT * FROM nurses WHERE id = ?', [nurse_id]);
    if (!nurse) {
      return res.status(400).json({ error: '护士不存在' });
    }

    if (nurse.department_id !== from_department_id) {
      return res.status(400).json({ error: '该护士不属于借出科室' });
    }

    const overlappingSecondment = await checkOverlappingSecondment(nurse_id, start_date, end_date, null);
    if (overlappingSecondment.length > 0) {
      return res.status(400).json({ error: `该护士在${overlappingSecondment[0].start_date}至${overlappingSecondment[0].end_date}期间已有生效的借调` });
    }

    const conflicts = await checkScheduleConflicts(nurse_id, start_date, end_date);
    const originalDeptConflicts = conflicts.filter(c => c.department_id === from_department_id);

    if (originalDeptConflicts.length > 0) {
      return res.status(400).json({
        error: `借调期间原科室存在排班冲突（${originalDeptConflicts.length}个班次），请先调整原科室排班后再发起借调`,
        conflicts: originalDeptConflicts
      });
    }

    const shiftsStr = shifts || 'all';

    const result = await runAsync(
      `INSERT INTO secondment_requests (from_department_id, to_department_id, nurse_id, start_date, end_date, shifts, status, reason)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [from_department_id, to_department_id, nurse_id, start_date, end_date, shiftsStr, reason || null]
    );

    res.json({ id: result.lastID, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/secondment-requests', async (req, res) => {
  try {
    const { status, start_date, end_date, department_id, nurse_id } = req.query;

    let query = `
      SELECT sr.*,
             fd.name as from_department_name,
             td.name as to_department_name,
             n.name as nurse_name,
             n.level as nurse_level
      FROM secondment_requests sr
      JOIN departments fd ON sr.from_department_id = fd.id
      JOIN departments td ON sr.to_department_id = td.id
      JOIN nurses n ON sr.nurse_id = n.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      query += ' AND sr.status = ?';
      params.push(status);
    }

    if (department_id) {
      query += ' AND (sr.from_department_id = ? OR sr.to_department_id = ?)';
      params.push(department_id, department_id);
    }

    if (nurse_id) {
      query += ' AND sr.nurse_id = ?';
      params.push(nurse_id);
    }

    if (start_date) {
      query += ' AND sr.end_date >= ?';
      params.push(start_date);
    }

    if (end_date) {
      query += ' AND sr.start_date <= ?';
      params.push(end_date);
    }

    query += ' ORDER BY sr.created_at DESC';

    const rows = await queryAsync(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/secondment-requests/:id', async (req, res) => {
  try {
    const row = await getAsync(
      `SELECT sr.*,
              fd.name as from_department_name,
              td.name as to_department_name,
              n.name as nurse_name,
              n.level as nurse_level
       FROM secondment_requests sr
       JOIN departments fd ON sr.from_department_id = fd.id
       JOIN departments td ON sr.to_department_id = td.id
       JOIN nurses n ON sr.nurse_id = n.id
       WHERE sr.id = ?`,
      [req.params.id]
    );

    if (!row) {
      return res.status(404).json({ error: '借调申请不存在' });
    }

    res.json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/secondment-requests/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { approver_remark } = req.body;

    const request = await getAsync('SELECT * FROM secondment_requests WHERE id = ?', [id]);
    if (!request) {
      return res.status(404).json({ error: '借调申请不存在' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: '该申请已处理' });
    }

    const conflicts = await checkScheduleConflicts(request.nurse_id, request.start_date, request.end_date);
    const originalDeptConflicts = conflicts.filter(c => c.department_id === request.from_department_id);

    if (originalDeptConflicts.length > 0) {
      await runAsync('UPDATE secondment_requests SET status = ? WHERE id = ?', ['rejected', id]);
      return res.status(400).json({
        error: `审批时检测到原科室存在排班冲突（${originalDeptConflicts.length}个班次），借调申请已自动拒绝，请先调整原科室排班`,
        conflicts: originalDeptConflicts
      });
    }

    const overlappingSecondment = await checkOverlappingSecondment(request.nurse_id, request.start_date, request.end_date, id);
    if (overlappingSecondment.length > 0) {
      await runAsync('UPDATE secondment_requests SET status = ? WHERE id = ?', ['rejected', id]);
      return res.status(400).json({ error: '审批时检测到该护士在同一时段已有生效的其他借调，申请已自动拒绝' });
    }

    const days = getDaysBetween(request.start_date, request.end_date);
    const shiftsToApply = request.shifts === 'all' ? SHIFTS : request.shifts.split(',');

    await runAsync('BEGIN TRANSACTION');
    try {
      if (originalDeptConflicts.length === 0) {
        const datePlaceholders = days.map(() => '?').join(',');
        if (days.length > 0) {
          await runAsync(
            `DELETE FROM schedules WHERE nurse_id = ? AND department_id = ? AND date IN (${datePlaceholders})`,
            [request.nurse_id, request.from_department_id, ...days]
          );
        }
      }

      await runAsync(
        'UPDATE secondment_requests SET status = ?, approver_remark = ? WHERE id = ?',
        ['approved', approver_remark || null, id]
      );

      await runAsync('COMMIT');
      res.json({ success: true });
    } catch (err) {
      await runAsync('ROLLBACK');
      throw err;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/secondment-requests/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { approver_remark } = req.body;

    const request = await getAsync('SELECT * FROM secondment_requests WHERE id = ?', [id]);
    if (!request) {
      return res.status(404).json({ error: '借调申请不存在' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ error: '该申请已处理' });
    }

    await runAsync(
      'UPDATE secondment_requests SET status = ?, approver_remark = ? WHERE id = ?',
      ['rejected', approver_remark || null, id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/secondment-requests/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const request = await getAsync('SELECT * FROM secondment_requests WHERE id = ?', [id]);
    if (!request) {
      return res.status(404).json({ error: '借调申请不存在' });
    }
    if (request.status !== 'pending' && request.status !== 'approved') {
      return res.status(400).json({ error: '当前状态无法取消' });
    }

    await runAsync('UPDATE secondment_requests SET status = ? WHERE id = ?', ['cancelled', id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments/:id/secondment-nurses', async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;
    const referenceDate = date || dayjs().format('YYYY-MM-DD');

    const secondments = await queryAsync(
      `SELECT sr.*, n.name as nurse_name, n.level as nurse_level,
              fd.name as from_department_name
       FROM secondment_requests sr
       JOIN nurses n ON sr.nurse_id = n.id
       JOIN departments fd ON sr.from_department_id = fd.id
       WHERE sr.to_department_id = ? AND sr.status = 'approved'
       AND sr.start_date <= ? AND sr.end_date >= ?
       ORDER BY sr.start_date`,
      [id, referenceDate, referenceDate]
    );

    res.json(secondments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments/:id/lent-out-nurses', async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;
    const referenceDate = date || dayjs().format('YYYY-MM-DD');

    const secondments = await queryAsync(
      `SELECT sr.*, n.name as nurse_name, n.level as nurse_level,
              td.name as to_department_name
       FROM secondment_requests sr
       JOIN nurses n ON sr.nurse_id = n.id
       JOIN departments td ON sr.to_department_id = td.id
       WHERE sr.from_department_id = ? AND sr.status = 'approved'
       AND sr.start_date <= ? AND sr.end_date >= ?
       ORDER BY sr.start_date`,
      [id, referenceDate, referenceDate]
    );

    res.json(secondments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments/:id/secondment-monthly-report', async (req, res) => {
  try {
    const { id } = req.params;
    const { month } = req.query;

    if (!month) {
      return res.status(400).json({ error: '请提供月份参数' });
    }

    const [year, monthNum] = month.split('-').map(Number);
    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = dayjs(startDate).endOf('month').format('YYYY-MM-DD');

    const borrowedNurses = await queryAsync(
      `SELECT sr.*, n.name as nurse_name, n.level as nurse_level,
              fd.name as from_department_name
       FROM secondment_requests sr
       JOIN nurses n ON sr.nurse_id = n.id
       JOIN departments fd ON sr.from_department_id = fd.id
       WHERE sr.to_department_id = ? AND sr.status = 'approved'
       AND sr.start_date <= ? AND sr.end_date >= ?
       ORDER BY n.name`,
      [id, endDate, startDate]
    );

    const lentOutNurses = await queryAsync(
      `SELECT sr.*, n.name as nurse_name, n.level as nurse_level,
              td.name as to_department_name
       FROM secondment_requests sr
       JOIN nurses n ON sr.nurse_id = n.id
       JOIN departments td ON sr.to_department_id = td.id
       WHERE sr.from_department_id = ? AND sr.status = 'approved'
       AND sr.start_date <= ? AND sr.end_date >= ?
       ORDER BY n.name`,
      [id, endDate, startDate]
    );

    const borrowedHours = [];
    for (const s of borrowedNurses) {
      const effectiveStart = dayjs(s.start_date).isBefore(dayjs(startDate)) ? startDate : s.start_date;
      const effectiveEnd = dayjs(s.end_date).isAfter(dayjs(endDate)) ? endDate : s.end_date;
      const effectiveDays = getDaysBetween(effectiveStart, effectiveEnd);

      let hours = 0;
      if (effectiveDays.length > 0) {
        const placeholders = effectiveDays.map(() => '?').join(',');
        const schedules = await queryAsync(
          `SELECT date, shift FROM schedules WHERE nurse_id = ? AND department_id = ? AND date IN (${placeholders})`,
          [s.nurse_id, id, ...effectiveDays]
        );
        schedules.forEach(sc => {
          hours += SHIFT_HOURS[sc.shift] || 8;
        });

        const overtimes = await queryAsync(
          `SELECT hours FROM overtime_requests WHERE nurse_id = ? AND department_id = ? AND date IN (${placeholders}) AND status = 'approved'`,
          [s.nurse_id, id, ...effectiveDays]
        );
        overtimes.forEach(o => {
          hours += o.hours;
        });
      }

      hours = Math.round(hours * 100) / 100;

      borrowedHours.push({
        secondment_id: s.id,
        nurse_id: s.nurse_id,
        nurse_name: s.nurse_name,
        nurse_level: s.nurse_level,
        from_department_name: s.from_department_name,
        start_date: s.start_date,
        end_date: s.end_date,
        effective_start: effectiveStart,
        effective_end: effectiveEnd,
        borrowed_hours: hours,
        nurse_type: 'borrowed'
      });
    }

    const lentOutHours = [];
    for (const s of lentOutNurses) {
      const effectiveStart = dayjs(s.start_date).isBefore(dayjs(startDate)) ? startDate : s.start_date;
      const effectiveEnd = dayjs(s.end_date).isAfter(dayjs(endDate)) ? endDate : s.end_date;

      lentOutHours.push({
        secondment_id: s.id,
        nurse_id: s.nurse_id,
        nurse_name: s.nurse_name,
        nurse_level: s.nurse_level,
        to_department_name: s.to_department_name,
        start_date: s.start_date,
        end_date: s.end_date,
        effective_start: effectiveStart,
        effective_end: effectiveEnd,
        nurse_type: 'lent_out'
      });
    }

    res.json({ borrowed: borrowedHours, lent_out: lentOutHours });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
