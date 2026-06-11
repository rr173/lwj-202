const express = require('express');
const router = express.Router();
const db = require('./db');
const dayjs = require('dayjs');

function getWeekRange(dateStr) {
  const date = dayjs(dateStr);
  const startOfWeek = date.startOf('week').format('YYYY-MM-DD');
  const endOfWeek = date.endOf('week').format('YYYY-MM-DD');
  return { startOfWeek, endOfWeek };
}

function getAllWeeksInMonth(monthStr) {
  const [year, monthNum] = monthStr.split('-').map(Number);
  const startOfMonth = dayjs(`${year}-${String(monthNum).padStart(2, '0')}-01`);
  const endOfMonth = startOfMonth.endOf('month');
  
  const weeks = [];
  let current = startOfMonth.startOf('week');
  
  while (current.isBefore(endOfMonth) || current.isSame(endOfMonth, 'week')) {
    const weekStart = current.format('YYYY-MM-DD');
    const weekEnd = current.endOf('week').format('YYYY-MM-DD');
    const overlapStart = current.isBefore(startOfMonth) ? startOfMonth.format('YYYY-MM-DD') : weekStart;
    const overlapEnd = current.endOf('week').isAfter(endOfMonth) ? endOfMonth.format('YYYY-MM-DD') : weekEnd;
    
    weeks.push({
      week_start: weekStart,
      week_end: weekEnd,
      overlap_start: overlapStart,
      overlap_end: overlapEnd,
      label: `第${weeks.length + 1}周(${overlapStart}~${overlapEnd})`
    });
    current = current.add(1, 'week');
  }
  
  return weeks;
}

function getThreshold(db, departmentId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT threshold FROM workload_balance_config WHERE department_id = ?',
      [departmentId],
      (err, row) => {
        if (err) reject(err);
        resolve(row ? row.threshold : 8);
      }
    );
  });
}

function computeWorkloadIndex(db, departmentId, weekStart, weekEnd) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM nurses WHERE department_id = ? ORDER BY id',
      [departmentId],
      (err, nurses) => {
        if (err) return reject(err);
        if (nurses.length === 0) return resolve([]);

        const nurseIds = nurses.map(n => n.id);
        const placeholders = nurseIds.map(() => '?').join(',');

        db.all(
          `SELECT nurse_id, shift, COUNT(*) as count 
           FROM schedules 
           WHERE department_id = ? AND date >= ? AND date <= ? AND nurse_id IN (${placeholders})
           GROUP BY nurse_id, shift`,
          [departmentId, weekStart, weekEnd, ...nurseIds],
          (err, shiftCounts) => {
            if (err) return reject(err);

            db.all(
              `SELECT nurse_id, COUNT(*) as count 
               FROM overtime_requests 
               WHERE department_id = ? AND date >= ? AND date <= ? AND status = 'approved' AND nurse_id IN (${placeholders})
               GROUP BY nurse_id`,
              [departmentId, weekStart, weekEnd, ...nurseIds],
              (err, overtimeCounts) => {
                if (err) return reject(err);

                db.all(
                  `SELECT substitute_nurse_id, COUNT(*) as count 
                   FROM leave_requests 
                   WHERE department_id = ? AND date >= ? AND date <= ? AND status = 'approved' 
                     AND substitute_status = 'confirmed' AND substitute_nurse_id IN (${placeholders})
                   GROUP BY substitute_nurse_id`,
                  [departmentId, weekStart, weekEnd, ...nurseIds],
                  (err, substituteCounts) => {
                    if (err) return reject(err);

                    const shiftCountMap = {};
                    shiftCounts.forEach(s => {
                      if (!shiftCountMap[s.nurse_id]) shiftCountMap[s.nurse_id] = {};
                      shiftCountMap[s.nurse_id][s.shift] = s.count;
                    });

                    const overtimeMap = {};
                    overtimeCounts.forEach(o => {
                      overtimeMap[o.nurse_id] = o.count;
                    });

                    const substituteMap = {};
                    substituteCounts.forEach(s => {
                      substituteMap[s.substitute_nurse_id] = s.count;
                    });

                    const result = nurses.map(nurse => {
                      const counts = shiftCountMap[nurse.id] || {};
                      const nightCount = counts.night || 0;
                      const afternoonCount = counts.afternoon || 0;
                      const morningCount = counts.morning || 0;
                      const overtimeCount = overtimeMap[nurse.id] || 0;
                      const substituteCount = substituteMap[nurse.id] || 0;

                      const loadIndex =
                        nightCount * 3 +
                        afternoonCount * 2 +
                        morningCount * 1 +
                        overtimeCount * 2 +
                        substituteCount * 1.5;

                      return {
                        nurse_id: nurse.id,
                        nurse_name: nurse.name,
                        nurse_level: nurse.level,
                        night_count: nightCount,
                        afternoon_count: afternoonCount,
                        morning_count: morningCount,
                        overtime_count: overtimeCount,
                        substitute_count: substituteCount,
                        load_index: Math.round(loadIndex * 100) / 100
                      };
                    });

                    result.sort((a, b) => b.load_index - a.load_index);
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
}

function generateWarningIfNeeded(db, departmentId, weekStart, weekEnd, workloadData, threshold) {
  return new Promise((resolve, reject) => {
    if (workloadData.length < 2) {
      return resolve(null);
    }

    const highLoad = workloadData[0];
    const lowLoad = workloadData[workloadData.length - 1];
    const indexDiff = Math.round((highLoad.load_index - lowLoad.load_index) * 100) / 100;

    if (indexDiff <= threshold) {
      return resolve(null);
    }

    db.get(
      `SELECT id FROM workload_balance_warnings 
       WHERE department_id = ? AND week_start = ? AND status = 'pending'`,
      [departmentId, weekStart],
      (err, existing) => {
        if (err) return reject(err);
        if (existing) return resolve(null);

        db.run(
          `INSERT INTO workload_balance_warnings (
            department_id, week_start, week_end,
            high_load_nurse_id, high_load_nurse_name, high_load_index,
            low_load_nurse_id, low_load_nurse_name, low_load_index,
            index_diff, threshold
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            departmentId, weekStart, weekEnd,
            highLoad.nurse_id, highLoad.nurse_name, highLoad.load_index,
            lowLoad.nurse_id, lowLoad.nurse_name, lowLoad.load_index,
            indexDiff, threshold
          ],
          function (err) {
            if (err) return reject(err);
            resolve({
              id: this.lastID,
              department_id: departmentId,
              week_start: weekStart,
              week_end: weekEnd,
              high_load_nurse_id: highLoad.nurse_id,
              high_load_nurse_name: highLoad.nurse_name,
              high_load_index: highLoad.load_index,
              low_load_nurse_id: lowLoad.nurse_id,
              low_load_nurse_name: lowLoad.nurse_name,
              low_load_index: lowLoad.load_index,
              index_diff: indexDiff,
              threshold,
              status: 'pending'
            });
          }
        );
      }
    );
  });
}

router.get('/departments/:id/workload-index', async (req, res) => {
  const { id } = req.params;
  const { date } = req.query;

  const referenceDate = date || dayjs().format('YYYY-MM-DD');
  const { startOfWeek, endOfWeek } = getWeekRange(referenceDate);

  try {
    const threshold = await getThreshold(db, id);
    const workloadData = await computeWorkloadIndex(db, id, startOfWeek, endOfWeek);

    if (workloadData.length >= 2) {
      await generateWarningIfNeeded(db, id, startOfWeek, endOfWeek, workloadData, threshold);
    }

    const maxIndex = workloadData.length > 0 ? workloadData[0].load_index : 0;
    const minIndex = workloadData.length > 0 ? workloadData[workloadData.length - 1].load_index : 0;
    const avgIndex = workloadData.length > 0
      ? Math.round((workloadData.reduce((sum, w) => sum + w.load_index, 0) / workloadData.length) * 100) / 100
      : 0;
    const indexDiff = Math.round((maxIndex - minIndex) * 100) / 100;
    const variance = workloadData.length > 0
      ? workloadData.reduce((sum, w) => sum + Math.pow(w.load_index - avgIndex, 2), 0) / workloadData.length
      : 0;
    const stdDev = Math.round(Math.sqrt(variance) * 100) / 100;

    res.json({
      department_id: parseInt(id),
      week_start: startOfWeek,
      week_end: endOfWeek,
      threshold,
      rankings: workloadData,
      statistics: {
        max_index: maxIndex,
        min_index: minIndex,
        avg_index: avgIndex,
        index_diff: indexDiff,
        std_dev: stdDev,
        is_over_threshold: indexDiff > threshold
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments/:id/workload-warnings', (req, res) => {
  const { id } = req.params;
  const { status } = req.query;

  let query = `
    SELECT w.*, d.name as department_name
    FROM workload_balance_warnings w
    JOIN departments d ON w.department_id = d.id
    WHERE w.department_id = ?
  `;
  const params = [id];

  if (status) {
    query += ' AND w.status = ?';
    params.push(status);
  }

  query += ' ORDER BY w.created_at DESC';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.get('/workload-warnings', (req, res) => {
  const { status, department_id } = req.query;

  let query = `
    SELECT w.*, d.name as department_name
    FROM workload_balance_warnings w
    JOIN departments d ON w.department_id = d.id
    WHERE 1=1
  `;
  const params = [];

  if (department_id) {
    query += ' AND w.department_id = ?';
    params.push(department_id);
  }
  if (status) {
    query += ' AND w.status = ?';
    params.push(status);
  } else {
    query += " AND w.status = 'pending'";
  }

  query += ' ORDER BY w.created_at DESC';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.put('/workload-warnings/:id/resolve', (req, res) => {
  const { id } = req.params;
  const { handled_by, handled_by_name, handled_remark } = req.body;

  if (!handled_remark || !handled_remark.trim()) {
    return res.status(400).json({ error: '请填写处理备注' });
  }

  db.get('SELECT * FROM workload_balance_warnings WHERE id = ?', [id], (err, warning) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!warning) return res.status(404).json({ error: '预警不存在' });
    if (warning.status === 'resolved') {
      return res.status(400).json({ error: '该预警已处理' });
    }

    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    db.run(
      `UPDATE workload_balance_warnings 
       SET status = 'resolved', handled_by = ?, handled_by_name = ?, handled_remark = ?, handled_at = ?
       WHERE id = ?`,
      [handled_by || null, handled_by_name || null, handled_remark.trim(), now, id],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, handled_at: now });
      }
    );
  });
});

router.get('/departments/:id/workload-trend', async (req, res) => {
  const { id } = req.params;
  const { month } = req.query;

  if (!month) {
    return res.status(400).json({ error: '请提供月份参数' });
  }

  const weeks = getAllWeeksInMonth(month);
  const result = [];

  try {
    const threshold = await getThreshold(db, id);

    for (const week of weeks) {
      const weeklyData = await computeWorkloadIndex(db, id, week.overlap_start, week.overlap_end);

      if (weeklyData.length > 0) {
        const avgIndex = weeklyData.reduce((sum, w) => sum + w.load_index, 0) / weeklyData.length;
        const variance = weeklyData.reduce((sum, w) => sum + Math.pow(w.load_index - avgIndex, 2), 0) / weeklyData.length;
        const maxIndex = weeklyData[0].load_index;
        const minIndex = weeklyData[weeklyData.length - 1].load_index;

        result.push({
          week_start: week.week_start,
          week_end: week.week_end,
          label: week.label,
          avg_index: Math.round(avgIndex * 100) / 100,
          std_dev: Math.round(Math.sqrt(variance) * 100) / 100,
          max_index: maxIndex,
          min_index: minIndex,
          index_diff: Math.round((maxIndex - minIndex) * 100) / 100,
          nurse_count: weeklyData.length
        });
      } else {
        result.push({
          week_start: week.week_start,
          week_end: week.week_end,
          label: week.label,
          avg_index: 0,
          std_dev: 0,
          max_index: 0,
          min_index: 0,
          index_diff: 0,
          nurse_count: 0
        });
      }
    }

    res.json({
      department_id: parseInt(id),
      month,
      threshold,
      weekly_data: result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments/:id/workload-threshold', (req, res) => {
  const { id } = req.params;
  getThreshold(db, id)
    .then(threshold => res.json({ department_id: parseInt(id), threshold }))
    .catch(err => res.status(500).json({ error: err.message }));
});

router.put('/departments/:id/workload-threshold', (req, res) => {
  const { id } = req.params;
  const { threshold } = req.body;

  if (threshold === undefined || threshold === null || isNaN(threshold) || threshold < 0) {
    return res.status(400).json({ error: '请提供有效的阈值（大于等于0的数字）' });
  }

  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  db.run(
    `INSERT INTO workload_balance_config (department_id, threshold, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(department_id) DO UPDATE SET threshold = excluded.threshold, updated_at = excluded.updated_at`,
    [id, threshold, now],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, threshold });
    }
  );
});

module.exports = router;
