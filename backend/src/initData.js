const db = require('./db');
const { generateSchedule } = require('./scheduler');
const dayjs = require('dayjs');

function initDemoData() {
  const currentMonth = dayjs().format('YYYY-MM');
  
  console.log('初始化演示数据...');

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run('DELETE FROM adverse_event_timeline');
    db.run('DELETE FROM adverse_events');
    db.run('DELETE FROM swap_requests');
    db.run('DELETE FROM overtime_requests');
    db.run('DELETE FROM leave_requests');
    db.run('DELETE FROM schedules');
    db.run('DELETE FROM unavailable_dates');
    db.run('DELETE FROM training_records');
    db.run('DELETE FROM training_courses');
    db.run('DELETE FROM training_config');
    db.run('DELETE FROM nurses');
    db.run('DELETE FROM departments');

    db.run("INSERT INTO departments (name) VALUES ('内科')", function(err) {
      if (err) {
        console.error('创建科室失败:', err);
        db.run('ROLLBACK');
        return;
      }
      const deptId = this.lastID;

      const nurses = [
        { name: '张主任', level: 'senior' },
        { name: '李护士长', level: 'senior' },
        { name: '王护士', level: 'junior' },
        { name: '赵护士', level: 'junior' },
        { name: '陈护士', level: 'junior' },
        { name: '刘护士', level: 'junior' }
      ];

      const nurseIds = [];
      let completed = 0;

      nurses.forEach(nurse => {
        db.run('INSERT INTO nurses (name, department_id, level) VALUES (?, ?, ?)', 
          [nurse.name, deptId, nurse.level], function(err) {
          if (err) {
            console.error('创建护士失败:', err);
            db.run('ROLLBACK');
            return;
          }
          nurseIds.push({ id: this.lastID, name: nurse.name, level: nurse.level });
          completed++;

          if (completed === nurses.length) {
            const unavailableDates = [
              { nurse_id: nurseIds[2].id, date: dayjs().date(5).format('YYYY-MM-DD') },
              { nurse_id: nurseIds[3].id, date: dayjs().date(15).format('YYYY-MM-DD') }
            ];

            unavailableDates.forEach(ud => {
              db.run('INSERT INTO unavailable_dates (nurse_id, date) VALUES (?, ?)', [ud.nurse_id, ud.date]);
            });

            const result = generateSchedule(deptId, nurseIds, currentMonth, unavailableDates);
            
            if (result.success) {
              const stmt = db.prepare('INSERT INTO schedules (department_id, nurse_id, date, shift, month) VALUES (?, ?, ?, ?, ?)');
              result.schedule.forEach(s => {
                stmt.run(s.department_id, s.nurse_id, s.date, s.shift, s.month);
              });
              stmt.finalize((err) => {
                if (err) {
                  console.error('插入排班失败:', err);
                  db.run('ROLLBACK');
                  return;
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

                db.run(
                  'INSERT OR REPLACE INTO training_config (department_id, year, annual_target_hours) VALUES (?, ?, ?)',
                  [deptId, currentYear, 40]
                );

                let courseCompleted = 0;
                const courseIds = [];

                courses.forEach(course => {
                  db.run(
                    'INSERT INTO training_courses (department_id, name, type, hours, assessment_method, pass_score, is_mandatory, instructor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [deptId, course.name, course.type, course.hours, course.assessment_method, course.pass_score, course.is_mandatory, course.instructor],
                    function(err) {
                      if (err) {
                        console.error('创建课程失败:', err);
                        return;
                      }
                      courseIds.push({ id: this.lastID, ...course });
                      courseCompleted++;

                      if (courseCompleted === courses.length) {
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

                        let recordCompleted = 0;
                        recordData.forEach(rd => {
                          const courseId = courseIds[rd.courseIdx].id;
                          const nurseId = nurseIds[rd.nurseIdx].id;
                          const passed = rd.score >= courseIds[rd.courseIdx].pass_score ? 1 : 0;
                          const trainingDate = dayjs().month(Math.floor(Math.random() * 6)).date(Math.floor(Math.random() * 28) + 1).format('YYYY-MM-DD');

                          db.run(
                            'INSERT INTO training_records (course_id, nurse_id, training_date, score, passed) VALUES (?, ?, ?, ?, ?)',
                            [courseId, nurseId, trainingDate, rd.score, passed],
                            function(err) {
                              if (err) {
                                console.error('创建培训记录失败:', err);
                                return;
                              }
                              recordCompleted++;
                              if (recordCompleted === recordData.length) {
                                const today = dayjs().format('YYYY-MM-DD');
                                const yesterday = dayjs().subtract(1, 'day').format('YYYY-MM-DD');
                                const twoDaysAgo = dayjs().subtract(2, 'day').format('YYYY-MM-DD');
                                const threeDaysAgo = dayjs().subtract(3, 'day').format('YYYY-MM-DD');
                                const fiveDaysAgo = dayjs().subtract(5, 'day').format('YYYY-MM-DD');
                                const tenDaysAgo = dayjs().subtract(10, 'day').format('YYYY-MM-DD');
                                const fifteenDaysAgo = dayjs().subtract(15, 'day').format('YYYY-MM-DD');

                                const demoEvents = [
                                  { reporterIdx: 2, event_type: 'medication_error', event_time: `${today} 09:30`, patient_bed: '12床', severity: 2, description: '早班给3床患者发药时将阿莫西林误发给12床患者，患者已服用，未出现不良反应', status: 'pending', responsible_nurse_id: null, rectification_days: null, rectification_deadline: null, rectification_report: null, is_overdue: 0 },
                                  { reporterIdx: 3, event_type: 'fall', event_time: `${yesterday} 22:15`, patient_bed: '8床', severity: 3, description: '夜班巡房时发现8床老年患者自行下床如厕时跌倒，右侧髋部疼痛，已通知医生处理', status: 'processing', responsible_nurse_id: null, rectification_days: 7, rectification_deadline: dayjs().add(6, 'day').format('YYYY-MM-DD'), rectification_report: null, is_overdue: 0 },
                                  { reporterIdx: 4, event_type: 'pressure_ulcer', event_time: `${twoDaysAgo} 14:00`, patient_bed: '5床', severity: 2, description: '交接班时发现5床长期卧床患者骶尾部出现II期压疮，面积约3cm×4cm', status: 'reviewing', responsible_nurse_id: null, rectification_days: 5, rectification_deadline: dayjs().add(3, 'day').format('YYYY-MM-DD'), rectification_report: '已制定翻身计划，每2小时翻身一次，使用防压疮气垫床，加强营养支持，已培训当班护士压疮护理规范', is_overdue: 0 },
                                  { reporterIdx: 2, event_type: 'infection', event_time: `${fiveDaysAgo} 10:00`, patient_bed: '3床', severity: 1, description: '3床术后伤口出现红肿渗液，送检培养结果为金葡菌感染', status: 'closed', responsible_nurse_id: null, rectification_days: 3, rectification_deadline: dayjs().subtract(2, 'day').format('YYYY-MM-DD'), rectification_report: '已加强手卫生管理，规范换药操作流程，每日观察伤口情况并记录，感染已控制', is_overdue: 0 },
                                  { reporterIdx: 5, event_type: 'medication_error', event_time: `${tenDaysAgo} 16:30`, patient_bed: '7床', severity: 1, description: '中班给7床患者发药时剂量多给一片，及时发现并纠正，未造成影响', status: 'closed', responsible_nurse_id: null, rectification_days: 5, rectification_deadline: dayjs().subtract(5, 'day').format('YYYY-MM-DD'), rectification_report: '已重新培训给药核对流程，增加双人核对环节，更新给药操作SOP', is_overdue: 0 },
                                  { reporterIdx: 3, event_type: 'fall', event_time: `${fifteenDaysAgo} 06:45`, patient_bed: '15床', severity: 4, description: '早班交接时发现15床患者自行翻越床栏坠床，头部着地，已紧急处理并转ICU观察', status: 'processing', responsible_nurse_id: null, rectification_days: 3, rectification_deadline: dayjs().subtract(12, 'day').format('YYYY-MM-DD'), rectification_report: null, is_overdue: 1 },
                                  { reporterIdx: 4, event_type: 'other', event_time: `${fiveDaysAgo} 11:00`, patient_bed: '20床', severity: 1, description: '20床患者家属投诉护士态度冷漠，沟通不畅', status: 'reviewing', responsible_nurse_id: null, rectification_days: 3, rectification_deadline: dayjs().subtract(2, 'day').format('YYYY-MM-DD'), rectification_report: '已组织科室沟通培训，当班护士已向家属致歉并改进服务态度，建立患者满意度反馈机制', is_overdue: 1 },
                                  { reporterIdx: 2, event_type: 'pressure_ulcer', event_time: `${threeDaysAgo} 08:00`, patient_bed: '11床', severity: 3, description: '11床偏瘫患者足跟出现III期压疮，面积约2cm×3cm，有坏死组织', status: 'pending', responsible_nurse_id: null, rectification_days: null, rectification_deadline: null, rectification_report: null, is_overdue: 0 }
                                ];
                                let eventCompleted = 0;
                                const eventIds = [];

                                demoEvents.forEach((de, idx) => {
                                  const reporterId = nurseIds[de.reporterIdx].id;
                                  const respNurseId = de.responsible_nurse_id !== null ? nurseIds[de.responsible_nurse_id].id : null;
                                  const actualRespId = de.status !== 'pending' ? nurseIds[1].id : null;
                                  const eventDate = de.event_time.substring(0, 10);

                                  db.get('SELECT id FROM schedules WHERE nurse_id = ? AND date = ?', [reporterId, eventDate], (sErr, scheduleRow) => {
                                    if (sErr) {
                                      console.error('查找排班失败:', sErr);
                                      return;
                                    }

                                    db.run(
                                      'INSERT INTO adverse_events (department_id, reporter_id, event_type, event_time, patient_bed, severity, description, status, schedule_id, responsible_nurse_id, rectification_days, rectification_deadline, rectification_report, is_overdue) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                                      [deptId, reporterId, de.event_type, de.event_time, de.patient_bed, de.severity, de.description, de.status, scheduleRow ? scheduleRow.id : null, actualRespId, de.rectification_days, de.rectification_deadline, de.rectification_report, de.is_overdue],
                                      function (eErr) {
                                        if (eErr) {
                                          console.error('创建不良事件失败:', eErr);
                                          return;
                                        }
                                        const eventId = this.lastID;
                                        eventIds.push(eventId);
                                        eventCompleted++;

                                        if (eventCompleted === demoEvents.length) {
                                          const timelineData = [];

                                          demoEvents.forEach((de2, idx2) => {
                                            const eid = eventIds[idx2];
                                            const rName = nurseIds[de2.reporterIdx].name;

                                            timelineData.push({ event_id: eid, action: '创建事件', from_status: null, to_status: 'pending', operator_id: nurseIds[de2.reporterIdx].id, operator_name: rName, remark: '事件上报' });

                                            if (de2.status !== 'pending') {
                                              timelineData.push({ event_id: eid, action: '审核通过，进入处理中', from_status: 'pending', to_status: 'processing', operator_id: nurseIds[0].id, operator_name: nurseIds[0].name, remark: `责任人: ${nurseIds[1].name}, 整改期限: ${de2.rectification_deadline}(${de2.rectification_days}天)` });
                                            }

                                            if (de2.status === 'reviewing' || de2.status === 'closed') {
                                              timelineData.push({ event_id: eid, action: '提交整改报告，待验收', from_status: 'processing', to_status: 'reviewing', operator_id: nurseIds[1].id, operator_name: nurseIds[1].name, remark: null });
                                            }

                                            if (de2.status === 'closed') {
                                              timelineData.push({ event_id: eid, action: '验收通过，事件关闭', from_status: 'reviewing', to_status: 'closed', operator_id: nurseIds[0].id, operator_name: nurseIds[0].name, remark: null });
                                            }

                                            if (de2.is_overdue === 1 && de2.status !== 'closed') {
                                              timelineData.push({ event_id: eid, action: '系统标记为逾期', from_status: de2.status, to_status: de2.status, operator_id: null, operator_name: '系统', remark: '超过整改期限未关闭' });
                                            }
                                          });

                                          let tlCompleted = 0;
                                          timelineData.forEach(td => {
                                            db.run(
                                              'INSERT INTO adverse_event_timeline (event_id, action, from_status, to_status, operator_id, operator_name, remark) VALUES (?, ?, ?, ?, ?, ?, ?)',
                                              [td.event_id, td.action, td.from_status, td.to_status, td.operator_id, td.operator_name, td.remark],
                                              function (tErr) {
                                                if (tErr) {
                                                  console.error('创建时间线失败:', tErr);
                                                  return;
                                                }
                                                tlCompleted++;
                                                if (tlCompleted === timelineData.length) {
                                                  db.run('COMMIT', (err) => {
                                                    if (err) {
                                                      console.error('提交事务失败:', err);
                                                      return;
                                                    }
                                                    console.log('演示数据初始化成功!');
                                                    console.log(`科室: 内科 (ID: ${deptId})`);
                                                    console.log(`护士人数: ${nurses.length} (2名senior, 4名junior)`);
                                                    console.log(`月份: ${currentMonth}`);
                                                    console.log(`排班记录数: ${result.schedule.length}`);
                                                    console.log(`培训课程数: ${courses.length}`);
                                                    console.log(`培训记录数: ${recordData.length}`);
                                                    console.log(`不良事件数: ${demoEvents.length}`);
                                                  });
                                                }
                                              }
                                            );
                                          });
                                        }
                                      }
                                    );
                                  });
                                });
                              }
                            }
                          );
                        });
                      }
                    }
                  );
                });
              });
            } else {
              console.error('生成排班失败:', result.reason);
              db.run('ROLLBACK');
            }
          }
        });
      });
    });
  });
}

initDemoData();
