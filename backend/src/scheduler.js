const dayjs = require('dayjs');

const SHIFTS = ['morning', 'afternoon', 'night'];

function getDaysInMonth(year, month) {
  const days = [];
  const date = dayjs(`${year}-${String(month).padStart(2, '0')}-01`);
  const daysInMonth = date.daysInMonth();
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(date.date(i).format('YYYY-MM-DD'));
  }
  return days;
}

function canAssign(nurse, date, shift, unavailableDates, existingShifts) {
  const nurseId = nurse.id;
  const prevDate = dayjs(date).subtract(1, 'day').format('YYYY-MM-DD');

  if (unavailableDates[nurseId] && unavailableDates[nurseId].includes(date)) {
    return false;
  }

  if (existingShifts[nurseId] && existingShifts[nurseId][date]) {
    return false;
  }

  if (shift === 'night') {
    if (existingShifts[nurseId] && existingShifts[nurseId][prevDate] === 'night') {
      return false;
    }
  }

  if (shift === 'morning') {
    if (existingShifts[nurseId] && existingShifts[nurseId][prevDate] === 'night') {
      return false;
    }
  }

  return true;
}

function generateSchedule(departmentId, nurses, month, unavailableDatesList = []) {
  const [year, monthNum] = month.split('-').map(Number);
  const days = getDaysInMonth(year, monthNum);
  
  const unavailableDates = {};
  unavailableDatesList.forEach(ud => {
    if (!unavailableDates[ud.nurse_id]) {
      unavailableDates[ud.nurse_id] = [];
    }
    unavailableDates[ud.nurse_id].push(ud.date);
  });

  const seniorNurses = nurses.filter(n => n.level === 'senior');
  const juniorNurses = nurses.filter(n => n.level === 'junior');

  if (seniorNurses.length < 1) {
    return { success: false, reason: '科室至少需要1名senior护士' };
  }

  const existingShifts = {};
  const shiftCounts = {};
  nurses.forEach(n => {
    existingShifts[n.id] = {};
    shiftCounts[n.id] = 0;
  });

  const schedule = [];

  for (const date of days) {
    const dayShifts = [];
    const usedNurses = new Set();
    let hasSenior = false;

    for (const shift of SHIFTS) {
      let assigned = false;
      const candidates = [...seniorNurses, ...juniorNurses].sort((a, b) => {
        const countA = shiftCounts[a.id] || 0;
        const countB = shiftCounts[b.id] || 0;
        return countA - countB;
      });

      for (const nurse of candidates) {
        if (usedNurses.has(nurse.id)) continue;
        
        if (canAssign(nurse, date, shift, unavailableDates, existingShifts)) {
          dayShifts.push({
            department_id: departmentId,
            nurse_id: nurse.id,
            date: date,
            shift: shift,
            month: month
          });
          existingShifts[nurse.id][date] = shift;
          shiftCounts[nurse.id]++;
          usedNurses.add(nurse.id);
          if (nurse.level === 'senior') {
            hasSenior = true;
          }
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        return { success: false, reason: `无法为 ${date} 的${shift === 'morning' ? '早班' : shift === 'afternoon' ? '中班' : '夜班'}找到合适护士` };
      }
    }

    if (!hasSenior) {
      let replaced = false;
      for (const shiftEntry of dayShifts) {
        const currentNurse = nurses.find(n => n.id === shiftEntry.nurse_id);
        if (currentNurse && currentNurse.level === 'junior') {
          for (const senior of seniorNurses) {
            if (!usedNurses.has(senior.id) && canAssign(senior, date, shiftEntry.shift, unavailableDates, existingShifts)) {
              delete existingShifts[currentNurse.id][date];
              shiftCounts[currentNurse.id]--;
              
              shiftEntry.nurse_id = senior.id;
              existingShifts[senior.id][date] = shiftEntry.shift;
              shiftCounts[senior.id]++;
              usedNurses.delete(currentNurse.id);
              usedNurses.add(senior.id);
              replaced = true;
              break;
            }
          }
        }
        if (replaced) break;
      }
      
      if (!replaced) {
        return { success: false, reason: `${date} 无法安排senior护士在岗` };
      }
    }

    schedule.push(...dayShifts);
  }

  const counts = Object.values(shiftCounts);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  
  if (maxCount - minCount > 3) {
    return { success: false, reason: `班次数差距过大（最大${maxCount}，最小${minCount}）` };
  }

  return { success: true, schedule, shiftCounts };
}

function validateSwap(schedule, nurses, requester_id, target_id, date, requester_shift, target_shift) {
  const testSchedules = schedule.filter(s => 
    !(s.nurse_id === requester_id && s.date === date) && 
    !(s.nurse_id === target_id && s.date === date)
  );
  
  testSchedules.push({
    nurse_id: target_id,
    date,
    shift: requester_shift
  });
  testSchedules.push({
    nurse_id: requester_id,
    date,
    shift: target_shift
  });

  const existingShifts = {};
  testSchedules.forEach(s => {
    if (!existingShifts[s.nurse_id]) {
      existingShifts[s.nurse_id] = {};
    }
    existingShifts[s.nurse_id][s.date] = s.shift;
  });

  const requester = nurses.find(n => n.id === requester_id);
  const target = nurses.find(n => n.id === target_id);

  if (!requester || !target) {
    return { valid: false, reason: '护士不存在' };
  }

  const prevDate = dayjs(date).subtract(1, 'day').format('YYYY-MM-DD');
  const nextDate = dayjs(date).add(1, 'day').format('YYYY-MM-DD');

  if (target_shift === 'night' && existingShifts[requester_id] && existingShifts[requester_id][prevDate] === 'night') {
    return { valid: false, reason: `${requester.name} 换班后会连续两天夜班` };
  }

  if (requester_shift === 'night' && existingShifts[target_id] && existingShifts[target_id][prevDate] === 'night') {
    return { valid: false, reason: `${target.name} 换班后会连续两天夜班` };
  }

  if (target_shift === 'morning' && existingShifts[requester_id] && existingShifts[requester_id][prevDate] === 'night') {
    return { valid: false, reason: `${requester.name} 换班后夜班后接早班，间隔不足8小时` };
  }

  if (requester_shift === 'morning' && existingShifts[target_id] && existingShifts[target_id][prevDate] === 'night') {
    return { valid: false, reason: `${target.name} 换班后夜班后接早班，间隔不足8小时` };
  }

  if (existingShifts[requester_id] && existingShifts[requester_id][nextDate] === 'night' && target_shift === 'night') {
    return { valid: false, reason: `${requester.name} 换班后会连续两天夜班` };
  }

  if (existingShifts[target_id] && existingShifts[target_id][nextDate] === 'night' && requester_shift === 'night') {
    return { valid: false, reason: `${target.name} 换班后会连续两天夜班` };
  }

  if (existingShifts[requester_id] && existingShifts[requester_id][nextDate] === 'morning' && target_shift === 'night') {
    return { valid: false, reason: `${requester.name} 换班后夜班后接早班，间隔不足8小时` };
  }

  if (existingShifts[target_id] && existingShifts[target_id][nextDate] === 'morning' && requester_shift === 'night') {
    return { valid: false, reason: `${target.name} 换班后夜班后接早班，间隔不足8小时` };
  }

  const dayShifts = testSchedules.filter(s => s.date === date);
  const hasSeniorAny = dayShifts.some(s => nurses.find(n => n.id === s.nurse_id)?.level === 'senior');
  if (!hasSeniorAny) {
    return { valid: false, reason: `${date} 换班后当天没有senior护士在岗` };
  }

  return { valid: true };
}

function validateScheduleChange(schedule, nurses, change) {
  const { nurse_id, date, shift } = change;
  const nurse = nurses.find(n => n.id === nurse_id);
  
  if (!nurse) {
    return { valid: false, reason: '护士不存在' };
  }

  const existingShifts = {};
  schedule.forEach(s => {
    if (!existingShifts[s.nurse_id]) {
      existingShifts[s.nurse_id] = {};
    }
    existingShifts[s.nurse_id][s.date] = s.shift;
  });

  if (existingShifts[nurse_id] && existingShifts[nurse_id][date] && existingShifts[nurse_id][date] !== shift) {
    delete existingShifts[nurse_id][date];
  }

  if (!canAssign(nurse, date, shift, {}, existingShifts)) {
    return { valid: false, reason: '违反排班约束' };
  }

  const dayShifts = schedule.filter(s => s.date === date && s.nurse_id !== nurse_id);
  dayShifts.push({ nurse_id, shift });

  const hasSeniorAny = dayShifts.some(s => nurses.find(n => n.id === s.nurse_id)?.level === 'senior');
  if (!hasSeniorAny) {
    return { valid: false, reason: `${date} 必须至少有1名senior护士在岗` };
  }

  return { valid: true };
}

module.exports = { generateSchedule, validateScheduleChange, validateSwap, getDaysInMonth };
