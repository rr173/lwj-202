const express = require('express');
const router = express.Router();
const db = require('./db');

router.get('/departments/:id/training-courses', (req, res) => {
  const { id } = req.params;
  db.all(
    'SELECT * FROM training_courses WHERE department_id = ? ORDER BY id',
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

router.post('/training-courses', (req, res) => {
  const { department_id, name, type, hours, assessment_method, pass_score, is_mandatory, instructor } = req.body;
  if (!department_id || !name || !type || !hours || !assessment_method || !instructor) {
    return res.status(400).json({ error: '请填写完整的课程信息' });
  }
  db.run(
    'INSERT INTO training_courses (department_id, name, type, hours, assessment_method, pass_score, is_mandatory, instructor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [department_id, name, type, hours, assessment_method, pass_score || 60, is_mandatory ? 1 : 0, instructor],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, department_id, name, type, hours, assessment_method, pass_score: pass_score || 60, is_mandatory: is_mandatory ? 1 : 0, instructor });
    }
  );
});

router.put('/training-courses/:id', (req, res) => {
  const { id } = req.params;
  const { name, type, hours, assessment_method, pass_score, is_mandatory, instructor } = req.body;
  db.run(
    'UPDATE training_courses SET name=?, type=?, hours=?, assessment_method=?, pass_score=?, is_mandatory=?, instructor=? WHERE id=?',
    [name, type, hours, assessment_method, pass_score, is_mandatory ? 1 : 0, instructor, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: '课程不存在' });
      res.json({ success: true });
    }
  );
});

router.delete('/training-courses/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM training_records WHERE course_id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    db.run('DELETE FROM training_courses WHERE id = ?', [id], function (err2) {
      if (err2) return res.status(500).json({ error: err2.message });
      if (this.changes === 0) return res.status(404).json({ error: '课程不存在' });
      res.json({ success: true });
    });
  });
});

router.get('/training-courses/:id/records', (req, res) => {
  const { id } = req.params;
  db.all(
    'SELECT tr.*, n.name as nurse_name, n.level as nurse_level FROM training_records tr JOIN nurses n ON tr.nurse_id = n.id WHERE tr.course_id = ? ORDER BY tr.id',
    [id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

router.post('/training-records', (req, res) => {
  const { course_id, nurse_id, training_date, score } = req.body;
  if (!course_id || !nurse_id || !training_date) {
    return res.status(400).json({ error: '请填写完整的培训记录' });
  }
  db.get('SELECT * FROM training_courses WHERE id = ?', [course_id], (err, course) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!course) return res.status(404).json({ error: '课程不存在' });
    const passed = score != null && score >= course.pass_score ? 1 : 0;
    db.run(
      'INSERT INTO training_records (course_id, nurse_id, training_date, score, passed) VALUES (?, ?, ?, ?, ?)',
      [course_id, nurse_id, training_date, score, passed],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, course_id, nurse_id, training_date, score, passed, success: true });
      }
    );
  });
});

router.put('/training-records/:id', (req, res) => {
  const { id } = req.params;
  const { score, training_date } = req.body;
  db.get('SELECT * FROM training_records WHERE id = ?', [id], (err, record) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!record) return res.status(404).json({ error: '培训记录不存在' });
    db.get('SELECT * FROM training_courses WHERE id = ?', [record.course_id], (err2, course) => {
      if (err2) return res.status(500).json({ error: err2.message });
      const finalScore = score != null ? score : record.score;
      const passed = finalScore != null && finalScore >= course.pass_score ? 1 : 0;
      db.run(
        'UPDATE training_records SET score=?, passed=?, training_date=? WHERE id=?',
        [finalScore, passed, training_date || record.training_date, id],
        function (err3) {
          if (err3) return res.status(500).json({ error: err3.message });
          res.json({ success: true, passed });
        }
      );
    });
  });
});

router.delete('/training-records/:id', (req, res) => {
  const { id } = req.params;
  db.run('DELETE FROM training_records WHERE id = ?', [id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: '培训记录不存在' });
    res.json({ success: true });
  });
});

router.get('/departments/:id/training-config', (req, res) => {
  const { id } = req.params;
  const { year } = req.query;
  if (!year) return res.status(400).json({ error: '请提供年份参数' });
  db.get(
    'SELECT * FROM training_config WHERE department_id = ? AND year = ?',
    [id, year],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(row || { department_id: id, year, annual_target_hours: 40 });
    }
  );
});

router.post('/training-config', (req, res) => {
  const { department_id, year, annual_target_hours } = req.body;
  if (!department_id || !year) return res.status(400).json({ error: '请填写完整配置' });
  db.run(
    'INSERT OR REPLACE INTO training_config (department_id, year, annual_target_hours) VALUES (?, ?, ?)',
    [department_id, year, annual_target_hours || 40],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID, department_id, year, annual_target_hours: annual_target_hours || 40 });
    }
  );
});

router.get('/departments/:id/nurses/:nurseId/training-progress', (req, res) => {
  const { id, nurseId } = req.params;
  const { year } = req.query;
  if (!year) return res.status(400).json({ error: '请提供年份参数' });

  db.get(
    'SELECT * FROM training_config WHERE department_id = ? AND year = ?',
    [id, year],
    (err, config) => {
      if (err) return res.status(500).json({ error: err.message });
      const targetHours = config ? config.annual_target_hours : 40;

      const yearPrefix = year + '-%';
      db.all(
        `SELECT tr.*, tc.name as course_name, tc.hours as course_hours, tc.is_mandatory, tc.pass_score
         FROM training_records tr
         JOIN training_courses tc ON tr.course_id = tc.id
         WHERE tr.nurse_id = ? AND tr.training_date LIKE ?
         ORDER BY tr.course_id, tr.id`,
        [nurseId, yearPrefix],
        (err2, records) => {
          if (err2) return res.status(500).json({ error: err2.message });

          const courseMap = new Map();
          records.forEach(r => {
            const existing = courseMap.get(r.course_id);
            if (!existing) {
              courseMap.set(r.course_id, { passed: r.passed, course_hours: r.course_hours, is_mandatory: r.is_mandatory });
            } else {
              if (r.passed && !existing.passed) {
                existing.passed = 1;
              }
            }
          });

          let completedHours = 0;
          let mandatoryFailed = false;
          courseMap.forEach((val) => {
            if (val.passed) completedHours += val.course_hours;
            if (val.is_mandatory && !val.passed) mandatoryFailed = true;
          });

          db.all(
            'SELECT * FROM training_courses WHERE department_id = ? AND is_mandatory = 1',
            [id],
            (err3, mandatoryCourses) => {
              if (err3) return res.status(500).json({ error: err3.message });

              const mandatoryNotAttempted = mandatoryCourses.filter(
                mc => !courseMap.has(mc.id)
              ).length;

              const isCompliant = !mandatoryFailed && mandatoryNotAttempted === 0 && completedHours >= targetHours;

              res.json({
                nurse_id: nurseId,
                year,
                target_hours: targetHours,
                completed_hours: completedHours,
                gap_hours: Math.max(0, targetHours - completedHours),
                mandatory_failed: mandatoryFailed,
                mandatory_not_attempted: mandatoryNotAttempted,
                is_compliant: isCompliant,
                records
              });
            }
          );
        }
      );
    }
  );
});

router.get('/departments/:id/training-compliance', (req, res) => {
  const { id } = req.params;
  const { year } = req.query;
  if (!year) return res.status(400).json({ error: '请提供年份参数' });

  db.get(
    'SELECT * FROM training_config WHERE department_id = ? AND year = ?',
    [id, year],
    (err, config) => {
      if (err) return res.status(500).json({ error: err.message });
      const targetHours = config ? config.annual_target_hours : 40;

      db.all('SELECT * FROM nurses WHERE department_id = ?', [id], (err2, nurses) => {
        if (err2) return res.status(500).json({ error: err2.message });

        db.all(
          'SELECT * FROM training_courses WHERE department_id = ? AND is_mandatory = 1',
          [id],
          (err3, mandatoryCourses) => {
            if (err3) return res.status(500).json({ error: err3.message });

            if (nurses.length === 0) {
              return res.json({ department_id: id, year, total_nurses: 0, compliant_nurses: 0, compliance_rate: 0, nurses: [] });
            }

            const yearPrefix = year + '-%';
            const nurseIds = nurses.map(n => n.id);
            const placeholders = nurseIds.map(() => '?').join(',');

            db.all(
              `SELECT tr.*, tc.hours as course_hours, tc.is_mandatory, tc.pass_score
               FROM training_records tr
               JOIN training_courses tc ON tr.course_id = tc.id
               WHERE tr.nurse_id IN (${placeholders}) AND tr.training_date LIKE ?
               ORDER BY tr.nurse_id, tr.course_id, tr.id`,
              [...nurseIds, yearPrefix],
              (err4, allRecords) => {
                if (err4) return res.status(500).json({ error: err4.message });

                const nurseResults = nurses.map(nurse => {
                  const nurseRecords = allRecords.filter(r => r.nurse_id === nurse.id);

                  const courseMap = new Map();
                  nurseRecords.forEach(r => {
                    const existing = courseMap.get(r.course_id);
                    if (!existing) {
                      courseMap.set(r.course_id, { passed: r.passed, course_hours: r.course_hours, is_mandatory: r.is_mandatory });
                    } else {
                      if (r.passed && !existing.passed) {
                        existing.passed = 1;
                      }
                    }
                  });

                  let completedHours = 0;
                  let mandatoryFailed = false;
                  courseMap.forEach((val) => {
                    if (val.passed) completedHours += val.course_hours;
                    if (val.is_mandatory && !val.passed) mandatoryFailed = true;
                  });

                  const mandatoryNotAttempted = mandatoryCourses.filter(
                    mc => !courseMap.has(mc.id)
                  ).length;

                  const isCompliant = !mandatoryFailed && mandatoryNotAttempted === 0 && completedHours >= targetHours;

                  return {
                    nurse_id: nurse.id,
                    nurse_name: nurse.name,
                    nurse_level: nurse.level,
                    completed_hours: completedHours,
                    target_hours: targetHours,
                    gap_hours: Math.max(0, targetHours - completedHours),
                    mandatory_failed: mandatoryFailed,
                    mandatory_not_attempted: mandatoryNotAttempted,
                    is_compliant: isCompliant
                  };
                });

                const compliantCount = nurseResults.filter(n => n.is_compliant).length;
                res.json({
                  department_id: id,
                  year,
                  target_hours: targetHours,
                  total_nurses: nurses.length,
                  compliant_nurses: compliantCount,
                  compliance_rate: Math.round((compliantCount / nurses.length) * 10000) / 100,
                  nurses: nurseResults
                });
              }
            );
          }
        );
      });
    }
  );
});

module.exports = router;
