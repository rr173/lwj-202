import { useState, useEffect } from 'react';
import {
  Layout, Select, Button, Table, Modal, Form, Input, InputNumber, DatePicker,
  message, Card, Tag, List, Typography, Space, Divider, Popconfirm, Badge,
  Alert, Statistic, Row, Col, Tooltip, Empty
} from 'antd';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import {
  getDepartments, getSupplies, createSupply, updateSupply, deleteSupply,
  getSupplyBatches, receiveSupply, createRequisition, getRequisitions,
  getSupplyFlow, getSupplyStockTrend, getSupplyWarnings,
  getSupplyMonthlyStatistics, getNurses
} from './api';

const { Option } = Select;
const { Header, Sider, Content, Footer } = Layout;
const { Title, Text } = Typography;
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

const WARNING_TYPE_CONFIG = {
  low_stock: { text: '库存不足', color: 'orange', icon: '⚠️' },
  expired: { text: '已过期', color: 'red', icon: '❌' },
  near_expiry: { text: '即将过期', color: 'gold', icon: '⏰' }
};

function SuppliesPage() {
  const [departments, setDepartments] = useState([]);
  const [currentDept, setCurrentDept] = useState(null);
  const [supplies, setSupplies] = useState([]);
  const [selectedSupply, setSelectedSupply] = useState(null);
  const [nurses, setNurses] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [supplyFlow, setSupplyFlow] = useState([]);
  const [stockTrend, setStockTrend] = useState({ dates: [], stocks: [] });
  const [batches, setBatches] = useState([]);
  const [monthlyStats, setMonthlyStats] = useState(null);

  const [addSupplyModal, setAddSupplyModal] = useState(false);
  const [editSupplyModal, setEditSupplyModal] = useState(false);
  const [receiveModal, setReceiveModal] = useState(false);
  const [requisitionModal, setRequisitionModal] = useState(false);
  const [statsModal, setStatsModal] = useState(false);

  const [supplyForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [receiveForm] = Form.useForm();
  const [requisitionForm] = Form.useForm();
  const [statsForm] = Form.useForm();

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    if (currentDept) {
      loadAllData();
    }
  }, [currentDept]);

  useEffect(() => {
    if (currentDept) {
      loadNurses();
    }
  }, [currentDept]);

  useEffect(() => {
    if (selectedSupply && currentDept) {
      loadSupplyDetail();
    }
  }, [selectedSupply, currentDept]);

  const loadDepartments = async () => {
    try {
      const res = await getDepartments();
      setDepartments(res.data);
      if (res.data.length > 0) setCurrentDept(res.data[0].id);
    } catch (e) {
      message.error('加载科室失败');
    }
  };

  const loadAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([loadSupplies(), loadWarnings()]);
    } finally {
      setLoading(false);
    }
  };

  const loadNurses = async () => {
    try {
      const res = await getNurses(currentDept);
      setNurses(res.data);
    } catch (e) {
      console.error('加载护士失败:', e);
    }
  };

  const loadSupplies = async () => {
    try {
      const res = await getSupplies(currentDept);
      setSupplies(res.data);
      if (res.data.length > 0 && !selectedSupply) {
        setSelectedSupply(res.data[0]);
      } else if (res.data.length === 0) {
        setSelectedSupply(null);
      } else if (selectedSupply) {
        const stillExists = res.data.find(s => s.id === selectedSupply.id);
        if (!stillExists) setSelectedSupply(res.data[0]);
        else setSelectedSupply(stillExists);
      }
    } catch (e) {
      message.error('加载耗材列表失败');
    }
  };

  const loadWarnings = async () => {
    try {
      const res = await getSupplyWarnings(currentDept);
      setWarnings(res.data);
    } catch (e) {
      console.error('加载预警失败:', e);
    }
  };

  const loadSupplyDetail = async () => {
    try {
      const [flowRes, trendRes, batchesRes] = await Promise.all([
        getSupplyFlow(selectedSupply.id, 50),
        getSupplyStockTrend(currentDept, selectedSupply.id, 30),
        getSupplyBatches(selectedSupply.id)
      ]);
      setSupplyFlow(flowRes.data);
      setStockTrend(trendRes.data);
      setBatches(batchesRes.data);
    } catch (e) {
      console.error('加载耗材详情失败:', e);
    }
  };

  const handleAddSupply = async () => {
    try {
      const values = await supplyForm.validateFields();
      await createSupply(currentDept, values);
      message.success('添加耗材成功');
      setAddSupplyModal(false);
      supplyForm.resetFields();
      await loadSupplies();
      await loadWarnings();
    } catch (e) {
      if (e.errorFields) return;
      message.error(e.response?.data?.error || '添加失败');
    }
  };

  const handleEditSupply = async () => {
    try {
      const values = await editForm.validateFields();
      await updateSupply(selectedSupply.id, values);
      message.success('修改成功');
      setEditSupplyModal(false);
      editForm.resetFields();
      await loadSupplies();
      await loadWarnings();
    } catch (e) {
      if (e.errorFields) return;
      message.error(e.response?.data?.error || '修改失败');
    }
  };

  const handleReceiveSupply = async () => {
    try {
      const values = await receiveForm.validateFields();
      await receiveSupply(selectedSupply.id, {
        ...values,
        expiry_date: values.expiry_date.format('YYYY-MM-DD')
      });
      message.success('入库成功');
      setReceiveModal(false);
      receiveForm.resetFields();
      await loadSupplies();
      await loadSupplyDetail();
      await loadWarnings();
    } catch (e) {
      if (e.errorFields) return;
      message.error(e.response?.data?.error || '入库失败');
    }
  };

  const handleRequisition = async () => {
    try {
      const values = await requisitionForm.validateFields();
      await createRequisition(currentDept, {
        supply_id: selectedSupply.id,
        ...values,
        requisition_time: values.requisition_time
          ? values.requisition_time.format('YYYY-MM-DD HH:mm:ss')
          : undefined
      });
      message.success('领用成功');
      setRequisitionModal(false);
      requisitionForm.resetFields();
      await loadSupplies();
      await loadSupplyDetail();
      await loadWarnings();
    } catch (e) {
      if (e.errorFields) return;
      message.error(e.response?.data?.error || '领用失败');
    }
  };

  const handleDeleteSupply = async (id) => {
    try {
      await deleteSupply(id);
      message.success('删除成功');
      setSelectedSupply(null);
      await loadSupplies();
      await loadWarnings();
    } catch (e) {
      message.error('删除失败');
    }
  };

  const handleViewStats = async () => {
    try {
      const values = await statsForm.validateFields();
      const res = await getSupplyMonthlyStatistics(currentDept, values.month.format('YYYY-MM'));
      setMonthlyStats(res.data);
    } catch (e) {
      if (e.errorFields) return;
      message.error(e.response?.data?.error || '查询失败');
    }
  };

  const stockTrendOption = {
    title: { text: '近30天库存趋势', left: 'center', textStyle: { fontSize: 14 } },
    tooltip: { trigger: 'axis' },
    grid: { left: '10%', right: '5%', bottom: '15%', top: '15%' },
    xAxis: {
      type: 'category',
      data: stockTrend.dates,
      axisLabel: { rotate: 45, fontSize: 10 }
    },
    yAxis: { type: 'value', name: selectedSupply?.unit || '数量' },
    series: [{
      data: stockTrend.stocks,
      type: 'line',
      smooth: true,
      areaStyle: { opacity: 0.3 },
      lineStyle: { color: '#1890ff', width: 2 },
      itemStyle: { color: '#1890ff' },
      markLine: selectedSupply ? {
        silent: true,
        data: [{ yAxis: selectedSupply.safety_threshold, name: '安全阈值', lineStyle: { color: '#fa8c16', type: 'dashed' } }],
        label: { formatter: '安全阈值' }
      } : undefined
    }]
  };

  const supplyColumns = [
    {
      title: '耗材名称',
      dataIndex: 'name',
      key: 'name',
      render: (t, r) => (
        <Space direction="vertical" size={0}>
          <Text strong>{t}</Text>
          {r.spec && <Text type="secondary" style={{ fontSize: 12 }}>{r.spec}</Text>}
        </Space>
      )
    },
    {
      title: '当前库存',
      dataIndex: 'total_stock',
      key: 'total_stock',
      width: 100,
      align: 'right',
      render: (v, r) => (
        <Badge
          count={r.is_low_stock ? '!' : 0}
          offset={[5, 0]}
          style={{ backgroundColor: r.total_stock === 0 ? '#ff4d4f' : '#fa8c16' }}
        >
          <Text strong style={{ color: r.is_low_stock ? '#ff4d4f' : undefined }}>
            {v} {r.unit}
          </Text>
        </Badge>
      )
    },
    {
      title: '安全阈值',
      dataIndex: 'safety_threshold',
      key: 'safety_threshold',
      width: 90,
      align: 'right',
      render: (v, r) => <Text type="secondary">{v} {r.unit}</Text>
    }
  ];

  const flowColumns = [
    {
      title: '时间',
      dataIndex: 'time',
      key: 'time',
      width: 160,
      render: (t) => dayjs(t).format('YYYY-MM-DD HH:mm')
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 70,
      render: (t) => t === 'in'
        ? <Tag color="green">入库</Tag>
        : <Tag color="blue">领用</Tag>
    },
    {
      title: '批次/班次',
      dataIndex: 'batch_no',
      key: 'batch_no',
      width: 120,
      render: (v, r) => r.type === 'in'
        ? <Text code>{v}</Text>
        : v && <Tag color={SHIFT_COLORS[v]}>{SHIFT_NAMES[v] || v}</Tag>
    },
    {
      title: '数量',
      dataIndex: 'qty',
      key: 'qty',
      width: 80,
      align: 'right',
      render: (v, r) => (
        <Text strong style={{ color: r.type === 'in' ? '#52c41a' : '#1890ff' }}>
          {r.type === 'in' ? '+' : '-'}{v}
        </Text>
      )
    },
    {
      title: '有效期',
      dataIndex: 'expiry_date',
      key: 'expiry_date',
      width: 100,
      render: (v) => v || '-'
    },
    {
      title: '操作人',
      dataIndex: 'operator_name',
      key: 'operator_name'
    }
  ];

  const batchColumns = [
    { title: '批次号', dataIndex: 'batch_no', key: 'batch_no', render: v => <Text code>{v}</Text> },
    { title: '总数量', dataIndex: 'quantity', key: 'quantity', width: 80, align: 'right' },
    {
      title: '剩余量',
      dataIndex: 'remaining',
      key: 'remaining',
      width: 80,
      align: 'right',
      render: (v, r) => (
        <Text style={{ color: r.is_expired ? '#ff4d4f' : v < r.quantity * 0.3 ? '#fa8c16' : undefined }}>
          {v}
        </Text>
      )
    },
    {
      title: '有效期',
      dataIndex: 'expiry_date',
      key: 'expiry_date',
      width: 110,
      render: (v, r) => (
        <Space>
          {r.is_expired ? <Tag color="red">已过期</Tag> : dayjs(v).isBefore(dayjs().add(30, 'day')) && <Tag color="gold">临期</Tag>}
          <Text>{v}</Text>
        </Space>
      )
    },
    { title: '入库时间', dataIndex: 'received_at', key: 'received_at', render: t => dayjs(t).format('YYYY-MM-DD') },
    { title: '操作人', dataIndex: 'operator_name', key: 'operator_name' }
  ];

  const warningCount = warnings.length;
  const lowStockCount = warnings.filter(w => w.warning_type === 'low_stock').length;
  const expiredCount = warnings.filter(w => w.warning_type === 'expired').length;

  return (
    <Layout style={{ height: 'calc(100vh - 48px)' }}>
      <Layout style={{ background: '#f0f2f5' }}>
        <Header style={{ background: '#fff', padding: '0 16px', height: 50, lineHeight: '50px', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Text strong style={{ fontSize: 15 }}>科室：</Text>
            <Select
              value={currentDept}
              onChange={setCurrentDept}
              style={{ width: 150 }}
              placeholder="选择科室"
            >
              {departments.map(d => (
                <Option key={d.id} value={d.id}>{d.name}</Option>
              ))}
            </Select>
            <Badge count={warningCount} offset={[5, -5]}>
              <Button type="dashed" size="small" onClick={() => loadAllData()}>
                刷新数据
              </Button>
            </Badge>
          </Space>
          <Space>
            <Button onClick={() => { statsForm.setFieldsValue({ month: dayjs() }); setStatsModal(true); }}>
              月度统计
            </Button>
            <Button type="primary" onClick={() => setAddSupplyModal(true)}>
              + 新增耗材
            </Button>
          </Space>
        </Header>

        <Layout style={{ padding: '0', overflow: 'hidden' }}>
          <Sider
            width={320}
            style={{ background: '#fff', borderRight: '1px solid #e8e8e8', overflow: 'auto' }}
          >
            <div style={{ padding: '12px 12px 8px' }}>
              <Row gutter={8}>
                <Col span={12}>
                  <Card size="small" style={{ background: lowStockCount > 0 ? '#fff7e6' : '#f6ffed' }}>
                    <Statistic
                      title={<span style={{ fontSize: 12 }}>库存不足</span>}
                      value={lowStockCount}
                      valueStyle={{ fontSize: 20, color: lowStockCount > 0 ? '#fa8c16' : '#52c41a' }}
                    />
                  </Card>
                </Col>
                <Col span={12}>
                  <Card size="small" style={{ background: expiredCount > 0 ? '#fff1f0' : '#f6ffed' }}>
                    <Statistic
                      title={<span style={{ fontSize: 12 }}>过期批次</span>}
                      value={expiredCount}
                      valueStyle={{ fontSize: 20, color: expiredCount > 0 ? '#ff4d4f' : '#52c41a' }}
                    />
                  </Card>
                </Col>
              </Row>
            </div>
            <Divider style={{ margin: '4px 0' }} />
            <div style={{ padding: '0 12px 8px' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>耗材列表（{supplies.length}种）</Text>
            </div>
            <Table
              size="small"
              rowKey="id"
              columns={supplyColumns}
              dataSource={supplies}
              loading={loading}
              pagination={false}
              scroll={{ y: 'calc(100vh - 320px)' }}
              onRow={(record) => ({
                onClick: () => setSelectedSupply(record),
                style: {
                  cursor: 'pointer',
                  background: selectedSupply?.id === record.id ? '#e6f7ff' : undefined,
                  borderLeft: selectedSupply?.id === record.id ? '3px solid #1890ff' : '3px solid transparent'
                }
              })}
              rowClassName={(r) => r.is_low_stock ? '' : ''}
            />
          </Sider>

          <Content style={{ padding: '12px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {selectedSupply ? (
              <>
                <Card
                  size="small"
                  title={
                    <Space>
                      <Title level={5} style={{ margin: 0 }}>
                        {selectedSupply.name}
                        {selectedSupply.spec && <Text type="secondary" style={{ fontSize: 13, marginLeft: 8 }}>{selectedSupply.spec}</Text>}
                      </Title>
                      {selectedSupply.is_low_stock && <Tag color="red">库存不足</Tag>}
                      {selectedSupply.has_expired && <Tag color="orange">存在过期</Tag>}
                      <Text type="secondary">单位: {selectedSupply.unit}</Text>
                      <Text type="secondary">安全阈值: {selectedSupply.safety_threshold}</Text>
                    </Space>
                  }
                  extra={
                    <Space>
                      <Button size="small" onClick={() => {
                        editForm.setFieldsValue({
                          name: selectedSupply.name,
                          spec: selectedSupply.spec,
                          unit: selectedSupply.unit,
                          safety_threshold: selectedSupply.safety_threshold,
                          category: selectedSupply.category
                        });
                        setEditSupplyModal(true);
                      }}>编辑</Button>
                      <Button size="small" type="primary" onClick={() => setReceiveModal(true)}>
                        入库补货
                      </Button>
                      <Button size="small" type="primary" ghost onClick={() => {
                        requisitionForm.resetFields();
                        requisitionForm.setFieldsValue({
                          requisition_time: dayjs()
                        });
                        setRequisitionModal(true);
                      }}>
                        领用登记
                      </Button>
                      <Popconfirm
                        title="确认删除该耗材？"
                        description="将同时删除所有批次和领用记录"
                        onConfirm={() => handleDeleteSupply(selectedSupply.id)}
                        okText="确认"
                        cancelText="取消"
                      >
                        <Button size="small" danger>删除</Button>
                      </Popconfirm>
                    </Space>
                  }
                />

                <Row gutter={12} style={{ flex: 1, minHeight: 300 }}>
                  <Col span={14}>
                    <Card
                      size="small"
                      title={<Text strong style={{ fontSize: 13 }}>出入库流水（最近50条）</Text>}
                      bodyStyle={{ padding: 0, height: '100%' }}
                      style={{ height: '100%' }}
                    >
                      <Table
                        size="small"
                        columns={flowColumns}
                        dataSource={supplyFlow}
                        pagination={false}
                        scroll={{ y: 260 }}
                        rowKey={(r, i) => `${r.type}-${r.id}-${i}`}
                        locale={{ emptyText: <Empty description="暂无流水记录" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                      />
                    </Card>
                  </Col>
                  <Col span={10}>
                    <Card size="small" style={{ height: '100%' }} bodyStyle={{ padding: '8px' }}>
                      <ReactECharts
                        option={stockTrendOption}
                        style={{ height: 290 }}
                        notMerge={true}
                      />
                    </Card>
                  </Col>
                </Row>

                <Card
                  size="small"
                  title={<Text strong style={{ fontSize: 13 }}>批次信息（{batches.filter(b => b.remaining > 0).length}个有效批次）</Text>}
                  bodyStyle={{ padding: 0 }}
                >
                  <Table
                    size="small"
                    columns={batchColumns}
                    dataSource={batches}
                    pagination={false}
                    scroll={{ y: 150 }}
                    rowKey="id"
                    locale={{ emptyText: <Empty description="暂无批次" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                  />
                </Card>
              </>
            ) : (
              <Card style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Empty description="请选择或新增耗材" />
              </Card>
            )}
          </Content>
        </Layout>

        <Footer
          style={{
            background: '#fff',
            padding: '8px 16px',
            borderTop: `2px solid ${warningCount > 0 ? '#ff4d4f' : '#e8e8e8'}`,
            maxHeight: 180,
            overflow: 'auto'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <Space>
              <Text strong>⚠️ 当前预警项</Text>
              <Badge count={warningCount} style={{ backgroundColor: '#ff4d4f' }} />
              {warningCount === 0 && <Tag color="green">全部正常</Tag>}
            </Space>
          </div>
          {warningCount > 0 ? (
            <List
              size="small"
              dataSource={warnings.slice(0, 10)}
              grid={{ gutter: 8, column: 3 }}
              renderItem={(w) => {
                const cfg = WARNING_TYPE_CONFIG[w.warning_type] || WARNING_TYPE_CONFIG.low_stock;
                return (
                  <List.Item>
                    <Alert
                      type={w.warning_type === 'expired' ? 'error' : w.warning_type === 'low_stock' ? 'warning' : 'warning'}
                      showIcon
                      style={{ padding: '6px 10px', fontSize: 12 }}
                      message={
                        <Space direction="vertical" size={0} style={{ width: '100%' }}>
                          <Space>
                            <Text strong>{cfg.icon} {cfg.text}</Text>
                            <Tag color={cfg.color}>{w.supply_name}{w.spec ? ` (${w.spec})` : ''}</Tag>
                          </Space>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            {w.warning_type === 'low_stock' && (
                              <>当前库存 {w.current_stock} / 阈值 {w.threshold}</>
                            )}
                            {w.warning_type === 'expired' && (
                              <>过期日期 {w.expiry_date}，剩余 {w.current_stock}</>
                            )}
                            {w.warning_type === 'near_expiry' && (
                              <>即将到期 {w.expiry_date}，剩余 {w.current_stock}</>
                            )}
                          </Text>
                        </Space>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          ) : (
            <Alert type="success" showIcon message="所有耗材库存充足，无过期批次" style={{ fontSize: 12 }} />
          )}
        </Footer>
      </Layout>

      <Modal
        title="新增耗材"
        open={addSupplyModal}
        onOk={handleAddSupply}
        onCancel={() => { setAddSupplyModal(false); supplyForm.resetFields(); }}
        okText="确认"
        cancelText="取消"
      >
        <Form form={supplyForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="耗材名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：一次性注射器" />
          </Form.Item>
          <Form.Item name="spec" label="规格/型号">
            <Input placeholder="如：5ml" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="unit" label="计量单位" initialValue="个">
                <Select>
                  <Option value="个">个</Option>
                  <Option value="支">支</Option>
                  <Option value="包">包</Option>
                  <Option value="卷">卷</Option>
                  <Option value="套">套</Option>
                  <Option value="根">根</Option>
                  <Option value="副">副</Option>
                  <Option value="盒">盒</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="safety_threshold" label="安全库存阈值" initialValue={10}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="category" label="分类" initialValue="general">
            <Select>
              <Option value="general">通用耗材</Option>
              <Option value="injection">注射类</Option>
              <Option value="dressing">敷料类</Option>
              <Option value="catheter">导管类</Option>
              <Option value="infusion">输液类</Option>
              <Option value="protection">防护类</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑耗材信息"
        open={editSupplyModal}
        onOk={handleEditSupply}
        onCancel={() => { setEditSupplyModal(false); editForm.resetFields(); }}
        okText="保存"
        cancelText="取消"
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="name" label="耗材名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="spec" label="规格/型号">
            <Input />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="unit" label="计量单位">
                <Select>
                  <Option value="个">个</Option>
                  <Option value="支">支</Option>
                  <Option value="包">包</Option>
                  <Option value="卷">卷</Option>
                  <Option value="套">套</Option>
                  <Option value="根">根</Option>
                  <Option value="副">副</Option>
                  <Option value="盒">盒</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="safety_threshold" label="安全库存阈值" rules={[{ required: true, message: '请输入阈值' }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="category" label="分类">
            <Select>
              <Option value="general">通用耗材</Option>
              <Option value="injection">注射类</Option>
              <Option value="dressing">敷料类</Option>
              <Option value="catheter">导管类</Option>
              <Option value="infusion">输液类</Option>
              <Option value="protection">防护类</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`入库补货 - ${selectedSupply?.name}${selectedSupply?.spec ? ` (${selectedSupply.spec})` : ''}`}
        open={receiveModal}
        onOk={handleReceiveSupply}
        onCancel={() => { setReceiveModal(false); receiveForm.resetFields(); }}
        okText="确认入库"
        cancelText="取消"
      >
        <Form form={receiveForm} layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item name="batch_no" label="批次号" rules={[{ required: true, message: '请输入批次号' }]}>
            <Input placeholder="如：SYZ20260601" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="quantity" label="入库数量" rules={[{ required: true, message: '请输入数量' }]}>
                <InputNumber min={1} style={{ width: '100%' }} addonAfter={selectedSupply?.unit} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="expiry_date" label="有效期" rules={[{ required: true, message: '请选择有效期' }]}>
                <DatePicker style={{ width: '100%' }} disabledDate={(d) => d.isBefore(dayjs().subtract(1, 'day'))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="operator_id" label="操作人（护士长）">
            <Select placeholder="请选择" allowClear>
              {nurses.filter(n => n.level === 'senior').map(n => (
                <Option key={n.id} value={n.id}>{n.name}</Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`耗材领用 - ${selectedSupply?.name}${selectedSupply?.spec ? ` (${selectedSupply.spec})` : ''}`}
        open={requisitionModal}
        onOk={handleRequisition}
        onCancel={() => { setRequisitionModal(false); requisitionForm.resetFields(); }}
        okText="确认领用"
        cancelText="取消"
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={`当前可用库存: ${selectedSupply?.total_stock || 0} ${selectedSupply?.unit || ''}`}
        />
        <Form form={requisitionForm} layout="vertical">
          <Form.Item name="nurse_id" label="领用人" rules={[{ required: true, message: '请选择领用人' }]}>
            <Select placeholder="请选择值班护士">
              {nurses.map(n => (
                <Option key={n.id} value={n.id}>{n.name} ({n.level === 'senior' ? '高级' : '初级'})</Option>
              ))}
            </Select>
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="quantity" label="领用数量" rules={[{ required: true, message: '请输入数量' }]}>
                <InputNumber min={1} max={selectedSupply?.total_stock || 1} style={{ width: '100%' }} addonAfter={selectedSupply?.unit} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="requisition_time" label="领用时间" initialValue={dayjs()}>
                <DatePicker showTime style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="remark" label="备注">
            <TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="月度耗材消耗统计"
        open={statsModal}
        onCancel={() => { setStatsModal(false); setMonthlyStats(null); }}
        footer={null}
        width={800}
      >
        <Form form={statsForm} layout="inline" style={{ marginBottom: 16 }}>
          <Form.Item name="month" label="统计月份" initialValue={dayjs()} rules={[{ required: true }]}>
            <DatePicker picker="month" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={handleViewStats}>查询</Button>
          </Form.Item>
        </Form>
        {monthlyStats && (
          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col span={8}>
              <Card size="small">
                <Statistic title="统计月份" value={monthlyStats.month} />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic
                  title="总领用量"
                  value={monthlyStats.supplies.reduce((a, b) => a + b.total_used, 0)}
                  suffix="件"
                />
              </Card>
            </Col>
            <Col span={8}>
              <Card size="small">
                <Statistic
                  title="预警耗材数"
                  value={monthlyStats.supplies.filter(s => s.is_low_stock).length}
                  valueStyle={{ color: monthlyStats.supplies.filter(s => s.is_low_stock).length > 0 ? '#ff4d4f' : '#52c41a' }}
                  suffix="种"
                />
              </Card>
            </Col>
          </Row>
        )}
        {monthlyStats && (
          <Table
            size="small"
            dataSource={monthlyStats.supplies}
            rowKey="supply_id"
            pagination={false}
            bordered
            columns={[
              { title: '耗材名称', dataIndex: 'supply_name', key: 'supply_name', render: (t, r) => <Space>{t}{r.supply_spec && <Text type="secondary" style={{ fontSize: 12 }}>({r.supply_spec})</Text>}</Space> },
              { title: '单位', dataIndex: 'unit', key: 'unit', width: 60, align: 'center' },
              { title: '本月总领用量', dataIndex: 'total_used', key: 'total_used', width: 100, align: 'right', render: v => <Text strong>{v}</Text> },
              { title: `日均消耗(${monthlyStats.days_in_month}天)`, dataIndex: 'avg_daily', key: 'avg_daily', width: 120, align: 'right', render: v => v.toFixed(2) },
              { title: '当前库存', dataIndex: 'current_stock', key: 'current_stock', width: 90, align: 'right', render: (v, r) => <Text style={{ color: r.is_low_stock ? '#ff4d4f' : undefined }} strong>{v}</Text> },
              { title: '安全阈值', dataIndex: 'safety_threshold', key: 'safety_threshold', width: 80, align: 'right' },
              { title: '预警状态', dataIndex: 'warning_status', key: 'warning_status', width: 90, align: 'center', render: (t, r) => <Tag color={r.is_low_stock ? (t === '缺货' ? 'red' : 'orange') : 'green'}>{t}</Tag> }
            ]}
          />
        )}
      </Modal>
    </Layout>
  );
}

export default SuppliesPage;
