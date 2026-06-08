const db = require('./db');
const { generateSchedule } = require('./scheduler');
const dayjs = require('dayjs');

function initDemoData() {
  const currentMonth = dayjs().format('YYYY-MM');
  
  console.log('初始化演示数据...');

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

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
