const express = require('express');
const router = express.Router();
const db = require('./db');
const dayjs = require('dayjs');

let writeMutex = Promise.resolve();
function withWriteLock(fn) {
  const result = writeMutex.then(() => fn());
  writeMutex = result.catch(() => {});
  return result;
}

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

function markExpiredBatches() {
  const today = dayjs().format('YYYY-MM-DD');
  return runAsync(
    `UPDATE supply_batches SET is_expired = 1
     WHERE is_expired = 0 AND date(expiry_date) < date(?)`,
    [today]
  );
}

function checkAndCreateWarnings(departmentId) {
  return new Promise(async (resolve, reject) => {
    try {
      const today = dayjs().format('YYYY-MM-DD');
      const nearExpiryDate = dayjs().add(30, 'day').format('YYYY-MM-DD');

      await runAsync(
        `UPDATE supply_warnings SET is_resolved = 1, resolved_at = ?
         WHERE department_id = ? AND is_resolved = 0`,
        [today, departmentId]
      );

      const supplies = await allAsync(
        `SELECT ms.*, COALESCE(SUM(sb.remaining), 0) as total_stock
         FROM medical_supplies ms
         LEFT JOIN supply_batches sb ON sb.supply_id = ms.id AND sb.is_expired = 0
         WHERE ms.department_id = ?
         GROUP BY ms.id`,
        [departmentId]
      );

      for (const supply of supplies) {
        if (supply.total_stock < supply.safety_threshold) {
          await runAsync(
            `INSERT INTO supply_warnings (department_id, supply_id, warning_type, current_stock, threshold)
             VALUES (?, ?, 'low_stock', ?, ?)`,
            [departmentId, supply.id, supply.total_stock, supply.safety_threshold]
          );
        }
      }

      const expiredBatches = await allAsync(
        `SELECT sb.*, ms.name as supply_name, ms.spec
         FROM supply_batches sb
         JOIN medical_supplies ms ON ms.id = sb.supply_id
         WHERE sb.supply_id IN (SELECT id FROM medical_supplies WHERE department_id = ?)
           AND sb.is_expired = 1 AND sb.remaining > 0`,
        [departmentId]
      );

      for (const batch of expiredBatches) {
        await runAsync(
          `INSERT INTO supply_warnings (department_id, supply_id, warning_type, current_stock, expiry_date, batch_id)
           VALUES (?, ?, 'expired', ?, ?, ?)`,
          [departmentId, batch.supply_id, batch.remaining, batch.expiry_date, batch.id]
        );
      }

      const nearExpiryBatches = await allAsync(
        `SELECT sb.*, ms.name as supply_name, ms.spec
         FROM supply_batches sb
         JOIN medical_supplies ms ON ms.id = sb.supply_id
         WHERE sb.supply_id IN (SELECT id FROM medical_supplies WHERE department_id = ?)
           AND sb.is_expired = 0 AND sb.remaining > 0
           AND date(sb.expiry_date) <= date(?) AND date(sb.expiry_date) >= date(?)`,
        [departmentId, nearExpiryDate, today]
      );

      for (const batch of nearExpiryBatches) {
        await runAsync(
          `INSERT INTO supply_warnings (department_id, supply_id, warning_type, current_stock, expiry_date, batch_id)
           VALUES (?, ?, 'near_expiry', ?, ?, ?)`,
          [departmentId, batch.supply_id, batch.remaining, batch.expiry_date, batch.id]
        );
      }

      resolve();
    } catch (err) {
      reject(err);
    }
  });
}

(async function init() {
  try {
    await markExpiredBatches();
    const depts = await allAsync('SELECT id FROM departments');
    for (const d of depts) {
      await checkAndCreateWarnings(d.id);
    }
  } catch (e) {
    console.error('耗材模块初始化失败:', e);
  }
})();

router.get('/departments/:id/supplies', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await allAsync(
      `SELECT ms.*,
              COALESCE(SUM(CASE WHEN sb.is_expired = 0 THEN sb.remaining ELSE 0 END), 0) as total_stock,
              COALESCE(SUM(CASE WHEN sb.is_expired = 1 THEN sb.remaining ELSE 0 END), 0) as expired_stock
       FROM medical_supplies ms
       LEFT JOIN supply_batches sb ON sb.supply_id = ms.id
       WHERE ms.department_id = ?
       GROUP BY ms.id
       ORDER BY ms.created_at DESC`,
      [id]
    );
    const result = rows.map(r => ({
      ...r,
      is_low_stock: r.total_stock < r.safety_threshold,
      has_expired: r.expired_stock > 0
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/departments/:id/supplies', async (req, res) => {
  const { id } = req.params;
  const { name, spec, unit, safety_threshold, category } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '耗材名称不能为空' });
  try {
    const result = await runAsync(
      `INSERT INTO medical_supplies (department_id, name, spec, unit, safety_threshold, category)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, name.trim(), spec || null, unit || '个', safety_threshold || 10, category || 'general']
    );
    await checkAndCreateWarnings(parseInt(id));
    res.json({ id: result.lastID, success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: '该耗材已存在' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/supplies/:id', async (req, res) => {
  const { id } = req.params;
  const { name, spec, unit, safety_threshold, category } = req.body;
  try {
    const supply = await getAsync('SELECT * FROM medical_supplies WHERE id = ?', [id]);
    if (!supply) return res.status(404).json({ error: '耗材不存在' });
    await runAsync(
      `UPDATE medical_supplies SET name = ?, spec = ?, unit = ?, safety_threshold = ?, category = ? WHERE id = ?`,
      [name || supply.name, spec !== undefined ? spec : supply.spec, unit || supply.unit,
       safety_threshold !== undefined ? safety_threshold : supply.safety_threshold,
       category || supply.category, id]
    );
    await checkAndCreateWarnings(supply.department_id);
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: '该耗材已存在' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/supplies/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const supply = await getAsync('SELECT * FROM medical_supplies WHERE id = ?', [id]);
    if (!supply) return res.status(404).json({ error: '耗材不存在' });
    await runAsync('DELETE FROM supply_warnings WHERE supply_id = ?', [id]);
    await runAsync('DELETE FROM supply_requisition_items WHERE batch_id IN (SELECT id FROM supply_batches WHERE supply_id = ?)', [id]);
    await runAsync('DELETE FROM supply_requisitions WHERE supply_id = ?', [id]);
    await runAsync('DELETE FROM supply_batches WHERE supply_id = ?', [id]);
    await runAsync('DELETE FROM medical_supplies WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/supplies/:id/batches', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await allAsync(
      `SELECT sb.*, n.name as operator_name
       FROM supply_batches sb
       LEFT JOIN nurses n ON n.id = sb.operator_id
       WHERE sb.supply_id = ?
       ORDER BY sb.expiry_date ASC, sb.received_at ASC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/supplies/:id/receive', async (req, res) => {
  const { id } = req.params;
  const { batch_no, expiry_date, quantity, operator_id } = req.body;
  if (!batch_no || !expiry_date || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '请填写完整的入库信息' });
  }
  try {
    const supply = await getAsync('SELECT * FROM medical_supplies WHERE id = ?', [id]);
    if (!supply) return res.status(404).json({ error: '耗材不存在' });
    const result = await runAsync(
      `INSERT INTO supply_batches (supply_id, batch_no, expiry_date, quantity, remaining, operator_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, batch_no, expiry_date, quantity, quantity, operator_id || null]
    );
    await markExpiredBatches();
    await checkAndCreateWarnings(supply.department_id);
    res.json({ id: result.lastID, success: true });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: '批次号已存在' });
    res.status(500).json({ error: err.message });
  }
});

function canNurseRequisitionInDept(nurseId, departmentId, date) {
  return new Promise(async (resolve, reject) => {
    try {
      const nurse = await getAsync('SELECT * FROM nurses WHERE id = ?', [nurseId]);
      if (!nurse) return resolve({ allowed: false, reason: '护士不存在' });
      if (nurse.department_id === parseInt(departmentId)) {
        return resolve({ allowed: true, type: 'own' });
      }
      const refDate = date || dayjs().format('YYYY-MM-DD');
      const secondment = await getAsync(
        `SELECT * FROM secondment_requests
         WHERE nurse_id = ? AND to_department_id = ? AND status = 'approved'
           AND date(start_date) <= date(?) AND date(end_date) >= date(?)
         LIMIT 1`,
        [nurseId, departmentId, refDate, refDate]
      );
      if (secondment) {
        return resolve({ allowed: true, type: 'secondment', secondment_id: secondment.id });
      }
      resolve({ allowed: false, reason: '该护士不属于本科室，也不在有效借调期内' });
    } catch (err) {
      reject(err);
    }
  });
}

router.post('/departments/:id/requisitions', async (req, res) => {
  const { id } = req.params;
  const { supply_id, nurse_id, quantity, requisition_time, remark } = req.body;
  if (!supply_id || !nurse_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: '请填写完整的领用信息' });
  }

  const actTime = requisition_time || dayjs().format('YYYY-MM-DD HH:mm:ss');
  const date = actTime.substring(0, 10);

  try {
    const permission = await canNurseRequisitionInDept(nurse_id, id, date);
    if (!permission.allowed) {
      return res.status(403).json({ error: permission.reason || '无领用权限' });
    }

    const nurse = await getAsync('SELECT * FROM nurses WHERE id = ?', [nurse_id]);
    if (!nurse) return res.status(404).json({ error: '护士不存在' });
    const schedule = await getAsync(
      'SELECT * FROM schedules WHERE nurse_id = ? AND date = ?',
      [nurse_id, date]
    );
    const scheduleId = schedule ? schedule.id : null;
    const shift = schedule ? schedule.shift : null;

    const result = await withWriteLock(async () => {
      const supply = await getAsync(
        `SELECT ms.*, COALESCE(SUM(CASE WHEN sb.is_expired = 0 THEN sb.remaining ELSE 0 END), 0) as available_stock
         FROM medical_supplies ms
         LEFT JOIN supply_batches sb ON sb.supply_id = ms.id AND sb.is_expired = 0
         WHERE ms.id = ? AND ms.department_id = ?
         GROUP BY ms.id`,
        [supply_id, id]
      );
      if (!supply) throw Object.assign(new Error('耗材不存在'), { statusCode: 404 });
      if (supply.available_stock < quantity) {
        throw Object.assign(new Error(`库存不足，可用库存仅 ${supply.available_stock} ${supply.unit}`), { statusCode: 400 });
      }

      const batches = await allAsync(
        `SELECT * FROM supply_batches
         WHERE supply_id = ? AND is_expired = 0 AND remaining > 0
         ORDER BY expiry_date ASC, received_at ASC`,
        [supply_id]
      );

      let remainingNeeded = quantity;
      const usedBatches = [];
      for (const batch of batches) {
        if (remainingNeeded <= 0) break;
        const takeQty = Math.min(batch.remaining, remainingNeeded);
        usedBatches.push({ batch_id: batch.id, quantity: takeQty });
        remainingNeeded -= takeQty;
      }
      if (remainingNeeded > 0) {
        throw Object.assign(new Error('库存扣减失败'), { statusCode: 400 });
      }

      return await new Promise((resolve, reject) => {
        db.serialize(() => {
          db.run('BEGIN IMMEDIATE TRANSACTION', async (beginErr) => {
            if (beginErr) {
              reject(beginErr);
              return;
            }
            try {
              const reqResult = await new Promise((resolve, reject) => {
                db.run(
                  `INSERT INTO supply_requisitions (department_id, supply_id, nurse_id, quantity, requisition_time, schedule_id, shift, date, remark)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [id, supply_id, nurse_id, quantity, actTime, scheduleId, shift, date, remark || null],
                  function (e) {
                    if (e) reject(e);
                    else resolve({ lastID: this.lastID });
                  }
                );
              });
              const requisitionId = reqResult.lastID;

              for (const ub of usedBatches) {
                const updateResult = await new Promise((resolve, reject) => {
                  db.run(
                    'UPDATE supply_batches SET remaining = remaining - ? WHERE id = ? AND remaining >= ?',
                    [ub.quantity, ub.batch_id, ub.quantity],
                    function (e) {
                      if (e) reject(e);
                      else resolve({ changes: this.changes });
                    }
                  );
                });
                if (updateResult.changes === 0) {
                  throw new Error('库存不足，扣减失败（可能有其他并发操作）');
                }
                await new Promise((resolve, reject) => {
                  db.run(
                    'INSERT INTO supply_requisition_items (requisition_id, batch_id, quantity) VALUES (?, ?, ?)',
                    [requisitionId, ub.batch_id, ub.quantity],
                    (e) => { if (e) reject(e); else resolve(); }
                  );
                });
              }

              await new Promise((resolve, reject) => {
                db.run('COMMIT', (e) => { if (e) reject(e); else resolve(); });
              });

              resolve({ id: requisitionId, shift });
            } catch (txErr) {
              db.run('ROLLBACK', () => reject(txErr));
            }
          });
        });
      });
    });

    await markExpiredBatches();
    await checkAndCreateWarnings(parseInt(id));

    res.json({ id: result.id, success: true, schedule_shift: result.shift });
  } catch (err) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ error: err.message });
    } else if (err.message && err.message.includes('库存不足')) {
      res.status(409).json({ error: err.message });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

router.get('/departments/:id/requisitions', async (req, res) => {
  const { id } = req.params;
  const { supply_id, month, start_date, end_date } = req.query;
  try {
    let query = `
      SELECT sr.*,
             ms.name as supply_name, ms.spec as supply_spec, ms.unit as supply_unit,
             n.name as nurse_name, n.level as nurse_level
      FROM supply_requisitions sr
      JOIN medical_supplies ms ON ms.id = sr.supply_id
      JOIN nurses n ON n.id = sr.nurse_id
      WHERE sr.department_id = ?
    `;
    const params = [id];
    if (supply_id) { query += ' AND sr.supply_id = ?'; params.push(supply_id); }
    if (month) { query += ' AND sr.date LIKE ?'; params.push(month + '%'); }
    if (start_date) { query += ' AND date(sr.date) >= date(?)'; params.push(start_date); }
    if (end_date) { query += ' AND date(sr.date) <= date(?)'; params.push(end_date); }
    query += ' ORDER BY sr.requisition_time DESC LIMIT 500';
    const rows = await allAsync(query, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments/:id/supplies/:supplyId/transactions', async (req, res) => {
  const { id, supplyId } = req.params;
  const { days = 30 } = req.query;
  try {
    const startDate = dayjs().subtract(parseInt(days) - 1, 'day').format('YYYY-MM-DD');
    const rows = await allAsync(
      `SELECT date, SUM(quantity) as total_qty
       FROM (
         SELECT date, quantity FROM supply_requisitions
         WHERE department_id = ? AND supply_id = ? AND date >= ?
         UNION ALL
         SELECT date(received_at) as date, -quantity as quantity FROM supply_batches
         WHERE supply_id = ? AND date(received_at) >= ?
       )
       GROUP BY date
       ORDER BY date ASC`,
      [id, supplyId, startDate, supplyId, startDate]
    );
    const dates = [];
    const qtyMap = {};
    for (let i = 0; i < parseInt(days); i++) {
      const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      dates.unshift(d);
      qtyMap[d] = 0;
    }
    rows.forEach(r => { qtyMap[r.date] = r.total_qty; });
    res.json({ dates, quantities: dates.map(d => qtyMap[d] || 0) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments/:id/supplies/:supplyId/stock-trend', async (req, res) => {
  const { id, supplyId } = req.params;
  const { days = 30 } = req.query;
  try {
    const initialStock = await getAsync(
      `SELECT COALESCE(SUM(quantity) - COALESCE((SELECT SUM(quantity) FROM supply_requisitions sr
         JOIN supply_requisition_items sri ON sri.requisition_id = sr.id
         WHERE sri.batch_id IN (SELECT id FROM supply_batches WHERE supply_id = ?)
           AND date(sr.date) < ?), 0), 0) as stock
       FROM supply_batches WHERE supply_id = ? AND date(received_at) < ?`,
      [supplyId, dayjs().subtract(parseInt(days) - 1, 'day').format('YYYY-MM-DD'),
       supplyId, dayjs().subtract(parseInt(days) - 1, 'day').format('YYYY-MM-DD')]
    );
    const txs = await allAsync(
      `SELECT date, type, qty FROM (
         SELECT date(sr.date) as date, 'out' as type, SUM(sr.quantity) as qty
         FROM supply_requisitions sr WHERE sr.department_id = ? AND sr.supply_id = ? GROUP BY date(sr.date)
         UNION ALL
         SELECT date(sb.received_at) as date, 'in' as type, SUM(sb.quantity) as qty
         FROM supply_batches sb WHERE sb.supply_id = ? GROUP BY date(sb.received_at)
       ) WHERE date >= ? ORDER BY date ASC`,
      [id, supplyId, supplyId, dayjs().subtract(parseInt(days) - 1, 'day').format('YYYY-MM-DD')]
    );
    const dates = [];
    const stocks = [];
    let runningStock = initialStock ? initialStock.stock || 0 : 0;
    const txMap = {};
    txs.forEach(t => {
      if (!txMap[t.date]) txMap[t.date] = { in: 0, out: 0 };
      if (t.type === 'in') txMap[t.date].in += t.qty;
      else txMap[t.date].out += t.qty;
    });
    for (let i = 0; i < parseInt(days); i++) {
      const d = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
      dates.unshift(d);
    }
    for (const d of dates) {
      if (txMap[d]) runningStock = runningStock + txMap[d].in - txMap[d].out;
      stocks.push(Math.max(0, runningStock));
    }
    res.json({ dates, stocks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments/:id/supply-warnings', async (req, res) => {
  const { id } = req.params;
  try {
    await markExpiredBatches();
    await checkAndCreateWarnings(parseInt(id));
    const rows = await allAsync(
      `SELECT sw.*, ms.name as supply_name, ms.spec, ms.unit, ms.safety_threshold
       FROM supply_warnings sw
       JOIN medical_supplies ms ON ms.id = sw.supply_id
       WHERE sw.department_id = ? AND sw.is_resolved = 0
       ORDER BY sw.created_at DESC`,
      [id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/departments/:id/supply-monthly-statistics', async (req, res) => {
  const { id } = req.params;
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: '请提供月份参数' });
  try {
    const [year, monthNum] = month.split('-').map(Number);
    const daysInMonth = dayjs(`${year}-${String(monthNum).padStart(2, '0')}-01`).daysInMonth();

    const usageStats = await allAsync(
      `SELECT supply_id, SUM(quantity) as total_used
       FROM supply_requisitions
       WHERE department_id = ? AND date LIKE ?
       GROUP BY supply_id`,
      [id, month + '%']
    );
    const usageMap = {};
    usageStats.forEach(u => { usageMap[u.supply_id] = u.total_used; });

    const supplies = await allAsync(
      `SELECT ms.*,
              COALESCE(SUM(CASE WHEN sb.is_expired = 0 THEN sb.remaining ELSE 0 END), 0) as current_stock
       FROM medical_supplies ms
       LEFT JOIN supply_batches sb ON sb.supply_id = ms.id
       WHERE ms.department_id = ?
       GROUP BY ms.id`,
      [id]
    );

    const result = supplies.map(s => {
      const totalUsed = usageMap[s.id] || 0;
      const avgDaily = Math.round((totalUsed / daysInMonth) * 100) / 100;
      return {
        supply_id: s.id,
        supply_name: s.name,
        supply_spec: s.spec,
        unit: s.unit,
        safety_threshold: s.safety_threshold,
        total_used: totalUsed,
        avg_daily: avgDaily,
        current_stock: s.current_stock,
        is_low_stock: s.current_stock < s.safety_threshold,
        warning_status: s.current_stock < s.safety_threshold
          ? (s.current_stock === 0 ? '缺货' : '库存不足')
          : '正常'
      };
    });
    res.json({
      month,
      days_in_month: daysInMonth,
      supplies: result.sort((a, b) => b.total_used - a.total_used)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/supplies/:id/flow', async (req, res) => {
  const { id } = req.params;
  const { limit = 100 } = req.query;
  try {
    const inFlow = await allAsync(
      `SELECT 'in' as type, id, received_at as time, batch_no, expiry_date, quantity as qty, operator_id,
              (SELECT name FROM nurses WHERE id = operator_id) as operator_name
       FROM supply_batches WHERE supply_id = ?
       UNION ALL
       SELECT 'out' as type, sr.id, sr.requisition_time as time, sr.shift as batch_no, NULL as expiry_date, sr.quantity as qty, sr.nurse_id as operator_id,
              n.name as operator_name
       FROM supply_requisitions sr
       JOIN nurses n ON n.id = sr.nurse_id
       WHERE sr.supply_id = ?
       ORDER BY time DESC LIMIT ?`,
      [id, id, parseInt(limit)]
    );
    res.json(inFlow);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
