const express = require('express');
const router = express.Router();
const db = require('./db');
const dayjs = require('dayjs');

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function allAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function scanOverdueWarnings() {
  try {
    const now = dayjs();
    const activePaths = await allAsync(`
      SELECT pcp.*, cpt.name as template_name
      FROM patient_care_paths pcp
      JOIN care_path_templates cpt ON pcp.template_id = cpt.id
      WHERE pcp.status = 'active'
    `);

    for (const path of activePaths) {
      const stageExecutions = await allAsync(`
        SELECT cse.*, cps.duration_hours, cps.name as stage_name
        FROM care_path_stage_executions cse
        JOIN care_path_stages cps ON cse.stage_id = cps.id
        WHERE cse.patient_path_id = ?
        ORDER BY cse.stage_index
      `, [path.id]);

      for (const stage of stageExecutions) {
        if (stage.status === 'completed') continue;

        const operations = await allAsync(`
          SELECT coe.*, cpo.name as operation_name, cpo.is_critical
          FROM care_path_operation_executions coe
          JOIN care_path_operations cpo ON coe.operation_id = cpo.id
          WHERE coe.stage_execution_id = ?
        `, [stage.id]);

        for (const op of operations) {
          if (op.status === 'completed') continue;
          if (!op.is_critical) continue;

          const deadline = dayjs(stage.deadline_time);
          if (now.isAfter(deadline)) {
            const overdueMinutes = now.diff(deadline, 'minute');
            const existing = await getAsync(`
              SELECT * FROM care_path_warnings
              WHERE operation_execution_id = ?
              ORDER BY id DESC LIMIT 1
            `, [op.id]);

            if (!existing) {
              await runAsync(`
                INSERT INTO care_path_warnings (patient_path_id, department_id, operation_execution_id, patient_bed, operation_name, overdue_minutes)
                VALUES (?, ?, ?, ?, ?, ?)
              `, [path.id, path.department_id, op.id, path.patient_bed, op.operation_name, overdueMinutes]);
            } else if (existing.is_handled === 0) {
              await runAsync(`
                UPDATE care_path_warnings SET overdue_minutes = ? WHERE id = ?
              `, [overdueMinutes, existing.id]);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('scanOverdueWarnings failed:', e);
  }
}

setInterval(scanOverdueWarnings, 60 * 1000);

router.get('/care-path-templates', async (req, res) => {
  const { department_id } = req.query;
  let query = `
    SELECT cpt.*, d.name as department_name
    FROM care_path_templates cpt
    JOIN departments d ON cpt.department_id = d.id
    WHERE 1=1
  `;
  const params = [];
  if (department_id) {
    query += ' AND cpt.department_id = ?';
    params.push(department_id);
  }
  query += ' ORDER BY cpt.id DESC';

  try {
    const templates = await allAsync(query, params);
    for (const tpl of templates) {
      const stages = await allAsync(`
        SELECT * FROM care_path_stages WHERE template_id = ? ORDER BY stage_order
      `, [tpl.id]);
      for (const stage of stages) {
        stage.operations = await allAsync(`
          SELECT * FROM care_path_operations WHERE stage_id = ? ORDER BY operation_order
        `, [stage.id]);
      }
      tpl.stages = stages;
    }
    res.json(templates);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/care-path-templates/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const tpl = await getAsync(`
      SELECT cpt.*, d.name as department_name
      FROM care_path_templates cpt
      JOIN departments d ON cpt.department_id = d.id
      WHERE cpt.id = ?
    `, [id]);
    if (!tpl) return res.status(404).json({ error: '路径模板不存在' });

    const stages = await allAsync(`
      SELECT * FROM care_path_stages WHERE template_id = ? ORDER BY stage_order
    `, [id]);
    for (const stage of stages) {
      stage.operations = await allAsync(`
        SELECT * FROM care_path_operations WHERE stage_id = ? ORDER BY operation_order
      `, [stage.id]);
    }
    tpl.stages = stages;
    res.json(tpl);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/care-path-templates', async (req, res) => {
  const { name, department_id, applicable_disease, stages } = req.body;
  if (!name || !department_id || !applicable_disease || !Array.isArray(stages) || stages.length === 0) {
    return res.status(400).json({ error: '请填写完整的模板信息，至少包含一个阶段' });
  }

  try {
    await runAsync('BEGIN TRANSACTION');
    const tplResult = await runAsync(`
      INSERT INTO care_path_templates (name, department_id, applicable_disease) VALUES (?, ?, ?)
    `, [name, department_id, applicable_disease]);
    const templateId = tplResult.lastID;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      if (!stage.name || !stage.duration_hours || !Array.isArray(stage.operations) || stage.operations.length === 0) {
        await runAsync('ROLLBACK');
        return res.status(400).json({ error: `第${i + 1}个阶段信息不完整` });
      }
      const stageResult = await runAsync(`
        INSERT INTO care_path_stages (template_id, stage_order, name, duration_hours) VALUES (?, ?, ?, ?)
      `, [templateId, i, stage.name, stage.duration_hours]);
      const stageId = stageResult.lastID;

      for (let j = 0; j < stage.operations.length; j++) {
        const op = stage.operations[j];
        if (!op.name) {
          await runAsync('ROLLBACK');
          return res.status(400).json({ error: `第${i + 1}个阶段第${j + 1}个操作项名称不能为空` });
        }
        await runAsync(`
          INSERT INTO care_path_operations (stage_id, operation_order, name, is_critical) VALUES (?, ?, ?, ?)
        `, [stageId, j, op.name, op.is_critical ? 1 : 0]);
      }
    }

    await runAsync('COMMIT');
    res.json({ id: templateId, success: true });
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch (e2) { }
    res.status(500).json({ error: e.message });
  }
});

router.put('/care-path-templates/:id', async (req, res) => {
  const { id } = req.params;
  const { name, applicable_disease, stages } = req.body;

  try {
    const existing = await getAsync('SELECT * FROM care_path_templates WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '路径模板不存在' });

    await runAsync('BEGIN TRANSACTION');
    await runAsync('UPDATE care_path_templates SET name = ?, applicable_disease = ? WHERE id = ?',
      [name || existing.name, applicable_disease || existing.applicable_disease, id]);

    if (Array.isArray(stages)) {
      const oldStageIds = (await allAsync('SELECT id FROM care_path_stages WHERE template_id = ?', [id])).map(s => s.id);
      for (const oldId of oldStageIds) {
        await runAsync('DELETE FROM care_path_operations WHERE stage_id = ?', [oldId]);
      }
      await runAsync('DELETE FROM care_path_stages WHERE template_id = ?', [id]);

      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        const stageResult = await runAsync(`
          INSERT INTO care_path_stages (template_id, stage_order, name, duration_hours) VALUES (?, ?, ?, ?)
        `, [id, i, stage.name, stage.duration_hours]);
        const stageId = stageResult.lastID;

        for (let j = 0; j < (stage.operations || []).length; j++) {
          const op = stage.operations[j];
          await runAsync(`
            INSERT INTO care_path_operations (stage_id, operation_order, name, is_critical) VALUES (?, ?, ?, ?)
          `, [stageId, j, op.name, op.is_critical ? 1 : 0]);
        }
      }
    }

    await runAsync('COMMIT');
    res.json({ success: true });
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch (e2) { }
    res.status(500).json({ error: e.message });
  }
});

router.delete('/care-path-templates/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const inUse = await getAsync('SELECT COUNT(*) as cnt FROM patient_care_paths WHERE template_id = ?', [id]);
    if (inUse.cnt > 0) {
      return res.status(400).json({ error: '该模板已有患者使用，无法删除' });
    }
    await runAsync('BEGIN TRANSACTION');
    const stageIds = (await allAsync('SELECT id FROM care_path_stages WHERE template_id = ?', [id])).map(s => s.id);
    for (const sid of stageIds) {
      await runAsync('DELETE FROM care_path_operations WHERE stage_id = ?', [sid]);
    }
    await runAsync('DELETE FROM care_path_stages WHERE template_id = ?', [id]);
    await runAsync('DELETE FROM care_path_templates WHERE id = ?', [id]);
    await runAsync('COMMIT');
    res.json({ success: true });
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch (e2) { }
    res.status(500).json({ error: e.message });
  }
});

router.post('/patient-care-paths', async (req, res) => {
  const { template_id, department_id, patient_bed, patient_name, start_time } = req.body;
  if (!template_id || !department_id || !patient_bed) {
    return res.status(400).json({ error: '请提供模板ID、科室ID和患者床号' });
  }

  try {
    const template = await getAsync(`
      SELECT cpt.*,
        (SELECT COUNT(*) FROM care_path_stages WHERE template_id = cpt.id) as stage_count
      FROM care_path_templates cpt WHERE cpt.id = ?
    `, [template_id]);
    if (!template) return res.status(404).json({ error: '路径模板不存在' });

    const startTime = start_time ? dayjs(start_time) : dayjs();

    await runAsync('BEGIN TRANSACTION');
    const pathResult = await runAsync(`
      INSERT INTO patient_care_paths (template_id, department_id, patient_bed, patient_name, status, current_stage_index, start_time)
      VALUES (?, ?, ?, ?, 'active', 0, ?)
    `, [template_id, department_id, patient_bed, patient_name || null, startTime.format('YYYY-MM-DD HH:mm:ss')]);
    const patientPathId = pathResult.lastID;

    const stages = await allAsync('SELECT * FROM care_path_stages WHERE template_id = ? ORDER BY stage_order', [template_id]);
    let cumulativeHours = 0;

    for (let i = 0; i < stages.length; i++) {
      const stage = stages[i];
      cumulativeHours += stage.duration_hours;
      const deadlineTime = startTime.add(cumulativeHours, 'hour');

      const stageExecResult = await runAsync(`
        INSERT INTO care_path_stage_executions (patient_path_id, stage_id, stage_index, deadline_time, status)
        VALUES (?, ?, ?, ?, ?)
      `, [patientPathId, stage.id, i, deadlineTime.format('YYYY-MM-DD HH:mm:ss'), i === 0 ? 'in_progress' : 'pending']);

      if (i === 0) {
        await runAsync(`
          UPDATE care_path_stage_executions SET actual_start_time = ? WHERE id = ?
        `, [startTime.format('YYYY-MM-DD HH:mm:ss'), stageExecResult.lastID]);
      }

      const operations = await allAsync('SELECT * FROM care_path_operations WHERE stage_id = ? ORDER BY operation_order', [stage.id]);
      for (const op of operations) {
        await runAsync(`
          INSERT INTO care_path_operation_executions (stage_execution_id, operation_id, status)
          VALUES (?, ?, 'pending')
        `, [stageExecResult.lastID, op.id]);
      }
    }

    await runAsync('COMMIT');
    res.json({ id: patientPathId, success: true });
  } catch (e) {
    try { await runAsync('ROLLBACK'); } catch (e2) { }
    res.status(500).json({ error: e.message });
  }
});

router.get('/patient-care-paths/active', async (req, res) => {
  const { department_id } = req.query;
  try {
    await scanOverdueWarnings();

    let query = `
      SELECT pcp.*, cpt.name as template_name, cpt.applicable_disease, d.name as department_name
      FROM patient_care_paths pcp
      JOIN care_path_templates cpt ON pcp.template_id = cpt.id
      JOIN departments d ON pcp.department_id = d.id
      WHERE pcp.status = 'active'
    `;
    const params = [];
    if (department_id) {
      query += ' AND pcp.department_id = ?';
      params.push(department_id);
    }
    query += ' ORDER BY pcp.created_at DESC';

    const paths = await allAsync(query, params);

    for (const path of paths) {
      const stageExecs = await allAsync(`
        SELECT cse.*, cps.name as stage_name, cps.duration_hours
        FROM care_path_stage_executions cse
        JOIN care_path_stages cps ON cse.stage_id = cps.id
        WHERE cse.patient_path_id = ?
        ORDER BY cse.stage_index
      `, [path.id]);

      let totalOps = 0, completedOps = 0;
      for (const stage of stageExecs) {
        const ops = await allAsync(`
          SELECT coe.*, cpo.name as operation_name, cpo.is_critical
          FROM care_path_operation_executions coe
          JOIN care_path_operations cpo ON coe.operation_id = cpo.id
          WHERE coe.stage_execution_id = ?
          ORDER BY cpo.operation_order
        `, [stage.id]);
        stage.operations = ops;
        totalOps += ops.length;
        completedOps += ops.filter(o => o.status === 'completed').length;
      }
      path.stages = stageExecs;
      path.progress_percent = totalOps > 0 ? Math.round((completedOps / totalOps) * 100) : 0;
      path.current_stage_name = stageExecs[path.current_stage_index]?.stage_name || null;

      const warnings = await allAsync(`
        SELECT * FROM care_path_warnings
        WHERE patient_path_id = ? AND is_handled = 0
      `, [path.id]);
      path.has_overdue = warnings.length > 0;
      path.overdue_count = warnings.length;
    }

    paths.sort((a, b) => {
      if (a.has_overdue && !b.has_overdue) return -1;
      if (!a.has_overdue && b.has_overdue) return 1;
      return 0;
    });

    res.json(paths);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/patient-care-paths/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const path = await getAsync(`
      SELECT pcp.*, cpt.name as template_name, cpt.applicable_disease, d.name as department_name
      FROM patient_care_paths pcp
      JOIN care_path_templates cpt ON pcp.template_id = cpt.id
      JOIN departments d ON pcp.department_id = d.id
      WHERE pcp.id = ?
    `, [id]);
    if (!path) return res.status(404).json({ error: '患者路径不存在' });

    const stageExecs = await allAsync(`
      SELECT cse.*, cps.name as stage_name, cps.duration_hours
      FROM care_path_stage_executions cse
      JOIN care_path_stages cps ON cse.stage_id = cps.id
      WHERE cse.patient_path_id = ?
      ORDER BY cse.stage_index
    `, [id]);

    let totalOps = 0, completedOps = 0;
    for (const stage of stageExecs) {
      const ops = await allAsync(`
        SELECT coe.*, cpo.name as operation_name, cpo.is_critical
        FROM care_path_operation_executions coe
        JOIN care_path_operations cpo ON coe.operation_id = cpo.id
        WHERE coe.stage_execution_id = ?
        ORDER BY cpo.operation_order
      `, [stage.id]);
      stage.operations = ops;
      totalOps += ops.length;
      completedOps += ops.filter(o => o.status === 'completed').length;
    }
    path.stages = stageExecs;
    path.progress_percent = totalOps > 0 ? Math.round((completedOps / totalOps) * 100) : 0;

    const warnings = await allAsync(`
      SELECT * FROM care_path_warnings WHERE patient_path_id = ? ORDER BY created_at DESC
    `, [id]);
    path.warnings = warnings;

    res.json(path);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/care-path-operation-executions/:id/sign', async (req, res) => {
  const { id } = req.params;
  const { nurse_id } = req.body;
  if (!nurse_id) return res.status(400).json({ error: '请提供签署护士ID' });

  try {
    const opExec = await getAsync(`
      SELECT coe.*, cse.patient_path_id, cse.stage_index, cse.stage_id, cse.status as stage_status, pcp.department_id, pcp.patient_bed
      FROM care_path_operation_executions coe
      JOIN care_path_stage_executions cse ON coe.stage_execution_id = cse.id
      JOIN patient_care_paths pcp ON cse.patient_path_id = pcp.id
      WHERE coe.id = ?
    `, [id]);
    if (!opExec) return res.status(404).json({ error: '操作项不存在' });
    if (opExec.status === 'completed') return res.status(400).json({ error: '该操作项已签署完成' });
    if (opExec.stage_status !== 'in_progress') {
      return res.status(400).json({ error: '该操作项所在阶段尚未开始，无法签署，请按顺序完成当前阶段' });
    }

    const today = dayjs().format('YYYY-MM-DD');
    const schedule = await getAsync(`
      SELECT s.*, n.name as nurse_name
      FROM schedules s
      JOIN nurses n ON s.nurse_id = n.id
      WHERE s.nurse_id = ? AND s.department_id = ? AND s.date = ?
    `, [nurse_id, opExec.department_id, today]);

    if (!schedule) {
      return res.status(400).json({ error: '该护士今日在本科室无排班，无法签署' });
    }

    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    await runAsync(`
      UPDATE care_path_operation_executions
      SET status = 'completed', signed_by = ?, signed_by_name = ?, signed_at = ?
      WHERE id = ?
    `, [nurse_id, schedule.nurse_name, now, id]);

    const allOpsInStage = await allAsync(`
      SELECT * FROM care_path_operation_executions WHERE stage_execution_id = ?
    `, [opExec.stage_execution_id]);
    const allCompleted = allOpsInStage.every(o => o.status === 'completed');

    if (allCompleted) {
      await runAsync(`
        UPDATE care_path_stage_executions
        SET status = 'completed', actual_end_time = ?
        WHERE id = ?
      `, [now, opExec.stage_execution_id]);

      const path = await getAsync('SELECT * FROM patient_care_paths WHERE id = ?', [opExec.patient_path_id]);
      const totalStages = await getAsync(`
        SELECT COUNT(*) as cnt FROM care_path_stage_executions WHERE patient_path_id = ?
      `, [opExec.patient_path_id]);

      const nextIndex = opExec.stage_index + 1;
      if (nextIndex < totalStages.cnt) {
        const nextStageExec = await getAsync(`
          SELECT * FROM care_path_stage_executions WHERE patient_path_id = ? AND stage_index = ?
        `, [opExec.patient_path_id, nextIndex]);

        await runAsync(`
          UPDATE care_path_stage_executions
          SET status = 'in_progress', actual_start_time = ?
          WHERE id = ?
        `, [now, nextStageExec.id]);

        await runAsync(`
          UPDATE patient_care_paths SET current_stage_index = ? WHERE id = ?
        `, [nextIndex, opExec.patient_path_id]);
      } else {
        await runAsync(`
          UPDATE patient_care_paths SET status = 'completed', completed_time = ? WHERE id = ?
        `, [now, opExec.patient_path_id]);
      }
    }

    res.json({ success: true, signed_at: now, signed_by_name: schedule.nurse_name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/care-path-warnings', async (req, res) => {
  const { department_id, is_handled } = req.query;
  try {
    await scanOverdueWarnings();
    let query = `
      SELECT cpw.*, pcp.patient_name, cpt.name as template_name
      FROM care_path_warnings cpw
      JOIN patient_care_paths pcp ON cpw.patient_path_id = pcp.id
      JOIN care_path_templates cpt ON pcp.template_id = cpt.id
      WHERE 1=1
    `;
    const params = [];
    if (department_id) {
      query += ' AND cpw.department_id = ?';
      params.push(department_id);
    }
    if (is_handled !== undefined) {
      query += ' AND cpw.is_handled = ?';
      params.push(is_handled === '1' || is_handled === 'true' ? 1 : 0);
    }
    query += ' ORDER BY cpw.created_at DESC';
    const warnings = await allAsync(query, params);
    res.json(warnings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/care-path-warnings/:id/handle', async (req, res) => {
  const { id } = req.params;
  const { handled_by } = req.body;
  try {
    const existing = await getAsync('SELECT * FROM care_path_warnings WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: '预警不存在' });
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    await runAsync(`
      UPDATE care_path_warnings SET is_handled = 1, handled_by = ?, handled_at = ? WHERE id = ?
    `, [handled_by || null, now, id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/care-path-statistics/overview', async (req, res) => {
  const { department_id, month } = req.query;
  if (!month) return res.status(400).json({ error: '请提供月份参数' });

  try {
    let pathWhere = "WHERE strftime('%Y-%m', pcp.start_time) = ?";
    const pathParams = [month];
    if (department_id) {
      pathWhere += ' AND pcp.department_id = ?';
      pathParams.push(department_id);
    }

    const totalResult = await getAsync(`
      SELECT COUNT(*) as total FROM patient_care_paths pcp ${pathWhere}
    `, pathParams);

    const completedResult = await getAsync(`
      SELECT COUNT(*) as cnt FROM patient_care_paths pcp ${pathWhere} AND pcp.status = 'completed'
    `, pathParams);

    const activeWhere = pathWhere + " AND pcp.status = 'active'";
    const pathsWithOverdue = await getAsync(`
      SELECT COUNT(DISTINCT pcp.id) as cnt
      FROM patient_care_paths pcp
      JOIN care_path_warnings cpw ON pcp.id = cpw.patient_path_id
      ${activeWhere}
    `, pathParams);

    let warningWhere = "WHERE strftime('%Y-%m', cpw.created_at) = ?";
    const warningParams = [month];
    if (department_id) {
      warningWhere += ' AND cpw.department_id = ?';
      warningParams.push(department_id);
    }
    const totalWarnings = await getAsync(`
      SELECT COUNT(*) as cnt FROM care_path_warnings cpw ${warningWhere}
    `, warningParams);

    const totalPaths = totalResult.total || 0;
    const completedPaths = completedResult.cnt || 0;
    const completionRate = totalPaths > 0 ? Math.round((completedPaths / totalPaths) * 100) / 100 : 0;
    const avgOverduePerPath = totalPaths > 0 ? Math.round((totalWarnings.cnt / totalPaths) * 10) / 10 : 0;

    res.json({
      month,
      total_paths: totalPaths,
      completed_paths: completedPaths,
      active_paths: totalPaths - completedPaths,
      completion_rate: completionRate,
      paths_with_overdue: pathsWithOverdue.cnt || 0,
      total_warnings: totalWarnings.cnt || 0,
      avg_overdue_per_path: avgOverduePerPath
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
