import { useState, useEffect, useMemo } from 'react';
import {
  Layout, Select, DatePicker, Button, Modal, Form, InputNumber, Input,
  Table, List, Card, Tag, message, Space, Tooltip, Divider, Row, Col, Slider,
  Statistic, Alert, Descriptions, Popconfirm
} from 'antd';
import { SettingOutlined, SaveOutlined, TrophyOutlined, LineChartOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import dayjs from 'dayjs';
import {
  getDepartments, getAssessmentMonthPreview, createQualityAssessment,
  getAssessmentWeightConfig, updateAssessmentWeightConfig,
  getAssessmentRanking, getAssessmentTrend, getAssessmentAutoInfo,
  getAssessmentHistory
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
  const [scoreForm] = Form.useForm();
  const [weightForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

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
      } else {
        scoreForm.resetFields();
        scoreForm.setFieldsValue({
          attendance_score: 8,
          operation_score: 8,
          satisfaction_score: 8,
          teamwork_score: 8
        });
      }
    } catch (err) {
      scoreForm.resetFields();
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
          {selectedNurse ? (
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
                  <Card title="本月考核详情预览" size="small">
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
    </Layout>
  );
}

export default AssessmentPage;
