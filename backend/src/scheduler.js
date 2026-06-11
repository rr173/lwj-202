const dayjs = require('dayjs');

const SHIFTS = ['morning', 'afternoon', 'night'];

const SHIFT_NAMES_CN = {
  morning: '早班',
  afternoon: '中班',
  night: '夜班'
};

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

  if (nurse.is_secondment && nurse.secondment_info) {
    const info = nurse.secondment_info;
    if (date < info.start_date || date > info.end_date) {
      return false;
    }
    if (info.shifts && info.shifts !== 'all') {
      const allowedShifts = info.shifts.split(',');
      if (!allowedShifts.includes(shift)) {
        return false;
      }
    }
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

function buildNurseSkillMap(nurseSkillsList) {
  const map = {};
  nurseSkillsList.forEach(ns => {
    if (!map[ns.nurse_id]) map[ns.nurse_id] = new Set();
    map[ns.nurse_id].add(ns.skill_id);
  });
  return map;
}

function buildShiftRequirementsMap(shiftRequirementsList) {
  const map = {};
  shiftRequirementsList.forEach(r => {
    if (!map[r.shift]) map[r.shift] = [];
    map[r.shift].push({ skill_id: r.skill_id, skill_name: r.skill_name });
  });
  return map;
}

function checkDaySkillCoverage(dayShifts, nurseSkillMap, shiftReqs) {
  const missing = [];
  Object.keys(shiftReqs).forEach(shift => {
    const nursesInShift = dayShifts.filter(s => s.shift === shift);
    const coveredSkillIds = new Set();
    nursesInShift.forEach(s => {
      if (nurseSkillMap[s.nurse_id]) {
        nurseSkillMap[s.nurse_id].forEach(sid => coveredSkillIds.add(sid));
      }
    });
    shiftReqs[shift].forEach(req => {
      if (!coveredSkillIds.has(req.skill_id)) {
        missing.push({
          shift,
          skill_id: req.skill_id,
          skill_name: req.skill_name
        });
      }
    });
  });
  return missing;
}

function buildNursePreferenceMap(preferencesList) {
  const map = {};
  preferencesList.forEach(p => {
    try {
      map[p.nurse_id] = {
        restDates: new Set(JSON.parse(p.rest_dates || '[]')),
        workDates: new Set(JSON.parse(p.work_dates || '[]')),
        preferredShifts: new Set(JSON.parse(p.preferred_shifts || '[]'))
      };
    } catch (e) {
      map[p.nurse_id] = { restDates: new Set(), workDates: new Set(), preferredShifts: new Set() };
    }
  });
  return map;
}

function calculatePreferenceScore(nurseId, date, shift, preferenceMap) {
  let score = 0;
  const pref = preferenceMap[nurseId];
  if (!pref) return score;

  if (pref.restDates.has(date)) {
    score -= 100;
  }
  if (pref.workDates.has(date)) {
    score += 50;
  }
  if (pref.preferredShifts.has(shift)) {
    score += 30;
  }

  return score;
}

function generateSchedule(departmentId, nurses, month, unavailableDatesList = [], nurseSkillsList = [], shiftRequirementsList = [], preferencesList = []) {
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

  const nurseSkillMap = buildNurseSkillMap(nurseSkillsList);
  const shiftReqs = buildShiftRequirementsMap(shiftRequirementsList);
  const preferenceMap = buildNursePreferenceMap(preferencesList);

  const existingShifts = {};
  const shiftCounts = {};
  nurses.forEach(n => {
    existingShifts[n.id] = {};
    shiftCounts[n.id] = 0;
  });

  const schedule = [];

  const skillShifts = SHIFTS.filter(s => shiftReqs[s] && shiftReqs[s].length > 0);
  const normalShifts = SHIFTS.filter(s => !shiftReqs[s] || shiftReqs[s].length === 0);

  for (const date of days) {
    const dayShifts = [];
    const usedNurses = new Set();
    let hasSenior = false;

    const assignOrder = [...skillShifts, ...normalShifts];

    for (const shift of assignOrder) {
      const requiredSkills = shiftReqs[shift] || [];
      let assigned = false;

      const candidates = [...seniorNurses, ...juniorNurses].filter(n =>
        !usedNurses.has(n.id) && canAssign(n, date, shift, unavailableDates, existingShifts)
      );

      if (requiredSkills.length > 0) {
        const scored = candidates.map(n => {
          const nurseSkills = nurseSkillMap[n.id] || new Set();
          let coveredCount = 0;
          requiredSkills.forEach(req => {
            if (nurseSkills.has(req.skill_id)) coveredCount++;
          });
          const prefScore = calculatePreferenceScore(n.id, date, shift, preferenceMap);
          return { nurse: n, coveredCount, shiftCount: shiftCounts[n.id] || 0, prefScore };
        });

        scored.sort((a, b) => {
          if (b.coveredCount !== a.coveredCount) return b.coveredCount - a.coveredCount;
          if (b.prefScore !== a.prefScore) return b.prefScore - a.prefScore;
          return a.shiftCount - b.shiftCount;
        });

        const chosen = scored[0];
        if (chosen) {
          dayShifts.push({
            department_id: departmentId,
            nurse_id: chosen.nurse.id,
            date: date,
            shift: shift,
            month: month
          });
          existingShifts[chosen.nurse.id][date] = shift;
          shiftCounts[chosen.nurse.id]++;
          usedNurses.add(chosen.nurse.id);
          if (chosen.nurse.level === 'senior') {
            hasSenior = true;
          }
          assigned = true;
        }
      } else {
        const scored = candidates.map(n => ({
          nurse: n,
          shiftCount: shiftCounts[n.id] || 0,
          prefScore: calculatePreferenceScore(n.id, date, shift, preferenceMap)
        }));

        scored.sort((a, b) => {
          if (b.prefScore !== a.prefScore) return b.prefScore - a.prefScore;
          return a.shiftCount - b.shiftCount;
        });

        for (const item of scored) {
          dayShifts.push({
            department_id: departmentId,
            nurse_id: item.nurse.id,
            date: date,
            shift: shift,
            month: month
          });
          existingShifts[item.nurse.id][date] = shift;
          shiftCounts[item.nurse.id]++;
          usedNurses.add(item.nurse.id);
          if (item.nurse.level === 'senior') {
            hasSenior = true;
          }
          assigned = true;
          break;
        }
      }

      if (!assigned) {
        return { success: false, reason: `无法为 ${date} 的${SHIFT_NAMES_CN[shift]}找到合适护士` };
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

  const skillWarnings = [];
  if (Object.keys(shiftReqs).length > 0) {
    const dates = [...new Set(schedule.map(s => s.date))].sort();
    for (const date of dates) {
      const dayShifts = schedule.filter(s => s.date === date);
      const missing = checkDaySkillCoverage(dayShifts, nurseSkillMap, shiftReqs);
      if (missing.length > 0) {
        missing.forEach(m => {
          skillWarnings.push({
            date,
            shift: m.shift,
            shift_name: SHIFT_NAMES_CN[m.shift],
            skill_id: m.skill_id,
            skill_name: m.skill_name
          });
        });
      }
    }
  }

  const counts = Object.values(shiftCounts);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  
  if (maxCount - minCount > 5) {
    return { success: false, reason: `班次数差距过大（最大${maxCount}，最小${minCount}）` };
  }

  return { success: true, schedule, shiftCounts, skillWarnings };
}

function validateSwap(schedule, nurses, requester_id, target_id, date, requester_shift, target_shift, nurseSkillsList = [], shiftRequirementsList = []) {
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

  if (nurseSkillsList.length > 0 && shiftRequirementsList.length > 0) {
    const nurseSkillMap = buildNurseSkillMap(nurseSkillsList);
    const shiftReqs = buildShiftRequirementsMap(shiftRequirementsList);
    const missing = checkDaySkillCoverage(dayShifts, nurseSkillMap, shiftReqs);
    if (missing.length > 0) {
      const details = missing.map(m => `${SHIFT_NAMES_CN[m.shift]}需要"${m.skill_name}"技能`).join('、');
      return { valid: false, reason: `${date} 换班后技能覆盖不足: ${details}` };
    }
  }

  return { valid: true };
}

function validateScheduleChange(schedule, nurses, change, nurseSkillsList = [], shiftRequirementsList = []) {
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

  if (nurseSkillsList.length > 0 && shiftRequirementsList.length > 0) {
    const nurseSkillMap = buildNurseSkillMap(nurseSkillsList);
    const shiftReqs = buildShiftRequirementsMap(shiftRequirementsList);
    const missing = checkDaySkillCoverage(dayShifts, nurseSkillMap, shiftReqs);
    if (missing.length > 0) {
      const details = missing.map(m => `${SHIFT_NAMES_CN[m.shift]}需要"${m.skill_name}"技能`).join('、');
      return { valid: false, reason: `${date} 调班后技能覆盖不足: ${details}` };
    }
  }

  return { valid: true };
}

module.exports = { generateSchedule, validateScheduleChange, validateSwap, getDaysInMonth };
