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
  } catch (err) {
    console.error('初始化失败:', err);
    try { await runAsync('ROLLBACK'); } catch (e) { }
  }
}

initDemoData();
