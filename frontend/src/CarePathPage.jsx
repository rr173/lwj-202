import { useState, useEffect } from 'react';
import {
  Layout, Button, Modal, Form, Select, Tag, message,
  Input, Space, Card, Badge, List, Tooltip, Divider, Progress,
  Row, Col, Statistic, Empty
} from 'antd';
import dayjs from 'dayjs';
import {
  getDepartments, getNurses,
  getCarePathTemplates, createPatientCarePath,
  getActivePatientCarePaths, getPatientCarePath,
  signCarePathOperation,
  getCarePathWarnings, handleCarePathWarning,
  getCarePathStatistics
} from './api';

const { Sider, Content } = Layout;
const { Option } = Select;

const STAGE_STATUS_COLOR = {
  pending: '#d9d9d9',
  in_progress: '#1890ff',
  completed: '#52c41a'
};

const STAGE_STATUS_TEXT = {
  pending: '待开始',
  in_progress: '进行中',
  completed: '已完成'
};

const OP_STATUS_COLOR = {
  pending: '#f0f0f0',
  completed: '#52c41a'
};

function CarePathPage() {
  const [departments, setDepartments] = useState([]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [nurses, setNurses] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [activePaths, setActivePaths] = useState([]);
  const [selectedPath, setSelectedPath] = useState(null);
  const [pathDetail, setPathDetail] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [currentMonth] = useState(dayjs().format('YYYY-MM'));

  const [admitModalVisible, setAdmitModalVisible] = useState(false);
  const [admitForm] = Form.useForm();

  const [signModalVisible, setSignModalVisible] = useState(false);
  const [signOperation, setSignOperation] = useState(null);
  const [signNurseId, setSignNurseId] = useState(null);

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    if (selectedDept) {
      loadNurses();
      loadTemplates();
      loadActivePaths();
      loadWarnings();
      loadStatistics();
    }
  }, [selectedDept]);

  useEffect(() => {
    if (selectedPath) {
      loadPathDetail();
    } else {
      setPathDetail(null);
    }
  }, [selectedPath]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (selectedDept) {
        loadActivePaths();
        loadWarnings();
        if (selectedPath) loadPathDetail();
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [selectedDept, selectedPath]);

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

  const loadTemplates = async () => {
    if (!selectedDept) return;
    try {
      const res = await getCarePathTemplates(selectedDept.id);
      setTemplates(res.data);
    } catch (err) {
      message.error('加载路径模板失败');
    }
  };

  const loadActivePaths = async () => {
    if (!selectedDept) return;
    try {
      const res = await getActivePatientCarePaths(selectedDept.id);
      setActivePaths(res.data);
      if (selectedPath) {
        const stillExists = res.data.find(p => p.id === selectedPath.id);
        if (!stillExists && res.data.length > 0) {
          setSelectedPath(res.data[0]);
        }
      } else if (res.data.length > 0) {
        setSelectedPath(res.data[0]);
      }
    } catch (err) {
      message.error('加载活跃路径失败');
    }
  };

  const loadPathDetail = async () => {
    if (!selectedPath) return;
    try {
      const res = await getPatientCarePath(selectedPath.id);
      setPathDetail(res.data);
    } catch (err) {
      message.error('加载路径详情失败');
    }
  };

  const loadWarnings = async () => {
    if (!selectedDept) return;
    try {
      const res = await getCarePathWarnings({ department_id: selectedDept.id, is_handled: 0 });
      setWarnings(res.data);
    } catch (err) {
      message.error('加载预警列表失败');
    }
  };

  const loadStatistics = async () => {
    if (!selectedDept) return;
    try {
      const res = await getCarePathStatistics(selectedDept.id, currentMonth);
      setStatistics(res.data);
    } catch (err) {
      // silently ignore statistics errors
    }
  };

  const handleAdmit = async (values) => {
    try {
      await createPatientCarePath({
        ...values,
        department_id: selectedDept.id,
        start_time: dayjs().format('YYYY-MM-DD HH:mm:ss')
      });
      message.success('患者入径成功');
      setAdmitModalVisible(false);
      admitForm.resetFields();
      loadActivePaths();
    } catch (err) {
      message.error(err.response?.data?.error || '入径失败');
    }
  };

  const openSignModal = (op) => {
    setSignOperation(op);
    setSignNurseId(null);
    setSignModalVisible(true);
  };

  const handleSign = async () => {
    if (!signNurseId) {
      message.error('请选择签署护士');
      return;
    }
    try {
      await signCarePathOperation(signOperation.id, signNurseId);
      message.success('签署成功');
      setSignModalVisible(false);
      loadActivePaths();
      loadPathDetail();
      loadWarnings();
    } catch (err) {
      message.error(err.response?.data?.error || '签署失败');
    }
  };

  const handleWarningHandle = async (warningId) => {
    try {
      await handleCarePathWarning(warningId, nurses[0]?.id);
      message.success('预警已处理');
      loadWarnings();
    } catch (err) {
      message.error('处理预警失败');
    }
  };

  const formatOverdue = (minutes) => {
    if (minutes < 60) return `${minutes}分钟`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}小时${m}分钟` : `${h}小时`;
  };

  const isOperationOverdue = (op, stage) => {
    if (op.status === 'completed') return false;
    if (!op.is_critical) return false;
    return dayjs().isAfter(dayjs(stage.deadline_time));
  };

  return (
    <Layout style={{ height: 'calc(100vh - 48px)' }}>
      <Sider width={320} style={{ background: '#fff', borderRight: '1px solid #e8e8e8' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e8e8e8' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Select
              style={{ width: 180 }}
              value={selectedDept?.id}
              onChange={(id) => setSelectedDept(departments.find(d => d.id === id))}
            >
              {departments.map(d => (
                <Option key={d.id} value={d.id}>{d.name}</Option>
              ))}
            </Select>
            <Button type="primary" size="small" onClick={() => setAdmitModalVisible(true)}>
              患者入径
            </Button>
          </Space>
        </div>

        <div style={{ padding: '8px 12px', background: '#fafafa', borderBottom: '1px solid #e8e8e8' }}>
          <Space size="large">
            <span style={{ fontSize: 12, color: '#666' }}>活跃患者: {activePaths.length}</span>
            <span style={{ fontSize: 12, color: '#ff4d4f' }}>超时预警: {warnings.length}</span>
          </Space>
        </div>

        <div style={{ overflow: 'auto', height: 'calc(100% - 100px)' }}>
          {activePaths.length === 0 ? (
            <Empty description="暂无活跃路径" style={{ marginTop: 40 }} />
          ) : (
            <List
              dataSource={activePaths}
              renderItem={(path) => (
                <List.Item
                  key={path.id}
                  onClick={() => setSelectedPath(path)}
                  style={{
                    cursor: 'pointer',
                    padding: '12px 16px',
                    background: selectedPath?.id === path.id ? '#e6f7ff' : '#fff',
                    borderBottom: '1px solid #f0f0f0',
                    borderLeft: selectedPath?.id === path.id ? '3px solid #1890ff' : '3px solid transparent'
                  }}
                >
                  <div style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <Space>
                        <span style={{ fontWeight: 600 }}>{path.patient_bed}</span>
                        {path.patient_name && <span style={{ color: '#666' }}>{path.patient_name}</span>}
                      </Space>
                      {path.has_overdue && (
                        <Badge count={path.overdue_count} size="small" />
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>
                      {path.template_name}
                      {path.has_overdue && <Tag color="red" style={{ marginLeft: 6 }}>有超时</Tag>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#888' }}>{path.current_stage_name}</span>
                      <Progress percent={path.progress_percent} size="small" style={{ flex: 1, margin: 0 }} />
                    </div>
                  </div>
                </List.Item>
              )}
            />
          )}
        </div>
      </Sider>

      <Layout style={{ background: '#f5f5f5', display: 'flex', flexDirection: 'column' }}>
        <Content style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {pathDetail ? (
            <div>
              <Card style={{ marginBottom: 16 }} size="small">
                <Space size="large" wrap>
                  <Statistic title="床号" value={pathDetail.patient_bed} />
                  <Statistic title="姓名" value={pathDetail.patient_name || '-'} />
                  <Statistic title="路径模板" value={pathDetail.template_name} />
                  <Statistic title="适用病种" value={pathDetail.applicable_disease} />
                  <Statistic title="入径时间" value={dayjs(pathDetail.start_time).format('MM-DD HH:mm')} />
                  <Statistic title="当前阶段" value={pathDetail.stages[pathDetail.current_stage_index]?.stage_name || '-'} />
                  <Statistic title="完成进度" value={`${pathDetail.progress_percent}%`} />
                </Space>
              </Card>

              <Card title="路径执行时间线" size="small">
                <div style={{ position: 'relative' }}>
                  {pathDetail.stages.map((stage, sIdx) => (
                    <div key={stage.id} style={{ marginBottom: sIdx === pathDetail.stages.length - 1 ? 0 : 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                        <div
                          style={{
                            width: 12,
                            height: 12,
                            borderRadius: '50%',
                            background: STAGE_STATUS_COLOR[stage.status],
                            marginRight: 10
                          }}
                        />
                        <Space>
                          <span style={{ fontWeight: 600 }}>{stage.stage_name}</span>
                          <Tag color={stage.status === 'completed' ? 'green' : stage.status === 'in_progress' ? 'blue' : 'default'}>
                            {STAGE_STATUS_TEXT[stage.status]}
                          </Tag>
                          <span style={{ fontSize: 12, color: '#888' }}>
                            截止: {dayjs(stage.deadline_time).format('MM-DD HH:mm')}
                          </span>
                        </Space>
                      </div>

                      <div style={{ marginLeft: 22, paddingLeft: 16, borderLeft: `2px solid ${STAGE_STATUS_COLOR[stage.status]}`, paddingBottom: 4 }}>
                        <Row gutter={[12, 12]}>
                          {stage.operations.map((op) => {
                            const overdue = isOperationOverdue(op, stage);
                            const cardColor = op.status === 'completed'
                              ? '#f6ffed'
                              : overdue
                                ? '#fff2f0'
                                : stage.status === 'in_progress'
                                  ? '#e6f7ff'
                                  : '#fafafa';
                            const borderColor = op.status === 'completed'
                              ? '#b7eb8f'
                              : overdue
                                ? '#ffccc7'
                                : stage.status === 'in_progress'
                                  ? '#91d5ff'
                                  : '#d9d9d9';
                            return (
                              <Col span={8} key={op.id}>
                                <Card
                                  size="small"
                                  style={{ background: cardColor, borderColor, height: '100%' }}
                                  bodyStyle={{ padding: 10 }}
                                  actions={op.status === 'pending' && stage.status === 'in_progress' ? [
                                    <Button
                                      key="sign"
                                      type="link"
                                      size="small"
                                      onClick={() => openSignModal(op)}
                                    >
                                      签署完成
                                    </Button>
                                  ] : []}
                                >
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                      <Space direction="vertical" size={2}>
                                        <span style={{ fontWeight: 500 }}>{op.operation_name}</span>
                                        <Space size={4}>
                                          {op.is_critical && <Tag color="red" style={{ margin: 0 }}>关键</Tag>}
                                          {op.status === 'completed' && <Tag color="green" style={{ margin: 0 }}>已完成</Tag>}
                                          {overdue && <Tag color="red" style={{ margin: 0 }}>超时</Tag>}
                                        </Space>
                                      </Space>
                                    </div>
                                  </div>
                                  {op.status === 'completed' && (
                                    <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
                                      <div>{op.signed_by_name}</div>
                                      <div>{dayjs(op.signed_at).format('MM-DD HH:mm')}</div>
                                    </div>
                                  )}
                                </Card>
                              </Col>
                            );
                          })}
                        </Row>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          ) : (
            <Empty description="请选择左侧患者查看详情" style={{ marginTop: 100 }} />
          )}
        </Content>

        <div
          style={{
            borderTop: '1px solid #e8e8e8',
            background: '#fff',
            maxHeight: 200,
            overflow: 'auto'
          }}
        >
          <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <span style={{ fontWeight: 600 }}>超时预警面板</span>
              <Badge count={warnings.length} size="small" />
            </Space>
            {statistics && (
              <Space size="large">
                <span style={{ fontSize: 12, color: '#666' }}>本月入径: {statistics.total_paths}</span>
                <span style={{ fontSize: 12, color: '#666' }}>完成率: {(statistics.completion_rate * 100).toFixed(0)}%</span>
                <span style={{ fontSize: 12, color: '#666' }}>平均超时: {statistics.avg_overdue_per_path}次/人</span>
              </Space>
            )}
          </div>
          {warnings.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>暂无未处理预警</div>
          ) : (
            <List
              size="small"
              dataSource={warnings}
              renderItem={(w) => (
                <List.Item
                  key={w.id}
                  actions={[
                    <Button type="link" size="small" onClick={() => handleWarningHandle(w.id)}>
                      标记已处理
                    </Button>
                  ]}
                >
                  <Space>
                    <Tag color="red">{w.patient_bed}</Tag>
                    <span>{w.operation_name}</span>
                    <Tag color="volcano">超时 {formatOverdue(w.overdue_minutes)}</Tag>
                    <span style={{ fontSize: 12, color: '#999' }}>
                      {dayjs(w.created_at).format('MM-DD HH:mm')}
                    </span>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </div>
      </Layout>

      <Modal
        title="患者入径"
        open={admitModalVisible}
        onCancel={() => setAdmitModalVisible(false)}
        onOk={() => admitForm.submit()}
        destroyOnClose
      >
        <Form form={admitForm} layout="vertical" onFinish={handleAdmit}>
          <Form.Item name="template_id" label="路径模板" rules={[{ required: true, message: '请选择路径模板' }]}>
            <Select placeholder="请选择路径模板">
              {templates.map(t => (
                <Option key={t.id} value={t.id}>{t.name} - {t.applicable_disease}</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="patient_bed" label="患者床号" rules={[{ required: true, message: '请输入床号' }]}>
            <Input placeholder="如: 3床" />
          </Form.Item>
          <Form.Item name="patient_name" label="患者姓名">
            <Input placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="签署操作完成"
        open={signModalVisible}
        onCancel={() => setSignModalVisible(false)}
        onOk={handleSign}
        destroyOnClose
      >
        <div style={{ marginBottom: 16 }}>
          <p><strong>操作项: </strong>{signOperation?.operation_name}</p>
          {signOperation?.is_critical && <Tag color="red">关键操作</Tag>}
        </div>
        <Form layout="vertical">
          <Form.Item label="签署护士" required>
            <Select
              value={signNurseId}
              onChange={setSignNurseId}
              placeholder="请选择今日有排班的护士"
            >
              {nurses.map(n => (
                <Option key={n.id} value={n.id}>{n.name} - {n.level === 'senior' ? '高级' : '初级'}</Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}

export default CarePathPage;
