import { useState, useEffect } from 'react';
import { 
  Layout, Menu, Table, Button, DatePicker, Select, Modal, Form, 
  message, Tabs, Badge, Popconfirm, Space, Tag, Radio, TimePicker, Input, Tooltip
} from 'antd';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import { 
  getDepartments, getNurses, getSchedule, generateSchedule, updateSchedule,
  getSwapRequests, createSwapRequest, confirmSwapRequest, approveSwapRequest, rejectSwapRequest,
  getOvertimeRequests, createOvertimeRequest, approveOvertimeRequest, rejectOvertimeRequest,
  getMonthlyReport,
  getLeaveRequests, createLeaveRequest, approveLeaveRequest, rejectLeaveRequest,
  confirmSubstitute, manualSubstitute, getLeaveSummary, getAvailableSubstitutes
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
      setSchedule(res.data);
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

  const handleGenerateSchedule = async () => {
    if (!selectedDept) return;
    setLoading(true);
    try {
      const res = await generateSchedule(selectedDept.id, month.format('YYYY-MM'));
      message.success('排班生成成功');
      loadSchedule();
      loadMonthlyReport();
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
    try {
      await approveSwapRequest(id);
      message.success('审批通过');
      loadSwapRequests();
      loadSchedule();
      loadMonthlyReport();
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
    try {
      await approveOvertimeRequest(id);
      message.success('审批通过');
      loadOvertimeRequests();
      loadMonthlyReport();
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
      loadLeaveRequests();
    } catch (err) {
      message.error(`提交失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleApproveLeave = async (id) => {
    try {
      const res = await approveLeaveRequest(id);
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
    try {
      await confirmSubstitute(leaveId);
      message.success('补班已确认，排班已更新');
      loadLeaveRequests();
      loadSchedule();
      loadMonthlyReport();
      loadLeaveSummary();
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
    try {
      await manualSubstitute(selectedLeave.id, manualSubstituteNurseId);
      message.success('手动补班已确认，排班已更新');
      setSubstituteModalVisible(false);
      loadLeaveRequests();
      loadSchedule();
      loadMonthlyReport();
      loadLeaveSummary();
    } catch (err) {
      message.error(`操作失败: ${err.response?.data?.error || err.message}`);
    }
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

  const days = getDaysInView();
  const pendingSwapCount = swapRequests.filter(r => r.status === 'pending' || r.status === 'confirmed').length;
  const pendingOvertimeCount = overtimeRequests.filter(r => r.status === 'pending').length;
  const pendingLeaveCount = leaveRequests.filter(r => r.status === 'pending').length;

  const getChartOption = () => {
    const names = monthlyReport.map(r => r.nurse_name);
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
      fixed: 'left'
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
                {req.status === 'approved' && (
                  <div style={{ fontSize: '13px', marginBottom: '8px', padding: '8px', background: '#e6f7ff', borderRadius: '4px', border: '1px solid #91d5ff' }}>
                    {req.substitute_status === 'pending' && req.substitute_name && (
                      <div>
                        <div>推荐补班: <strong>{req.substitute_name}</strong></div>
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
            <Button type="primary" loading={loading} onClick={handleGenerateSchedule}>
              生成排班
            </Button>
          </div>
        </Header>
        <Layout>
          <Content style={{ padding: '24px', overflow: 'auto' }}>
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
                    {nurses.map(nurse => (
                      <tr key={nurse.id}>
                        <td style={{ border: '1px solid #e8e8e8', padding: '8px', textAlign: 'left' }}>
                          <div>{nurse.name}</div>
                          <div style={{ fontSize: '12px', color: nurse.level === 'senior' ? '#fa8c16' : '#999' }}>
                            {nurse.level === 'senior' ? '资深' : '普通'}
                          </div>
                        </td>
                        {days.map(day => {
                          const dateStr = day.format('YYYY-MM-DD');
                          const shift = getShiftForNurseAndDate(nurse.id, day);
                          const overtimes = getOvertimeForNurseAndDate(nurse.id, day);
                          const leave = getLeaveForNurseAndDate(nurse.id, day);
                          const subInfo = getSubstituteInfoForDate(day).find(s => s.substitute_nurse_id === nurse.id);

                          const isLeave = leave && shift;
                          const isSubstitute = subInfo && !isLeave;

                          return (
                            <td 
                              key={dateStr} 
                              style={{ 
                                border: '1px solid #e8e8e8', 
                                padding: '4px', 
                                textAlign: 'center', 
                                verticalAlign: 'top',
                                background: isLeave ? '#fff1f0' : (isSubstitute ? '#e6fffb' : 'transparent')
                              }}
                            >
                              {shift && (
                                <div 
                                  style={{ 
                                    padding: '4px 8px', 
                                    borderRadius: '4px', 
                                    color: '#fff', 
                                    fontSize: '12px',
                                    background: isLeave ? '#ff4d4f' : (isSubstitute ? '#13c2c2' : SHIFT_COLORS[shift.shift]),
                                    marginBottom: '4px',
                                    cursor: 'pointer',
                                    textDecoration: isLeave ? 'line-through' : 'none'
                                  }}
                                  onClick={() => handleCellClick(nurse, dateStr, shift.shift, shift.id)}
                                >
                                  {isLeave ? `请假(${LEAVE_TYPE_NAMES[leave.leave_type]})` : (isSubstitute ? `补班(${SHIFT_NAMES[shift.shift]})` : SHIFT_NAMES[shift.shift])}
                                </div>
                              )}
                              {!shift && leave && (
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
                    ))}
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
              <h3 style={{ marginTop: 0, marginBottom: '16px' }}>请假汇总</h3>
              <Table
                columns={leaveSummaryColumns}
                dataSource={leaveSummary}
                rowKey="nurse_id"
                size="small"
                pagination={false}
              />
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
            <Select placeholder="请选择护士">
              {nurses.map(nurse => (
                <Option key={nurse.id} value={nurse.id}>
                  {nurse.name} ({nurse.level === 'senior' ? '资深' : '普通'})
                </Option>
              ))}
            </Select>
          </Form.Item>
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
              <Option value="personal">事假</Option>
              <Option value="sick">病假</Option>
              <Option value="annual">年假</Option>
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
                </Option>
              ))}
            </Select>
          </div>
        )}
      </Modal>
    </Layout>
  );
}

export default SchedulePage;
