const { generateSchedule } = require('./src/scheduler');

const nurses = [
  { id: 1, name: '张主任', level: 'senior' },
  { id: 2, name: '李护士长', level: 'senior' },
  { id: 3, name: '王护士', level: 'junior' },
  { id: 4, name: '赵护士', level: 'junior' },
  { id: 5, name: '陈护士', level: 'junior' },
  { id: 6, name: '刘护士', level: 'junior' }
];

const result = generateSchedule(1, nurses, '2026-06', []);

if (result.success) {
  console.log('排班成功!');
  console.log('班次数统计:', result.shiftCounts);
  
  const dateShifts = {};
  result.schedule.forEach(s => {
    if (!dateShifts[s.date]) {
      dateShifts[s.date] = [];
    }
    dateShifts[s.date].push(s);
  });
  
  let daysWithSenior = 0;
  let totalDays = 0;
  for (const date in dateShifts) {
    totalDays++;
    const hasSenior = dateShifts[date].some(s => 
      nurses.find(n => n.id === s.nurse_id)?.level === 'senior'
    );
    if (hasSenior) daysWithSenior++;
  }
  
  console.log(`有senior的天数: ${daysWithSenior}/${totalDays}`);
  
  const counts = Object.values(result.shiftCounts);
  console.log(`班次数范围: ${Math.min(...counts)} - ${Math.max(...counts)} (差: ${Math.max(...counts) - Math.min(...counts)})`);
  console.log(`总排班级: ${result.schedule.length}`);
} else {
  console.log('排班失败:', result.reason);
}
