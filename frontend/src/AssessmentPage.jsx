import { useState, useEffect, useMemo } from 'react';
import {
  Layout, Select, DatePicker, Button, Modal, Form, InputNumber, Input,
  Table, List, Card, Tag, message, Space, Tooltip, Divider, Row, Col, Slider,
  Statistic, Alert, Descriptions, Popconfirm, Radio
} from 'antd';
import { SettingOutlined, SaveOutlined, TrophyOutlined, LineChartOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import {
  getDepartments, getAssessmentMonthPreview, createQualityAssessment,
  getAssessmentWeightConfig, updateAssessmentWeightConfig,
  getAssessmentRanking, getAssessmentTrend, getAssessmentAutoInfo,
  getAssessmentHistory, getAppealStatus, createAppeal,
  getAppeals, handleAppeal, getAppealById
} from './api';

const { Sider, Content } = Layout;
const { Option } = Select;
const { TextArea } = Input;

const DIMENSION_CONFIG = [
  { key: 'attendance', label: '出勤纪律', color: '#1890ff', field: 'attendance_score' },
  { key: 'operation', label: '护理操作规范', color: '#52c41a', field: 'operation_score' },
  { key: 'satisfaction', label: '患者满意度', color: '#faad14', field: 'satisfaction_score' },
  { key: 'teamwork', label: '团队协作', color: '#722ed1', field: 'teamwork_score' }
];

const DIMENSION_FINAL = {
  attendance: 'final_attendance',
  operation: 'final_operation',
  satisfaction: 'final_satisfaction',
  teamwork: 'final_teamwork'
};

const DIMENSION_ADJ = {
  attendance: 'attendance_adjustment',
  operation: 'operation_adjustment',
  satisfaction: 'satisfaction_adjustment',
  teamwork: 'teamwork_adjustment'
};

const EVENT_TYPE_CN = {
  medication_error: '用药错误',
  fall: '跌倒',
  pressure_ulcer: '压疮',
  infection: '感染',
  other: '其他'
};

const DIMENSION_CN = {
  attendance: '出勤纪律',
  operation: '护理操作规范',
  satisfaction: '患者满意度',
  teamwork: '团队协作'
};

const LEVEL_CN = { senior: '高级护士', junior: '初级护士' };
const LEVEL_COLOR = { senior: 'blue', junior: 'green' };

const APPEAL_STATUS_CN = {
  pending: '待处理',
  maintained: '已维持',
  adjusted: '已调整'
};
const APPEAL_STATUS_COLOR = {
  pending: 'orange',
  maintained: 'default',
  adjusted: 'green'
};

function AssessmentPage() {
  const [departments, setDepartments] = useState([]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(dayjs().format('YYYY-MM'));
  const [nurseList, setNurseList] = useState([]);
  const [selectedNurse, setSelectedNurse] = useState(null);
  const [ranking, setRanking] = useState([]);
  const [weightConfig, setWeightConfig] = useState(null);
  const [autoInfo, setAutoInfo] = useState(null);
  const [trendData, setTrendData] = useState([]);
  const [historyRecords, setHistoryRecords] = useState([]);

  const [weightModalVisible, setWeightModalVisible] = useState(false);
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [appealModalVisible, setAppealModalVisible] = useState(false);
  const [appealListVisible, setAppealListVisible] = useState(false);
  const [appealHandleModalVisible, setAppealHandleModalVisible] = useState(false);
  const [appealStatus, setAppealStatus] = useState(null);
  const [appealList, setAppealList] = useState([]);
  const [currentAppeal, setCurrentAppeal] = useState(null);
  const [scoreForm] = Form.useForm();
  const [weightForm] = Form.useForm();
  const [appealForm] = Form.useForm();
  const [appealHandleForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [submittingAppeal, setSubmittingAppeal] = useState(false);
  const [handlingAppeal, setHandlingAppeal] = useState(false);
  const [currentView, setCurrentView] = useState('assessment');
  const [selectedAssessmentForAppeal, setSelectedAssessmentForAppeal] = useState(null);

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    if (selectedDept) {
      loadNurseList();
      loadRanking();
      loadWeightConfig();
    }
  }, [selectedDept, selectedMonth]);

  useEffect(() => {
    if (selectedNurse && selectedDept) {
      loadAutoInfo();
      loadTrend();
      loadFormData();
    }
  }, [selectedNurse, selectedMonth, selectedDept]);

  const loadDepartments = async () => {
    try {
      const res = await getDepartments();
      setDepartments(res.data);
      if (res.data.length > 0 && !selectedDept) {
        setSelectedDept(res.data[0]);
      }
    } catch (err) {
      message.error('加载科室列表失败');
    }
  };

  const loadNurseList = async () => {
    if (!selectedDept) return;
    try {
      const res = await getAssessmentMonthPreview(selectedDept.id, selectedMonth);
      setNurseList(res.data);
      if (res.data.length > 0) {
        const current = selectedNurse && res.data.find(n => n.nurse_id === selectedNurse.nurse_id);
        setSelectedNurse(current || res.data[0]);
      } else {
        setSelectedNurse(null);
      }
    } catch (err) {
      message.error('加载护士列表失败');
    }
  };

  const loadRanking = async () => {
    if (!selectedDept) return;
    try {
      const res = await getAssessmentRanking(selectedDept.id, selectedMonth);
      setRanking(res.data);
    } catch (err) {
      setRanking([]);
    }
  };

  const loadWeightConfig = async () => {
    if (!selectedDept) return;
    try {
      const res = await getAssessmentWeightConfig(selectedDept.id);
      setWeightConfig(res.data);
    } catch (err) {
      message.error('加载权重配置失败');
    }
  };

  const loadAutoInfo = async () => {
    if (!selectedNurse || !selectedDept) return;
    try {
      const res = await getAssessmentAutoInfo(selectedNurse.nurse_id, {
        department_id: selectedDept.id,
        month: selectedMonth
      });
      setAutoInfo(res.data);
    } catch (err) {
      setAutoInfo(null);
    }
  };

  const loadTrend = async () => {
    if (!selectedNurse) return;
    try {
      const res = await getAssessmentTrend(selectedNurse.nurse_id, {});
      setTrendData(res.data);
    } catch (err) {
      setTrendData([]);
    }
  };

  const loadFormData = async () => {
    if (!selectedNurse || !selectedDept) return;
    try {
      const res = await getAssessmentHistory({
        department_id: selectedDept.id,
        nurse_id: selectedNurse.nurse_id,
        month: selectedMonth
      });
      if (res.data.length > 0) {
        const record = res.data[0];
        scoreForm.setFieldsValue({
          attendance_score: record.attendance_score,
          operation_score: record.operation_score,
          satisfaction_score: record.satisfaction_score,
          teamwork_score: record.teamwork_score,
          remark: record.remark
        });
        setSelectedAssessmentForAppeal(record);
        loadAppealStatus(record.id);
      } else {
        scoreForm.resetFields();
        scoreForm.setFieldsValue({
          attendance_score: 8,
          operation_score: 8,
          satisfaction_score: 8,
          teamwork_score: 8
        });
        setSelectedAssessmentForAppeal(null);
        setAppealStatus(null);
      }
    } catch (err) {
      scoreForm.resetFields();
      setSelectedAssessmentForAppeal(null);
      setAppealStatus(null);
    }
  };

  const loadAppealStatus = async (assessmentId) => {
    try {
      const res = await getAppealStatus(assessmentId);
      setAppealStatus(res.data);
    } catch (err) {
      setAppealStatus(null);
    }
  };

  const loadAppealList = async () => {
    if (!selectedDept) return;
    try {
      const res = await getAppeals({
        department_id: selectedDept.id,
        month: selectedMonth
      });
      setAppealList(res.data);
    } catch (err) {
      message.error('加载申诉列表失败');
    }
  };

  const loadPendingAppeals = async () => {
    if (!selectedDept) return;
    try {
      const res = await getAppeals({
        department_id: selectedDept.id,
        status: 'pending'
      });
      setAppealList(res.data);
    } catch (err) {
      message.error('加载待处理申诉失败');
    }
  };

  const openAppealModal = () => {
    if (!appealStatus?.can_appeal) return;
    appealForm.resetFields();
    setAppealModalVisible(true);
  };

  const handleAppealSubmit = async () => {
    if (!selectedAssessmentForAppeal) return;
    try {
      const values = await appealForm.validateFields();
      setSubmittingAppeal(true);
      await createAppeal(selectedAssessmentForAppeal.id, {
        ...values,
        nurse_id: selectedNurse.nurse_id
      });
      message.success('申诉提交成功');
      setAppealModalVisible(false);
      loadAppealStatus(selectedAssessmentForAppeal.id);
      loadAppealList();
    } catch (err) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || '提交失败');
    } finally {
      setSubmittingAppeal(false);
    }
  };

  const openAppealHandleModal = async (appeal) => {
    setCurrentAppeal(appeal);
    const detail = await getAppealById(appeal.id);
    appealHandleForm.resetFields();
    appealHandleForm.setFieldsValue({
      attendance_score: detail.data.attendance_score,
      operation_score: detail.data.operation_score,
      satisfaction_score: detail.data.satisfaction_score,
      teamwork_score: detail.data.teamwork_score
    });
    setAppealHandleModalVisible(true);
  };

  const handleAppealProcess = async () => {
    if (!currentAppeal) return;
    try {
      const values = await appealHandleForm.validateFields();
      setHandlingAppeal(true);
      await handleAppeal(currentAppeal.id, {
        handle_result: values.handle_result,
        handle_reason: values.handle_reason,
        handled_by: 1,
        scores: values.handle_result === 'adjust' ? {
          attendance_score: values.attendance_score,
          operation_score: values.operation_score,
          satisfaction_score: values.satisfaction_score,
          teamwork_score: values.teamwork_score
        } : undefined
      });
      message.success('处理成功');
      setAppealHandleModalVisible(false);
      loadAppealList();
      loadPendingAppeals();
      loadRanking();
      loadNurseList();
    } catch (err) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || '处理失败');
    } finally {
      setHandlingAppeal(false);
    }
  };

  const loadHistoryRecords = async () => {
    if (!selectedNurse || !selectedDept) return;
    try {
      const res = await getAssessmentHistory({
        department_id: selectedDept.id,
        nurse_id: selectedNurse.nurse_id
      });
      setHistoryRecords(res.data);
      setHistoryModalVisible(true);
    } catch (err) {
      message.error('加载历史记录失败');
    }
  };

  const handleScoreChange = () => {
    // 触发重新计算预览
    const values = scoreForm.getFieldsValue();
    previewCalculation(values);
  };

  const previewCalculation = (values) => {
    if (!weightConfig || !autoInfo) return null;

    const rawScores = {
      attendance: Number(values.attendance_score) || 0,
      operation: Number(values.operation_score) || 0,
      satisfaction: Number(values.satisfaction_score) || 0,
      teamwork: Number(values.teamwork_score) || 0
    };

    const adjustments = { attendance: 0, operation: 0, satisfaction: 0, teamwork: 0 };
    autoInfo.adverse_events?.forEach(e => {
      adjustments[e.affected_dimension] -= 2;
    });
    if (autoInfo.is_full_attendance) {
      adjustments.attendance += 1;
    }

    const finalScores = {};
    Object.keys(rawScores).forEach(k => {
      finalScores[k] = Math.max(0, Math.min(10, rawScores[k] + adjustments[k]));
    });

    const weightedTotal = (
      finalScores.attendance * weightConfig.attendance_weight / 100 +
      finalScores.operation * weightConfig.operation_weight / 100 +
      finalScores.satisfaction * weightConfig.satisfaction_weight / 100 +
      finalScores.teamwork * weightConfig.teamwork_weight / 100
    ) * 10;

    return {
      rawScores,
      adjustments,
      finalScores,
      weightedTotal: Math.round(weightedTotal * 100) / 100
    };
  };

  const handleSubmit = async () => {
    if (!selectedDept || !selectedNurse) {
      message.warning('请选择科室和护士');
      return;
    }
    try {
      const values = await scoreForm.validateFields();
      setSubmitting(true);
      const res = await createQualityAssessment({
        department_id: selectedDept.id,
        nurse_id: selectedNurse.nurse_id,
        month: selectedMonth,
        ...values
      });
      message.success(`考核提交成功！加权总分：${res.data.data.weighted_total}`);
      loadNurseList();
      loadRanking();
      loadTrend();
    } catch (err) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || '提交失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWeightSubmit = async () => {
    if (!selectedDept) return;
    try {
      const values = await weightForm.validateFields();
      await updateAssessmentWeightConfig({
        department_id: selectedDept.id,
        ...values
      });
      message.success('权重配置保存成功');
      setWeightModalVisible(false);
      loadWeightConfig();
    } catch (err) {
      if (err.errorFields) return;
      message.error(err.response?.data?.error || '保存失败');
    }
  };

  const openWeightModal = () => {
    weightForm.setFieldsValue({
      attendance_weight: weightConfig?.attendance_weight || 25,
      operation_weight: weightConfig?.operation_weight || 25,
      satisfaction_weight: weightConfig?.satisfaction_weight || 25,
      teamwork_weight: weightConfig?.teamwork_weight || 25
    });
    setWeightModalVisible(true);
  };

  const [formValues] = Form.useWatch([
    'attendance_score', 'operation_score', 'satisfaction_score', 'teamwork_score'
  ], scoreForm);

  const preview = useMemo(() => {
    const vals = scoreForm.getFieldsValue();
    if (!weightConfig || !autoInfo) return null;
    return previewCalculation(vals);
  }, [formValues, weightConfig, autoInfo]);

  const trendOption = useMemo(() => {
    if (!trendData || trendData.length === 0) return null;
    return {
      tooltip: { trigger: 'axis' },
      legend: {
        data: ['加权总分', '出勤纪律', '护理操作', '患者满意', '团队协作'],
        bottom: 0
      },
      grid: { left: 40, right: 20, top: 30, bottom: 50 },
      xAxis: {
        type: 'category',
        data: trendData.map(d => d.month),
        axisLabel: { fontSize: 11 }
      },
      yAxis: [
        { type: 'value', name: '总分', min: 0, max: 100, position: 'left' },
        { type: 'value', name: '维度分', min: 0, max: 10, position: 'right' }
      ],
      series: [
        {
          name: '加权总分',
          type: 'line',
          yAxisIndex: 0,
          data: trendData.map(d => d.weighted_total),
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 3, color: '#1890ff' },
          itemStyle: { color: '#1890ff' }
        },
        {
          name: '出勤纪律',
          type: 'line',
          yAxisIndex: 1,
          data: trendData.map(d => d.final_attendance),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: '#1890ff' },
          itemStyle: { color: '#1890ff' }
        },
        {
          name: '护理操作',
          type: 'line',
          yAxisIndex: 1,
          data: trendData.map(d => d.final_operation),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: '#52c41a' },
          itemStyle: { color: '#52c41a' }
        },
        {
          name: '患者满意',
          type: 'line',
          yAxisIndex: 1,
          data: trendData.map(d => d.final_satisfaction),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: '#faad14' },
          itemStyle: { color: '#faad14' }
        },
        {
          name: '团队协作',
          type: 'line',
          yAxisIndex: 1,
          data: trendData.map(d => d.final_teamwork),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: '#722ed1' },
          itemStyle: { color: '#722ed1' }
        }
      ]
    };
  }, [trendData]);

  const rankingColumns = [
    {
      title: '排名',
      dataIndex: 'rank',
      width: 70,
      render: (v) => {
        if (v === 1) return <Tag color="gold" icon={<TrophyOutlined />}>1</Tag>;
        if (v === 2) return <Tag color="silver">2</Tag>;
        if (v === 3) return <Tag color="bronze">3</Tag>;
        return <span>{v}</span>;
      }
    },
    { title: '姓名', dataIndex: 'nurse_name', width: 100 },
    {
      title: '职级',
      dataIndex: 'nurse_level',
      width: 90,
      render: (v) => <Tag color={LEVEL_COLOR[v]}>{LEVEL_CN[v]}</Tag>
    },
    {
      title: '出勤纪律',
      dataIndex: DIMENSION_FINAL.attendance,
      width: 95,
      render: (v, r) => renderDimScore(v, r[DIMENSION_ADJ.attendance])
    },
    {
      title: '护理操作',
      dataIndex: DIMENSION_FINAL.operation,
      width: 95,
      render: (v, r) => renderDimScore(v, r[DIMENSION_ADJ.operation])
    },
    {
      title: '患者满意',
      dataIndex: DIMENSION_FINAL.satisfaction,
      width: 95,
      render: (v, r) => renderDimScore(v, r[DIMENSION_ADJ.satisfaction])
    },
    {
      title: '团队协作',
      dataIndex: DIMENSION_FINAL.teamwork,
      width: 95,
      render: (v, r) => renderDimScore(v, r[DIMENSION_ADJ.teamwork])
    },
    {
      title: '不良事件',
      dataIndex: 'adverse_event_count',
      width: 90,
      render: (v) => v > 0 ? <Tag color="red">{v}条</Tag> : <Tag color="green">0</Tag>
    },
    {
      title: '全勤',
      dataIndex: 'is_full_attendance',
      width: 70,
      render: (v) => v ? <Tag color="green">是</Tag> : <Tag>否</Tag>
    },
    {
      title: '加权总分',
      dataIndex: 'weighted_total',
      width: 100,
      render: (v) => <strong style={{ fontSize: 16, color: '#1890ff' }}>{v.toFixed(2)}</strong>,
      sorter: (a, b) => a.weighted_total - b.weighted_total,
      defaultSortOrder: 'descend'
    }
  ];

  function renderDimScore(score, adj) {
    const adjText = adj > 0 ? `(+${adj})` : adj < 0 ? `(${adj})` : '';
    const color = adj > 0 ? '#52c41a' : adj < 0 ? '#ff4d4f' : 'inherit';
    return (
      <Space direction="vertical" size={0} style={{ fontSize: 12 }}>
        <span style={{ fontWeight: 'bold' }}>{score?.toFixed(1)}</span>
        {adj !== 0 && <span style={{ color, fontSize: 11 }}>{adjText}</span>}
      </Space>
    );
  }

  const historyColumns = [
    { title: '月份', dataIndex: 'month', width: 100 },
    {
      title: '出勤',
      dataIndex: DIMENSION_FINAL.attendance,
      render: (v, r) => `${v?.toFixed(1)}${r[DIMENSION_ADJ.attendance] !== 0 ? ` (${r[DIMENSION_ADJ.attendance] > 0 ? '+' : ''}${r[DIMENSION_ADJ.attendance]})` : ''}`
    },
    {
      title: '操作',
      dataIndex: DIMENSION_FINAL.operation,
      render: (v, r) => `${v?.toFixed(1)}${r[DIMENSION_ADJ.operation] !== 0 ? ` (${r[DIMENSION_ADJ.operation] > 0 ? '+' : ''}${r[DIMENSION_ADJ.operation]})` : ''}`
    },
    {
      title: '满意',
      dataIndex: DIMENSION_FINAL.satisfaction,
      render: (v, r) => `${v?.toFixed(1)}${r[DIMENSION_ADJ.satisfaction] !== 0 ? ` (${r[DIMENSION_ADJ.satisfaction] > 0 ? '+' : ''}${r[DIMENSION_ADJ.satisfaction]})` : ''}`
    },
    {
      title: '协作',
      dataIndex: DIMENSION_FINAL.teamwork,
      render: (v, r) => `${v?.toFixed(1)}${r[DIMENSION_ADJ.teamwork] !== 0 ? ` (${r[DIMENSION_ADJ.teamwork] > 0 ? '+' : ''}${r[DIMENSION_ADJ.teamwork]})` : ''}`
    },
    { title: '不良事件', dataIndex: 'adverse_event_count', render: (v) => `${v}条` },
    { title: '全勤', dataIndex: 'is_full_attendance', render: (v) => v ? '是' : '否' },
    { title: '加权总分', dataIndex: 'weighted_total', render: (v) => <strong>{v?.toFixed(2)}</strong> },
    { title: '备注', dataIndex: 'remark' }
  ];

  return (
    <Layout style={{ height: 'calc(100vh - 48px)', background: '#f0f2f5' }}>
      <div style={{
        padding: '12px 24px',
        background: '#fff',
        borderBottom: '1px solid #e8e8e8',
        display: 'flex',
        alignItems: 'center',
        gap: 16
      }}>
        <Space size="middle">
          <span>科室：</span>
          <Select
            style={{ width: 180 }}
            value={selectedDept?.id}
            onChange={(id) => setSelectedDept(departments.find(d => d.id === id))}
          >
            {departments.map(d => (
              <Option key={d.id} value={d.id}>{d.name}</Option>
            ))}
          </Select>
          <span>月份：</span>
          <DatePicker
            picker="month"
            value={dayjs(selectedMonth)}
            onChange={(d) => d && setSelectedMonth(d.format('YYYY-MM'))}
            allowClear={false}
          />
        </Space>
        <Space style={{ marginLeft: 'auto' }}>
          <Button.Group>
            <Button
              type={currentView === 'assessment' ? 'primary' : 'default'}
              onClick={() => setCurrentView('assessment')}
            >
              考核管理
            </Button>
            <Button
              type={currentView === 'appeal' ? 'primary' : 'default'}
              onClick={() => {
                setCurrentView('appeal');
                loadPendingAppeals();
              }}
            >
              申诉处理
              {appealList.filter(a => a.status === 'pending').length > 0 && (
                <Tag color="red" style={{ marginLeft: 4 }}>
                  {appealList.filter(a => a.status === 'pending').length}
                </Tag>
              )}
            </Button>
          </Button.Group>
          <Button
            icon={<SettingOutlined />}
            onClick={openWeightModal}
          >
            权重配置
          </Button>
          <span style={{ fontSize: 12, color: '#888' }}>
            当前权重：出勤{weightConfig?.attendance_weight || 25}% / 操作{weightConfig?.operation_weight || 25}% / 满意{weightConfig?.satisfaction_weight || 25}% / 协作{weightConfig?.teamwork_weight || 25}%
          </span>
        </Space>
      </div>

      <Layout>
        <Sider
          width={260}
          style={{ background: '#fff', borderRight: '1px solid #e8e8e8', overflow: 'auto' }}
        >
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
            <strong>护士列表</strong>
            <span style={{ color: '#888', fontSize: 12, marginLeft: 8 }}>当月总分</span>
          </div>
          <List
            dataSource={nurseList}
            renderItem={(nurse) => (
              <List.Item
                onClick={() => setSelectedNurse(nurse)}
                style={{
                  cursor: 'pointer',
                  padding: '10px 16px',
                  background: selectedNurse?.nurse_id === nurse.nurse_id ? '#e6f7ff' : 'transparent',
                  borderLeft: selectedNurse?.nurse_id === nurse.nurse_id ? '3px solid #1890ff' : '3px solid transparent'
                }}
              >
                <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{nurse.nurse_name}</div>
                    <Tag color={LEVEL_COLOR[nurse.nurse_level]} style={{ marginTop: 4 }}>
                      {LEVEL_CN[nurse.nurse_level]}
                    </Tag>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {nurse.weighted_total !== null && nurse.weighted_total !== undefined ? (
                      <div style={{ fontSize: 18, fontWeight: 'bold', color: '#1890ff' }}>
                        {nurse.weighted_total.toFixed(1)}
                      </div>
                    ) : (
                      <Tag color="default">未打分</Tag>
                    )}
                  </div>
                </div>
              </List.Item>
            )}
          />
        </Sider>

        <Layout style={{ padding: 16, overflow: 'auto' }}>
          {currentView === 'appeal' ? (
            <div style={{ width: '100%' }}>
              <Card
                title={
                  <Space>
                    <span>申诉处理</span>
                    <Select
                      defaultValue="pending"
                      style={{ width: 120 }}
                      onChange={(val) => {
                        if (val === 'pending') {
                          loadPendingAppeals();
                        } else if (val === 'all') {
                          loadAppealList();
                        } else {
                          getAppeals({
                            department_id: selectedDept.id,
                            status: val
                          }).then(res => setAppealList(res.data));
                        }
                      }}
                    >
                      <Option value="pending">待处理</Option>
                      <Option value="maintained">已维持</Option>
                      <Option value="adjusted">已调整</Option>
                      <Option value="all">全部</Option>
                    </Select>
                  </Space>
                }
                size="small"
              >
                <Table
                  dataSource={appealList}
                  rowKey="id"
                  size="small"
                  columns={[
                    { title: '护士姓名', dataIndex: 'nurse_name', width: 100 },
                    { title: '职级', dataIndex: 'nurse_level', width: 90, render: v => <Tag color={LEVEL_COLOR[v]}>{LEVEL_CN[v]}</Tag> },
                    { title: '考核月份', dataIndex: 'month', width: 100 },
                    { title: '申诉理由', dataIndex: 'appeal_reason', ellipsis: true },
                    { title: '期望调整维度', dataIndex: 'expected_dimension', width: 120, render: v => DIMENSION_CN[v] || v },
                    { title: '期望分数', dataIndex: 'expected_score', width: 90, render: v => v?.toFixed(1) },
                    { title: '状态', dataIndex: 'status', width: 100, render: v => <Tag color={APPEAL_STATUS_COLOR[v]}>{APPEAL_STATUS_CN[v]}</Tag> },
                    { title: '申诉时间', dataIndex: 'created_at', width: 160 },
                    {
                      title: '操作',
                      width: 100,
                      render: (_, record) => (
                        record.status === 'pending' ? (
                          <Button type="primary" size="small" onClick={() => openAppealHandleModal(record)}>
                            处理
                          </Button>
                        ) : (
                          <Button size="small" onClick={() => openAppealHandleModal(record)}>
                            查看
                          </Button>
                        )
                      )
                    }
                  ]}
                />
              </Card>
            </div>
          ) : selectedNurse ? (
            <Row gutter={16}>
              <Col xs={24} lg={12}>
                <Card
                  title={
                    <Space>
                      <span>{selectedNurse.nurse_name} - {selectedMonth} 考核打分</span>
                      <Button
                        type="link"
                        size="small"
                        icon={<LineChartOutlined />}
                        onClick={loadHistoryRecords}
                      >
                        查看历史
                      </Button>
                    </Space>
                  }
                  size="small"
                  style={{ marginBottom: 16 }}
                >
                  {autoInfo && (
                    <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
                      {autoInfo.is_full_attendance && (
                        <Alert
                          type="success"
                          showIcon
                          message="全勤奖励：出勤纪律维度 +1分"
                          size="small"
                        />
                      )}
                      {autoInfo.adverse_event_count > 0 && (
                        <Alert
                          type="error"
                          showIcon
                          message={`本月关联 ${autoInfo.adverse_event_count} 条不良事件，对应维度各扣2分`}
                          description={
                            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                              {autoInfo.adverse_events.map(e => (
                                <li key={e.id}>
                                  {EVENT_TYPE_CN[e.event_type] || '其他'} → 扣【{DIMENSION_CN[e.affected_dimension]}】2分
                                </li>
                              ))}
                            </ul>
                          }
                          size="small"
                        />
                      )}
                    </Space>
                  )}

                  <Form
                    form={scoreForm}
                    layout="vertical"
                    onValuesChange={handleScoreChange}
                  >
                    {DIMENSION_CONFIG.map(dim => (
                      <div key={dim.key} style={{ marginBottom: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <strong style={{ color: dim.color }}>{dim.label}</strong>
                          {preview && (
                            <Space>
                              <span style={{ fontSize: 12, color: '#888' }}>
                                原始: {preview.rawScores[dim.key]}
                              </span>
                              {preview.adjustments[dim.key] !== 0 && (
                                <Tag color={preview.adjustments[dim.key] > 0 ? 'green' : 'red'}>
                                  {preview.adjustments[dim.key] > 0 ? '+' : ''}{preview.adjustments[dim.key]}
                                </Tag>
                              )}
                              <span style={{ fontWeight: 'bold', color: dim.color }}>
                                = {preview.finalScores[dim.key]}
                              </span>
                            </Space>
                          )}
                        </div>
                        <Form.Item
                          name={dim.field}
                          rules={[{ required: true, message: `请为${dim.label}打分` }]}
                          style={{ marginBottom: 4 }}
                        >
                          <Slider
                            min={1}
                            max={10}
                            step={0.5}
                            marks={{ 1: '1', 5: '5', 10: '10' }}
                            tooltip={{ formatter: v => `${v}分` }}
                            style={{ marginRight: 16 }}
                          />
                        </Form.Item>
                      </div>
                    ))}

                    <Form.Item label="备注" name="remark">
                      <TextArea rows={2} placeholder="可选" />
                    </Form.Item>

                    {preview && (
                      <Card size="small" style={{ background: '#fafafa', marginBottom: 16 }}>
                        <Row gutter={16}>
                          {DIMENSION_CONFIG.map(dim => (
                            <Col span={6} key={dim.key}>
                              <Statistic
                                title={dim.label}
                                value={preview.finalScores[dim.key]}
                                precision={1}
                                valueStyle={{ fontSize: 16, color: dim.color }}
                              />
                            </Col>
                          ))}
                        </Row>
                        <Divider style={{ margin: '12px 0' }} />
                        <Row justify="center">
                          <Statistic
                            title="加权总分（满分100）"
                            value={preview.weightedTotal}
                            precision={2}
                            valueStyle={{ fontSize: 28, color: '#1890ff' }}
                            prefix={<TrophyOutlined />}
                          />
                        </Row>
                      </Card>
                    )}

                    <Button
                      type="primary"
                      block
                      icon={<SaveOutlined />}
                      onClick={handleSubmit}
                      loading={submitting}
                      size="large"
                    >
                      保存考核成绩
                    </Button>
                  </Form>
                </Card>
              </Col>

              <Col xs={24} lg={12}>
                <Card
                  title={`${selectedNurse.nurse_name} - 近12个月考核趋势`}
                  size="small"
                  style={{ marginBottom: 16, height: 480 }}
                >
                  {trendOption ? (
                    <ReactECharts option={trendOption} style={{ height: 400 }} />
                  ) : (
                    <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                      暂无历史考核数据
                    </div>
                  )}
                </Card>

                {selectedNurse && preview && (
                  <Card
                    title={
                      <Space>
                        <span>本月考核详情预览</span>
                        {selectedAssessmentForAppeal && appealStatus && (
                          <Tooltip title={
                            appealStatus.is_expired
                              ? `申诉已过期（截止：${appealStatus.appeal_expires_at}）`
                              : appealStatus.has_appealed
                                ? `已申诉，状态：${APPEAL_STATUS_CN[appealStatus.appeal.status]}`
                                : `对考核结果有异议？点击申诉（截止：${appealStatus.appeal_expires_at}）`
                          }>
                            <Button
                              type="primary"
                              danger
                              size="small"
                              disabled={!appealStatus.can_appeal}
                              onClick={openAppealModal}
                            >
                              {appealStatus.is_expired ? '申诉已过期' : appealStatus.has_appealed ? '已申诉' : '申诉'}
                            </Button>
                          </Tooltip>
                        )}
                        {appealStatus?.appeal && (
                          <Tag color={APPEAL_STATUS_COLOR[appealStatus.appeal.status]}>
                            {APPEAL_STATUS_CN[appealStatus.appeal.status]}
                          </Tag>
                        )}
                      </Space>
                    }
                    size="small"
                  >
                    <Descriptions column={1} size="small" bordered>
                      <Descriptions.Item label="护士姓名">{selectedNurse.nurse_name}</Descriptions.Item>
                      <Descriptions.Item label="考核月份">{selectedMonth}</Descriptions.Item>
                      {DIMENSION_CONFIG.map(dim => (
                        <Descriptions.Item key={dim.key} label={dim.label}>
                          <Space>
                            <span>原始分 {preview.rawScores[dim.key]}</span>
                            {preview.adjustments[dim.key] !== 0 && (
                              <Tag color={preview.adjustments[dim.key] > 0 ? 'green' : 'red'}>
                                调整 {preview.adjustments[dim.key] > 0 ? '+' : ''}{preview.adjustments[dim.key]}
                              </Tag>
                            )}
                            <strong style={{ color: dim.color }}>→ 最终 {preview.finalScores[dim.key]}</strong>
                          </Space>
                        </Descriptions.Item>
                      ))}
                      <Descriptions.Item label="不良事件">
                        {autoInfo?.adverse_event_count > 0
                          ? <Tag color="red">{autoInfo.adverse_event_count}条，按规则扣分</Tag>
                          : <Tag color="green">无</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="全勤奖励">
                        {autoInfo?.is_full_attendance
                          ? <Tag color="green">出勤纪律+1分</Tag>
                          : <Tag>无</Tag>}
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>
                )}
              </Col>

              <Col span={24}>
                <Card
                  title={
                    <Space>
                      <TrophyOutlined style={{ color: '#faad14' }} />
                      <span>{selectedMonth} 科室月度考核排名</span>
                      <Tag color="blue">{ranking.length}人</Tag>
                    </Space>
                  }
                  size="small"
                >
                  <Table
                    dataSource={ranking}
                    columns={rankingColumns}
                    rowKey="id"
                    size="small"
                    pagination={false}
                    scroll={{ x: 900 }}
                  />
                </Card>
              </Col>
            </Row>
          ) : (
            <div style={{
              height: 300,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#999',
              background: '#fff',
              borderRadius: 8
            }}>
              请从左侧选择护士进行考核
            </div>
          )}
        </Layout>
      </Layout>

      <Modal
        title="考核维度权重配置"
        open={weightModalVisible}
        onOk={handleWeightSubmit}
        onCancel={() => setWeightModalVisible(false)}
        width={480}
      >
        <Form form={weightForm} layout="vertical">
          <Alert
            type="info"
            showIcon
            message="四个维度权重之和必须为100%"
            style={{ marginBottom: 16 }}
          />
          {DIMENSION_CONFIG.map(dim => (
            <Form.Item
              key={dim.key}
              label={`${dim.label} 权重（%）`}
              name={`${dim.key}_weight`}
              rules={[
                { required: true, message: '请输入权重' },
                { type: 'number', min: 0, max: 100, message: '权重范围0-100' }
              ]}
            >
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                max={100}
                step={1}
                addonAfter="%"
              />
            </Form.Item>
          ))}
        </Form>
      </Modal>

      <Modal
        title={`${selectedNurse?.nurse_name} - 考核历史记录`}
        open={historyModalVisible}
        onCancel={() => setHistoryModalVisible(false)}
        footer={null}
        width={900}
      >
        <Table
          dataSource={historyRecords}
          columns={historyColumns}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
        />
      </Modal>

      <Modal
        title="提交考核申诉"
        open={appealModalVisible}
        onOk={handleAppealSubmit}
        onCancel={() => setAppealModalVisible(false)}
        confirmLoading={submittingAppeal}
        width={500}
      >
        <Alert
          type="warning"
          showIcon
          message="温馨提示"
          description="每条考核记录只能申诉一次，请认真填写申诉理由和期望调整的内容。"
          style={{ marginBottom: 16 }}
        />
        <Form form={appealForm} layout="vertical">
          <Form.Item
            label="期望调整的维度"
            name="expected_dimension"
            rules={[{ required: true, message: '请选择期望调整的维度' }]}
          >
            <Select placeholder="请选择维度">
              {DIMENSION_CONFIG.map(dim => (
                <Option key={dim.key} value={dim.key}>{dim.label}</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="期望调整分数"
            name="expected_score"
            rules={[
              { required: true, message: '请填写期望分数' },
              { type: 'number', min: 1, max: 10, message: '分数范围1-10' }
            ]}
          >
            <InputNumber
              style={{ width: '100%' }}
              min={1}
              max={10}
              step={0.5}
              placeholder="请输入期望分数（1-10）"
            />
          </Form.Item>
          <Form.Item
            label="申诉理由"
            name="appeal_reason"
            rules={[{ required: true, message: '请填写申诉理由' }]}
          >
            <TextArea
              rows={4}
              placeholder="请详细说明申诉理由，包括认为评分不公的原因和依据..."
              showCount
              maxLength={500}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={currentAppeal?.status === 'pending' ? '处理考核申诉' : '申诉详情'}
        open={appealHandleModalVisible}
        onOk={currentAppeal?.status === 'pending' ? handleAppealProcess : undefined}
        onCancel={() => setAppealHandleModalVisible(false)}
        confirmLoading={handlingAppeal}
        footer={currentAppeal?.status === 'pending' ? undefined : null}
        width={700}
      >
        {currentAppeal && (
          <div>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="护士姓名">{currentAppeal.nurse_name}</Descriptions.Item>
              <Descriptions.Item label="考核月份">{currentAppeal.month}</Descriptions.Item>
              <Descriptions.Item label="期望调整维度" span={2}>
                {DIMENSION_CN[currentAppeal.expected_dimension]}
              </Descriptions.Item>
              <Descriptions.Item label="期望分数">{currentAppeal.expected_score?.toFixed(1)}</Descriptions.Item>
              <Descriptions.Item label="申诉时间">{currentAppeal.created_at}</Descriptions.Item>
              <Descriptions.Item label="申诉理由" span={2}>
                {currentAppeal.appeal_reason}
              </Descriptions.Item>
              {currentAppeal.status !== 'pending' && (
                <>
                  <Descriptions.Item label="处理结果" span={2}>
                    <Tag color={APPEAL_STATUS_COLOR[currentAppeal.status]}>
                      {APPEAL_STATUS_CN[currentAppeal.status]}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="处理人">{currentAppeal.handler_name}</Descriptions.Item>
                  <Descriptions.Item label="处理时间">{currentAppeal.handled_at}</Descriptions.Item>
                  <Descriptions.Item label="处理理由" span={2}>
                    {currentAppeal.handle_reason}
                  </Descriptions.Item>
                </>
              )}
            </Descriptions>

            {currentAppeal.status === 'pending' && (
              <Form form={appealHandleForm} layout="vertical">
                <Divider orientation="left">当前分数</Divider>
                <Row gutter={16} style={{ marginBottom: 16 }}>
                  {DIMENSION_CONFIG.map(dim => (
                    <Col span={6} key={dim.key}>
                      <Statistic
                        title={dim.label}
                        value={currentAppeal[`${dim.key}_score`] || 0}
                        precision={1}
                        valueStyle={{ fontSize: 16, color: dim.color }}
                      />
                    </Col>
                  ))}
                </Row>

                <Form.Item
                  label="处理结果"
                  name="handle_result"
                  rules={[{ required: true, message: '请选择处理结果' }]}
                >
                  <Radio.Group>
                    <Radio value="maintain">维持原分</Radio>
                    <Radio value="adjust">调整分数</Radio>
                  </Radio.Group>
                </Form.Item>

                <Form.Item shouldUpdate noStyle>
                  {({ getFieldValue }) =>
                    getFieldValue('handle_result') === 'adjust' && (
                      <>
                        <Divider orientation="left">调整分数</Divider>
                        <Row gutter={16} style={{ marginBottom: 16 }}>
                          {DIMENSION_CONFIG.map(dim => (
                            <Col span={6} key={dim.key}>
                              <Form.Item
                                label={dim.label}
                                name={`${dim.key}_score`}
                                rules={[
                                  { required: true, message: '请输入分数' },
                                  { type: 'number', min: 1, max: 10, message: '分数范围1-10' }
                                ]}
                              >
                                <InputNumber
                                  style={{ width: '100%' }}
                                  min={1}
                                  max={10}
                                  step={0.5}
                                />
                              </Form.Item>
                            </Col>
                          ))}
                        </Row>
                      </>
                    )
                  }
                </Form.Item>

                <Form.Item
                  label="处理理由"
                  name="handle_reason"
                  rules={[{ required: true, message: '请填写处理理由' }]}
                >
                  <TextArea
                    rows={3}
                    placeholder="请填写处理理由..."
                    showCount
                    maxLength={500}
                  />
                </Form.Item>
              </Form>
            )}

            {currentAppeal.status === 'adjusted' && currentAppeal.adjusted_attendance !== null && (
              <>
                <Divider orientation="left">调整后的分数</Divider>
                <Row gutter={16}>
                  <Col span={6}>
                    <Statistic
                      title="出勤纪律"
                      value={currentAppeal.adjusted_attendance}
                      precision={1}
                      valueStyle={{ fontSize: 16, color: '#1890ff' }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title="护理操作规范"
                      value={currentAppeal.adjusted_operation}
                      precision={1}
                      valueStyle={{ fontSize: 16, color: '#52c41a' }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title="患者满意度"
                      value={currentAppeal.adjusted_satisfaction}
                      precision={1}
                      valueStyle={{ fontSize: 16, color: '#faad14' }}
                    />
                  </Col>
                  <Col span={6}>
                    <Statistic
                      title="团队协作"
                      value={currentAppeal.adjusted_teamwork}
                      precision={1}
                      valueStyle={{ fontSize: 16, color: '#722ed1' }}
                    />
                  </Col>
                </Row>
              </>
            )}
          </div>
        )}
      </Modal>
    </Layout>
  );
}

export default AssessmentPage;
