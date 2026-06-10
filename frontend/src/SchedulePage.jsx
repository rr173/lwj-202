import { useState, useEffect } from 'react';
import { 
  Layout, Menu, Table, Button, DatePicker, Select, Modal, Form, 
  message, Tabs, Badge, Popconfirm, Space, Tag, Radio, TimePicker, Input, Tooltip, Alert, Checkbox, Progress, InputNumber
} from 'antd';
const { RangePicker } = DatePicker;
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import { 
  getDepartments, getNurses, getSchedule, generateSchedule, updateSchedule,
  getSwapRequests, createSwapRequest, confirmSwapRequest, approveSwapRequest, rejectSwapRequest,
  getOvertimeRequests, createOvertimeRequest, approveOvertimeRequest, rejectOvertimeRequest,
  getMonthlyReport,
  getLeaveRequests, createLeaveRequest, approveLeaveRequest, rejectLeaveRequest,
  confirmSubstitute, manualSubstitute, getLeaveSummary, getAvailableSubstitutes,
  getFatigueStatus,
  getSkillTags, createSkillTag, deleteSkillTag,
  updateNurseSkills,
  getShiftSkillRequirements, updateShiftSkillRequirements,
  getSkillCoverageReport,
  getNurseLeaveBalance, getLeaveQuotaOverview, getLeaveQuotaConfig, updateLeaveQuotaConfig,
  getSecondmentRequests, createSecondmentRequest, approveSecondmentRequest, rejectSecondmentRequest,
  cancelSecondmentRequest, getSecondmentNurses, getLentOutNurses
} from './api';

const { Option } = Select;
const { Header, Sider, Content } = Layout;
const { TextArea } = Input;

const SHIFT_NAMES = {
  morning: '早班',
  afternoon: '中班',
  night: '夜班'
};

const SHIFT_COLORS = {
  morning: '#52c41a',
  afternoon: '#1890ff',
  night: '#722ed1'
};

const OVERTIME_STATUS = {
  pending: { text: '待审批', color: 'gold' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已拒绝', color: 'red' }
};

const LEAVE_TYPE_NAMES = {
  personal: '事假',
  sick: '病假',
  annual: '年假'
};

const LEAVE_TYPE_COLORS = {
  personal: '#ff4d4f',
  sick: '#fa8c16',
  annual: '#1890ff'
};

const SUBSTITUTE_STATUS = {
  pending: { text: '待确认', color: 'gold' },
  confirmed: { text: '已确认', color: 'green' },
  none: { text: '无补班', color: 'default' },
  manual: { text: '需手动协调', color: 'red' }
};

const SHIFTS = ['morning', 'afternoon', 'night'];

const SECONMENT_STATUS = {
  pending: { text: '待审批', color: 'gold' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已拒绝', color: 'red' },
  cancelled: { text: '已取消', color: 'default' }
};

const NURSE_TYPE_LABELS = {
  own: { text: '本科室', color: 'blue' },
  borrowed: { text: '借入', color: 'orange' },
  lent_out: { text: '外借', color: 'purple' }
};

function FatigueWarningBanner({ fatigueData, expanded, onToggle }) {
  const warningNurses = (fatigueData || []).filter(n => n.is_fatigue_warning);
  if (warningNurses.length === 0) return null;

  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: '16px', cursor: 'pointer' }}
      message={
        <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>
            <strong>疲劳预警</strong>：当前有 <strong style={{ color: '#fa8c16' }}>{warningNurses.length}</strong> 名护士近7日累计工时超过48小时
          </span>
          <span style={{ fontSize: '12px', color: '#999' }}>{expanded ? '收起 ▲' : '展开详情 ▼'}</span>
        </div>
      }
      description={expanded ? (
        <div style={{ marginTop: '8px' }}>
          {warningNurses.map(n => (
            <div key={n.nurse_id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed #ffe7ba' }}>
              <span style={{ fontWeight: '500', color: '#fa8c16' }}>{n.nurse_name}</span>
              <span>近7日累计 <strong style={{ color: '#fa8c16' }}>{n.total_hours}h</strong></span>
            </div>
          ))}
        </div>
      ) : null}
    />
  );
}

function LeaveQuotaInline({ nurseId, leaveBalances }) {
  const balance = leaveBalances[nurseId];
  if (!balance) return null;
  return (
    <div style={{ fontSize: '12px', padding: '6px 8px', background: '#f0f5ff', borderRadius: '4px', marginBottom: '8px', border: '1px solid #d6e4ff' }}>
      <div style={{ fontWeight: '500', marginBottom: '4px', color: '#1890ff' }}>假期额度</div>
      <div style={{ display: 'flex', gap: '12px' }}>
        {['annual', 'sick', 'personal'].map(type => {
          const q = balance[type];
          if (!q) return null;
          const isExhausted = q.remaining <= 0;
          return (
            <span key={type} style={{ color: isExhausted ? '#ff4d4f' : '#666' }}>
              {LEAVE_TYPE_NAMES[type]}: {q.used}/{q.total}天
              <span style={{ color: isExhausted ? '#ff4d4f' : '#52c41a', marginLeft: '2px' }}>
                ({isExhausted ? '已用完' : `余${q.remaining}天`})
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

function SchedulePage() {
  const [departments, setDepartments] = useState([]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [nurses, setNurses] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [month, setMonth] = useState(dayjs());
  const [viewMode, setViewMode] = useState('month');
  const [swapRequests, setSwapRequests] = useState([]);
  const [overtimeRequests, setOvertimeRequests] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [monthlyReport, setMonthlyReport] = useState([]);
  const [leaveSummary, setLeaveSummary] = useState([]);
  const [swapModalVisible, setSwapModalVisible] = useState(false);
  const [overtimeModalVisible, setOvertimeModalVisible] = useState(false);
  const [leaveModalVisible, setLeaveModalVisible] = useState(false);
  const [substituteModalVisible, setSubstituteModalVisible] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const [selectedOvertimeNurse, setSelectedOvertimeNurse] = useState(null);
  const [selectedLeave, setSelectedLeave] = useState(null);
  const [availableSubstitutes, setAvailableSubstitutes] = useState([]);
  const [manualSubstituteNurseId, setManualSubstituteNurseId] = useState(null);
  const [form] = Form.useForm();
  const [overtimeForm] = Form.useForm();
  const [leaveForm] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [fatigueData, setFatigueData] = useState([]);
  const [fatigueBannerExpanded, setFatigueBannerExpanded] = useState(false);
  const [approveConfirmVisible, setApproveConfirmVisible] = useState(false);
  const [approveAction, setApproveAction] = useState(null);
  const [approveWarnings, setApproveWarnings] = useState([]);
  const [skillTags, setSkillTags] = useState([]);
  const [shiftSkillReqs, setShiftSkillReqs] = useState([]);
  const [skillCoverageReport, setSkillCoverageReport] = useState(null);
  const [nurseSkillModalVisible, setNurseSkillModalVisible] = useState(false);
  const [editingNurse, setEditingNurse] = useState(null);
  const [editingNurseSkills, setEditingNurseSkills] = useState([]);
  const [skillReqModalVisible, setSkillReqModalVisible] = useState(false);
  const [editingSkillReqs, setEditingSkillReqs] = useState([]);
  const [newSkillName, setNewSkillName] = useState('');
  const [coverageReportVisible, setCoverageReportVisible] = useState(false);
  const [leaveBalances, setLeaveBalances] = useState({});
  const [leaveQuotaOverview, setLeaveQuotaOverview] = useState([]);
  const [leaveQuotaConfig, setLeaveQuotaConfig] = useState(null);
  const [quotaConfigModalVisible, setQuotaConfigModalVisible] = useState(false);
  const [editingQuotaConfig, setEditingQuotaConfig] = useState({ sick_days: 15, personal_days: 5 });
  const [secondmentRequests, setSecondmentRequests] = useState([]);
  const [secondmentModalVisible, setSecondmentModalVisible] = useState(false);
  const [secondmentForm] = Form.useForm();
  const [secondmentNurses, setSecondmentNurses] = useState([]);
  const [lentOutNurses, setLentOutNurses] = useState([]);
  const [secondmentStatusFilter, setSecondmentStatusFilter] = useState(null);
  const [fromDeptNurses, setFromDeptNurses] = useState([]);
  const [scheduleSecondments, setScheduleSecondments] = useState([]);

  const fatigueMap = {};
  (fatigueData || []).forEach(f => {
    fatigueMap[f.nurse_id] = f;
  });

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    if (selectedDept) {
      loadNurses();
      loadSchedule();
      loadSwapRequests();
      loadOvertimeRequests();
      loadLeaveRequests();
      loadMonthlyReport();
      loadLeaveSummary();
      loadFatigueStatus();
      loadSkillTags();
      loadShiftSkillReqs();
      loadSkillCoverageReport();
      loadLeaveQuotaOverview();
      loadLeaveQuotaConfig();
      loadSecondmentRequests();
      loadSecondmentNurses();
      loadLentOutNurses();
    }
  }, [selectedDept, month]);

  const loadDepartments = async () => {
    try {
      const res = await getDepartments();
      setDepartments(res.data);
      if (res.data.length > 0) {
        setSelectedDept(res.data[0]);
      }
    } catch (err) {
      message.error('加载科室列表失败');
    }
  };

  const loadNurses = async () => {
    if (!selectedDept) return;
    try {
      const res = await getNurses(selectedDept.id);
      setNurses(res.data);
    } catch (err) {
      message.error('加载护士列表失败');
    }
  };

  const loadSchedule = async () => {
    if (!selectedDept) return;
    try {
      const res = await getSchedule(selectedDept.id, month.format('YYYY-MM'));
      if (res.data.schedules) {
        setSchedule(res.data.schedules);
        setShiftSkillReqs(res.data.shift_skill_requirements || []);
        setScheduleSecondments(res.data.secondments || []);
      } else {
        setSchedule(res.data);
      }
    } catch (err) {
      message.error('加载排班表失败');
    }
  };

  const loadSwapRequests = async () => {
    if (!selectedDept) return;
    try {
      const res = await getSwapRequests(selectedDept.id);
      setSwapRequests(res.data);
    } catch (err) {
      message.error('加载换班申请失败');
    }
  };

  const loadOvertimeRequests = async () => {
    if (!selectedDept) return;
    try {
      const res = await getOvertimeRequests(selectedDept.id);
      setOvertimeRequests(res.data);
    } catch (err) {
      message.error('加载加班申请失败');
    }
  };

  const loadLeaveRequests = async () => {
    if (!selectedDept) return;
    try {
      const res = await getLeaveRequests(selectedDept.id, null, month.format('YYYY-MM'));
      setLeaveRequests(res.data);
      const nurseIds = [...new Set(res.data.map(r => r.nurse_id))];
      nurseIds.forEach(nid => {
        if (!leaveBalances[nid]) {
          getNurseLeaveBalance(nid, month.year()).then(balance => {
            if (balance) setLeaveBalances(prev => ({ ...prev, [nid]: balance }));
          });
        }
      });
    } catch (err) {
      message.error('加载请假记录失败');
    }
  };

  const loadMonthlyReport = async () => {
    if (!selectedDept) return;
    try {
      const res = await getMonthlyReport(selectedDept.id, month.format('YYYY-MM'));
      setMonthlyReport(res.data);
    } catch (err) {
      message.error('加载月度报表失败');
    }
  };

  const loadLeaveSummary = async () => {
    if (!selectedDept) return;
    try {
      const res = await getLeaveSummary(selectedDept.id, month.format('YYYY-MM'));
      setLeaveSummary(res.data);
    } catch (err) {
      message.error('加载请假汇总失败');
    }
  };

  const loadFatigueStatus = async () => {
    if (!selectedDept) return;
    try {
      const res = await getFatigueStatus(selectedDept.id);
      setFatigueData(res.data.nurses || []);
    } catch (err) {
      setFatigueData([]);
    }
  };

  const loadSkillTags = async () => {
    if (!selectedDept) return;
    try {
      const res = await getSkillTags(selectedDept.id);
      setSkillTags(res.data);
    } catch (err) {
      setSkillTags([]);
    }
  };

  const loadShiftSkillReqs = async () => {
    if (!selectedDept) return;
    try {
      const res = await getShiftSkillRequirements(selectedDept.id);
      setShiftSkillReqs(res.data);
    } catch (err) {
      setShiftSkillReqs([]);
    }
  };

  const loadSkillCoverageReport = async () => {
    if (!selectedDept) return;
    try {
      const res = await getSkillCoverageReport(selectedDept.id, month.format('YYYY-MM'));
      setSkillCoverageReport(res.data);
    } catch (err) {
      setSkillCoverageReport(null);
    }
  };

  const loadLeaveQuotaOverview = async () => {
    if (!selectedDept) return;
    try {
      const res = await getLeaveQuotaOverview(selectedDept.id, month.year());
      setLeaveQuotaOverview(res.data);
    } catch (err) {
      setLeaveQuotaOverview([]);
    }
  };

  const loadLeaveQuotaConfig = async () => {
    if (!selectedDept) return;
    try {
      const res = await getLeaveQuotaConfig(selectedDept.id, month.year());
      setLeaveQuotaConfig(res.data);
      setEditingQuotaConfig({ sick_days: res.data.sick_days, personal_days: res.data.personal_days });
    } catch (err) {
      setLeaveQuotaConfig(null);
    }
  };

  const loadNurseLeaveBalance = async (nurseId) => {
    try {
      const res = await getNurseLeaveBalance(nurseId, month.year());
      setLeaveBalances(prev => ({ ...prev, [nurseId]: res.data }));
      return res.data;
    } catch (err) {
      return null;
    }
  };

  const loadSecondmentRequests = async () => {
    if (!selectedDept) return;
    try {
      const res = await getSecondmentRequests({ department_id: selectedDept.id });
      setSecondmentRequests(res.data);
    } catch (err) {
      setSecondmentRequests([]);
    }
  };

  const loadSecondmentNurses = async () => {
    if (!selectedDept) return;
    try {
      const res = await getSecondmentNurses(selectedDept.id, dayjs().format('YYYY-MM-DD'));
      setSecondmentNurses(res.data);
    } catch (err) {
      setSecondmentNurses([]);
    }
  };

  const loadLentOutNurses = async () => {
    if (!selectedDept) return;
    try {
      const res = await getLentOutNurses(selectedDept.id, dayjs().format('YYYY-MM-DD'));
      setLentOutNurses(res.data);
    } catch (err) {
      setLentOutNurses([]);
    }
  };

  const handleSecondmentSubmit = async () => {
    try {
      const values = await secondmentForm.validateFields();
      await createSecondmentRequest({
        from_department_id: values.from_department_id,
        to_department_id: selectedDept.id,
        nurse_id: values.nurse_id,
        start_date: values.date_range[0].format('YYYY-MM-DD'),
        end_date: values.date_range[1].format('YYYY-MM-DD'),
        shifts: values.shifts || 'all',
        reason: values.reason
      });
      message.success('借调申请已提交');
      setSecondmentModalVisible(false);
      secondmentForm.resetFields();
      setFromDeptNurses([]);
      loadSecondmentRequests();
      loadSecondmentNurses();
      loadLentOutNurses();
    } catch (err) {
      if (err.response?.data?.error) {
        message.error(err.response.data.error);
      } else if (err.message) {
        message.error('提交失败');
      }
    }
  };

  const handleApproveSecondment = async (id) => {
    try {
      await approveSecondmentRequest(id);
      message.success('借调审批通过');
      loadSecondmentRequests();
      loadSecondmentNurses();
      loadLentOutNurses();
      loadSchedule();
      loadMonthlyReport();
    } catch (err) {
      message.error(`审批失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleRejectSecondment = async (id) => {
    try {
      await rejectSecondmentRequest(id);
      message.success('已拒绝借调申请');
      loadSecondmentRequests();
    } catch (err) {
      message.error(`操作失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleCancelSecondment = async (id) => {
    try {
      await cancelSecondmentRequest(id);
      message.success('已取消借调');
      loadSecondmentRequests();
      loadSecondmentNurses();
      loadLentOutNurses();
    } catch (err) {
      message.error(`操作失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleFromDeptChange = async (deptId) => {
    secondmentForm.setFieldsValue({ nurse_id: undefined });
    if (!deptId) {
      setFromDeptNurses([]);
      return;
    }
    try {
      const res = await getNurses(deptId);
      setFromDeptNurses(res.data);
    } catch (err) {
      setFromDeptNurses([]);
    }
  };

  const handleAddSkillTag = async () => {
    if (!newSkillName.trim()) {
      message.error('技能名称不能为空');
      return;
    }
    try {
      await createSkillTag(selectedDept.id, newSkillName.trim());
      setNewSkillName('');
      loadSkillTags();
      message.success('技能标签添加成功');
    } catch (err) {
      message.error(`添加失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleDeleteSkillTag = async (id) => {
    try {
      await deleteSkillTag(id);
      loadSkillTags();
      loadShiftSkillReqs();
      loadNurses();
      message.success('技能标签已删除');
    } catch (err) {
      message.error(`删除失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleOpenNurseSkillModal = (nurse) => {
    setEditingNurse(nurse);
    setEditingNurseSkills((nurse.skills || []).map(s => s.skill_id));
    setNurseSkillModalVisible(true);
  };

  const handleSaveNurseSkills = async () => {
    try {
      await updateNurseSkills(editingNurse.id, editingNurseSkills);
      message.success('护士技能更新成功');
      setNurseSkillModalVisible(false);
      loadNurses();
      loadSkillCoverageReport();
    } catch (err) {
      message.error(`更新失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleOpenSkillReqModal = () => {
    const initial = {};
    SHIFTS.forEach(shift => {
      initial[shift] = shiftSkillReqs.filter(r => r.shift === shift).map(r => r.skill_id);
    });
    setEditingSkillReqs(initial);
    setSkillReqModalVisible(true);
  };

  const handleSaveSkillReqs = async () => {
    try {
      const requirements = [];
      Object.keys(editingSkillReqs).forEach(shift => {
        editingSkillReqs[shift].forEach(skillId => {
          requirements.push({ shift, skill_id: skillId });
        });
      });
      await updateShiftSkillRequirements(selectedDept.id, requirements);
      message.success('班次技能要求更新成功');
      setSkillReqModalVisible(false);
      loadShiftSkillReqs();
      loadSkillCoverageReport();
    } catch (err) {
      message.error(`更新失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleGenerateSchedule = async () => {
    if (!selectedDept) return;
    setLoading(true);
    try {
      const res = await generateSchedule(selectedDept.id, month.format('YYYY-MM'));
      message.success('排班生成成功');
      if (res.data.fatigue_warnings && res.data.fatigue_warnings.length > 0) {
        const names = res.data.fatigue_warnings.map(w => `${w.nurse_name}(${w.total_hours}h)`).join('、');
        message.warning({ content: `疲劳预警：${names} 近7日累计工时已超过48小时`, duration: 6 });
      }
      if (res.data.skill_warnings && res.data.skill_warnings.length > 0) {
        const summary = {};
        res.data.skill_warnings.forEach(w => {
          const key = `${w.shift_name}-${w.skill_name}`;
          if (!summary[key]) summary[key] = { ...w, count: 0 };
          summary[key].count++;
        });
        const details = Object.values(summary).map(s => `${s.shift_name}缺"${s.skill_name}"(${s.count}天)`).join('、');
        message.warning({ content: `技能覆盖不足：${details}，建议调整护士技能或班次要求`, duration: 10 });
      }
      loadSchedule();
      loadMonthlyReport();
      loadFatigueStatus();
      loadSkillCoverageReport();
    } catch (err) {
      message.error(`排班生成失败: ${err.response?.data?.error || err.message}`);
    }
    setLoading(false);
  };

  const handleCellClick = (nurse, date, shift, scheduleId) => {
    setSelectedCell({ nurse, date, shift, scheduleId });
    form.setFieldsValue({
      targetNurse: undefined
    });
    setSwapModalVisible(true);
  };

  const handleSwapSubmit = async () => {
    try {
      const values = await form.validateFields();
      const targetSchedule = schedule.find(
        s => s.date === selectedCell.date && s.nurse_id === values.targetNurse
      );
      
      if (!targetSchedule) {
        message.error('该护士当天没有排班');
        return;
      }

      await createSwapRequest({
        department_id: selectedDept.id,
        requester_id: selectedCell.nurse.id,
        target_id: values.targetNurse,
        date: selectedCell.date,
        requester_shift: selectedCell.shift,
        target_shift: targetSchedule.shift
      });
      
      message.success('换班申请已提交');
      setSwapModalVisible(false);
      loadSwapRequests();
    } catch (err) {
      message.error('提交失败');
    }
  };

  const handleConfirmSwap = async (id) => {
    try {
      await confirmSwapRequest(id, nurses[0]?.id);
      message.success('已确认换班');
      loadSwapRequests();
    } catch (err) {
      message.error(`确认失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleApproveSwap = async (id) => {
    const req = swapRequests.find(r => r.id === id);
    if (req) {
      const affectedIds = [req.requester_id, req.target_id];
      const warnings = affectedIds
        .map(nid => fatigueMap[nid])
        .filter(f => f && f.is_fatigue_warning);
      if (warnings.length > 0) {
        setApproveAction({ type: 'swap', id });
        setApproveWarnings(warnings);
        setApproveConfirmVisible(true);
        return;
      }
    }
    doApproveSwap(id);
  };

  const doApproveSwap = async (id) => {
    try {
      const res = await approveSwapRequest(id);
      message.success('审批通过');
      if (res.data.fatigue_warnings && res.data.fatigue_warnings.length > 0) {
        const names = res.data.fatigue_warnings.map(w => `${w.nurse_name}(${w.total_hours}h)`).join('、');
        message.warning({ content: `疲劳预警：${names} 近7日累计工时已超过48小时`, duration: 6 });
      }
      loadSwapRequests();
      loadSchedule();
      loadMonthlyReport();
      loadFatigueStatus();
      loadSkillCoverageReport();
    } catch (err) {
      message.error(`审批失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleRejectSwap = async (id) => {
    try {
      await rejectSwapRequest(id);
      message.success('已拒绝');
      loadSwapRequests();
    } catch (err) {
      message.error(`操作失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleOvertimeSubmit = async () => {
    try {
      const values = await overtimeForm.validateFields();
      const startTime = values.startTime.format('HH:mm');
      const endTime = values.endTime.format('HH:mm');
      
      await createOvertimeRequest({
        department_id: selectedDept.id,
        nurse_id: selectedOvertimeNurse,
        date: values.date.format('YYYY-MM-DD'),
        start_time: startTime,
        end_time: endTime,
        reason: values.reason
      });
      
      message.success('加班申请已提交');
      setOvertimeModalVisible(false);
      overtimeForm.resetFields();
      loadOvertimeRequests();
    } catch (err) {
      message.error(`提交失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleApproveOvertime = async (id) => {
    const req = overtimeRequests.find(r => r.id === id);
    if (req) {
      const f = fatigueMap[req.nurse_id];
      if (f && f.is_fatigue_warning) {
        setApproveAction({ type: 'overtime', id });
        setApproveWarnings([f]);
        setApproveConfirmVisible(true);
        return;
      }
    }
    doApproveOvertime(id);
  };

  const doApproveOvertime = async (id) => {
    try {
      const res = await approveOvertimeRequest(id);
      message.success('审批通过');
      if (res.data.fatigue_warnings && res.data.fatigue_warnings.length > 0) {
        const names = res.data.fatigue_warnings.map(w => `${w.nurse_name}(${w.total_hours}h)`).join('、');
        message.warning({ content: `疲劳预警：${names} 近7日累计工时已超过48小时`, duration: 6 });
      }
      loadOvertimeRequests();
      loadMonthlyReport();
      loadFatigueStatus();
    } catch (err) {
      message.error(`审批失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleRejectOvertime = async (id) => {
    try {
      await rejectOvertimeRequest(id);
      message.success('已拒绝');
      loadOvertimeRequests();
    } catch (err) {
      message.error(`操作失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleLeaveSubmit = async () => {
    try {
      const values = await leaveForm.validateFields();
      await createLeaveRequest({
        department_id: selectedDept.id,
        nurse_id: values.nurse,
        date: values.date.format('YYYY-MM-DD'),
        leave_type: values.leaveType,
        reason: values.reason
      });
      message.success('请假申请已提交');
      setLeaveModalVisible(false);
      leaveForm.resetFields();
      setLeaveBalances({});
      loadLeaveRequests();
      loadLeaveQuotaOverview();
    } catch (err) {
      message.error(`提交失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleApproveLeave = async (id) => {
    try {
      const res = await approveLeaveRequest(id);
      if (res.data.fatigue_warnings && res.data.fatigue_warnings.length > 0) {
        const names = res.data.fatigue_warnings.map(w => `${w.nurse_name}(${w.total_hours}h)`).join('、');
        message.warning({ content: `疲劳预警：${names} 近7日累计工时已超过48小时`, duration: 6 });
      }
      if (res.data.need_manual) {
        message.warning('无可用补班人选，需要手动协调');
      } else if (res.data.substitute) {
        message.success(`请假已审批，推荐补班人: ${res.data.substitute.substitute_name}`);
      } else {
        message.success('请假已审批');
      }
      loadLeaveRequests();
      loadSchedule();
      loadMonthlyReport();
      loadLeaveSummary();
      loadFatigueStatus();
      loadLeaveQuotaOverview();
    } catch (err) {
      message.error(`审批失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleRejectLeave = async (id) => {
    try {
      await rejectLeaveRequest(id);
      message.success('已拒绝请假申请');
      loadLeaveRequests();
    } catch (err) {
      message.error(`操作失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleConfirmSubstitute = async (leaveId) => {
    const leaveReq = leaveRequests.find(l => l.id === leaveId);
    if (leaveReq && leaveReq.substitute_nurse_id) {
      const f = fatigueMap[leaveReq.substitute_nurse_id];
      if (f && f.is_fatigue_warning) {
        setApproveAction({ type: 'substitute', id: leaveId });
        setApproveWarnings([f]);
        setApproveConfirmVisible(true);
        return;
      }
    }
    doConfirmSubstitute(leaveId);
  };

  const doConfirmSubstitute = async (leaveId) => {
    try {
      const res = await confirmSubstitute(leaveId);
      message.success('补班已确认，排班已更新');
      if (res.data.fatigue_warnings && res.data.fatigue_warnings.length > 0) {
        const names = res.data.fatigue_warnings.map(w => `${w.nurse_name}(${w.total_hours}h)`).join('、');
        message.warning({ content: `疲劳预警：${names} 近7日累计工时已超过48小时`, duration: 6 });
      }
      loadLeaveRequests();
      loadSchedule();
      loadMonthlyReport();
      loadLeaveSummary();
      loadFatigueStatus();
    } catch (err) {
      message.error(`确认失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleOpenSubstituteModal = async (leave) => {
    setSelectedLeave(leave);
    setManualSubstituteNurseId(null);
    try {
      const res = await getAvailableSubstitutes(selectedDept.id, leave.date, leave.nurse_id);
      setAvailableSubstitutes(res.data);
    } catch (err) {
      message.error('获取可用补班人选失败');
    }
    setSubstituteModalVisible(true);
  };

  const handleManualSubstitute = async () => {
    if (!manualSubstituteNurseId) {
      message.error('请选择补班护士');
      return;
    }
    const f = fatigueMap[manualSubstituteNurseId];
    if (f && f.is_fatigue_warning) {
      setApproveAction({ type: 'manualSub', id: selectedLeave.id, nurseId: manualSubstituteNurseId });
      setApproveWarnings([f]);
      setApproveConfirmVisible(true);
      return;
    }
    doManualSubstitute();
  };

  const doManualSubstitute = async () => {
    try {
      const res = await manualSubstitute(selectedLeave.id, manualSubstituteNurseId);
      message.success('手动补班已确认，排班已更新');
      if (res.data.fatigue_warnings && res.data.fatigue_warnings.length > 0) {
        const names = res.data.fatigue_warnings.map(w => `${w.nurse_name}(${w.total_hours}h)`).join('、');
        message.warning({ content: `疲劳预警：${names} 近7日累计工时已超过48小时`, duration: 6 });
      }
      setSubstituteModalVisible(false);
      loadLeaveRequests();
      loadSchedule();
      loadMonthlyReport();
      loadLeaveSummary();
      loadFatigueStatus();
    } catch (err) {
      message.error(`操作失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleApproveConfirmOk = () => {
    setApproveConfirmVisible(false);
    if (!approveAction) return;
    if (approveAction.type === 'swap') {
      doApproveSwap(approveAction.id);
    } else if (approveAction.type === 'overtime') {
      doApproveOvertime(approveAction.id);
    } else if (approveAction.type === 'substitute') {
      doConfirmSubstitute(approveAction.id);
    } else if (approveAction.type === 'manualSub') {
      doManualSubstitute();
    }
    setApproveAction(null);
    setApproveWarnings([]);
  };

  const handleApproveConfirmCancel = () => {
    setApproveConfirmVisible(false);
    setApproveAction(null);
    setApproveWarnings([]);
  };

  const getDaysInView = () => {
    const year = month.year();
    const monthNum = month.month();
    const daysInMonth = dayjs(`${year}-${String(monthNum + 1).padStart(2, '0')}-01`).daysInMonth();
    const days = [];
    
    if (viewMode === 'week') {
      const startOfWeek = month.startOf('week');
      for (let i = 0; i < 7; i++) {
        days.push(startOfWeek.add(i, 'day'));
      }
    } else {
      for (let i = 1; i <= daysInMonth; i++) {
        days.push(dayjs(`${year}-${String(monthNum + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`));
      }
    }
    return days;
  };

  const getShiftForNurseAndDate = (nurseId, date) => {
    return schedule.find(s => s.nurse_id === nurseId && s.date === date.format('YYYY-MM-DD'));
  };

  const getOvertimeForNurseAndDate = (nurseId, date) => {
    return overtimeRequests.filter(
      o => o.nurse_id === nurseId && o.date === date.format('YYYY-MM-DD') && o.status === 'approved'
    );
  };

  const getLeaveForNurseAndDate = (nurseId, date) => {
    return leaveRequests.find(
      l => l.nurse_id === nurseId && l.date === date.format('YYYY-MM-DD') && l.status === 'approved'
    );
  };

  const getSubstituteInfoForDate = (date) => {
    return leaveRequests.filter(
      l => l.date === date.format('YYYY-MM-DD') && l.status === 'approved' && l.substitute_status === 'confirmed' && l.substitute_nurse_id
    );
  };

  const getSubstituteShiftForDate = (nurseId, date) => {
    const subInfo = getSubstituteInfoForDate(date).find(s => s.substitute_nurse_id === nurseId);
    if (!subInfo) return null;
    const originalShift = schedule.find(s => s.nurse_id === subInfo.nurse_id && s.date === date.format('YYYY-MM-DD'));
    return originalShift || null;
  };

  const days = getDaysInView();
  const pendingSwapCount = swapRequests.filter(r => r.status === 'pending' || r.status === 'confirmed').length;
  const pendingOvertimeCount = overtimeRequests.filter(r => r.status === 'pending').length;
  const pendingLeaveCount = leaveRequests.filter(r => r.status === 'pending').length;

  const getChartOption = () => {
    const names = monthlyReport.map(r => {
      const typeLabel = r.nurse_type === 'borrowed' ? '(借入)' : r.nurse_type === 'lent_out' ? '(外借)' : '';
      return `${r.nurse_name}${typeLabel}`;
    });
    const normalHours = monthlyReport.map(r => r.normal_hours);
    const substituteHours = monthlyReport.map(r => r.substitute_hours || 0);
    const overtimeHours = monthlyReport.map(r => r.overtime_hours);
    
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' }
      },
      legend: {
        data: ['正常工时', '补班工时', '加班工时'],
        bottom: 0
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '10%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        data: names,
        axisLabel: {
          rotate: 30,
          interval: 0
        }
      },
      yAxis: {
        type: 'value',
        name: '小时'
      },
      series: [
        {
          name: '正常工时',
          type: 'bar',
          stack: 'total',
          data: normalHours,
          itemStyle: { color: '#1890ff' },
          barWidth: '30%'
        },
        {
          name: '补班工时',
          type: 'bar',
          stack: 'total',
          data: substituteHours,
          itemStyle: { color: '#13c2c2' },
          barWidth: '30%'
        },
        {
          name: '加班工时',
          type: 'bar',
          stack: 'total',
          data: overtimeHours,
          itemStyle: { color: '#fa8c16' },
          barWidth: '30%'
        }
      ]
    };
  };

  const reportColumns = [
    {
      title: '护士姓名',
      dataIndex: 'nurse_name',
      key: 'nurse_name',
      width: 100,
      fixed: 'left',
      render: (text, record) => (
        <span>
          {text}
          {record.nurse_type && record.nurse_type !== 'own' && (
            <Tag color={NURSE_TYPE_LABELS[record.nurse_type]?.color} style={{ marginLeft: 4, fontSize: '10px', padding: '0 4px', lineHeight: '16px' }}>
              {NURSE_TYPE_LABELS[record.nurse_type]?.text}
            </Tag>
          )}
        </span>
      )
    },
    {
      title: '类型',
      dataIndex: 'nurse_type',
      key: 'nurse_type',
      width: 70,
      align: 'center',
      render: (val) => val ? (
        <Tag color={NURSE_TYPE_LABELS[val]?.color || 'default'}>
          {NURSE_TYPE_LABELS[val]?.text || val}
        </Tag>
      ) : <Tag color="blue">本科室</Tag>
    },
    {
      title: '来源/去向',
      key: 'dept_info',
      width: 120,
      align: 'center',
      render: (_, record) => {
        if (record.nurse_type === 'borrowed') return <span style={{ fontSize: '12px', color: '#fa8c16' }}>来自{record.borrowed_from}</span>;
        if (record.nurse_type === 'lent_out') return <span style={{ fontSize: '12px', color: '#722ed1' }}>借至{record.lent_out_to}</span>;
        return <span style={{ color: '#999' }}>—</span>;
      }
    },
    {
      title: '排班班次',
      dataIndex: 'normal_shift_count',
      key: 'normal_shift_count',
      width: 80,
      align: 'center'
    },
    {
      title: '请假天数',
      dataIndex: 'leave_count',
      key: 'leave_count',
      width: 80,
      align: 'center',
      render: (val) => val > 0 ? <Tag color="red">{val}</Tag> : 0
    },
    {
      title: '补班次数',
      dataIndex: 'substitute_shifts',
      key: 'substitute_shifts',
      width: 80,
      align: 'center',
      render: (val) => val > 0 ? <Tag color="cyan">{val}</Tag> : 0
    },
    {
      title: '有效班次',
      dataIndex: 'effective_shift_count',
      key: 'effective_shift_count',
      width: 80,
      align: 'center'
    },
    {
      title: '正常工时',
      dataIndex: 'normal_hours',
      key: 'normal_hours',
      width: 90,
      align: 'center'
    },
    {
      title: '补班工时',
      dataIndex: 'substitute_hours',
      key: 'substitute_hours',
      width: 90,
      align: 'center',
      render: (val) => val > 0 ? <Tag color="cyan">{val}h</Tag> : '0h'
    },
    {
      title: '加班工时',
      dataIndex: 'overtime_hours',
      key: 'overtime_hours',
      width: 90,
      align: 'center'
    },
    {
      title: '总工时',
      dataIndex: 'total_hours',
      key: 'total_hours',
      width: 80,
      align: 'center',
      render: (text) => <strong>{text}</strong>
    }
  ];

  const leaveSummaryColumns = [
    {
      title: '护士',
      dataIndex: 'nurse_name',
      key: 'nurse_name',
      width: 100
    },
    {
      title: '事假',
      dataIndex: 'personal_days',
      key: 'personal_days',
      width: 70,
      align: 'center',
      render: (val) => val > 0 ? <Tag color="red">{val}天</Tag> : '0'
    },
    {
      title: '病假',
      dataIndex: 'sick_days',
      key: 'sick_days',
      width: 70,
      align: 'center',
      render: (val) => val > 0 ? <Tag color="orange">{val}天</Tag> : '0'
    },
    {
      title: '年假',
      dataIndex: 'annual_days',
      key: 'annual_days',
      width: 70,
      align: 'center',
      render: (val) => val > 0 ? <Tag color="blue">{val}天</Tag> : '0'
    },
    {
      title: '请假合计',
      dataIndex: 'total_leave_days',
      key: 'total_leave_days',
      width: 80,
      align: 'center',
      render: (val) => <strong>{val}</strong>
    },
    {
      title: '补班次数',
      dataIndex: 'substitute_count',
      key: 'substitute_count',
      width: 80,
      align: 'center',
      render: (val) => val > 0 ? <Tag color="cyan">{val}次</Tag> : '0'
    }
  ];

  const rightPanelItems = [
    {
      key: 'leave',
      label: (
        <span>
          请假审批
          {pendingLeaveCount > 0 && <Badge count={pendingLeaveCount} style={{ marginLeft: 8 }} />}
        </span>
      ),
      children: (
        <div style={{ padding: '8px 0' }}>
          {leaveRequests.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
              暂无请假申请
            </div>
          ) : (
            leaveRequests.map(req => (
              <div 
                key={req.id} 
                style={{ 
                  border: '1px solid #e8e8e8', 
                  borderRadius: '8px', 
                  padding: '12px', 
                  marginBottom: '12px',
                  background: '#fafafa'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: '500' }}>{req.date}</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Tag color={LEAVE_TYPE_COLORS[req.leave_type]}>
                      {LEAVE_TYPE_NAMES[req.leave_type]}
                    </Tag>
                    <Tag color={
                      req.status === 'pending' ? 'gold' :
                      req.status === 'approved' ? 'green' : 'red'
                    }>
                      {req.status === 'pending' ? '待审批' :
                       req.status === 'approved' ? '已通过' : '已拒绝'}
                    </Tag>
                  </div>
                </div>
                <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>
                  <div><strong>{req.nurse_name}</strong></div>
                  {req.reason && <div style={{ fontSize: '12px' }}>原因: {req.reason}</div>}
                </div>
                <LeaveQuotaInline nurseId={req.nurse_id} leaveBalances={leaveBalances} />
                {req.status === 'approved' && (
                  <div style={{ fontSize: '13px', marginBottom: '8px', padding: '8px', background: '#e6f7ff', borderRadius: '4px', border: '1px solid #91d5ff' }}>
                    {req.substitute_status === 'pending' && req.substitute_name && (
                      <div>
                        <div>推荐补班: <strong>{req.substitute_name}</strong></div>
                        {fatigueMap[req.substitute_nurse_id]?.is_fatigue_warning && (
                          <div style={{ color: '#fa8c16', fontSize: '12px', marginTop: '2px' }}>
                            ⚠ {req.substitute_name} 近7日累计{fatigueMap[req.substitute_nurse_id].total_hours}小时，已达疲劳预警
                          </div>
                        )}
                        <div style={{ marginTop: '4px' }}>
                          <Button size="small" type="primary" onClick={() => handleConfirmSubstitute(req.id)}>
                            确认补班
                          </Button>
                        </div>
                      </div>
                    )}
                    {req.substitute_status === 'confirmed' && req.substitute_name && (
                      <div>补班人: <Tag color="green">{req.substitute_name}</Tag> 已确认</div>
                    )}
                    {req.substitute_status === 'none' && (
                      <div>
                        <div style={{ color: '#ff4d4f' }}>无可用补班人选，需要手动协调</div>
                        <div style={{ marginTop: '4px' }}>
                          <Button size="small" type="primary" onClick={() => handleOpenSubstituteModal(req)}>
                            手动指定补班
                          </Button>
                        </div>
                      </div>
                    )}
                    {req.substitute_status === 'manual' && !req.substitute_nurse_id && (
                      <div>
                        <div style={{ color: '#fa8c16' }}>待手动协调补班人选</div>
                        <div style={{ marginTop: '4px' }}>
                          <Button size="small" type="primary" onClick={() => handleOpenSubstituteModal(req)}>
                            指定补班人
                          </Button>
                        </div>
                      </div>
                    )}
                    {!req.substitute_status && (
                      <div style={{ color: '#999' }}>当天无排班，无需补班</div>
                    )}
                  </div>
                )}
                {req.status === 'pending' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <Button size="small" type="primary" onClick={() => handleApproveLeave(req.id)}>
                      通过
                    </Button>
                    <Button size="small" danger onClick={() => handleRejectLeave(req.id)}>
                      拒绝
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )
    },
    {
      key: 'swap',
      label: (
        <span>
          换班审批
          {pendingSwapCount > 0 && <Badge count={pendingSwapCount} style={{ marginLeft: 8 }} />}
        </span>
      ),
      children: (
        <div style={{ padding: '8px 0' }}>
          {swapRequests.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
              暂无换班申请
            </div>
          ) : (
            swapRequests.map(req => (
              <div 
                key={req.id} 
                style={{ 
                  border: '1px solid #e8e8e8', 
                  borderRadius: '8px', 
                  padding: '12px', 
                  marginBottom: '12px',
                  background: '#fafafa'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: '500' }}>{req.date}</span>
                  <Tag color={
                    req.status === 'pending' ? 'gold' :
                    req.status === 'confirmed' ? 'blue' :
                    req.status === 'approved' ? 'green' : 'red'
                  }>
                    {req.status === 'pending' ? '待确认' :
                     req.status === 'confirmed' ? '待审批' :
                     req.status === 'approved' ? '已通过' : '已拒绝'}
                  </Tag>
                </div>
                <div style={{ fontSize: '14px', color: '#666', marginBottom: '12px' }}>
                  <div>{req.requester_name} ({SHIFT_NAMES[req.requester_shift]}) ↔ {req.target_name} ({SHIFT_NAMES[req.target_shift]})</div>
                </div>
                {req.status === 'confirmed' && (() => {
                  const warnings = [req.requester_id, req.target_id]
                    .map(nid => fatigueMap[nid])
                    .filter(f => f && f.is_fatigue_warning);
                  if (warnings.length > 0) {
                    return (
                      <div style={{ padding: '6px 8px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: '4px', marginBottom: '8px', fontSize: '12px', color: '#fa8c16' }}>
                        ⚠ 疲劳预警：{warnings.map(w => `${w.nurse_name}近7日${w.total_hours}h`).join('、')}
                      </div>
                    );
                  }
                  return null;
                })()}
                {req.status === 'pending' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <Button size="small" onClick={() => handleConfirmSwap(req.id)}>
                      确认
                    </Button>
                    <Button size="small" danger onClick={() => handleRejectSwap(req.id)}>
                      拒绝
                    </Button>
                  </div>
                )}
                {req.status === 'confirmed' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <Button size="small" type="primary" onClick={() => handleApproveSwap(req.id)}>
                      通过
                    </Button>
                    <Button size="small" danger onClick={() => handleRejectSwap(req.id)}>
                      拒绝
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )
    },
    {
      key: 'overtime',
      label: (
        <span>
          加班审批
          {pendingOvertimeCount > 0 && <Badge count={pendingOvertimeCount} style={{ marginLeft: 8 }} />}
        </span>
      ),
      children: (
        <div style={{ padding: '8px 0' }}>
          {overtimeRequests.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
              暂无加班申请
            </div>
          ) : (
            overtimeRequests.map(req => (
              <div 
                key={req.id} 
                style={{ 
                  border: '1px solid #e8e8e8', 
                  borderRadius: '8px', 
                  padding: '12px', 
                  marginBottom: '12px',
                  background: '#fafafa'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: '500' }}>{req.date}</span>
                  <Tag color={OVERTIME_STATUS[req.status].color}>
                    {OVERTIME_STATUS[req.status].text}
                  </Tag>
                </div>
                <div style={{ fontSize: '14px', color: '#666', marginBottom: '8px' }}>
                  <div><strong>{req.nurse_name}</strong></div>
                  <div>时段: {req.start_time} - {req.end_time} ({req.hours}小时)</div>
                  {req.reason && <div>原因: {req.reason}</div>}
                </div>
                {req.status === 'pending' && fatigueMap[req.nurse_id]?.is_fatigue_warning && (
                  <div style={{ padding: '6px 8px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: '4px', marginBottom: '8px', fontSize: '12px', color: '#fa8c16' }}>
                    ⚠ 疲劳预警：{req.nurse_name} 近7日累计{fatigueMap[req.nurse_id].total_hours}小时
                  </div>
                )}
                {req.status === 'pending' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <Button size="small" type="primary" onClick={() => handleApproveOvertime(req.id)}>
                      通过
                    </Button>
                    <Button size="small" danger onClick={() => handleRejectOvertime(req.id)}>
                      拒绝
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )
    },
    {
      key: 'secondment',
      label: (
        <span>
          借调管理
          {secondmentRequests.filter(r => r.status === 'pending' && r.from_department_id === selectedDept?.id).length > 0 && <Badge count={secondmentRequests.filter(r => r.status === 'pending' && r.from_department_id === selectedDept?.id).length} style={{ marginLeft: 8 }} />}
        </span>
      ),
      children: (
        <div style={{ padding: '8px 0' }}>
          {lentOutNurses.length > 0 && (
            <div style={{ marginBottom: '12px', padding: '8px', background: '#f9f0ff', borderRadius: '4px', border: '1px solid #d3adf7' }}>
              <div style={{ fontWeight: '500', color: '#722ed1', marginBottom: '4px', fontSize: '12px' }}>当前外借护士</div>
              {lentOutNurses.map(s => (
                <div key={s.id} style={{ fontSize: '12px', color: '#666', marginBottom: '2px' }}>
                  {s.nurse_name} → {s.to_department_name} ({s.start_date} ~ {s.end_date})
                </div>
              ))}
            </div>
          )}
          {secondmentNurses.length > 0 && (
            <div style={{ marginBottom: '12px', padding: '8px', background: '#fff7e6', borderRadius: '4px', border: '1px solid #ffd591' }}>
              <div style={{ fontWeight: '500', color: '#fa8c16', marginBottom: '4px', fontSize: '12px' }}>当前借入护士</div>
              {secondmentNurses.map(s => (
                <div key={s.id} style={{ fontSize: '12px', color: '#666', marginBottom: '2px' }}>
                  {s.nurse_name} ← {s.from_department_name} ({s.start_date} ~ {s.end_date})
                </div>
              ))}
            </div>
          )}
          <div style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '13px', fontWeight: '500' }}>借调记录</span>
            <Select
              size="small"
              allowClear
              placeholder="按状态筛选"
              style={{ width: 120 }}
              value={secondmentStatusFilter}
              onChange={(val) => setSecondmentStatusFilter(val)}
            >
              <Option value="pending">待审批</Option>
              <Option value="approved">已通过</Option>
              <Option value="rejected">已拒绝</Option>
              <Option value="cancelled">已取消</Option>
            </Select>
          </div>
          {secondmentRequests.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '40px 0' }}>
              暂无借调记录
            </div>
          ) : (
            (secondmentStatusFilter ? secondmentRequests.filter(r => r.status === secondmentStatusFilter) : secondmentRequests).map(req => (
              <div
                key={req.id}
                style={{
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  padding: '12px',
                  marginBottom: '12px',
                  background: '#fafafa'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: '500', fontSize: '13px' }}>{req.from_department_name} → {req.to_department_name}</span>
                  <Tag color={SECONMENT_STATUS[req.status].color}>
                    {SECONMENT_STATUS[req.status].text}
                  </Tag>
                </div>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>
                  <div><strong>{req.nurse_name}</strong> ({req.nurse_level === 'senior' ? '资深' : '普通'})</div>
                  <div>日期: {req.start_date} ~ {req.end_date}</div>
                  {req.shifts && req.shifts !== 'all' && <div>班次: {req.shifts.split(',').map(s => SHIFT_NAMES[s]).join(', ')}</div>}
                  {req.reason && <div style={{ fontSize: '12px', color: '#999' }}>原因: {req.reason}</div>}
                </div>
                {req.status === 'pending' && req.from_department_id === selectedDept?.id && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '8px' }}>
                    <Button size="small" type="primary" onClick={() => handleApproveSecondment(req.id)}>
                      同意借出
                    </Button>
                    <Button size="small" danger onClick={() => handleRejectSecondment(req.id)}>
                      拒绝
                    </Button>
                  </div>
                )}
                {req.status === 'approved' && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                    <Popconfirm title="确定取消此借调?" onConfirm={() => handleCancelSecondment(req.id)}>
                      <Button size="small" danger>取消借调</Button>
                    </Popconfirm>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )
    }
  ];

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider width={200} theme="light" style={{ borderRight: '1px solid #e8e8e8' }}>
        <div style={{ padding: '16px', fontSize: '18px', fontWeight: 'bold', borderBottom: '1px solid #e8e8e8' }}>
          科室列表
        </div>
        <Menu
          mode="inline"
          selectedKeys={selectedDept ? [String(selectedDept.id)] : []}
          style={{ borderRight: 'none' }}
          items={departments.map(dept => ({
            key: dept.id,
            label: dept.name,
            onClick: () => setSelectedDept(dept)
          }))}
        />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 24px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0 }}>{selectedDept?.name || '护理排班系统'}</h2>
            <DatePicker 
              picker="month" 
              value={month} 
              onChange={(date) => date && setMonth(date)}
              allowClear={false}
            />
            <Radio.Group value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
              <Radio.Button value="week">周视图</Radio.Button>
              <Radio.Button value="month">月视图</Radio.Button>
            </Radio.Group>
            <div style={{ display: 'flex', gap: '16px', marginLeft: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '16px', height: '16px', background: SHIFT_COLORS.morning, borderRadius: '2px' }}></div>
                <span>早班</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '16px', height: '16px', background: SHIFT_COLORS.afternoon, borderRadius: '2px' }}></div>
                <span>中班</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '16px', height: '16px', background: SHIFT_COLORS.night, borderRadius: '2px' }}></div>
                <span>夜班</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '16px', height: '16px', background: '#ff4d4f', borderRadius: '2px' }}></div>
                <span>请假</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '16px', height: '16px', background: '#13c2c2', borderRadius: '2px' }}></div>
                <span>补班</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '16px', height: '16px', background: '#fa8c16', borderRadius: '2px' }}></div>
                <span>疲劳预警</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <div style={{ width: '16px', height: '16px', background: '#722ed1', borderRadius: '2px', border: '2px dashed #722ed1' }}></div>
                <span>借调</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button onClick={() => {
              leaveForm.resetFields();
              setLeaveModalVisible(true);
            }}>
              申请请假
            </Button>
            <Button onClick={() => {
              setSelectedOvertimeNurse(null);
              overtimeForm.resetFields();
              setOvertimeModalVisible(true);
            }}>
              申请加班
            </Button>
            <Button onClick={() => {
              secondmentForm.resetFields();
              setFromDeptNurses([]);
              setSecondmentModalVisible(true);
            }}>
              发起借调
            </Button>
            <Button type="primary" loading={loading} onClick={handleGenerateSchedule}>
              生成排班
            </Button>
          </div>
        </Header>
        <Layout>
          <Content style={{ padding: '24px', overflow: 'auto' }}>
            <FatigueWarningBanner 
              fatigueData={fatigueData} 
              expanded={fatigueBannerExpanded} 
              onToggle={() => setFatigueBannerExpanded(!fatigueBannerExpanded)} 
            />
            <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', marginBottom: '24px' }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: days.length * 70 + 150 }}>
                  <thead>
                    <tr>
                      <th style={{ border: '1px solid #e8e8e8', padding: '8px', background: '#fafafa', minWidth: '120px', textAlign: 'left' }}>
                        护士
                      </th>
                      {days.map(day => (
                        <th key={day.format('YYYY-MM-DD')} style={{ border: '1px solid #e8e8e8', padding: '8px', background: '#fafafa', minWidth: '60px', textAlign: 'center' }}>
                          <div>{day.format('MM-DD')}</div>
                          <div style={{ fontSize: '12px', color: '#999' }}>{day.format('ddd')}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {nurses.map(nurse => {
                      const isFatigue = fatigueMap[nurse.id]?.is_fatigue_warning;
                      const fatigueHours = fatigueMap[nurse.id]?.total_hours;
                      const nurseSecondment = scheduleSecondments.find(s => s.nurse_id === nurse.id);
                      const isLentOut = !!nurseSecondment;
                      return (
                        <tr key={nurse.id}>
                          <td style={{ border: '1px solid #e8e8e8', padding: '8px', textAlign: 'left', background: isFatigue ? '#fff7e6' : (isLentOut ? '#f9f0ff' : 'transparent') }}>
                            <Tooltip title={isFatigue ? `近7日累计${fatigueHours}小时` : (isLentOut ? `借调至${nurseSecondment.to_department_name || '其他科室'}` : '')}>
                              <span style={{ color: isFatigue ? '#fa8c16' : (isLentOut ? '#722ed1' : 'inherit'), fontWeight: isFatigue || isLentOut ? '600' : 'normal' }}>
                                {nurse.name}
                              </span>
                            </Tooltip>
                            {isLentOut && (
                              <Tag color="purple" style={{ fontSize: '10px', padding: '0 4px', lineHeight: '16px', marginTop: '2px', display: 'inline-block' }}>外借</Tag>
                            )}
                            <div style={{ fontSize: '12px', color: nurse.level === 'senior' ? '#fa8c16' : '#999' }}>
                              {nurse.level === 'senior' ? '资深' : '普通'}
                            </div>
                            {nurse.skills && nurse.skills.length > 0 && (
                              <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                                {nurse.skills.map(s => (
                                  <Tag key={s.skill_id} style={{ fontSize: '10px', padding: '0 4px', lineHeight: '16px', margin: 0 }} color="blue">{s.skill_name}</Tag>
                                ))}
                              </div>
                            )}
                            {isFatigue && (
                              <div style={{ fontSize: '11px', color: '#fa8c16', marginTop: '2px' }}>⚠ 疲劳预警</div>
                            )}
                            <Button size="small" type="link" style={{ fontSize: '11px', padding: 0, height: 'auto' }} onClick={() => handleOpenNurseSkillModal(nurse)}>
                              编辑技能
                            </Button>
                          </td>
                          {days.map(day => {
                            const dateStr = day.format('YYYY-MM-DD');
                            const shift = getShiftForNurseAndDate(nurse.id, day);
                            const overtimes = getOvertimeForNurseAndDate(nurse.id, day);
                            const leave = getLeaveForNurseAndDate(nurse.id, day);
                            const subInfo = getSubstituteInfoForDate(day).find(s => s.substitute_nurse_id === nurse.id);
                            const subOriginalShift = subInfo ? getSubstituteShiftForDate(nurse.id, day) : null;

                            const isLeave = leave && shift;
                            const isSubstitute = subInfo && !isLeave;
                            const isSecondmentShift = shift && shift.is_secondment;

                            return (
                              <td 
                                key={dateStr} 
                                style={{ 
                                  border: '1px solid #e8e8e8', 
                                  padding: '4px', 
                                  textAlign: 'center', 
                                  verticalAlign: 'top',
                                  background: isLeave ? '#fff1f0' : (isSubstitute ? '#e6fffb' : (isFatigue ? '#fffbe6' : (isLentOut ? '#f9f0ff' : 'transparent')))
                                }}
                              >
                                {shift && !isSubstitute && (
                                  <div 
                                    style={{ 
                                      padding: '4px 8px', 
                                      borderRadius: '4px', 
                                      color: '#fff', 
                                      fontSize: '12px',
                                      background: isLeave ? '#ff4d4f' : (isSecondmentShift ? '#722ed1' : SHIFT_COLORS[shift.shift]),
                                      marginBottom: '4px',
                                      cursor: 'pointer',
                                      textDecoration: isLeave ? 'line-through' : 'none',
                                      border: isSecondmentShift ? '2px dashed #531dab' : 'none'
                                    }}
                                    onClick={() => handleCellClick(nurse, dateStr, shift.shift, shift.id)}
                                  >
                                    {isLeave ? `请假(${LEAVE_TYPE_NAMES[leave.leave_type]})` : SHIFT_NAMES[shift.shift]}
                                    {isSecondmentShift && !isLeave && <span style={{ marginLeft: '2px', fontSize: '10px' }}>借</span>}
                                    {shiftSkillReqs.filter(r => r.shift === shift.shift).length > 0 && !isLeave && (
                                      <Tooltip title={`技能要求: ${shiftSkillReqs.filter(r => r.shift === shift.shift).map(r => r.skill_name).join(', ')}`}>
                                        <span style={{ marginLeft: '4px', fontSize: '10px' }}>🔧</span>
                                      </Tooltip>
                                    )}
                                  </div>
                                )}
                                {isSubstitute && (
                                  <div 
                                    style={{ 
                                      padding: '4px 8px', 
                                      borderRadius: '4px', 
                                      color: '#fff', 
                                      fontSize: '12px',
                                      background: '#13c2c2',
                                      marginBottom: '4px'
                                    }}
                                  >
                                    补班({subOriginalShift ? SHIFT_NAMES[subOriginalShift.shift] : '—'})
                                  </div>
                                )}
                                {!shift && leave && !isSubstitute && (
                                  <div 
                                    style={{ 
                                      padding: '4px 8px', 
                                      borderRadius: '4px', 
                                      color: '#fff', 
                                      fontSize: '11px',
                                      background: '#ff4d4f',
                                      marginBottom: '4px'
                                    }}
                                  >
                                    {LEAVE_TYPE_NAMES[leave.leave_type]}
                                  </div>
                                )}
                                {overtimes.map((ot, idx) => (
                                  <div 
                                    key={idx}
                                    style={{ 
                                      padding: '2px 4px', 
                                      borderRadius: '2px', 
                                      color: '#fff', 
                                      fontSize: '10px',
                                      background: '#fa8c16',
                                      marginTop: '2px'
                                    }}
                                    title={`加班: ${ot.start_time}-${ot.end_time} (${ot.hours}小时)`}
                                  >
                                    加班{ot.hours}h
                                  </div>
                                ))}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', marginBottom: '24px' }}>
              <h3 style={{ marginTop: 0, marginBottom: '16px' }}>月度工时统计</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                <div>
                  <h4 style={{ marginTop: 0, marginBottom: '12px' }}>工时对比图</h4>
                  <ReactECharts 
                    option={getChartOption()} 
                    style={{ height: '350px', width: '100%' }}
                    notMerge={true}
                    lazyUpdate={true}
                  />
                </div>
                <div>
                  <h4 style={{ marginTop: 0, marginBottom: '12px' }}>工时明细表</h4>
                  <Table
                    columns={reportColumns}
                    dataSource={monthlyReport}
                    rowKey="nurse_id"
                    size="small"
                    pagination={false}
                    scroll={{ y: 300 }}
                  />
                </div>
              </div>
            </div>

            <div style={{ background: '#fff', padding: '24px', borderRadius: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ marginTop: 0, marginBottom: 0 }}>假期额度总览</h3>
                <Button size="small" onClick={() => {
                  setEditingQuotaConfig({
                    sick_days: leaveQuotaConfig?.sick_days || 15,
                    personal_days: leaveQuotaConfig?.personal_days || 5
                  });
                  setQuotaConfigModalVisible(true);
                }}>额度配置</Button>
              </div>
              <Table
                columns={[
                  { title: '护士', dataIndex: 'nurse_name', key: 'nurse_name', width: 80 },
                  { title: '工龄', dataIndex: 'years_of_service', key: 'years_of_service', width: 60, align: 'center', render: v => `${v}年` },
                  {
                    title: '年假',
                    key: 'annual',
                    width: 140,
                    align: 'center',
                    render: (_, r) => r.annual ? (
                      <div>
                        <span style={{ color: r.annual.remaining <= 0 ? '#ff4d4f' : '#1890ff' }}>
                          {r.annual.used}/{r.annual.total}天
                        </span>
                        <span style={{ fontSize: '11px', color: r.annual.remaining <= 0 ? '#ff4d4f' : '#52c41a', marginLeft: '4px' }}>
                          {r.annual.remaining <= 0 ? '已用完' : `余${r.annual.remaining}天`}
                        </span>
                      </div>
                    ) : '-'
                  },
                  {
                    title: '病假',
                    key: 'sick',
                    width: 140,
                    align: 'center',
                    render: (_, r) => r.sick ? (
                      <div>
                        <span style={{ color: r.sick.remaining <= 0 ? '#ff4d4f' : '#fa8c16' }}>
                          {r.sick.used}/{r.sick.total}天
                        </span>
                        <span style={{ fontSize: '11px', color: r.sick.remaining <= 0 ? '#ff4d4f' : '#52c41a', marginLeft: '4px' }}>
                          {r.sick.remaining <= 0 ? '已用完' : `余${r.sick.remaining}天`}
                        </span>
                      </div>
                    ) : '-'
                  },
                  {
                    title: '事假',
                    key: 'personal',
                    width: 140,
                    align: 'center',
                    render: (_, r) => r.personal ? (
                      <div>
                        <span style={{ color: r.personal.remaining <= 0 ? '#ff4d4f' : '#ff4d4f' }}>
                          {r.personal.used}/{r.personal.total}天
                        </span>
                        <span style={{ fontSize: '11px', color: r.personal.remaining <= 0 ? '#ff4d4f' : '#52c41a', marginLeft: '4px' }}>
                          {r.personal.remaining <= 0 ? '已用完' : `余${r.personal.remaining}天`}
                        </span>
                      </div>
                    ) : '-'
                  }
                ]}
                dataSource={leaveQuotaOverview}
                rowKey="nurse_id"
                size="small"
                pagination={false}
              />
            </div>

            <div style={{ background: '#fff', padding: '24px', borderRadius: '8px', marginTop: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ margin: 0 }}>技能管理</h3>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <Button size="small" onClick={handleOpenSkillReqModal}>班次技能要求</Button>
                  <Button size="small" type="primary" onClick={() => {
                    setCoverageReportVisible(true);
                    loadSkillCoverageReport();
                  }}>技能覆盖率报告</Button>
                </div>
              </div>
              
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>技能标签</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                  {skillTags.map(tag => (
                    <Tag key={tag.id} closable onClose={() => handleDeleteSkillTag(tag.id)} color="blue">
                      {tag.name}
                    </Tag>
                  ))}
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <Input 
                      size="small" 
                      placeholder="新技能名称" 
                      value={newSkillName} 
                      onChange={(e) => setNewSkillName(e.target.value)}
                      onPressEnter={handleAddSkillTag}
                      style={{ width: '120px' }}
                    />
                    <Button size="small" type="primary" onClick={handleAddSkillTag}>添加</Button>
                  </div>
                </div>
              </div>

              <div>
                <div style={{ fontSize: '14px', fontWeight: '500', marginBottom: '8px' }}>班次技能要求</div>
                {SHIFTS.map(shift => {
                  const reqs = shiftSkillReqs.filter(r => r.shift === shift);
                  return (
                    <div key={shift} style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Tag color={SHIFT_COLORS[shift]}>{SHIFT_NAMES[shift]}</Tag>
                      {reqs.length > 0 ? reqs.map(r => (
                        <Tag key={r.skill_id} color="orange">{r.skill_name}</Tag>
                      )) : <span style={{ color: '#999', fontSize: '12px' }}>无技能要求</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </Content>
          <Sider width={350} theme="light" style={{ borderLeft: '1px solid #e8e8e8' }}>
            <div style={{ height: 'calc(100vh - 64px)', overflowY: 'auto' }}>
              <Tabs 
                defaultActiveKey="leave" 
                items={rightPanelItems}
                style={{ padding: '0 16px' }}
              />
            </div>
          </Sider>
        </Layout>
      </Layout>

      <Modal
        title="申请换班"
        open={swapModalVisible}
        onOk={handleSwapSubmit}
        onCancel={() => setSwapModalVisible(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="您的班次">
            <div>
              {selectedCell?.date} - {selectedCell?.nurse?.name} - {SHIFT_NAMES[selectedCell?.shift]}
            </div>
          </Form.Item>
          <Form.Item 
            name="targetNurse" 
            label="选择换班护士" 
            rules={[{ required: true, message: '请选择换班护士' }]}
          >
            <Select placeholder="请选择护士">
              {nurses.filter(n => n.id !== selectedCell?.nurse?.id).map(nurse => (
                <Option key={nurse.id} value={nurse.id}>
                  {nurse.name} ({nurse.level === 'senior' ? '资深' : '普通'})
                  {fatigueMap[nurse.id]?.is_fatigue_warning && <Tag color="orange" style={{ marginLeft: 4 }}>疲劳预警</Tag>}
                </Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="申请加班"
        open={overtimeModalVisible}
        onOk={handleOvertimeSubmit}
        onCancel={() => setOvertimeModalVisible(false)}
        width={500}
      >
        <Form form={overtimeForm} layout="vertical">
          <Form.Item 
            name="nurse" 
            label="申请人" 
            rules={[{ required: true, message: '请选择申请人' }]}
          >
            <Select 
              placeholder="请选择护士" 
              onChange={(value) => setSelectedOvertimeNurse(value)}
            >
              {nurses.map(nurse => (
                <Option key={nurse.id} value={nurse.id}>
                  {nurse.name} ({nurse.level === 'senior' ? '资深' : '普通'})
                  {fatigueMap[nurse.id]?.is_fatigue_warning && <Tag color="orange" style={{ marginLeft: 4 }}>疲劳预警</Tag>}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item 
            name="date" 
            label="加班日期" 
            rules={[{ required: true, message: '请选择加班日期' }]}
          >
            <DatePicker style={{ width: '100%' }} placeholder="请选择日期" />
          </Form.Item>
          <div style={{ display: 'flex', gap: '16px' }}>
            <Form.Item 
              name="startTime" 
              label="开始时间" 
              rules={[{ required: true, message: '请选择开始时间' }]}
              style={{ flex: 1 }}
            >
              <TimePicker format="HH:mm" style={{ width: '100%' }} placeholder="开始时间" />
            </Form.Item>
            <Form.Item 
              name="endTime" 
              label="结束时间" 
              rules={[{ required: true, message: '请选择结束时间' }]}
              style={{ flex: 1 }}
            >
              <TimePicker format="HH:mm" style={{ width: '100%' }} placeholder="结束时间" />
            </Form.Item>
          </div>
          <Form.Item name="reason" label="加班原因">
            <TextArea rows={3} placeholder="请输入加班原因（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="申请请假"
        open={leaveModalVisible}
        onOk={handleLeaveSubmit}
        onCancel={() => setLeaveModalVisible(false)}
        width={500}
      >
        <Form form={leaveForm} layout="vertical">
          <Form.Item 
            name="nurse" 
            label="申请人" 
            rules={[{ required: true, message: '请选择申请人' }]}
          >
            <Select placeholder="请选择护士" onChange={(val) => loadNurseLeaveBalance(val)}>
              {nurses.map(nurse => (
                <Option key={nurse.id} value={nurse.id}>
                  {nurse.name} ({nurse.level === 'senior' ? '资深' : '普通'})
                  {fatigueMap[nurse.id]?.is_fatigue_warning && <Tag color="orange" style={{ marginLeft: 4 }}>疲劳预警</Tag>}
                </Option>
              ))}
            </Select>
          </Form.Item>
          {leaveForm.getFieldValue('nurse') && leaveBalances[leaveForm.getFieldValue('nurse')] && (
            <div style={{ marginBottom: '16px', padding: '12px', background: '#f6f6f6', borderRadius: '6px' }}>
              <div style={{ fontWeight: '500', marginBottom: '8px', fontSize: '13px' }}>假期额度</div>
              {['annual', 'sick', 'personal'].map(type => {
                const b = leaveBalances[leaveForm.getFieldValue('nurse')][type];
                if (!b) return null;
                const percent = b.total > 0 ? Math.round((b.used / b.total) * 100) : 0;
                const isExhausted = b.remaining <= 0;
                return (
                  <div key={type} style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: '40px', fontSize: '12px', color: isExhausted ? '#999' : LEAVE_TYPE_COLORS[type] }}>
                      {LEAVE_TYPE_NAMES[type]}
                    </span>
                    <Progress 
                      percent={percent} 
                      size="small" 
                      strokeColor={isExhausted ? '#d9d9d9' : LEAVE_TYPE_COLORS[type]}
                      style={{ flex: 1, marginBottom: 0 }}
                      format={() => `${b.used}/${b.total}天`}
                    />
                    <span style={{ fontSize: '12px', color: isExhausted ? '#ff4d4f' : '#52c41a', whiteSpace: 'nowrap' }}>
                      {isExhausted ? '已用完' : `余${b.remaining}天`}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <Form.Item 
            name="date" 
            label="请假日期" 
            rules={[{ required: true, message: '请选择请假日期' }]}
          >
            <DatePicker style={{ width: '100%' }} placeholder="请选择日期" />
          </Form.Item>
          <Form.Item 
            name="leaveType" 
            label="请假类型" 
            rules={[{ required: true, message: '请选择请假类型' }]}
          >
            <Select placeholder="请选择请假类型">
              {['personal', 'sick', 'annual'].map(type => {
                const nurseId = leaveForm.getFieldValue('nurse');
                const balance = nurseId && leaveBalances[nurseId] ? leaveBalances[nurseId][type] : null;
                const isExhausted = balance && balance.remaining <= 0;
                return (
                  <Option key={type} value={type} disabled={!!isExhausted}>
                    <span style={{ color: isExhausted ? '#d9d9d9' : 'inherit' }}>
                      {LEAVE_TYPE_NAMES[type]}
                    </span>
                    {balance && (
                      <span style={{ float: 'right', fontSize: '12px', color: isExhausted ? '#ff4d4f' : '#999' }}>
                        {isExhausted ? '已用完' : `余${balance.remaining}天`}
                      </span>
                    )}
                  </Option>
                );
              })}
            </Select>
          </Form.Item>
          <Form.Item name="reason" label="请假原因">
            <TextArea rows={3} placeholder="请输入请假原因（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="手动指定补班人"
        open={substituteModalVisible}
        onOk={handleManualSubstitute}
        onCancel={() => setSubstituteModalVisible(false)}
        width={450}
      >
        <div style={{ marginBottom: '16px' }}>
          <div><strong>请假护士:</strong> {selectedLeave?.nurse_name}</div>
          <div><strong>请假日期:</strong> {selectedLeave?.date}</div>
          <div><strong>请假类型:</strong> {selectedLeave && LEAVE_TYPE_NAMES[selectedLeave.leave_type]}</div>
        </div>
        {availableSubstitutes.length > 0 ? (
          <div>
            <div style={{ marginBottom: '8px', color: '#666' }}>可用补班人选（按当月班次由少到多排列）:</div>
            <Select 
              style={{ width: '100%' }} 
              placeholder="请选择补班护士"
              value={manualSubstituteNurseId}
              onChange={(val) => setManualSubstituteNurseId(val)}
            >
              {availableSubstitutes.map(n => (
                <Option key={n.id} value={n.id}>
                  {n.name} ({n.level === 'senior' ? '资深' : '普通'}) - 当月{n.shift_count}班次
                  {fatigueMap[n.id]?.is_fatigue_warning && <Tag color="orange" style={{ marginLeft: 4 }}>疲劳预警</Tag>}
                </Option>
              ))}
            </Select>
          </div>
        ) : (
          <div style={{ padding: '16px', background: '#fff1f0', borderRadius: '4px', border: '1px solid #ffa39e' }}>
            <div style={{ color: '#ff4d4f', fontWeight: '500' }}>当前没有可用的补班人选</div>
            <div style={{ color: '#999', fontSize: '12px', marginTop: '4px' }}>同科室其他护士当天均已有排班或不可用</div>
            <Select 
              style={{ width: '100%', marginTop: '12px' }} 
              placeholder="强制指定其他护士（需自行协调）"
              value={manualSubstituteNurseId}
              onChange={(val) => setManualSubstituteNurseId(val)}
            >
              {nurses.filter(n => n.id !== selectedLeave?.nurse_id).map(nurse => (
                <Option key={nurse.id} value={nurse.id}>
                  {nurse.name} ({nurse.level === 'senior' ? '资深' : '普通'})
                  {fatigueMap[nurse.id]?.is_fatigue_warning && <Tag color="orange" style={{ marginLeft: 4 }}>疲劳预警</Tag>}
                </Option>
              ))}
            </Select>
          </div>
        )}
      </Modal>

      <Modal
        title="疲劳预警确认"
        open={approveConfirmVisible}
        onOk={handleApproveConfirmOk}
        onCancel={handleApproveConfirmCancel}
        okText="确认继续"
        cancelText="取消"
      >
        <div style={{ marginBottom: '12px' }}>
          <Alert
            type="warning"
            showIcon
            message="该操作会导致以下护士进入或继续处于疲劳预警状态（近7日累计工时超过48小时），请知悉："
            style={{ marginBottom: '12px' }}
          />
          {approveWarnings.map(w => (
            <div key={w.nurse_id} style={{ padding: '8px 12px', background: '#fff7e6', border: '1px solid #ffd591', borderRadius: '4px', marginBottom: '8px' }}>
              <div style={{ fontWeight: '600', color: '#fa8c16' }}>{w.nurse_name}</div>
              <div style={{ fontSize: '13px', color: '#666' }}>近7日累计工时：<strong style={{ color: '#fa8c16' }}>{w.total_hours}小时</strong></div>
            </div>
          ))}
        </div>
      </Modal>

      <Modal
        title={`编辑护士技能 - ${editingNurse?.name || ''}`}
        open={nurseSkillModalVisible}
        onOk={handleSaveNurseSkills}
        onCancel={() => setNurseSkillModalVisible(false)}
        okText="保存"
        cancelText="取消"
      >
        <div style={{ marginBottom: '12px' }}>
          {skillTags.length === 0 ? (
            <div style={{ color: '#999', textAlign: 'center', padding: '16px' }}>
              暂无技能标签，请先在技能管理区域添加
            </div>
          ) : (
            <Checkbox.Group
              value={editingNurseSkills}
              onChange={(values) => setEditingNurseSkills(values)}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}
            >
              {skillTags.map(tag => (
                <Checkbox key={tag.id} value={tag.id}>{tag.name}</Checkbox>
              ))}
            </Checkbox.Group>
          )}
        </div>
      </Modal>

      <Modal
        title="编辑班次技能要求"
        open={skillReqModalVisible}
        onOk={handleSaveSkillReqs}
        onCancel={() => setSkillReqModalVisible(false)}
        okText="保存"
        cancelText="取消"
        width={600}
      >
        {SHIFTS.map(shift => (
          <div key={shift} style={{ marginBottom: '16px' }}>
            <div style={{ fontWeight: '500', marginBottom: '8px' }}>
              <Tag color={SHIFT_COLORS[shift]}>{SHIFT_NAMES[shift]}</Tag>
            </div>
            <Checkbox.Group
              value={editingSkillReqs[shift] || []}
              onChange={(values) => setEditingSkillReqs({ ...editingSkillReqs, [shift]: values })}
              style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}
            >
              {skillTags.map(tag => (
                <Checkbox key={tag.id} value={tag.id}>{tag.name}</Checkbox>
              ))}
            </Checkbox.Group>
          </div>
        ))}
      </Modal>

      <Modal
        title="技能覆盖率报告"
        open={coverageReportVisible}
        onCancel={() => setCoverageReportVisible(false)}
        footer={null}
        width={700}
      >
        {skillCoverageReport ? (
          <div>
            <div style={{ marginBottom: '16px', display: 'flex', gap: '16px' }}>
              <div style={{ padding: '12px', background: '#f6ffed', borderRadius: '4px', flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#52c41a' }}>{skillCoverageReport.met_count}</div>
                <div style={{ fontSize: '12px', color: '#666' }}>已满足班次</div>
              </div>
              <div style={{ padding: '12px', background: '#fff2f0', borderRadius: '4px', flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#ff4d4f' }}>{skillCoverageReport.unmet_count}</div>
                <div style={{ fontSize: '12px', color: '#666' }}>未满足班次</div>
              </div>
              <div style={{ padding: '12px', background: '#e6f7ff', borderRadius: '4px', flex: 1, textAlign: 'center' }}>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#1890ff' }}>{skillCoverageReport.total_shifts}</div>
                <div style={{ fontSize: '12px', color: '#666' }}>总班次数</div>
              </div>
            </div>

            {skillCoverageReport.requirements.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontWeight: '500', marginBottom: '8px' }}>技能要求配置</div>
                {SHIFTS.map(shift => {
                  const reqs = skillCoverageReport.requirements.filter(r => r.shift === shift);
                  if (reqs.length === 0) return null;
                  return (
                    <div key={shift} style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Tag color={SHIFT_COLORS[shift]}>{SHIFT_NAMES[shift]}</Tag>
                      {reqs.map(r => <Tag key={r.skill_id} color="orange">{r.skill_name}</Tag>)}
                    </div>
                  );
                })}
              </div>
            )}

            {skillCoverageReport.unmet.length > 0 ? (
              <div>
                <div style={{ fontWeight: '500', marginBottom: '8px', color: '#ff4d4f' }}>未满足列表</div>
                <Table
                  columns={[
                    { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
                    { title: '班次', dataIndex: 'shift_name', key: 'shift_name', width: 80, render: (text, record) => <Tag color={SHIFT_COLORS[record.shift]}>{text}</Tag> },
                    { title: '缺失技能', dataIndex: 'skill_name', key: 'skill_name', render: (text) => <Tag color="red">{text}</Tag> }
                  ]}
                  dataSource={skillCoverageReport.unmet}
                  rowKey={(r, i) => `${r.date}-${r.shift}-${r.skill_id}-${i}`}
                  size="small"
                  pagination={false}
                  scroll={{ y: 300 }}
                />
              </div>
            ) : (
              <Alert type="success" message="所有班次的技能要求均已满足" showIcon />
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px', color: '#999' }}>加载中...</div>
        )}
      </Modal>

      <Modal
        title="假期额度配置"
        open={quotaConfigModalVisible}
        onOk={async () => {
          try {
            await updateLeaveQuotaConfig(selectedDept.id, {
              year: month.year(),
              sick_days: editingQuotaConfig.sick_days,
              personal_days: editingQuotaConfig.personal_days
            });
            message.success('额度配置已更新');
            setQuotaConfigModalVisible(false);
            loadLeaveQuotaConfig();
            loadLeaveQuotaOverview();
          } catch (err) {
            message.error(`更新失败: ${err.response?.data?.error || err.message}`);
          }
        }}
        onCancel={() => setQuotaConfigModalVisible(false)}
        okText="保存"
        cancelText="取消"
        width={450}
      >
        <div style={{ marginBottom: '12px', color: '#666', fontSize: '13px' }}>
          配置 {month.year()} 年度 {selectedDept?.name} 的假期额度。年假天数按工龄自动计算（1-5年5天, 5-10年10天, 10年以上15天），无需手动设置。
        </div>
        <div style={{ display: 'flex', gap: '16px', marginBottom: '16px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: '4px', fontWeight: '500' }}>病假天数上限</div>
            <InputNumber
              min={1}
              max={365}
              value={editingQuotaConfig.sick_days}
              onChange={(val) => setEditingQuotaConfig(prev => ({ ...prev, sick_days: val }))}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ marginBottom: '4px', fontWeight: '500' }}>事假天数上限</div>
            <InputNumber
              min={1}
              max={365}
              value={editingQuotaConfig.personal_days}
              onChange={(val) => setEditingQuotaConfig(prev => ({ ...prev, personal_days: val }))}
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </Modal>

      <Modal
        title="发起借调申请"
        open={secondmentModalVisible}
        onOk={handleSecondmentSubmit}
        onCancel={() => { setSecondmentModalVisible(false); setFromDeptNurses([]); }}
        okText="提交"
        cancelText="取消"
        width={550}
      >
        <Form form={secondmentForm} layout="vertical">
          <Form.Item label="借入科室" style={{ marginBottom: '8px' }}>
            <Input value={selectedDept?.name} disabled />
          </Form.Item>
          <Form.Item
            name="from_department_id"
            label="借出科室"
            rules={[{ required: true, message: '请选择借出科室' }]}
            style={{ marginBottom: '16px' }}
          >
            <Select
              placeholder="请选择借出科室"
              onChange={handleFromDeptChange}
            >
              {departments.filter(d => d.id !== selectedDept?.id).map(dept => (
                <Option key={dept.id} value={dept.id}>{dept.name}</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="nurse_id"
            label="借入护士"
            rules={[{ required: true, message: '请选择借入护士' }]}
            style={{ marginBottom: '16px' }}
          >
            <Select
              placeholder={fromDeptNurses.length > 0 ? '请选择护士' : '请先选择借出科室'}
              disabled={fromDeptNurses.length === 0}
            >
              {fromDeptNurses.map(n => (
                <Option key={n.id} value={n.id}>
                  {n.name} ({n.level === 'senior' ? '资深' : '普通'})
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            name="date_range"
            label="借调日期范围"
            rules={[{ required: true, message: '请选择借调日期范围' }]}
            style={{ marginBottom: '16px' }}
          >
            <RangePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="shifts"
            label="借调班次"
            style={{ marginBottom: '16px' }}
          >
            <Select placeholder="默认所有班次" allowClear>
              <Option value="all">所有班次</Option>
              <Option value="morning">仅早班</Option>
              <Option value="afternoon">仅中班</Option>
              <Option value="night">仅夜班</Option>
              <Option value="morning,afternoon">早班+中班</Option>
              <Option value="afternoon,night">中班+夜班</Option>
            </Select>
          </Form.Item>
          <Form.Item name="reason" label="借调原因">
            <TextArea rows={3} placeholder="请输入借调原因（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}

export default SchedulePage;
