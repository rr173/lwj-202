const db = require('./db');
const { generateSchedule } = require('./scheduler');
const dayjs = require('dayjs');

function initDemoData() {
  const currentMonth = dayjs().format('YYYY-MM');
  
  console.log('初始化演示数据...');

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run('DELETE FROM swap_requests');
    db.run('DELETE FROM schedules');
    db.run('DELETE FROM unavailable_dates');
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
