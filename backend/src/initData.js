const db = require('./db');
const { generateSchedule } = require('./scheduler');
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

async function initDemoData() {
  const currentMonth = dayjs().format('YYYY-MM');
  console.log('初始化演示数据...');

  try {
    db.serialize();

    await runAsync('BEGIN TRANSACTION');

    await runAsync('DELETE FROM nurse_skills');
    await runAsync('DELETE FROM shift_skill_requirements');
    await runAsync('DELETE FROM skill_tags');
    await runAsync('DELETE FROM adverse_event_timeline');
    await runAsync('DELETE FROM adverse_events');
    await runAsync('DELETE FROM swap_requests');
    await runAsync('DELETE FROM overtime_requests');
    await runAsync('DELETE FROM leave_requests');
    await runAsync('DELETE FROM schedules');
    await runAsync('DELETE FROM unavailable_dates');
    await runAsync('DELETE FROM training_records');
    await runAsync('DELETE FROM training_courses');
    await runAsync('DELETE FROM training_config');
    await runAsync('DELETE FROM handover_signoffs');
    await runAsync('DELETE FROM handover_items');
    await runAsync('DELETE FROM shift_handovers');
    await runAsync('DELETE FROM supply_warnings');
    await runAsync('DELETE FROM supply_requisition_items');
    await runAsync('DELETE FROM supply_requisitions');
    await runAsync('DELETE FROM supply_batches');
    await runAsync('DELETE FROM medical_supplies');
    await runAsync('DELETE FROM care_path_warnings');
    await runAsync('DELETE FROM care_path_operation_executions');
    await runAsync('DELETE FROM care_path_stage_executions');
    await runAsync('DELETE FROM patient_care_paths');
    await runAsync('DELETE FROM care_path_operations');
    await runAsync('DELETE FROM care_path_stages');
    await runAsync('DELETE FROM care_path_templates');
    await runAsync('DELETE FROM nurses');
    await runAsync('DELETE FROM departments');

    const deptResult = await runAsync("INSERT INTO departments (name) VALUES ('内科')");
    const deptId = deptResult.lastID;

    const nurseData = [
      { name: '张主任', level: 'senior', hire_date: '2010-03-15' },
      { name: '李护士长', level: 'senior', hire_date: '2013-07-01' },
      { name: '王护士', level: 'junior', hire_date: '2020-09-10' },
      { name: '赵护士', level: 'junior', hire_date: '2022-04-20' },
      { name: '陈护士', level: 'junior', hire_date: '2024-01-15' },
      { name: '刘护士', level: 'junior', hire_date: '2025-06-01' }
    ];

    const nurseIds = [];
    for (const nurse of nurseData) {
      const result = await runAsync('INSERT INTO nurses (name, department_id, level, hire_date) VALUES (?, ?, ?, ?)', [nurse.name, deptId, nurse.level, nurse.hire_date]);
      nurseIds.push({ id: result.lastID, name: nurse.name, level: nurse.level, hire_date: nurse.hire_date });
    }

    const unavailableDates = [
      { nurse_id: nurseIds[2].id, date: dayjs().date(5).format('YYYY-MM-DD') },
      { nurse_id: nurseIds[3].id, date: dayjs().date(15).format('YYYY-MM-DD') }
    ];
    for (const ud of unavailableDates) {
      await runAsync('INSERT INTO unavailable_dates (nurse_id, date) VALUES (?, ?)', [ud.nurse_id, ud.date]);
    }

    const scheduleResult = generateSchedule(deptId, nurseIds, currentMonth, unavailableDates);
    if (!scheduleResult.success) {
      console.error('生成排班失败:', scheduleResult.reason);
      await runAsync('ROLLBACK');
      return;
    }

    for (const s of scheduleResult.schedule) {
      await runAsync('INSERT INTO schedules (department_id, nurse_id, date, shift, month) VALUES (?, ?, ?, ?, ?)', [s.department_id, s.nurse_id, s.date, s.shift, s.month]);
    }

    const skillNames = ['ICU', '心电监护', '静脉穿刺', '呼吸机操作', '急救技能'];
    const skillIds = [];
    for (const skillName of skillNames) {
      const result = await runAsync('INSERT INTO skill_tags (department_id, name) VALUES (?, ?)', [deptId, skillName]);
      skillIds.push({ id: result.lastID, name: skillName });
    }

    const nurseSkillData = [
      { nurseIdx: 0, skillIdxs: [0, 1, 2, 3, 4] },
      { nurseIdx: 1, skillIdxs: [0, 1, 2, 3, 4] },
      { nurseIdx: 2, skillIdxs: [1, 2, 4] },
      { nurseIdx: 3, skillIdxs: [2] },
      { nurseIdx: 4, skillIdxs: [1, 2] },
      { nurseIdx: 5, skillIdxs: [2, 4] }
    ];
    for (const ns of nurseSkillData) {
      for (const skillIdx of ns.skillIdxs) {
        await runAsync('INSERT INTO nurse_skills (nurse_id, skill_id) VALUES (?, ?)', [nurseIds[ns.nurseIdx].id, skillIds[skillIdx].id]);
      }
    }

    const shiftReqData = [
      { shift: 'night', skillIdxs: [3] },
      { shift: 'night', skillIdxs: [0] },
      { shift: 'morning', skillIdxs: [2] },
      { shift: 'afternoon', skillIdxs: [1] }
    ];
    for (const sr of shiftReqData) {
      for (const skillIdx of sr.skillIdxs) {
        await runAsync('INSERT INTO shift_skill_requirements (department_id, shift, skill_id) VALUES (?, ?, ?)', [deptId, sr.shift, skillIds[skillIdx].id]);
      }
    }

    const currentYear = dayjs().format('YYYY');
    const courses = [
      { name: '基础护理操作规范', type: 'skill', hours: 8, assessment_method: 'practical', pass_score: 70, is_mandatory: 1, instructor: '张主任' },
      { name: '院内感染防控', type: 'theory', hours: 6, assessment_method: 'written', pass_score: 60, is_mandatory: 1, instructor: '李护士长' },
      { name: '急救技能培训', type: 'comprehensive', hours: 10, assessment_method: 'mixed', pass_score: 80, is_mandatory: 1, instructor: '张主任' },
      { name: '护理文书书写', type: 'theory', hours: 4, assessment_method: 'written', pass_score: 60, is_mandatory: 0, instructor: '李护士长' },
      { name: '患者沟通技巧', type: 'skill', hours: 4, assessment_method: 'practical', pass_score: 65, is_mandatory: 0, instructor: '李护士长' },
      { name: '药物安全管理', type: 'theory', hours: 6, assessment_method: 'written', pass_score: 60, is_mandatory: 0, instructor: '张主任' }
    ];

    await runAsync('INSERT OR REPLACE INTO training_config (department_id, year, annual_target_hours) VALUES (?, ?, ?)', [deptId, currentYear, 40]);

    await runAsync('INSERT OR REPLACE INTO leave_quota_config (department_id, year, sick_days, personal_days) VALUES (?, ?, ?, ?)', [deptId, currentYear, 15, 5]);

    const courseIds = [];
    for (const course of courses) {
      const result = await runAsync(
        'INSERT INTO training_courses (department_id, name, type, hours, assessment_method, pass_score, is_mandatory, instructor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [deptId, course.name, course.type, course.hours, course.assessment_method, course.pass_score, course.is_mandatory, course.instructor]
      );
      courseIds.push({ id: result.lastID, ...course });
    }

    const recordData = [
      { nurseIdx: 0, courseIdx: 0, score: 88 },
      { nurseIdx: 0, courseIdx: 1, score: 75 },
      { nurseIdx: 0, courseIdx: 2, score: 92 },
      { nurseIdx: 0, courseIdx: 3, score: 82 },
      { nurseIdx: 0, courseIdx: 4, score: 78 },
      { nurseIdx: 1, courseIdx: 0, score: 85 },
      { nurseIdx: 1, courseIdx: 1, score: 90 },
      { nurseIdx: 1, courseIdx: 2, score: 88 },
      { nurseIdx: 1, courseIdx: 3, score: 70 },
      { nurseIdx: 1, courseIdx: 5, score: 80 },
      { nurseIdx: 2, courseIdx: 0, score: 72 },
      { nurseIdx: 2, courseIdx: 1, score: 55 },
      { nurseIdx: 2, courseIdx: 3, score: 65 },
      { nurseIdx: 3, courseIdx: 0, score: 68 },
      { nurseIdx: 3, courseIdx: 1, score: 62 },
      { nurseIdx: 3, courseIdx: 2, score: 75 },
      { nurseIdx: 4, courseIdx: 1, score: 58 },
      { nurseIdx: 4, courseIdx: 4, score: 70 },
      { nurseIdx: 4, courseIdx: 5, score: 73 }
    ];

    for (const rd of recordData) {
      const courseId = courseIds[rd.courseIdx].id;
      const nurseId = nurseIds[rd.nurseIdx].id;
      const passed = rd.score >= courseIds[rd.courseIdx].pass_score ? 1 : 0;
      const trainingDate = dayjs().month(Math.floor(Math.random() * 6)).date(Math.floor(Math.random() * 28) + 1).format('YYYY-MM-DD');
      await runAsync(
        'INSERT INTO training_records (course_id, nurse_id, training_date, score, passed) VALUES (?, ?, ?, ?, ?)',
        [courseId, nurseId, trainingDate, rd.score, passed]
      );
    }

    const today = dayjs().format('YYYY-MM-DD');
    const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
    const twoDaysAgo = dayjs().subtract(2, 'day').format('YYYY-MM-DD');
    const threeDaysAgo = dayjs().subtract(3, 'day').format('YYYY-MM-DD');
    const fiveDaysAgo = dayjs().subtract(5, 'day').format('YYYY-MM-DD');
    const tenDaysAgo = dayjs().subtract(10, 'day').format('YYYY-MM-DD');
    const fifteenDaysAgo = dayjs().subtract(15, 'day').format('YYYY-MM-DD');

    const demoEvents = [
      { reporterIdx: 2, event_type: 'medication_error', event_time: `${today} 09:30`, patient_bed: '12床', severity: 2, description: '早班给3床患者发药时将阿莫西林误发给12床患者，患者已服用，未出现不良反应', status: 'pending', rectification_days: null, rectification_deadline: null, rectification_report: null, is_overdue: 0 },
      { reporterIdx: 3, event_type: 'fall', event_time: `${yesterday} 22:15`, patient_bed: '8床', severity: 3, description: '夜班巡房时发现8床老年患者自行下床如厕时跌倒，右侧髋部疼痛，已通知医生处理', status: 'processing', rectification_days: 7, rectification_deadline: dayjs().add(6, 'day').format('YYYY-MM-DD'), rectification_report: null, is_overdue: 0 },
      { reporterIdx: 4, event_type: 'pressure_ulcer', event_time: `${twoDaysAgo} 14:00`, patient_bed: '5床', severity: 2, description: '交接班时发现5床长期卧床患者骶尾部出现II期压疮，面积约3cm×4cm', status: 'reviewing', rectification_days: 5, rectification_deadline: dayjs().add(3, 'day').format('YYYY-MM-DD'), rectification_report: '已制定翻身计划，每2小时翻身一次，使用防压疮气垫床，加强营养支持，已培训当班护士压疮护理规范', is_overdue: 0 },
      { reporterIdx: 2, event_type: 'infection', event_time: `${fiveDaysAgo} 10:00`, patient_bed: '3床', severity: 1, description: '3床术后伤口出现红肿渗液，送检培养结果为金葡菌感染', status: 'closed', rectification_days: 3, rectification_deadline: dayjs().subtract(2, 'day').format('YYYY-MM-DD'), rectification_report: '已加强手卫生管理，规范换药操作流程，每日观察伤口情况并记录，感染已控制', is_overdue: 0 },
      { reporterIdx: 5, event_type: 'medication_error', event_time: `${tenDaysAgo} 16:30`, patient_bed: '7床', severity: 1, description: '中班给7床患者发药时剂量多给一片，及时发现并纠正，未造成影响', status: 'closed', rectification_days: 5, rectification_deadline: dayjs().subtract(5, 'day').format('YYYY-MM-DD'), rectification_report: '已重新培训给药核对流程，增加双人核对环节，更新给药操作SOP', is_overdue: 0 },
      { reporterIdx: 3, event_type: 'fall', event_time: `${fifteenDaysAgo} 06:45`, patient_bed: '15床', severity: 4, description: '早班交接时发现15床患者自行翻越床栏坠床，头部着地，已紧急处理并转ICU观察', status: 'processing', rectification_days: 3, rectification_deadline: dayjs().subtract(12, 'day').format('YYYY-MM-DD'), rectification_report: null, is_overdue: 1 },
      { reporterIdx: 4, event_type: 'other', event_time: `${fiveDaysAgo} 11:00`, patient_bed: '20床', severity: 1, description: '20床患者家属投诉护士态度冷漠，沟通不畅', status: 'reviewing', rectification_days: 3, rectification_deadline: dayjs().subtract(2, 'day').format('YYYY-MM-DD'), rectification_report: '已组织科室沟通培训，当班护士已向家属致歉并改进服务态度，建立患者满意度反馈机制', is_overdue: 1 },
      { reporterIdx: 2, event_type: 'pressure_ulcer', event_time: `${threeDaysAgo} 08:00`, patient_bed: '11床', severity: 3, description: '11床偏瘫患者足跟出现III期压疮，面积约2cm×3cm，有坏死组织', status: 'pending', rectification_days: null, rectification_deadline: null, rectification_report: null, is_overdue: 0 }
    ];

    const eventIds = [];
    for (const de of demoEvents) {
      const reporterId = nurseIds[de.reporterIdx].id;
      const actualRespId = de.status !== 'pending' ? nurseIds[1].id : null;
      const eventDate = de.event_time.substring(0, 10);
      const scheduleRow = await getAsync('SELECT id FROM schedules WHERE nurse_id = ? AND date = ?', [reporterId, eventDate]);
      const result = await runAsync(
        'INSERT INTO adverse_events (department_id, reporter_id, event_type, event_time, patient_bed, severity, description, status, schedule_id, responsible_nurse_id, rectification_days, rectification_deadline, rectification_report, is_overdue) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [deptId, reporterId, de.event_type, de.event_time, de.patient_bed, de.severity, de.description, de.status, scheduleRow ? scheduleRow.id : null, actualRespId, de.rectification_days, de.rectification_deadline, de.rectification_report, de.is_overdue]
      );
      eventIds.push(result.lastID);
    }

    const timelineData = [];
    demoEvents.forEach((de, idx) => {
      const eid = eventIds[idx];
      const rName = nurseIds[de.reporterIdx].name;
      timelineData.push({ event_id: eid, action: '创建事件', from_status: null, to_status: 'pending', operator_id: nurseIds[de.reporterIdx].id, operator_name: rName, remark: '事件上报' });
      if (de.status !== 'pending') {
        timelineData.push({ event_id: eid, action: '审核通过，进入处理中', from_status: 'pending', to_status: 'processing', operator_id: nurseIds[0].id, operator_name: nurseIds[0].name, remark: `责任人: ${nurseIds[1].name}, 整改期限: ${de.rectification_deadline}(${de.rectification_days}天)` });
      }
      if (de.status === 'reviewing' || de.status === 'closed') {
        timelineData.push({ event_id: eid, action: '提交整改报告，待验收', from_status: 'processing', to_status: 'reviewing', operator_id: nurseIds[1].id, operator_name: nurseIds[1].name, remark: null });
      }
      if (de.status === 'closed') {
        timelineData.push({ event_id: eid, action: '验收通过，事件关闭', from_status: 'reviewing', to_status: 'closed', operator_id: nurseIds[0].id, operator_name: nurseIds[0].name, remark: null });
      }
      if (de.is_overdue === 1 && de.status !== 'closed') {
        timelineData.push({ event_id: eid, action: '系统标记为逾期', from_status: de.status, to_status: de.status, operator_id: null, operator_name: '系统', remark: '超过整改期限未关闭' });
      }
    });

    for (const td of timelineData) {
      await runAsync(
        'INSERT INTO adverse_event_timeline (event_id, action, from_status, to_status, operator_id, operator_name, remark) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [td.event_id, td.action, td.from_status, td.to_status, td.operator_id, td.operator_name, td.remark]
      );
    }

    await runAsync('DELETE FROM handover_signoffs');
    await runAsync('DELETE FROM handover_items');
    await runAsync('DELETE FROM shift_handovers');

    const allSchedules = await allAsync('SELECT * FROM schedules ORDER BY date, shift');
    const scheduleByDateShift = {};
    allSchedules.forEach(s => {
      const key = `${s.date}_${s.shift}`;
      if (!scheduleByDateShift[key]) scheduleByDateShift[key] = [];
      scheduleByDateShift[key].push(s);
    });

    const shiftSequence = [
      { from: 'morning', to: 'afternoon' },
      { from: 'afternoon', to: 'night' }
    ];

    const demoHandoverConfigs = [];
    const handoverDates = [];

    const dateSet = [...new Set(allSchedules.map(s => s.date))].sort();
    for (let i = 0; i < Math.min(dateSet.length, 10); i++) {
      handoverDates.push(dateSet[i]);
    }

    for (const date of handoverDates) {
      for (const seq of shiftSequence) {
        const fromKey = `${date}_${seq.from}`;
        const toKey = `${date}_${seq.to}`;
        const fromNurses = scheduleByDateShift[fromKey] || [];
        const toNurses = scheduleByDateShift[toKey] || [];
        if (fromNurses.length > 0 && toNurses.length > 0) {
          demoHandoverConfigs.push({
            date,
            shift_type: seq.from,
            from_nurse_id: fromNurses[0].nurse_id,
            to_nurse_id: toNurses[0].nurse_id
          });
        }
      }
    }

    const demoHandoverData = [];
    for (let i = 0; i < Math.min(demoHandoverConfigs.length, 8); i++) {
      const cfg = demoHandoverConfigs[i];
      const baseTime = dayjs(cfg.date).hour(cfg.shift_type === 'morning' ? 7 : cfg.shift_type === 'afternoon' ? 15 : 23).minute(30);

      let status, items, fromSignedAt, toSignedAt, headNurseId, headNurseRemark, headNurseConfirmedAt;

      if (i < 4) {
        status = 'completed';
        items = generateDemoItems(i);
        fromSignedAt = baseTime.format('YYYY-MM-DD HH:mm:ss');
        toSignedAt = baseTime.add(15 + i * 5, 'minute').format('YYYY-MM-DD HH:mm:ss');
        headNurseId = null;
        headNurseRemark = null;
        headNurseConfirmedAt = null;
      } else if (i === 4) {
        status = 'completed';
        items = generateDemoItems(4, true);
        fromSignedAt = baseTime.format('YYYY-MM-DD HH:mm:ss');
        toSignedAt = baseTime.add(25, 'minute').format('YYYY-MM-DD HH:mm:ss');
        headNurseId = nurseIds[0].id;
        headNurseRemark = '已确认，相关疑问已跟进处理';
        headNurseConfirmedAt = baseTime.add(40, 'minute').format('YYYY-MM-DD HH:mm:ss');
      } else if (i === 5) {
        status = 'disputed';
        items = generateDemoItems(5, true);
        fromSignedAt = baseTime.format('YYYY-MM-DD HH:mm:ss');
        toSignedAt = null;
        headNurseId = null;
        headNurseRemark = null;
        headNurseConfirmedAt = null;
      } else {
        status = 'pending_confirm';
        items = generateDemoItems(i);
        fromSignedAt = baseTime.format('YYYY-MM-DD HH:mm:ss');
        toSignedAt = null;
        headNurseId = null;
        headNurseRemark = null;
        headNurseConfirmedAt = null;
      }

      demoHandoverData.push({
        ...cfg,
        status,
        items,
        fromSignedAt,
        toSignedAt,
        headNurseId,
        headNurseRemark,
        headNurseConfirmedAt
      });
    }

    function generateDemoItems(index, hasQuestion = false) {
      const itemSets = [
        [
          { item_type: 'abnormal', description: '3床患者上午9点出现胸闷气短，已通知值班医生，给予吸氧处理后症状缓解，需持续观察', urgency: 3 },
          { item_type: 'key_patient', description: '8床老年患者跌倒风险评估为高危，已采取防护措施，夜间需加强巡视', urgency: 2 },
          { item_type: 'todo', description: '12床患者今日预约CT检查，需提前做好检查前准备和宣教', urgency: 1 }
        ],
        [
          { item_type: 'abnormal', description: '5床患者输液反应，出现寒战发热，已停止输液并报告医生，更换输液管路', urgency: 3 },
          { item_type: 'key_patient', description: '15床术后患者引流管引流液颜色加深，需密切监测引流量和生命体征', urgency: 2 },
          { item_type: 'todo', description: '新入院患者7床需完成入院评估和护理记录', urgency: 2 }
        ],
        [
          { item_type: 'key_patient', description: '11床偏瘫患者足跟压疮换药，每班需检查受压部位皮肤状况', urgency: 2 },
          { item_type: 'abnormal', description: '药房通知降压药缺货，10床和14床患者需联系医生更换替代药品', urgency: 2 },
          { item_type: 'todo', description: '科室急救车物品需补充，已提交请领单', urgency: 1 }
        ],
        [
          { item_type: 'key_patient', description: '2床心衰患者24小时出入量监测，严格控制输液速度和饮水量', urgency: 3 },
          { item_type: 'todo', description: '交接班记录本和护理记录单需签完今日班次', urgency: 1 },
          { item_type: 'abnormal', description: '6床患者家属对治疗费用有疑问，已解释但仍有不满情绪', urgency: 1 }
        ],
        [
          { item_type: 'abnormal', description: '4床患者下午出现过敏反应，全身荨麻疹，已给予抗过敏处理', urgency: 3 },
          { item_type: 'key_patient', description: '9床糖尿病患者空腹血糖持续偏高，需关注饮食控制和胰岛素用量', urgency: 2 },
          { item_type: 'todo', description: '今日下午新转入患者需完成转科交接和护理评估', urgency: 2 }
        ],
        [
          { item_type: 'abnormal', description: '1床患者夜间突发心率不齐，已通知医生处理，心电图已做', urgency: 3 },
          { item_type: 'key_patient', description: '13床重症患者呼吸机参数有调整，需持续监测血氧饱和度', urgency: 3 },
          { item_type: 'todo', description: '夜班期间需完成3名患者的生命体征测量记录', urgency: 1 }
        ],
        [
          { item_type: 'key_patient', description: '18床患者今日手术，术后需密切观察伤口渗血和意识状态', urgency: 2 },
          { item_type: 'todo', description: '明早需空腹抽血的患者有5名，提前准备好采血物品', urgency: 1 },
          { item_type: 'abnormal', description: '16床患者下午请假外出未按时归院，已联系家属', urgency: 2 }
        ],
        [
          { item_type: 'abnormal', description: '走廊消防通道堆放杂物被检查通报，需通知后勤清理', urgency: 1 },
          { item_type: 'key_patient', description: '20床患者情绪低落有轻生倾向，需加强看护和心理疏导', urgency: 3 },
          { item_type: 'todo', description: '科室消毒隔离检查明日进行，需提前整理相关台账', urgency: 2 }
        ]
      ];
      const items = itemSets[index % itemSets.length];
      return items;
    }

    for (const dh of demoHandoverData) {
      const handoverResult = await runAsync(
        'INSERT INTO shift_handovers (department_id, from_nurse_id, to_nurse_id, handover_date, shift_type, status, from_nurse_signed_at, to_nurse_signed_at, head_nurse_id, head_nurse_remark, head_nurse_confirmed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [deptId, dh.from_nurse_id, dh.to_nurse_id, dh.date, dh.shift_type, dh.status, dh.fromSignedAt, dh.toSignedAt, dh.headNurseId, dh.headNurseRemark, dh.headNurseConfirmedAt]
      );
      const handoverId = handoverResult.lastID;

      for (const item of dh.items) {
        const itemResult = await runAsync(
          'INSERT INTO handover_items (handover_id, item_type, description, urgency) VALUES (?, ?, ?, ?)',
          [handoverId, item.item_type, item.description, item.urgency]
        );
        const itemId = itemResult.lastID;

        if (dh.status === 'completed' || dh.status === 'disputed') {
          const baseTime = dayjs(dh.fromSignedAt);
          const signoffMinutes = 5 + Math.floor(Math.random() * 15);
          const signoffAt = baseTime.add(signoffMinutes, 'minute').format('YYYY-MM-DD HH:mm:ss');

          const isQuestionedItem = dh.status === 'disputed' && item.item_type === 'abnormal';
          const isFirstCompletedDisputed = dh.status === 'completed' && dh.headNurseId && item.item_type === 'abnormal';

          await runAsync(
            'INSERT INTO handover_signoffs (item_id, nurse_id, result, remark, signed_at) VALUES (?, ?, ?, ?, ?)',
            [
              itemId,
              dh.to_nurse_id,
              (isQuestionedItem || isFirstCompletedDisputed) ? 'questioned' : 'confirmed',
              (isQuestionedItem || isFirstCompletedDisputed) ? '需进一步确认相关情况' : null,
              signoffAt
            ]
          );
        }
      }
    }

    const supplyData = [
      { name: '一次性注射器', spec: '5ml', unit: '支', safety_threshold: 50, category: 'injection' },
      { name: '一次性注射器', spec: '10ml', unit: '支', safety_threshold: 30, category: 'injection' },
      { name: '无菌纱布', spec: '8cm×8cm', unit: '包', safety_threshold: 80, category: 'dressing' },
      { name: '医用棉签', spec: '10cm', unit: '包', safety_threshold: 100, category: 'dressing' },
      { name: '一次性导尿管', spec: '16号', unit: '根', safety_threshold: 20, category: 'catheter' },
      { name: '一次性胃管', spec: '18号', unit: '根', safety_threshold: 15, category: 'catheter' },
      { name: '医用胶带', spec: '1.25cm×910cm', unit: '卷', safety_threshold: 40, category: 'dressing' },
      { name: '一次性输液器', spec: '带针', unit: '套', safety_threshold: 60, category: 'infusion' },
      { name: '医用口罩', spec: 'N95', unit: '个', safety_threshold: 200, category: 'protection' },
      { name: '一次性手套', spec: 'M号', unit: '副', safety_threshold: 150, category: 'protection' }
    ];
    const supplyIds = [];
    for (const s of supplyData) {
      const result = await runAsync(
        'INSERT INTO medical_supplies (department_id, name, spec, unit, safety_threshold, category) VALUES (?, ?, ?, ?, ?, ?)',
        [deptId, s.name, s.spec, s.unit, s.safety_threshold, s.category]
      );
      supplyIds.push({ id: result.lastID, ...s });
    }

    const todayObj = dayjs();
    const batchData = [
      { supplyIdx: 0, batch_no: 'SYZ20260501', expiry: todayObj.add(8, 'month').format('YYYY-MM-DD'), qty: 120, received: todayObj.subtract(10, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 1 },
      { supplyIdx: 0, batch_no: 'SYZ20260301', expiry: todayObj.add(3, 'month').format('YYYY-MM-DD'), qty: 40, received: todayObj.subtract(45, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 1 },
      { supplyIdx: 1, batch_no: 'SYR20260401', expiry: todayObj.add(10, 'month').format('YYYY-MM-DD'), qty: 80, received: todayObj.subtract(20, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 1 },
      { supplyIdx: 2, batch_no: 'SB20260101', expiry: todayObj.subtract(5, 'day').format('YYYY-MM-DD'), qty: 30, received: todayObj.subtract(90, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 1 },
      { supplyIdx: 2, batch_no: 'SB20260501', expiry: todayObj.add(12, 'month').format('YYYY-MM-DD'), qty: 150, received: todayObj.subtract(5, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 1 },
      { supplyIdx: 3, batch_no: 'MQ20260501', expiry: todayObj.add(18, 'month').format('YYYY-MM-DD'), qty: 300, received: todayObj.subtract(3, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 2 },
      { supplyIdx: 4, batch_no: 'NG20260201', expiry: todayObj.add(2, 'month').format('YYYY-MM-DD'), qty: 25, received: todayObj.subtract(60, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 2 },
      { supplyIdx: 5, batch_no: 'WG20260401', expiry: todayObj.add(9, 'month').format('YYYY-MM-DD'), qty: 45, received: todayObj.subtract(15, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 2 },
      { supplyIdx: 6, batch_no: 'JD20260501', expiry: todayObj.add(24, 'month').format('YYYY-MM-DD'), qty: 90, received: todayObj.subtract(8, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 1 },
      { supplyIdx: 7, batch_no: 'SYQ20260301', expiry: todayObj.add(4, 'month').format('YYYY-MM-DD'), qty: 50, received: todayObj.subtract(50, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 1 },
      { supplyIdx: 8, batch_no: 'KZ20260501', expiry: todayObj.add(14, 'month').format('YYYY-MM-DD'), qty: 500, received: todayObj.subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 2 },
      { supplyIdx: 9, batch_no: 'ST20260401', expiry: todayObj.add(8, 'month').format('YYYY-MM-DD'), qty: 180, received: todayObj.subtract(25, 'day').format('YYYY-MM-DD HH:mm:ss'), op: 2 }
    ];
    const batchIds = [];
    for (const b of batchData) {
      const result = await runAsync(
        'INSERT INTO supply_batches (supply_id, batch_no, expiry_date, quantity, remaining, received_at, operator_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [supplyIds[b.supplyIdx].id, b.batch_no, b.expiry, b.qty, b.qty, b.received, nurseIds[b.op - 1].id]
      );
      batchIds.push({ id: result.lastID, ...b });
    }

    const allSchedulesForSupplies = await allAsync('SELECT * FROM schedules ORDER BY date, shift');
    const scheduleByDateNurse = {};
    allSchedulesForSupplies.forEach(s => {
      const key = `${s.date}_${s.nurse_id}`;
      scheduleByDateNurse[key] = s;
    });

    const requisitionData = [];
    for (let i = 0; i < 60; i++) {
      const daysAgo = Math.floor(Math.random() * 20);
      const reqDate = todayObj.subtract(daysAgo, 'day');
      const reqDateStr = reqDate.format('YYYY-MM-DD');
      const nurseIdx = 2 + Math.floor(Math.random() * 4);
      const supplyIdx = Math.floor(Math.random() * supplyIds.length);
      const qty = 1 + Math.floor(Math.random() * 10);
      const schedKey = `${reqDateStr}_${nurseIds[nurseIdx].id}`;
      const sched = scheduleByDateNurse[schedKey] || null;

      requisitionData.push({
        department_id: deptId,
        supply_id: supplyIds[supplyIdx].id,
        nurse_id: nurseIds[nurseIdx].id,
        quantity: qty,
        requisition_time: reqDate.hour(8 + Math.floor(Math.random() * 12)).minute(Math.floor(Math.random() * 60)).format('YYYY-MM-DD HH:mm:ss'),
        schedule_id: sched ? sched.id : null,
        shift: sched ? sched.shift : (['morning', 'afternoon', 'night'][Math.floor(Math.random() * 3)]),
        date: reqDateStr,
        remark: null
      });
    }

    const batchRemaining = {};
    batchIds.forEach(b => { batchRemaining[b.id] = b.qty; });

    for (const req of requisitionData) {
      const validBatches = batchIds
        .filter(b => b.supplyIdx === supplyIds.findIndex(s => s.id === req.supply_id))
        .map(b => ({
          ...b,
          is_expired: dayjs(b.expiry).isBefore(todayObj.format('YYYY-MM-DD')) ? 1 : 0
        }))
        .filter(b => !b.is_expired && batchRemaining[b.id] > 0)
        .sort((a, b) => dayjs(a.expiry).valueOf() - dayjs(b.expiry).valueOf());

      let needed = req.quantity;
      const usedBatches = [];
      for (const vb of validBatches) {
        if (needed <= 0) break;
        const take = Math.min(batchRemaining[vb.id], needed);
        if (take > 0) {
          usedBatches.push({ batch_id: vb.id, qty: take });
          batchRemaining[vb.id] -= take;
          needed -= take;
        }
      }
      if (needed > 0) continue;

      const reqResult = await runAsync(
        'INSERT INTO supply_requisitions (department_id, supply_id, nurse_id, quantity, requisition_time, schedule_id, shift, date, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [req.department_id, req.supply_id, req.nurse_id, req.quantity, req.requisition_time, req.schedule_id, req.shift, req.date, req.remark]
      );
      for (const ub of usedBatches) {
        await runAsync(
          'INSERT INTO supply_requisition_items (requisition_id, batch_id, quantity) VALUES (?, ?, ?)',
          [reqResult.lastID, ub.batch_id, ub.qty]
        );
        await runAsync(
          'UPDATE supply_batches SET remaining = remaining - ? WHERE id = ?',
          [ub.qty, ub.batch_id]
        );
      }
    }

    for (const bid of Object.keys(batchRemaining)) {
      const batch = batchIds.find(b => b.id === parseInt(bid));
      if (batch && dayjs(batch.expiry).isBefore(todayObj.format('YYYY-MM-DD'))) {
        await runAsync('UPDATE supply_batches SET is_expired = 1 WHERE id = ?', [bid]);
      }
    }

    const pathTemplates = [
      {
        name: '术后恢复护理路径',
        applicable_disease: '术后恢复',
        stages: [
          {
            name: '术后监护期',
            duration_hours: 6,
            operations: [
              { name: '生命体征监测（每15分钟）', is_critical: 1 },
              { name: '伤口渗血观察', is_critical: 1 },
              { name: '引流管护理', is_critical: 0 },
              { name: '疼痛评估', is_critical: 0 }
            ]
          },
          {
            name: '术后恢复期',
            duration_hours: 24,
            operations: [
              { name: '生命体征监测（每1小时）', is_critical: 1 },
              { name: '协助翻身拍背', is_critical: 1 },
              { name: '饮食指导', is_critical: 0 },
              { name: '早期活动指导', is_critical: 0 },
              { name: '输液观察', is_critical: 1 }
            ]
          },
          {
            name: '出院准备期',
            duration_hours: 12,
            operations: [
              { name: '出院健康宣教', is_critical: 1 },
              { name: '伤口换药', is_critical: 0 },
              { name: '用药指导', is_critical: 1 },
              { name: '复诊预约', is_critical: 0 }
            ]
          }
        ]
      },
      {
        name: '脑卒中护理路径',
        applicable_disease: '脑卒中',
        stages: [
          {
            name: '急性期（24h内）',
            duration_hours: 24,
            operations: [
              { name: '意识瞳孔评估（每15分钟）', is_critical: 1 },
              { name: '生命体征监测', is_critical: 1 },
              { name: '肢体活动度评估', is_critical: 1 },
              { name: '气道管理', is_critical: 1 },
              { name: '血糖监测', is_critical: 0 }
            ]
          },
          {
            name: '稳定期（1-7天）',
            duration_hours: 72,
            operations: [
              { name: '神经功能评估（每班）', is_critical: 1 },
              { name: '压疮预防护理', is_critical: 1 },
              { name: '早期康复训练', is_critical: 0 },
              { name: '吞咽功能评估', is_critical: 1 },
              { name: '心理护理', is_critical: 0 }
            ]
          },
          {
            name: '康复期',
            duration_hours: 96,
            operations: [
              { name: '肢体功能锻炼指导', is_critical: 1 },
              { name: '日常生活能力训练', is_critical: 0 },
              { name: '二级预防宣教', is_critical: 1 },
              { name: '出院评估', is_critical: 1 }
            ]
          }
        ]
      }
    ];

    const templateIds = [];
    for (const tpl of pathTemplates) {
      const tplResult = await runAsync(
        'INSERT INTO care_path_templates (name, department_id, applicable_disease) VALUES (?, ?, ?)',
        [tpl.name, deptId, tpl.applicable_disease]
      );
      const tplId = tplResult.lastID;
      const stageIds = [];

      for (let sIdx = 0; sIdx < tpl.stages.length; sIdx++) {
        const stage = tpl.stages[sIdx];
        const stageResult = await runAsync(
          'INSERT INTO care_path_stages (template_id, stage_order, name, duration_hours) VALUES (?, ?, ?, ?)',
          [tplId, sIdx, stage.name, stage.duration_hours]
        );
        const stageId = stageResult.lastID;
        stageIds.push({ id: stageId, duration_hours: stage.duration_hours, operations: stage.operations });

        for (let oIdx = 0; oIdx < stage.operations.length; oIdx++) {
          const op = stage.operations[oIdx];
          await runAsync(
            'INSERT INTO care_path_operations (stage_id, operation_order, name, is_critical) VALUES (?, ?, ?, ?)',
            [stageId, oIdx, op.name, op.is_critical]
          );
        }
      }
      templateIds.push({ id: tplId, stageIds, name: tpl.name });
    }

    const demoPatients = [
      {
        patient_bed: '3床',
        patient_name: '王建国',
        template_idx: 0,
        hours_ago: 8,
        progress: 'in_progress'
      },
      {
        patient_bed: '7床',
        patient_name: '李秀英',
        template_idx: 1,
        hours_ago: 30,
        progress: 'overdue'
      },
      {
        patient_bed: '12床',
        patient_name: '张桂兰',
        template_idx: 0,
        hours_ago: 60,
        progress: 'completed'
      }
    ];

    for (const patient of demoPatients) {
      const tpl = templateIds[patient.template_idx];
      const startTime = dayjs().subtract(patient.hours_ago, 'hour');

      const pathResult = await runAsync(
        `INSERT INTO patient_care_paths (template_id, department_id, patient_bed, patient_name, status, current_stage_index, start_time)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tpl.id, deptId, patient.patient_bed, patient.patient_name,
         patient.progress === 'completed' ? 'completed' : 'active',
         patient.progress === 'completed' ? tpl.stageIds.length : (patient.progress === 'overdue' ? 0 : 0),
         startTime.format('YYYY-MM-DD HH:mm:ss')]
      );
      const patientPathId = pathResult.lastID;

      let cumulativeHours = 0;
      for (let sIdx = 0; sIdx < tpl.stageIds.length; sIdx++) {
        const stage = tpl.stageIds[sIdx];
        cumulativeHours += stage.duration_hours;
        const deadlineTime = startTime.add(cumulativeHours, 'hour');

        let stageStatus, actualStart, actualEnd;
        if (patient.progress === 'completed') {
          stageStatus = 'completed';
          actualStart = startTime.add(cumulativeHours - stage.duration_hours, 'hour').format('YYYY-MM-DD HH:mm:ss');
          actualEnd = startTime.add(cumulativeHours - stage.duration_hours / 2, 'hour').format('YYYY-MM-DD HH:mm:ss');
        } else if (sIdx === 0) {
          stageStatus = 'in_progress';
          actualStart = startTime.format('YYYY-MM-DD HH:mm:ss');
          actualEnd = null;
        } else {
          stageStatus = 'pending';
          actualStart = null;
          actualEnd = null;
        }

        const stageExecResult = await runAsync(
          `INSERT INTO care_path_stage_executions (patient_path_id, stage_id, stage_index, deadline_time, actual_start_time, actual_end_time, status)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [patientPathId, stage.id, sIdx, deadlineTime.format('YYYY-MM-DD HH:mm:ss'), actualStart, actualEnd, stageStatus]
        );
        const stageExecId = stageExecResult.lastID;

        for (let oIdx = 0; oIdx < stage.operations.length; oIdx++) {
          const opInfo = stage.operations[oIdx];

          let opStatus, signedBy, signedByName, signedAt;
          if (patient.progress === 'completed') {
            opStatus = 'completed';
            signedBy = nurseIds[2].id;
            signedByName = nurseIds[2].name;
            signedAt = startTime.add(cumulativeHours - stage.duration_hours / 2, 'hour').format('YYYY-MM-DD HH:mm:ss');
          } else if (patient.progress === 'overdue' && sIdx === 0 && oIdx >= 2) {
            opStatus = 'pending';
            signedBy = null;
            signedByName = null;
            signedAt = null;
          } else if (sIdx === 0 && oIdx < (patient.progress === 'in_progress' ? 2 : 2)) {
            opStatus = 'completed';
            signedBy = nurseIds[3].id;
            signedByName = nurseIds[3].name;
            signedAt = startTime.add(oIdx * 0.5, 'hour').format('YYYY-MM-DD HH:mm:ss');
          } else {
            opStatus = 'pending';
            signedBy = null;
            signedByName = null;
            signedAt = null;
          }

          const opExecResult = await runAsync(
            `INSERT INTO care_path_operation_executions (stage_execution_id, operation_id, status, signed_by, signed_by_name, signed_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [stageExecId, await getAsync('SELECT id FROM care_path_operations WHERE stage_id = ? AND operation_order = ?', [stage.id, oIdx]).then(r => r.id),
             opStatus, signedBy, signedByName, signedAt]
          );
          const opExecId = opExecResult.lastID;

          if (patient.progress === 'overdue' && sIdx === 0 && opInfo.is_critical && opStatus === 'pending') {
            const overdueMinutes = dayjs().diff(deadlineTime, 'minute');
            await runAsync(
              `INSERT INTO care_path_warnings (patient_path_id, department_id, operation_execution_id, patient_bed, operation_name, overdue_minutes)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [patientPathId, deptId, opExecId, patient.patient_bed, opInfo.name, Math.max(overdueMinutes, 60)]
            );
          }
        }
      }

      if (patient.progress === 'completed') {
        await runAsync(
          'UPDATE patient_care_paths SET completed_time = ? WHERE id = ?',
          [startTime.add(patient.hours_ago - 5, 'hour').format('YYYY-MM-DD HH:mm:ss'), patientPathId]
        );
      }
    }

    console.log(`护理路径模板数: ${pathTemplates.length}`);
    console.log(`患者路径数: ${demoPatients.length} (进行中/有超时/已完结)`);

    await runAsync('COMMIT');

    console.log('演示数据初始化成功!');
    console.log(`科室: 内科 (ID: ${deptId})`);
    console.log(`护士人数: ${nurseData.length} (2名senior, 4名junior)`);
    console.log(`月份: ${currentMonth}`);
    console.log(`排班记录数: ${scheduleResult.schedule.length}`);
    console.log(`技能标签数: ${skillNames.length}`);
    console.log(`培训课程数: ${courses.length}`);
    console.log(`培训记录数: ${recordData.length}`);
    console.log(`不良事件数: ${demoEvents.length}`);
    console.log(`交接班记录数: ${demoHandoverData.length}`);
    console.log(`耗材种类数: ${supplyData.length}`);
    console.log(`耗材入库批次: ${batchData.length}`);
    console.log(`耗材领用记录数: 约60条`);
  } catch (err) {
    console.error('初始化失败:', err);
    try { await runAsync('ROLLBACK'); } catch (e) { }
  }
}

initDemoData();
