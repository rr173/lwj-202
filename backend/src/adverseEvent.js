const express = require('express');
const router = express.Router();
const db = require('./db');
const dayjs = require('dayjs');

function checkOverdue(event) {
  if (event.status === 'closed') return event;
  if (event.rectification_deadline && dayjs().isAfter(dayjs(event.rectification_deadline))) {
    event.is_overdue = 1;
  }
  return event;
}

function addTimeline(eventId, action, fromStatus, toStatus, operatorId, operatorName, remark) {
  return new Promise((resolve, reject) => {
    db.run(
      'INSERT INTO adverse_event_timeline (event_id, action, from_status, to_status, operator_id, operator_name, remark) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [eventId, action, fromStatus, toStatus, operatorId, operatorName, remark || null],
      function (err) {
        if (err) return reject(err);
        resolve(this.lastID);
      }
    );
  });
}

router.get('/adverse-events', (req, res) => {
  const { department_id, status, event_type } = req.query;
  let query = `
    SELECT ae.*, 
           r.name as reporter_name, r.level as reporter_level,
           rn.name as responsible_nurse_name,
           d.name as department_name
    FROM adverse_events ae
    JOIN nurses r ON ae.reporter_id = r.id
    LEFT JOIN nurses rn ON ae.responsible_nurse_id = rn.id
    JOIN departments d ON ae.department_id = d.id
    WHERE 1=1
  `;
  const params = [];

  if (department_id) {
    query += ' AND ae.department_id = ?';
    params.push(department_id);
  }
  if (status) {
    query += ' AND ae.status = ?';
    params.push(status);
  }
  if (event_type) {
    query += ' AND ae.event_type = ?';
    params.push(event_type);
  }

  query += ' ORDER BY ae.created_at DESC';

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const events = rows.map(e => checkOverdue(e));
    const overdueIds = events.filter(e => e.is_overdue === 1 && e.status !== 'closed').map(e => e.id);
    if (overdueIds.length > 0) {
      const placeholders = overdueIds.map(() => '?').join(',');
      db.run(`UPDATE adverse_events SET is_overdue = 1 WHERE id IN (${placeholders}) AND status != 'closed'`, overdueIds, (uErr) => {
        if (uErr) console.error('Failed to update overdue status:', uErr);
        res.json(events);
      });
    } else {
      res.json(events);
    }
  });
});

router.get('/adverse-events/:id', (req, res) => {
  const { id } = req.params;
  db.get(
    `SELECT ae.*, 
            r.name as reporter_name, r.level as reporter_level,
            rn.name as responsible_nurse_name,
            d.name as department_name
     FROM adverse_events ae
     JOIN nurses r ON ae.reporter_id = r.id
     LEFT JOIN nurses rn ON ae.responsible_nurse_id = rn.id
     JOIN departments d ON ae.department_id = d.id
     WHERE ae.id = ?`,
    [id],
    (err, event) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!event) return res.status(404).json({ error: '事件不存在' });
      event = checkOverdue(event);
      db.all(
        'SELECT * FROM adverse_event_timeline WHERE event_id = ? ORDER BY created_at',
        [id],
        (err2, timeline) => {
          if (err2) return res.status(500).json({ error: err2.message });
          event.timeline = timeline;
          res.json(event);
        }
      );
    }
  );
});

router.post('/adverse-events', (req, res) => {
  const { department_id, reporter_id, event_type, event_time, patient_bed, severity, description } = req.body;

  if (!department_id || !reporter_id || !event_type || !event_time || !severity) {
    return res.status(400).json({ error: '请填写完整的事件信息' });
  }
  if (![1, 2, 3, 4].includes(severity)) {
    return res.status(400).json({ error: '严重等级必须为1-4级' });
  }

  const eventDate = event_time.substring(0, 10);

  db.get(
    'SELECT * FROM schedules WHERE nurse_id = ? AND date = ?',
    [reporter_id, eventDate],
    (err, schedule) => {
      if (err) return res.status(500).json({ error: err.message });

      let scheduleId = null;
      let scheduleShift = null;
      if (schedule) {
        scheduleId = schedule.id;
        scheduleShift = schedule.shift;
      }

      db.get('SELECT * FROM nurses WHERE id = ?', [reporter_id], (nErr, nurse) => {
        if (nErr) return res.status(500).json({ error: nErr.message });

        db.run(
          `INSERT INTO adverse_events (department_id, reporter_id, event_type, event_time, patient_bed, severity, description, status, schedule_id, is_overdue)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0)`,
          [department_id, reporter_id, event_type, event_time, patient_bed || null, severity, description || null, scheduleId],
          function (err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            const eventId = this.lastID;

            const remark = scheduleShift
              ? `自动关联当班排班: ${eventDate} ${scheduleShift === 'morning' ? '早班' : scheduleShift === 'afternoon' ? '中班' : '夜班'}`
              : '未找到当班排班记录';

            addTimeline(eventId, '创建事件', null, 'pending', reporter_id, nurse ? nurse.name : '未知', remark)
              .then(() => {
                res.json({ id: eventId, success: true, schedule_shift: scheduleShift });
              })
              .catch(tErr => {
                res.status(500).json({ error: tErr.message });
              });
          }
        );
      });
    }
  );
});

router.put('/adverse-events/:id/approve', (req, res) => {
  const { id } = req.params;
  const { responsible_nurse_id, rectification_days, operator_id } = req.body;

  if (!responsible_nurse_id || !rectification_days) {
    return res.status(400).json({ error: '请指定责任人和整改期限' });
  }

  db.get('SELECT * FROM adverse_events WHERE id = ?', [id], (err, event) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!event) return res.status(404).json({ error: '事件不存在' });
    if (event.status !== 'pending') {
      return res.status(400).json({ error: '只有待审核事件可以审核' });
    }

    const deadline = dayjs().add(rectification_days, 'day').format('YYYY-MM-DD');

    db.get('SELECT * FROM nurses WHERE id = ?', [operator_id || responsible_nurse_id], (nErr, nurse) => {
      if (nErr) return res.status(500).json({ error: nErr.message });
      const operatorName = nurse ? nurse.name : '科室负责人';

      db.run(
        'UPDATE adverse_events SET status = ?, responsible_nurse_id = ?, rectification_days = ?, rectification_deadline = ? WHERE id = ?',
        ['processing', responsible_nurse_id, rectification_days, deadline, id],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });

          addTimeline(id, '审核通过，进入处理中', 'pending', 'processing', operator_id || responsible_nurse_id, operatorName, `责任人: ${operatorName}, 整改期限: ${deadline}(${rectification_days}天)`)
            .then(() => res.json({ success: true, rectification_deadline: deadline }))
            .catch(tErr => res.status(500).json({ error: tErr.message }));
        }
      );
    });
  });
});

router.put('/adverse-events/:id/submit-rectification', (req, res) => {
  const { id } = req.params;
  const { rectification_report, operator_id } = req.body;

  if (!rectification_report) {
    return res.status(400).json({ error: '请填写整改报告' });
  }

  db.get('SELECT * FROM adverse_events WHERE id = ?', [id], (err, event) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!event) return res.status(404).json({ error: '事件不存在' });
    if (event.status !== 'processing') {
      return res.status(400).json({ error: '只有处理中的事件可以提交整改报告' });
    }

    db.get('SELECT * FROM nurses WHERE id = ?', [operator_id || event.responsible_nurse_id], (nErr, nurse) => {
      if (nErr) return res.status(500).json({ error: nErr.message });
      const operatorName = nurse ? nurse.name : '责任人';

      db.run(
        'UPDATE adverse_events SET status = ?, rectification_report = ? WHERE id = ?',
        ['reviewing', rectification_report, id],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });

          addTimeline(id, '提交整改报告，待验收', 'processing', 'reviewing', operator_id || event.responsible_nurse_id, operatorName, null)
            .then(() => res.json({ success: true }))
            .catch(tErr => res.status(500).json({ error: tErr.message }));
        }
      );
    });
  });
});

router.put('/adverse-events/:id/accept', (req, res) => {
  const { id } = req.params;
  const { operator_id } = req.body;

  db.get('SELECT * FROM adverse_events WHERE id = ?', [id], (err, event) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!event) return res.status(404).json({ error: '事件不存在' });
    if (event.status !== 'reviewing') {
      return res.status(400).json({ error: '只有待验收事件可以验收' });
    }

    db.get('SELECT * FROM nurses WHERE id = ?', [operator_id || event.reporter_id], (nErr, nurse) => {
      if (nErr) return res.status(500).json({ error: nErr.message });
      const operatorName = nurse ? nurse.name : '科室负责人';

      db.run(
        'UPDATE adverse_events SET status = ?, is_overdue = 0 WHERE id = ?',
        ['closed', id],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });

          addTimeline(id, '验收通过，事件关闭', 'reviewing', 'closed', operator_id || event.reporter_id, operatorName, null)
            .then(() => res.json({ success: true }))
            .catch(tErr => res.status(500).json({ error: tErr.message }));
        }
      );
    });
  });
});

router.put('/adverse-events/:id/reject', (req, res) => {
  const { id } = req.params;
  const { operator_id, remark } = req.body;

  db.get('SELECT * FROM adverse_events WHERE id = ?', [id], (err, event) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!event) return res.status(404).json({ error: '事件不存在' });
    if (event.status !== 'reviewing') {
      return res.status(400).json({ error: '只有待验收事件可以退回' });
    }

    const newDeadline = dayjs().add(event.rectification_days, 'day').format('YYYY-MM-DD');

    db.get('SELECT * FROM nurses WHERE id = ?', [operator_id || event.reporter_id], (nErr, nurse) => {
      if (nErr) return res.status(500).json({ error: nErr.message });
      const operatorName = nurse ? nurse.name : '科室负责人';

      db.run(
        'UPDATE adverse_events SET status = ?, rectification_deadline = ?, rectification_report = NULL, is_overdue = 0 WHERE id = ?',
        ['processing', newDeadline, id],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });

          addTimeline(id, '验收不通过，退回处理中', 'reviewing', 'processing', operator_id || event.reporter_id, operatorName, remark || `整改期限重置为: ${newDeadline}(${event.rectification_days}天)`)
            .then(() => res.json({ success: true, rectification_deadline: newDeadline }))
            .catch(tErr => res.status(500).json({ error: tErr.message }));
        }
      );
    });
  });
});

router.get('/adverse-event-statistics/overview', (req, res) => {
  const { department_id, month, event_type } = req.query;

  let where = 'WHERE 1=1';
  const params = [];

  if (department_id) {
    where += ' AND department_id = ?';
    params.push(department_id);
  }
  if (month) {
    where += ` AND event_time LIKE ?`;
    params.push(month + '%');
  }
  if (event_type) {
    where += ' AND event_type = ?';
    params.push(event_type);
  }

  db.all(`SELECT status, COUNT(*) as count FROM adverse_events ${where} GROUP BY status`, params, (err, statusStats) => {
    if (err) return res.status(500).json({ error: err.message });

    db.all(`SELECT event_type, COUNT(*) as count FROM adverse_events ${where} GROUP BY event_type`, params, (err2, typeStats) => {
      if (err2) return res.status(500).json({ error: err2.message });

      const totalQuery = `SELECT COUNT(*) as total,
        SUM(CASE WHEN is_overdue = 1 AND status != 'closed' THEN 1 ELSE 0 END) as overdue_count
        FROM adverse_events ${where}`;

      db.get(totalQuery, params, (err3, totals) => {
        if (err3) return res.status(500).json({ error: err3.message });

        const closedWhere = where + " AND ae.status = 'closed'";
        const closedQuery = `SELECT AVG(
          (SELECT CAST((julianday(tl.created_at) - julianday(ae.created_at)) * 24 AS REAL)
           FROM adverse_event_timeline tl WHERE tl.event_id = ae.id AND tl.to_status = 'closed' LIMIT 1)
        ) as avg_hours
        FROM adverse_events ae ${closedWhere}`;

        db.get(closedQuery, params, (err4, avgResult) => {
          if (err4) return res.status(500).json({ error: err4.message });

          res.json({
            status_distribution: statusStats,
            type_distribution: typeStats,
            total: totals.total || 0,
            overdue_count: totals.overdue_count || 0,
            avg_processing_hours: avgResult && avgResult.avg_hours ? Math.round(avgResult.avg_hours * 10) / 10 : 0
          });
        });
      });
    });
  });
});

router.get('/adverse-event-statistics/by-nurse', (req, res) => {
  const { department_id } = req.query;

  if (!department_id) {
    return res.status(400).json({ error: '请提供科室ID' });
  }

  db.all(
    `SELECT n.id as nurse_id, n.name as nurse_name, n.level as nurse_level,
            COUNT(ae.id) as event_count,
            SUM(CASE WHEN ae.status = 'closed' THEN 1 ELSE 0 END) as closed_count,
            SUM(CASE WHEN ae.status != 'closed' THEN 1 ELSE 0 END) as open_count
     FROM nurses n
     LEFT JOIN adverse_events ae ON ae.reporter_id = n.id
     WHERE n.department_id = ?
     GROUP BY n.id
     ORDER BY event_count DESC`,
    [department_id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

module.exports = router;
