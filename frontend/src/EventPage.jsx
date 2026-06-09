import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, Select, Tag, message,
  Space, DatePicker, InputNumber, Timeline, Card, Badge
} from 'antd';
import ReactECharts from 'echarts-for-react';
import {
  getDepartments, getNurses, getAdverseEvents, getAdverseEvent,
  createAdverseEvent, approveAdverseEvent, submitRectification,
  acceptAdverseEvent, rejectAdverseEvent, getAdverseEventStatistics,
  getAdverseEventNurseStatistics
} from './api';

const { Option } = Select;
const { TextArea } = Input;

const EVENT_TYPE_MAP = {
  medication_error: '给药错误',
  fall: '跌倒',
  pressure_ulcer: '压疮',
  infection: '感染',
  other: '其他'
};

const EVENT_TYPE_COLOR = {
  medication_error: '#ff4d4f',
  fall: '#fa8c16',
  pressure_ulcer: '#722ed1',
  infection: '#13c2c2',
  other: '#8c8c8c'
};

const STATUS_MAP = {
  pending: { text: '待审核', color: 'gold' },
  processing: { text: '处理中', color: 'blue' },
  reviewing: { text: '待验收', color: 'cyan' },
  closed: { text: '已关闭', color: 'green' }
};

const SEVERITY_MAP = {
  1: { text: 'I级(轻度)', color: '#52c41a' },
  2: { text: 'II级(中度)', color: '#faad14' },
  3: { text: 'III级(重度)', color: '#fa8c16' },
  4: { text: 'IV级(严重)', color: '#ff4d4f' }
};

function EventPage() {
  const [departments, setDepartments] = useState([]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [nurses, setNurses] = useState([]);
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [eventDetail, setEventDetail] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [filterType, setFilterType] = useState(null);
  const [statistics, setStatistics] = useState(null);
  const [nurseStats, setNurseStats] = useState([]);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [approveModalVisible, setApproveModalVisible] = useState(false);
  const [rectificationModalVisible, setRectificationModalVisible] = useState(false);
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewAction, setReviewAction] = useState(null);
  const [reviewerId, setReviewerId] = useState(null);

  const [createForm] = Form.useForm();
  const [approveForm] = Form.useForm();

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    if (selectedDept) {
      loadNurses();
      loadEvents();
      loadStatistics();
      loadNurseStats();
    }
  }, [selectedDept, filterStatus, filterType]);

  useEffect(() => {
    if (!selectedDept) return;
    const timer = setInterval(() => {
      loadEvents();
      loadStatistics();
    }, 60000);
    return () => clearInterval(timer);
  }, [selectedDept, filterStatus, filterType]);

  useEffect(() => {
    if (selectedEvent) {
      loadEventDetail();
    } else {
      setEventDetail(null);
    }
  }, [selectedEvent]);

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

  const loadNurses = async () => {
    if (!selectedDept) return;
    try {
      const res = await getNurses(selectedDept.id);
      setNurses(res.data);
    } catch (err) {
      message.error('加载护士列表失败');
    }
  };

  const loadEvents = async () => {
    if (!selectedDept) return;
    try {
      const params = { department_id: selectedDept.id };
      if (filterStatus) params.status = filterStatus;
      if (filterType) params.event_type = filterType;
      const res = await getAdverseEvents(params);
      setEvents(res.data);
      if (selectedEvent) {
        const stillExists = res.data.find(e => e.id === selectedEvent.id);
        if (!stillExists) {
          setSelectedEvent(null);
          setEventDetail(null);
        }
      }
    } catch (err) {
      message.error('加载事件列表失败');
    }
  };

  const loadEventDetail = async () => {
    if (!selectedEvent) return;
    try {
      const res = await getAdverseEvent(selectedEvent.id);
      setEventDetail(res.data);
    } catch (err) {
      message.error('加载事件详情失败');
    }
  };

  const loadStatistics = async () => {
    if (!selectedDept) return;
    try {
      const res = await getAdverseEventStatistics({ department_id: selectedDept.id });
      setStatistics(res.data);
    } catch (err) {
      setStatistics(null);
    }
  };

  const loadNurseStats = async () => {
    if (!selectedDept) return;
    try {
      const res = await getAdverseEventNurseStatistics(selectedDept.id);
      setNurseStats(res.data);
    } catch (err) {
      setNurseStats([]);
    }
  };

  const refreshAll = () => {
    loadEvents();
    loadStatistics();
    loadNurseStats();
    if (selectedEvent) loadEventDetail();
  };

  const handleCreate = async () => {
    try {
      const values = await createForm.validateFields();
      await createAdverseEvent({
        department_id: selectedDept.id,
        reporter_id: values.reporter_id,
        event_type: values.event_type,
        event_time: values.event_time.format('YYYY-MM-DD HH:mm'),
        patient_bed: values.patient_bed,
        severity: values.severity,
        description: values.description
      });
      message.success('不良事件上报成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      refreshAll();
    } catch (err) {
      if (err.response) {
        message.error(`上报失败: ${err.response?.data?.error || err.message}`);
      }
    }
  };

  const handleApprove = async () => {
    try {
      const values = await approveForm.validateFields();
      await approveAdverseEvent(selectedEvent.id, {
        responsible_nurse_id: values.responsible_nurse_id,
        rectification_days: values.rectification_days,
        reviewer_id: values.reviewer_id
      });
      message.success('审核通过，事件已进入处理中');
      setApproveModalVisible(false);
      approveForm.resetFields();
      refreshAll();
    } catch (err) {
      if (err.response) {
        message.error(`审核失败: ${err.response?.data?.error || err.message}`);
      }
    }
  };

  const handleSubmitRectification = async (report) => {
    if (!report || !report.trim()) {
      message.error('请填写整改报告');
      return;
    }
    try {
      await submitRectification(selectedEvent.id, {
        rectification_report: report,
        operator_id: eventDetail.responsible_nurse_id
      });
      message.success('整改报告提交成功');
      refreshAll();
    } catch (err) {
      message.error(`提交失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleAccept = async () => {
    if (!reviewerId) {
      message.error('请选择验收人');
      return;
    }
    try {
      await acceptAdverseEvent(selectedEvent.id, {
        reviewer_id: reviewerId
      });
      message.success('验收通过，事件已关闭');
      setReviewModalVisible(false);
      setReviewerId(null);
      refreshAll();
    } catch (err) {
      message.error(`验收失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleReject = async () => {
    if (!reviewerId) {
      message.error('请选择验收人');
      return;
    }
    try {
      await rejectAdverseEvent(selectedEvent.id, {
        reviewer_id: reviewerId,
        remark: '验收不通过，需重新整改'
      });
      message.warning('已退回处理中，整改期限已重置');
      setReviewModalVisible(false);
      setReviewerId(null);
      refreshAll();
    } catch (err) {
      message.error(`操作失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const openApproveModal = () => {
    approveForm.resetFields();
    setApproveModalVisible(true);
  };

  const getTypePieOption = () => {
    if (!statistics || !statistics.type_distribution) return {};
    const data = statistics.type_distribution.map(item => ({
      name: EVENT_TYPE_MAP[item.event_type] || item.event_type,
      value: item.count
    }));
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0, type: 'scroll' },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { show: true, formatter: '{b}\n{c}件' },
        data
      }]
    };
  };

  const getStatusPieOption = () => {
    if (!statistics || !statistics.status_distribution) return {};
    const data = statistics.status_distribution.map(item => ({
      name: STATUS_MAP[item.status]?.text || item.status,
      value: item.count
    }));
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: 0 },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { show: true, formatter: '{b}\n{c}件' },
        data,
        color: ['#faad14', '#1890ff', '#13c2c2', '#52c41a']
      }]
    };
  };

  const nurseStatsColumns = [
    {
      title: '护士',
      dataIndex: 'nurse_name',
      key: 'nurse_name',
      width: 100,
      render: (text, record) => (
        <span>{text} <span style={{ fontSize: 12, color: record.nurse_level === 'senior' ? '#fa8c16' : '#999' }}>({record.nurse_level === 'senior' ? '资深' : '普通'})</span></span>
      )
    },
    {
      title: '关联事件数',
      dataIndex: 'event_count',
      key: 'event_count',
      width: 100,
      align: 'center',
      render: (val) => val > 0 ? <Tag color="orange">{val}</Tag> : 0
    },
    {
      title: '已关闭',
      dataIndex: 'closed_count',
      key: 'closed_count',
      width: 80,
      align: 'center',
      render: (val) => val > 0 ? <Tag color="green">{val}</Tag> : 0
    },
    {
      title: '未关闭',
      dataIndex: 'open_count',
      key: 'open_count',
      width: 80,
      align: 'center',
      render: (val) => val > 0 ? <Tag color="red">{val}</Tag> : 0
    }
  ];

  const pendingCount = events.filter(e => e.status === 'pending').length;
  const reviewingCount = events.filter(e => e.status === 'reviewing').length;
  const overdueCount = events.filter(e => e.is_overdue === 1 && e.status !== 'closed').length;

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)' }}>
      <div style={{ width: 360, borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold', fontSize: 15 }}>不良事件列表</span>
          <Button type="primary" size="small" onClick={() => {
            createForm.resetFields();
            setCreateModalVisible(true);
          }}>上报事件</Button>
        </div>
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #e8e8e8' }}>
          <Select
            style={{ width: '100%', marginBottom: 8 }}
            value={selectedDept?.id}
            onChange={(val) => {
              const dept = departments.find(d => d.id === val);
              setSelectedDept(dept);
              setSelectedEvent(null);
              setEventDetail(null);
            }}
            placeholder="选择科室"
          >
            {departments.map(d => <Option key={d.id} value={d.id}>{d.name}</Option>)}
          </Select>
          <div style={{ display: 'flex', gap: 8 }}>
            <Select
              style={{ flex: 1 }}
              value={filterStatus}
              onChange={setFilterStatus}
              allowClear
              placeholder="按状态筛选"
            >
              <Option value="pending">待审核</Option>
              <Option value="processing">处理中</Option>
              <Option value="reviewing">待验收</Option>
              <Option value="closed">已关闭</Option>
            </Select>
            <Select
              style={{ flex: 1 }}
              value={filterType}
              onChange={setFilterType}
              allowClear
              placeholder="按类型筛选"
            >
              <Option value="medication_error">给药错误</Option>
              <Option value="fall">跌倒</Option>
              <Option value="pressure_ulcer">压疮</Option>
              <Option value="infection">感染</Option>
              <Option value="other">其他</Option>
            </Select>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {events.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '40px 16px' }}>暂无不良事件</div>
          ) : (
            events.map(evt => {
              const statusInfo = STATUS_MAP[evt.status];
              const isSelected = selectedEvent?.id === evt.id;
              return (
                <div
                  key={evt.id}
                  onClick={() => setSelectedEvent(evt)}
                  style={{
                    padding: '10px 16px',
                    cursor: 'pointer',
                    background: isSelected ? '#e6f7ff' : (evt.is_overdue === 1 && evt.status !== 'closed' ? '#fff1f0' : 'transparent'),
                    borderLeft: isSelected ? '3px solid #1890ff' : (evt.is_overdue === 1 && evt.status !== 'closed' ? '3px solid #ff4d4f' : '3px solid transparent'),
                    borderBottom: '1px solid #f0f0f0'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Tag color={EVENT_TYPE_COLOR[evt.event_type]} style={{ fontSize: 11 }}>{EVENT_TYPE_MAP[evt.event_type]}</Tag>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{evt.patient_bed}</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <Tag color={statusInfo?.color} style={{ fontSize: 11 }}>{statusInfo?.text}</Tag>
                      {evt.is_overdue === 1 && evt.status !== 'closed' && (
                        <Tag color="red" style={{ fontSize: 11 }}>逾期</Tag>
                      )}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {evt.description}
                  </div>
                  <div style={{ fontSize: 12, color: '#999', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{evt.reporter_name}</span>
                    <span>{evt.event_time?.substring(0, 16)}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {eventDetail ? (
            <div>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag color={EVENT_TYPE_COLOR[eventDetail.event_type]} style={{ fontSize: 13 }}>{EVENT_TYPE_MAP[eventDetail.event_type]}</Tag>
                    {eventDetail.patient_bed}
                    <Tag color={SEVERITY_MAP[eventDetail.severity]?.color}>{SEVERITY_MAP[eventDetail.severity]?.text}</Tag>
                    {eventDetail.is_overdue === 1 && eventDetail.status !== 'closed' && (
                      <Tag color="red">逾期</Tag>
                    )}
                  </h3>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
                    科室: {eventDetail.department_name} | 上报人: {eventDetail.reporter_name} | 发生时间: {eventDetail.event_time}
                  </div>
                </div>
                <Space>
                  {eventDetail.status === 'pending' && (
                    <Button type="primary" onClick={openApproveModal}>审核通过</Button>
                  )}
                  {eventDetail.status === 'processing' && (
                    <Button type="primary" onClick={() => setRectificationModalVisible(true)}>提交整改报告</Button>
                  )}
                  {eventDetail.status === 'reviewing' && (
                    <>
                      <Button type="primary" onClick={() => { setReviewAction('accept'); setReviewerId(null); setReviewModalVisible(true); }}>验收通过</Button>
                      <Button danger onClick={() => { setReviewAction('reject'); setReviewerId(null); setReviewModalVisible(true); }}>退回整改</Button>
                    </>
                  )}
                </Space>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <Card title="事件信息" size="small">
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 13 }}>
                    <div><span style={{ color: '#999' }}>事件类型：</span>{EVENT_TYPE_MAP[eventDetail.event_type]}</div>
                    <div><span style={{ color: '#999' }}>严重等级：</span>{SEVERITY_MAP[eventDetail.severity]?.text}</div>
                    <div><span style={{ color: '#999' }}>患者床号：</span>{eventDetail.patient_bed}</div>
                    <div><span style={{ color: '#999' }}>发生时间：</span>{eventDetail.event_time}</div>
                    <div><span style={{ color: '#999' }}>上报人：</span>{eventDetail.reporter_name}</div>
                    <div><span style={{ color: '#999' }}>当前状态：</span><Tag color={STATUS_MAP[eventDetail.status]?.color}>{STATUS_MAP[eventDetail.status]?.text}</Tag></div>
                    {eventDetail.responsible_nurse_name && (
                      <div><span style={{ color: '#999' }}>责任人：</span>{eventDetail.responsible_nurse_name}</div>
                    )}
                    {eventDetail.rectification_deadline && (
                      <div><span style={{ color: '#999' }}>整改期限：</span>{eventDetail.rectification_deadline}</div>
                    )}
                  </div>
                  {eventDetail.description && (
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      <span style={{ color: '#999' }}>事件描述：</span>
                      <div style={{ padding: '8px', background: '#f5f5f5', borderRadius: 4, marginTop: 4 }}>{eventDetail.description}</div>
                    </div>
                  )}
                </Card>

                <Card title="状态流转时间线" size="small">
                  <Timeline
                    items={(eventDetail.timeline || []).map((tl, idx) => ({
                      color: tl.to_status === 'closed' ? 'green' :
                             tl.to_status === 'pending' ? 'gray' :
                             tl.to_status === 'processing' ? 'blue' :
                             tl.to_status === 'reviewing' ? 'cyan' :
                             tl.action.includes('逾期') ? 'red' : 'blue',
                      children: (
                        <div key={idx}>
                          <div style={{ fontSize: 13, fontWeight: 500 }}>
                            {tl.action}
                            {tl.from_status && tl.to_status && tl.from_status !== tl.to_status && (
                              <span style={{ marginLeft: 8, fontSize: 11 }}>
                                ({STATUS_MAP[tl.from_status]?.text} → {STATUS_MAP[tl.to_status]?.text})
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 12, color: '#999' }}>
                            {tl.operator_name && <span>操作人: {tl.operator_name} | </span>}
                            {tl.created_at}
                          </div>
                          {tl.remark && (
                            <div style={{ fontSize: 12, color: '#666', marginTop: 2, padding: '4px 8px', background: '#f5f5f5', borderRadius: 4 }}>
                              {tl.remark}
                            </div>
                          )}
                        </div>
                      )
                    }))}
                  />
                </Card>
              </div>

              {eventDetail.rectification_report && (
                <Card title="整改报告" size="small" style={{ marginBottom: 16 }}>
                  <div style={{ padding: '12px', background: '#f6ffed', borderRadius: 4, border: '1px solid #b7eb8f', fontSize: 13 }}>
                    {eventDetail.rectification_report}
                  </div>
                </Card>
              )}

              <Card title="护士事件关联统计" size="small">
                <Table
                  columns={nurseStatsColumns}
                  dataSource={nurseStats}
                  rowKey="nurse_id"
                  size="small"
                  pagination={false}
                />
              </Card>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#999', padding: '80px 0' }}>
              请从左侧选择一个不良事件查看详情
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid #e8e8e8', padding: 16, background: '#fafafa' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <h4 style={{ margin: 0 }}>统计概览</h4>
              {statistics && (
                <span style={{ fontSize: 13, color: '#666' }}>
                  共 <strong>{statistics.total}</strong> 件
                  {statistics.overdue_count > 0 && (
                    <span style={{ color: '#ff4d4f', marginLeft: 8 }}>
                      逾期 <strong>{statistics.overdue_count}</strong> 件
                    </span>
                  )}
                  <span style={{ marginLeft: 8 }}>平均处理时长: <strong>{statistics.avg_processing_hours}h</strong></span>
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {pendingCount > 0 && <Badge count={pendingCount}><Tag color="gold">待审核</Tag></Badge>}
              {reviewingCount > 0 && <Badge count={reviewingCount}><Tag color="cyan">待验收</Tag></Badge>}
              {overdueCount > 0 && <Badge count={overdueCount}><Tag color="red">逾期</Tag></Badge>}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, textAlign: 'center' }}>事件类型分布</div>
              <ReactECharts
                option={getTypePieOption()}
                style={{ height: '260px', width: '100%' }}
                notMerge={true}
                lazyUpdate={true}
              />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8, textAlign: 'center' }}>事件状态分布</div>
              <ReactECharts
                option={getStatusPieOption()}
                style={{ height: '260px', width: '100%' }}
                notMerge={true}
                lazyUpdate={true}
              />
            </div>
          </div>
        </div>
      </div>

      <Modal
        title="上报不良事件"
        open={createModalVisible}
        onOk={handleCreate}
        onCancel={() => setCreateModalVisible(false)}
        width={560}
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="reporter_id" label="上报人" rules={[{ required: true, message: '请选择上报人' }]}>
            <Select placeholder="请选择护士" showSearch optionFilterProp="children">
              {nurses.map(n => (
                <Option key={n.id} value={n.id}>{n.name} ({n.level === 'senior' ? '资深' : '普通'})</Option>
              ))}
            </Select>
          </Form.Item>
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item name="event_type" label="事件类型" rules={[{ required: true, message: '请选择事件类型' }]} style={{ flex: 1 }}>
              <Select placeholder="请选择">
                <Option value="medication_error">给药错误</Option>
                <Option value="fall">跌倒</Option>
                <Option value="pressure_ulcer">压疮</Option>
                <Option value="infection">感染</Option>
                <Option value="other">其他</Option>
              </Select>
            </Form.Item>
            <Form.Item name="severity" label="严重等级" rules={[{ required: true, message: '请选择严重等级' }]} style={{ flex: 1 }}>
              <Select placeholder="请选择">
                <Option value={1}>I级 - 轻度</Option>
                <Option value={2}>II级 - 中度</Option>
                <Option value={3}>III级 - 重度</Option>
                <Option value={4}>IV级 - 严重</Option>
              </Select>
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item name="event_time" label="发生时间" rules={[{ required: true, message: '请选择发生时间' }]} style={{ flex: 1 }}>
              <DatePicker showTime format="YYYY-MM-DD HH:mm" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="patient_bed" label="患者床号" style={{ flex: 1 }}>
              <Input placeholder="如：12床" />
            </Form.Item>
          </div>
          <Form.Item name="description" label="事件描述" rules={[{ required: true, message: '请描述事件经过' }]}>
            <TextArea rows={4} placeholder="请详细描述事件发生经过" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="审核不良事件"
        open={approveModalVisible}
        onOk={handleApprove}
        onCancel={() => setApproveModalVisible(false)}
        width={480}
      >
        <Form form={approveForm} layout="vertical">
          <Form.Item name="reviewer_id" label="审核人" rules={[{ required: true, message: '请选择审核人' }]}>
            <Select placeholder="请选择审核人(科室负责人)">
              {nurses.filter(n => n.level === 'senior').map(n => (
                <Option key={n.id} value={n.id}>{n.name} (资深)</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="responsible_nurse_id" label="责任人" rules={[{ required: true, message: '请指定责任人' }]}>
            <Select placeholder="请选择责任人">
              {nurses.map(n => (
                <Option key={n.id} value={n.id}>{n.name} ({n.level === 'senior' ? '资深' : '普通'})</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="rectification_days" label="整改期限(天)" rules={[{ required: true, message: '请输入整改期限' }]}>
            <InputNumber min={1} max={90} style={{ width: '100%' }} placeholder="请输入整改天数" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="提交整改报告"
        open={rectificationModalVisible}
        onOk={() => {
          const report = document.getElementById('rectification-report-input')?.value;
          handleSubmitRectification(report);
          setRectificationModalVisible(false);
        }}
        onCancel={() => setRectificationModalVisible(false)}
        width={560}
      >
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 8 }}>
            事件: {EVENT_TYPE_MAP[eventDetail?.event_type]} | {eventDetail?.patient_bed} | 整改期限: {eventDetail?.rectification_deadline}
          </div>
          <TextArea
            id="rectification-report-input"
            rows={6}
            placeholder="请详细描述整改措施和执行情况"
            defaultValue=""
          />
        </div>
      </Modal>

      <Modal
        title={reviewAction === 'accept' ? '验收通过' : '退回整改'}
        open={reviewModalVisible}
        onOk={reviewAction === 'accept' ? handleAccept : handleReject}
        onCancel={() => { setReviewModalVisible(false); setReviewerId(null); }}
        width={420}
        okText={reviewAction === 'accept' ? '确认通过' : '确认退回'}
      >
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
            事件: {EVENT_TYPE_MAP[eventDetail?.event_type]} | {eventDetail?.patient_bed} | 责任人: {eventDetail?.responsible_nurse_name}
          </div>
          <div style={{ marginBottom: 8, fontWeight: 500 }}>验收人</div>
          <Select
            style={{ width: '100%' }}
            placeholder="请选择验收人(科室负责人)"
            value={reviewerId}
            onChange={setReviewerId}
          >
            {nurses.filter(n => n.level === 'senior').map(n => (
              <Option key={n.id} value={n.id}>{n.name} (资深)</Option>
            ))}
          </Select>
          <div style={{ fontSize: 12, color: '#999', marginTop: 8 }}>
            验收人应与责任人不同，确保审核独立性
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default EventPage;
