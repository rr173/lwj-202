import { useState, useEffect } from 'react';
import {
  Layout, Menu, Button, Modal, Form, Select, Tag, message,
  DatePicker, Input, Space, Card, Badge, Radio, List, Tooltip, Divider, Progress, InputNumber
} from 'antd';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import {
  getDepartments, getNurses, getSchedule,
  getHandovers, getHandover, createHandover,
  signoffHandoverItem, headNurseConfirmHandover,
  getHandoverStatistics
} from './api';

const { Sider, Content } = Layout;
const { TextArea } = Input;
const { Option } = Select;

const SHIFT_NAMES = { morning: '早班', afternoon: '中班', night: '夜班' };
const SHIFT_COLORS = { morning: '#52c41a', afternoon: '#1890ff', night: '#722ed1' };

const ITEM_TYPE_MAP = { abnormal: '异常情况', key_patient: '重点关注患者', todo: '待办事项' };
const ITEM_TYPE_COLOR = { abnormal: '#ff4d4f', key_patient: '#fa8c16', todo: '#1890ff' };

const URGENCY_MAP = {
  1: { text: '一般', color: '#52c41a' },
  2: { text: '较急', color: '#faad14' },
  3: { text: '紧急', color: '#ff4d4f' }
};

const STATUS_MAP = {
  pending_sign: { text: '待交班', color: 'default' },
  pending_confirm: { text: '待签收', color: 'gold' },
  completed: { text: '已完成', color: 'green' },
  disputed: { text: '有异议', color: 'red' }
};

function HandoverPage() {
  const [departments, setDepartments] = useState([]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [nurses, setNurses] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [handovers, setHandovers] = useState([]);
  const [selectedHandover, setSelectedHandover] = useState(null);
  const [handoverDetail, setHandoverDetail] = useState(null);
  const [filterStatus, setFilterStatus] = useState(null);
  const [month, setMonth] = useState(dayjs());
  const [statistics, setStatistics] = useState(null);

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createItems, setCreateItems] = useState([{ item_type: 'abnormal', description: '', urgency: 2 }]);
  const [createForm] = Form.useForm();

  const [signoffModalVisible, setSignoffModalVisible] = useState(false);
  const [signoffItem, setSignoffItem] = useState(null);
  const [signoffResult, setSignoffResult] = useState('confirmed');
  const [signoffRemark, setSignoffRemark] = useState('');

  const [headNurseModalVisible, setHeadNurseModalVisible] = useState(false);
  const [headNurseForm] = Form.useForm();

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    if (selectedDept) {
      loadNurses();
      loadSchedule();
      loadHandovers();
      loadStatistics();
    }
  }, [selectedDept, month, filterStatus]);

  useEffect(() => {
    if (selectedHandover) {
      loadHandoverDetail();
    } else {
      setHandoverDetail(null);
    }
  }, [selectedHandover]);

  const loadDepartments = async () => {
    try {
      const res = await getDepartments();
      setDepartments(res.data);
      if (res.data.length > 0) setSelectedDept(res.data[0]);
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
      setSchedule(res.data.schedules || res.data);
    } catch (err) {
      setSchedule([]);
    }
  };

  const loadHandovers = async () => {
    if (!selectedDept) return;
    try {
      const params = { department_id: selectedDept.id, month: month.format('YYYY-MM') };
      if (filterStatus) params.status = filterStatus;
      const res = await getHandovers(params);
      setHandovers(res.data);
      if (selectedHandover) {
        const stillExists = res.data.find(h => h.id === selectedHandover.id);
        if (!stillExists) {
          setSelectedHandover(null);
        }
      }
    } catch (err) {
      message.error('加载交接记录失败');
    }
  };

  const loadHandoverDetail = async () => {
    if (!selectedHandover) return;
    try {
      const res = await getHandover(selectedHandover.id);
      setHandoverDetail(res.data);
    } catch (err) {
      message.error('加载交接详情失败');
    }
  };

  const loadStatistics = async () => {
    if (!selectedDept) return;
    try {
      const res = await getHandoverStatistics({ department_id: selectedDept.id, month: month.format('YYYY-MM') });
      setStatistics(res.data);
    } catch (err) {
      setStatistics(null);
    }
  };

  const handleCreateHandover = async () => {
    try {
      const values = await createForm.validateFields();
      const invalidItem = createItems.find(i => !i.description.trim());
      if (invalidItem) {
        message.error('请填写所有事项描述');
        return;
      }
      await createHandover({
        department_id: selectedDept.id,
        from_nurse_id: values.from_nurse_id,
        to_nurse_id: values.to_nurse_id,
        handover_date: values.handover_date.format('YYYY-MM-DD'),
        shift_type: values.shift_type,
        items: createItems
      });
      message.success('交接记录创建成功');
      setCreateModalVisible(false);
      createForm.resetFields();
      setCreateItems([{ item_type: 'abnormal', description: '', urgency: 2 }]);
      loadHandovers();
      loadStatistics();
    } catch (err) {
      if (err.response?.data?.error) {
        message.error(err.response.data.error);
      } else if (err.errorFields) {
        message.error('请填写完整信息');
      } else {
        message.error('创建失败');
      }
    }
  };

  const handleSignoff = async () => {
    if (!handoverDetail || !signoffItem) return;
    try {
      await signoffHandoverItem(handoverDetail.id, {
        item_id: signoffItem.id,
        nurse_id: handoverDetail.to_nurse_id,
        result: signoffResult,
        remark: signoffRemark || null
      });
      message.success(signoffResult === 'confirmed' ? '已确认' : '已标记疑问');
      setSignoffModalVisible(false);
      setSignoffItem(null);
      setSignoffResult('confirmed');
      setSignoffRemark('');
      loadHandoverDetail();
      loadHandovers();
      loadStatistics();
    } catch (err) {
      message.error(err.response?.data?.error || '签收失败');
    }
  };

  const handleHeadNurseConfirm = async () => {
    if (!handoverDetail) return;
    try {
      const values = await headNurseForm.validateFields();
      await headNurseConfirmHandover(handoverDetail.id, {
        head_nurse_id: values.head_nurse_id,
        remark: values.remark || null
      });
      message.success('护士长确认完成');
      setHeadNurseModalVisible(false);
      headNurseForm.resetFields();
      loadHandoverDetail();
      loadHandovers();
      loadStatistics();
    } catch (err) {
      message.error(err.response?.data?.error || '确认失败');
    }
  };

  const addCreateItem = () => {
    setCreateItems([...createItems, { item_type: 'abnormal', description: '', urgency: 2 }]);
  };

  const removeCreateItem = (index) => {
    if (createItems.length <= 1) return;
    setCreateItems(createItems.filter((_, i) => i !== index));
  };

  const updateCreateItem = (index, field, value) => {
    const updated = [...createItems];
    updated[index] = { ...updated[index], [field]: value };
    setCreateItems(updated);
  };

  const handoversByDate = {};
  handovers.forEach(h => {
    if (!handoversByDate[h.handover_date]) handoversByDate[h.handover_date] = [];
    handoversByDate[h.handover_date].push(h);
  });
  const sortedDates = Object.keys(handoversByDate).sort((a, b) => b.localeCompare(a));

  const getCompletionChartOption = () => {
    if (!statistics) return {};
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { fontSize: 12 } },
      series: [{
        type: 'pie',
        radius: ['40%', '65%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        label: { show: true, fontSize: 11, formatter: '{b}: {c}' },
        data: [
          { value: statistics.completed, name: '已完成', itemStyle: { color: '#52c41a' } },
          { value: statistics.pending_confirm, name: '待签收', itemStyle: { color: '#faad14' } },
          { value: statistics.pending_sign, name: '待交班', itemStyle: { color: '#d9d9d9' } },
          { value: statistics.disputed, name: '有异议', itemStyle: { color: '#ff4d4f' } }
        ].filter(d => d.value > 0)
      }]
    };
  };

  const getUrgencyChartOption = () => {
    if (!statistics || !statistics.urgency_distribution) return {};
    const urgencyData = statistics.urgency_distribution.map(u => ({
      value: u.count,
      name: URGENCY_MAP[u.urgency]?.text || `级别${u.urgency}`,
      itemStyle: { color: URGENCY_MAP[u.urgency]?.color || '#999' }
    }));
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { fontSize: 12 } },
      series: [{
        type: 'pie',
        radius: ['35%', '60%'],
        center: ['50%', '45%'],
        label: { show: true, fontSize: 11, formatter: '{b}: {c}' },
        data: urgencyData
      }]
    };
  };

  const seniorNurses = nurses.filter(n => n.level === 'senior');

  const openSignoffModal = (item) => {
    setSignoffItem(item);
    setSignoffResult('confirmed');
    setSignoffRemark('');
    setSignoffModalVisible(true);
  };

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider width={260} theme="light" style={{ borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px', borderBottom: '1px solid #e8e8e8' }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '8px' }}>科室列表</div>
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
        <div style={{ padding: '16px', borderTop: '1px solid #e8e8e8' }}>
          <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '8px' }}>交接记录</div>
          <div style={{ marginBottom: '8px' }}>
            <Select
              value={filterStatus}
              onChange={setFilterStatus}
              allowClear
              placeholder="筛选状态"
              style={{ width: '100%' }}
              size="small"
            >
              {Object.entries(STATUS_MAP).map(([key, val]) => (
                <Option key={key} value={key}>{val.text}</Option>
              ))}
            </Select>
          </div>
          <div style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
            {sortedDates.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#999', padding: '20px 0' }}>暂无记录</div>
            ) : (
              sortedDates.map(date => (
                <div key={date} style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '12px', color: '#999', marginBottom: '4px', fontWeight: '500' }}>
                    {dayjs(date).format('MM月DD日')}
                  </div>
                  {handoversByDate[date].map(h => (
                    <div
                      key={h.id}
                      onClick={() => setSelectedHandover(h)}
                      style={{
                        padding: '8px 10px',
                        marginBottom: '4px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        background: selectedHandover?.id === h.id ? '#e6f7ff' : '#fafafa',
                        border: selectedHandover?.id === h.id ? '1px solid #1890ff' : '1px solid #e8e8e8',
                        transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Tag color={SHIFT_COLORS[h.shift_type]} style={{ margin: 0, fontSize: '11px' }}>
                          {SHIFT_NAMES[h.shift_type]}
                        </Tag>
                        <Tag color={STATUS_MAP[h.status]?.color} style={{ margin: 0, fontSize: '11px' }}>
                          {STATUS_MAP[h.status]?.text}
                        </Tag>
                      </div>
                      <div style={{ fontSize: '12px', marginTop: '4px', color: '#666' }}>
                        {h.from_nurse_name} → {h.to_nurse_name}
                      </div>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </Sider>
      <Layout>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #e8e8e8', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h2 style={{ margin: 0 }}>{selectedDept?.name || '交接班管理'}</h2>
            <DatePicker
              picker="month"
              value={month}
              onChange={(date) => date && setMonth(date)}
              allowClear={false}
            />
          </div>
          <Button type="primary" onClick={() => {
            createForm.resetFields();
            setCreateItems([{ item_type: 'abnormal', description: '', urgency: 2 }]);
            setCreateModalVisible(true);
          }}>
            新建交接
          </Button>
        </div>
        <Content style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
          <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
            {handoverDetail ? (
              <div>
                <Card
                  style={{ marginBottom: '16px' }}
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <Tag color={SHIFT_COLORS[handoverDetail.shift_type]}>{SHIFT_NAMES[handoverDetail.shift_type]}</Tag>
                      <span>{handoverDetail.handover_date}</span>
                      <Tag color={STATUS_MAP[handoverDetail.status]?.color}>
                        {STATUS_MAP[handoverDetail.status]?.text}
                      </Tag>
                    </div>
                  }
                >
                  <div style={{ display: 'flex', gap: '32px', marginBottom: '12px' }}>
                    <div>
                      <span style={{ color: '#999', fontSize: '13px' }}>交班人：</span>
                      <strong>{handoverDetail.from_nurse_name}</strong>
                      {handoverDetail.from_nurse_signed_at && (
                        <span style={{ fontSize: '12px', color: '#52c41a', marginLeft: '8px' }}>
                          已提交 {dayjs(handoverDetail.from_nurse_signed_at).format('HH:mm')}
                        </span>
                      )}
                    </div>
                    <div>
                      <span style={{ color: '#999', fontSize: '13px' }}>接班人：</span>
                      <strong>{handoverDetail.to_nurse_name}</strong>
                      {handoverDetail.to_nurse_signed_at && (
                        <span style={{ fontSize: '12px', color: '#52c41a', marginLeft: '8px' }}>
                          已签收 {dayjs(handoverDetail.to_nurse_signed_at).format('HH:mm')}
                        </span>
                      )}
                    </div>
                  </div>
                  {handoverDetail.status === 'disputed' && (
                    <div style={{ padding: '8px 12px', background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: '6px', marginBottom: '12px' }}>
                      <div style={{ color: '#ff4d4f', fontWeight: '500', marginBottom: '4px' }}>⚠ 交接有异议，需护士长介入确认</div>
                      <Button size="small" type="primary" danger onClick={() => {
                        headNurseForm.resetFields();
                        setHeadNurseModalVisible(true);
                      }}>
                        护士长确认
                      </Button>
                    </div>
                  )}
                  {handoverDetail.head_nurse_id && (
                    <div style={{ padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: '6px', fontSize: '13px' }}>
                      <div>护士长 <strong>{handoverDetail.head_nurse_name}</strong> 已于 {handoverDetail.head_nurse_confirmed_at} 确认</div>
                      {handoverDetail.head_nurse_remark && <div style={{ color: '#666', marginTop: '4px' }}>备注: {handoverDetail.head_nurse_remark}</div>}
                    </div>
                  )}
                </Card>

                <Card title={<span>交接事项 ({handoverDetail.items?.length || 0}条)</span>}>
                  {handoverDetail.items?.map((item, index) => (
                    <div
                      key={item.id}
                      style={{
                        padding: '12px 16px',
                        marginBottom: '8px',
                        borderRadius: '8px',
                        border: '1px solid #e8e8e8',
                        background: item.signoff_result === 'questioned' ? '#fff1f0' : item.signoff_result === 'confirmed' ? '#f6ffed' : '#fafafa'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
                            <span style={{ fontWeight: '600', color: '#333' }}>#{index + 1}</span>
                            <Tag color={ITEM_TYPE_COLOR[item.item_type]}>{ITEM_TYPE_MAP[item.item_type]}</Tag>
                            <Tag color={URGENCY_MAP[item.urgency]?.color}>{URGENCY_MAP[item.urgency]?.text}</Tag>
                          </div>
                          <div style={{ fontSize: '14px', color: '#333', lineHeight: '1.6' }}>{item.description}</div>
                        </div>
                        <div style={{ marginLeft: '16px', flexShrink: 0 }}>
                          {item.signoff_result ? (
                            <Tag color={item.signoff_result === 'confirmed' ? 'green' : 'red'}>
                              {item.signoff_result === 'confirmed' ? '✓ 已确认' : '✗ 有疑问'}
                            </Tag>
                          ) : handoverDetail.status === 'pending_confirm' || handoverDetail.status === 'disputed' ? (
                            <Button size="small" type="primary" onClick={() => openSignoffModal(item)}>
                              签收
                            </Button>
                          ) : (
                            <Tag>待签收</Tag>
                          )}
                        </div>
                      </div>
                      {item.signoff_result === 'questioned' && item.signoff_remark && (
                        <div style={{ marginTop: '8px', padding: '6px 10px', background: '#fff', borderRadius: '4px', fontSize: '13px', color: '#ff4d4f', border: '1px solid #ffa39e' }}>
                          疑问: {item.signoff_remark}
                        </div>
                      )}
                      {item.signoff_result && (
                        <div style={{ marginTop: '4px', fontSize: '12px', color: '#999' }}>
                          签收人: {item.signoff_nurse_name} | {dayjs(item.signed_at).format('MM-DD HH:mm')}
                        </div>
                      )}
                    </div>
                  ))}
                </Card>
              </div>
            ) : (
              <div style={{ textAlign: 'center', color: '#999', padding: '80px 0', fontSize: '16px' }}>
                请选择左侧交接记录查看详情
              </div>
            )}
          </div>

          {statistics && (
            <div style={{ borderTop: '1px solid #e8e8e8', background: '#fff', padding: '16px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '12px' }}>月度交接统计 - {month.format('YYYY年MM月')}</div>
                  <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#1890ff' }}>{statistics.total}</div>
                      <div style={{ fontSize: '12px', color: '#999' }}>总交接数</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#52c41a' }}>{statistics.completion_rate}%</div>
                      <div style={{ fontSize: '12px', color: '#999' }}>完成率</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#fa8c16' }}>{statistics.avg_signoff_minutes}分钟</div>
                      <div style={{ fontSize: '12px', color: '#999' }}>平均签收时长</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#ff4d4f' }}>{statistics.disputed}</div>
                      <div style={{ fontSize: '12px', color: '#999' }}>异议数</div>
                    </div>
                  </div>
                  <div style={{ marginTop: '12px' }}>
                    <Progress
                      percent={statistics.completion_rate}
                      strokeColor={{ '0%': '#52c41a', '100%': '#389e0d' }}
                      size="small"
                      format={() => `完成率 ${statistics.completion_rate}%`}
                    />
                  </div>
                </div>
                <div style={{ width: '200px' }}>
                  <ReactECharts option={getCompletionChartOption()} style={{ height: '160px' }} />
                </div>
                <div style={{ width: '200px' }}>
                  <ReactECharts option={getUrgencyChartOption()} style={{ height: '160px' }} />
                </div>
              </div>
            </div>
          )}
        </Content>
      </Layout>

      <Modal
        title="新建交接记录"
        open={createModalVisible}
        onOk={handleCreateHandover}
        onCancel={() => setCreateModalVisible(false)}
        width={640}
        okText="提交交接"
      >
        <Form form={createForm} layout="vertical">
          <div style={{ display: 'flex', gap: '16px' }}>
            <Form.Item name="from_nurse_id" label="交班人" rules={[{ required: true, message: '请选择交班人' }]} style={{ flex: 1 }}>
              <Select placeholder="选择交班人">
                {nurses.map(n => (
                  <Option key={n.id} value={n.id}>{n.name} ({n.level === 'senior' ? '资深' : '普通'})</Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="to_nurse_id" label="接班人" rules={[{ required: true, message: '请选择接班人' }]} style={{ flex: 1 }}>
              <Select placeholder="选择接班人">
                {nurses.map(n => (
                  <Option key={n.id} value={n.id}>{n.name} ({n.level === 'senior' ? '资深' : '普通'})</Option>
                ))}
              </Select>
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: '16px' }}>
            <Form.Item name="handover_date" label="交接日期" rules={[{ required: true, message: '请选择日期' }]} style={{ flex: 1 }}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="shift_type" label="班次类型" rules={[{ required: true, message: '请选择班次' }]} style={{ flex: 1 }}>
              <Select placeholder="选择班次">
                {Object.entries(SHIFT_NAMES).map(([key, name]) => (
                  <Option key={key} value={key}>{name}</Option>
                ))}
              </Select>
            </Form.Item>
          </div>
        </Form>

        <Divider orientation="left" style={{ fontSize: '14px' }}>交接事项</Divider>
        {createItems.map((item, index) => (
          <div key={index} style={{ marginBottom: '12px', padding: '12px', background: '#fafafa', borderRadius: '6px', border: '1px solid #e8e8e8' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontWeight: '500', fontSize: '13px' }}>事项 {index + 1}</span>
              <Select value={item.item_type} onChange={(v) => updateCreateItem(index, 'item_type', v)} size="small" style={{ width: '120px' }}>
                {Object.entries(ITEM_TYPE_MAP).map(([key, name]) => (
                  <Option key={key} value={key}>{name}</Option>
                ))}
              </Select>
              <Select value={item.urgency} onChange={(v) => updateCreateItem(index, 'urgency', v)} size="small" style={{ width: '90px' }}>
                {Object.entries(URGENCY_MAP).map(([key, val]) => (
                  <Option key={key} value={Number(key)}>{val.text}</Option>
                ))}
              </Select>
              {createItems.length > 1 && (
                <Button size="small" danger type="link" onClick={() => removeCreateItem(index)}>删除</Button>
              )}
            </div>
            <TextArea
              value={item.description}
              onChange={(e) => updateCreateItem(index, 'description', e.target.value)}
              placeholder="请输入事项描述"
              rows={2}
            />
          </div>
        ))}
        <Button type="dashed" block onClick={addCreateItem} style={{ marginTop: '4px' }}>+ 添加事项</Button>
      </Modal>

      <Modal
        title="签收事项"
        open={signoffModalVisible}
        onOk={handleSignoff}
        onCancel={() => { setSignoffModalVisible(false); setSignoffItem(null); }}
        okText="确认签收"
      >
        {signoffItem && (
          <div>
            <div style={{ marginBottom: '12px', padding: '10px', background: '#fafafa', borderRadius: '6px' }}>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                <Tag color={ITEM_TYPE_COLOR[signoffItem.item_type]}>{ITEM_TYPE_MAP[signoffItem.item_type]}</Tag>
                <Tag color={URGENCY_MAP[signoffItem.urgency]?.color}>{URGENCY_MAP[signoffItem.urgency]?.text}</Tag>
              </div>
              <div>{signoffItem.description}</div>
            </div>
            <div style={{ marginBottom: '12px' }}>
              <div style={{ marginBottom: '8px', fontWeight: '500' }}>签收结果</div>
              <Radio.Group value={signoffResult} onChange={(e) => setSignoffResult(e.target.value)}>
                <Radio value="confirmed">确认</Radio>
                <Radio value="questioned">有疑问</Radio>
              </Radio.Group>
            </div>
            <div>
              <div style={{ marginBottom: '8px', fontWeight: '500' }}>备注</div>
              <TextArea
                value={signoffRemark}
                onChange={(e) => setSignoffRemark(e.target.value)}
                placeholder={signoffResult === 'questioned' ? '请描述疑问内容' : '可选填写备注'}
                rows={3}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        title="护士长确认"
        open={headNurseModalVisible}
        onOk={handleHeadNurseConfirm}
        onCancel={() => { setHeadNurseModalVisible(false); headNurseForm.resetFields(); }}
        okText="确认"
      >
        <Form form={headNurseForm} layout="vertical">
          <Form.Item name="head_nurse_id" label="护士长" rules={[{ required: true, message: '请选择护士长' }]}>
            <Select placeholder="选择护士长">
              {seniorNurses.map(n => (
                <Option key={n.id} value={n.id}>{n.name}</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="remark" label="确认备注">
            <TextArea rows={3} placeholder="可选填写确认备注" />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}

export default HandoverPage;
