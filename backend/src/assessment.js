const express = require('express');
const router = express.Router();
const db = require('./db');
const dayjs = require('dayjs');

const EVENT_TYPE_TO_DIMENSION = {
  medication_error: 'operation',
  fall: 'operation',
  pressure_ulcer: 'operation',
  infection: 'operation',
  other: 'teamwork'
};

function getWeightConfig(departmentId) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM assessment_weight_configs WHERE department_id = ?', [departmentId], (err, row) => {
      if (err) return reject(err);
      if (row) {
        resolve(row);
      } else {
        resolve({
          attendance_weight: 25,
          operation_weight: 25,
          satisfaction_weight: 25,
          teamwork_weight: 25
        });
      }
    });
  });
}

function checkFullAttendance(nurseId, departmentId, month) {
  return new Promise((resolve, reject) => {
    const [year, monthNum] = month.split('-').map(Number);
    const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const monthEnd = dayjs(monthStart).endOf('month').format('YYYY-MM-DD');

    db.all(
      "SELECT COUNT(*) as leave_count FROM leave_requests WHERE nurse_id = ? AND department_id = ? AND date >= ? AND date <= ? AND status = 'approved'",
      [nurseId, departmentId, monthStart, monthEnd],
      (err, leaveResult) => {
        if (err) return reject(err);
        const leaveCount = leaveResult[0].leave_count;

        db.all(
          "SELECT COUNT(*) as schedule_count FROM schedules WHERE nurse_id = ? AND department_id = ? AND month = ?",
          [nurseId, departmentId, month],
          (err2, scheduleResult) => {
            if (err2) return reject(err2);
            const scheduleCount = scheduleResult[0].schedule_count;
            resolve(leaveCount === 0 && scheduleCount > 0);
          }
        );
      }
    );
  });
}

function getAdverseEventsCount(nurseId, departmentId, month) {
  return new Promise((resolve, reject) => {
    const [year, monthNum] = month.split('-').map(Number);
    const monthStart = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const monthEnd = dayjs(monthStart).endOf('month').format('YYYY-MM-DD');

    db.all(
      `SELECT ae.event_type, ae.id
       FROM adverse_events ae
       WHERE (ae.responsible_nurse_id = ? OR ae.reporter_id = ?)
         AND ae.department_id = ?
         AND ae.event_time >= ? AND ae.event_time <= ?`,
      [nurseId, nurseId, departmentId, `${monthStart} 00:00:00`, `${monthEnd} 23:59:59`],
      (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      }
    );
  });
}

function computeAdjustments(scores, adverseEvents, isFullAttendance) {
  const adjustments = {
    attendance: 0,
    operation: 0,
    satisfaction: 0,
    teamwork: 0
  };

  adverseEvents.forEach(event => {
    const dimension = EVENT_TYPE_TO_DIMENSION[event.event_type] || 'operation';
    adjustments[dimension] -= 2;
  });

  if (isFullAttendance) {
    adjustments.attendance += 1;
  }

  const finalScores = {
    attendance: Math.max(0, Math.min(10, scores.attendance + adjustments.attendance)),
    operation: Math.max(0, Math.min(10, scores.operation + adjustments.operation)),
    satisfaction: Math.max(0, Math.min(10, scores.satisfaction + adjustments.satisfaction)),
    teamwork: Math.max(0, Math.min(10, scores.teamwork + adjustments.teamwork))
  };

  return { adjustments, finalScores };
}

function computeWeightedTotal(finalScores, weights) {
  const total = (
    finalScores.attendance * weights.attendance_weight / 100 +
    finalScores.operation * weights.operation_weight / 100 +
    finalScores.satisfaction * weights.satisfaction_weight / 100 +
    finalScores.teamwork * weights.teamwork_weight / 100
  ) * 10;
  return Math.round(total * 100) / 100;
}

router.get('/assessment-weight-config/:departmentId', async (req, res) => {
  const { departmentId } = req.params;
  try {
    const config = await getWeightConfig(departmentId);
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/assessment-weight-config', (req, res) => {
  const { department_id, attendance_weight, operation_weight, satisfaction_weight, teamwork_weight } = req.body;

  if (!department_id) {
    return res.status(400).json({ error: '请提供科室ID' });
  }

  const total = (Number(attendance_weight) || 0) + (Number(operation_weight) || 0) +
                (Number(satisfaction_weight) || 0) + (Number(teamwork_weight) || 0);

  if (Math.abs(total - 100) > 0.01) {
    return res.status(400).json({ error: '四个维度权重之和必须等于100%' });
  }

  db.run(
    `INSERT INTO assessment_weight_configs (department_id, attendance_weight, operation_weight, satisfaction_weight, teamwork_weight, updated_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(department_id) DO UPDATE SET
       attendance_weight = excluded.attendance_weight,
       operation_weight = excluded.operation_weight,
       satisfaction_weight = excluded.satisfaction_weight,
       teamwork_weight = excluded.teamwork_weight,
       updated_at = CURRENT_TIMESTAMP`,
    [department_id, attendance_weight, operation_weight, satisfaction_weight, teamwork_weight],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    }
  );
});

router.post('/quality-assessments', async (req, res) => {
  const {
    department_id, nurse_id, month,
    attendance_score, operation_score, satisfaction_score, teamwork_score,
    remark, evaluator_id
  } = req.body;

  if (!department_id || !nurse_id || !month) {
    return res.status(400).json({ error: '请提供科室ID、护士ID和月份' });
  }

  const scores = [attendance_score, operation_score, satisfaction_score, teamwork_score];
  for (const s of scores) {
    if (s === undefined || s === null || isNaN(s)) {
      return res.status(400).json({ error: '请为所有维度打分(1-10分)' });
    }
    const num = Number(s);
    if (num < 1 || num > 10) {
      return res.status(400).json({ error: '所有维度分数必须在1-10之间' });
    }
  }

  try {
    const [weights, isFullAttendance, adverseEvents] = await Promise.all([
      getWeightConfig(department_id),
      checkFullAttendance(nurse_id, department_id, month),
      getAdverseEventsCount(nurse_id, department_id, month)
    ]);

    const rawScores = {
      attendance: Number(attendance_score),
      operation: Number(operation_score),
      satisfaction: Number(satisfaction_score),
      teamwork: Number(teamwork_score)
    };

    const { adjustments, finalScores } = computeAdjustments(rawScores, adverseEvents, isFullAttendance);
    const weightedTotal = computeWeightedTotal(finalScores, weights);

    db.run(
      `INSERT INTO quality_assessments (
        department_id, nurse_id, month,
        attendance_score, operation_score, satisfaction_score, teamwork_score,
        attendance_adjustment, operation_adjustment, satisfaction_adjustment, teamwork_adjustment,
        final_attendance, final_operation, final_satisfaction, final_teamwork,
        weighted_total, adverse_event_count, is_full_attendance, remark, evaluator_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(nurse_id, month) DO UPDATE SET
        attendance_score = excluded.attendance_score,
        operation_score = excluded.operation_score,
        satisfaction_score = excluded.satisfaction_score,
        teamwork_score = excluded.teamwork_score,
        attendance_adjustment = excluded.attendance_adjustment,
        operation_adjustment = excluded.operation_adjustment,
        satisfaction_adjustment = excluded.satisfaction_adjustment,
        teamwork_adjustment = excluded.teamwork_adjustment,
        final_attendance = excluded.final_attendance,
        final_operation = excluded.final_operation,
        final_satisfaction = excluded.final_satisfaction,
        final_teamwork = excluded.final_teamwork,
        weighted_total = excluded.weighted_total,
        adverse_event_count = excluded.adverse_event_count,
        is_full_attendance = excluded.is_full_attendance,
        remark = excluded.remark,
        evaluator_id = excluded.evaluator_id,
        updated_at = CURRENT_TIMESTAMP`,
      [
        department_id, nurse_id, month,
        rawScores.attendance, rawScores.operation, rawScores.satisfaction, rawScores.teamwork,
        adjustments.attendance, adjustments.operation, adjustments.satisfaction, adjustments.teamwork,
        finalScores.attendance, finalScores.operation, finalScores.satisfaction, finalScores.teamwork,
        weightedTotal, adverseEvents.length, isFullAttendance ? 1 : 0,
        remark || null, evaluator_id || null
      ],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          success: true,
          id: this.lastID,
          data: {
            weighted_total: weightedTotal,
            final_scores: finalScores,
            adjustments,
            adverse_event_count: adverseEvents.length,
            is_full_attendance: isFullAttendance
          }
        });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/quality-assessments/history', (req, res) => {
  const { department_id, nurse_id, month } = req.query;

  if (!department_id) {
    return res.status(400).json({ error: '请提供科室ID' });
  }

  let query = `
    SELECT qa.*, n.name as nurse_name, n.level as nurse_level
    FROM quality_assessments qa
    JOIN nurses n ON qa.nurse_id = n.id
    WHERE qa.department_id = ?
  `;
  const params = [department_id];

  if (nurse_id) {
    query += ' AND qa.nurse_id = ?';
    params.push(nurse_id);
  }
  if (month) {
    query += ' AND qa.month = ?';
    params.push(month);
  }

  query += ' ORDER BY qa.month DESC, n.name';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.get('/quality-assessments/:id', (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT qa.*, n.name as nurse_name, n.level as nurse_level,
            ev.name as evaluator_name
     FROM quality_assessments qa
     JOIN nurses n ON qa.nurse_id = n.id
     LEFT JOIN nurses ev ON qa.evaluator_id = ev.id
     WHERE qa.id = ?`,
    [id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: '考核记录不存在' });
      res.json(row);
    }
  );
});

router.get('/quality-assessments/ranking/:departmentId', (req, res) => {
  const { departmentId } = req.params;
  const { month } = req.query;

  if (!month) {
    return res.status(400).json({ error: '请提供月份参数' });
  }

  db.all(
    `SELECT qa.*, n.name as nurse_name, n.level as nurse_level
     FROM quality_assessments qa
     JOIN nurses n ON qa.nurse_id = n.id
     WHERE qa.department_id = ? AND qa.month = ?
     ORDER BY qa.weighted_total DESC, n.name`,
    [departmentId, month],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      const ranked = rows.map((row, idx) => ({
        ...row,
        rank: idx + 1
      }));
      res.json(ranked);
    }
  );
});

router.get('/quality-assessments/month-preview/:departmentId', (req, res) => {
  const { departmentId } = req.params;
  const { month } = req.query;

  if (!month) {
    return res.status(400).json({ error: '请提供月份参数' });
  }

  db.all(
    `SELECT n.id as nurse_id, n.name as nurse_name, n.level as nurse_level,
            qa.weighted_total, qa.id as assessment_id
     FROM nurses n
     LEFT JOIN quality_assessments qa ON qa.nurse_id = n.id AND qa.month = ? AND qa.department_id = ?
     WHERE n.department_id = ?
     ORDER BY n.name`,
    [month, departmentId, departmentId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

router.get('/quality-assessments/trend/:nurseId', (req, res) => {
  const { nurseId } = req.params;
  const { start_month, end_month } = req.query;

  let query = `
    SELECT month, weighted_total,
           final_attendance, final_operation, final_satisfaction, final_teamwork
    FROM quality_assessments
    WHERE nurse_id = ?
  `;
  const params = [nurseId];

  if (start_month) {
    query += ' AND month >= ?';
    params.push(start_month);
  }
  if (end_month) {
    query += ' AND month <= ?';
    params.push(end_month);
  }

  query += ' ORDER BY month ASC LIMIT 12';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.delete('/quality-assessments/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM quality_assessments WHERE id = ?', [id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: '考核记录不存在' });
    res.json({ success: true });
  });
});

router.get('/quality-assessments/auto-info/:nurseId', async (req, res) => {
  const { nurseId } = req.params;
  const { department_id, month } = req.query;

  if (!department_id || !month) {
    return res.status(400).json({ error: '请提供科室ID和月份' });
  }

  try {
    const [isFullAttendance, adverseEvents] = await Promise.all([
      checkFullAttendance(nurseId, department_id, month),
      getAdverseEventsCount(nurseId, department_id, month)
    ]);

    res.json({
      is_full_attendance: isFullAttendance,
      adverse_events: adverseEvents.map(e => ({
        id: e.id,
        event_type: e.event_type,
        affected_dimension: EVENT_TYPE_TO_DIMENSION[e.event_type] || 'operation'
      })),
      adverse_event_count: adverseEvents.length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
