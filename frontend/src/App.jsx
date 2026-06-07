import { useState, useEffect } from 'react';
import { 
  Layout, Menu, Table, Button, DatePicker, Select, Modal, Form, 
  message, Tabs, Badge, Popconfirm, Space, Tag, Radio
} from 'antd';
import dayjs from 'dayjs';
import { 
  getDepartments, getNurses, getSchedule, generateSchedule, updateSchedule,
  getSwapRequests, createSwapRequest, confirmSwapRequest, approveSwapRequest, rejectSwapRequest
} from './api';

const { Option } = Select;
const { Header, Sider, Content } = Layout;

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

function App() {
  const [departments, setDepartments] = useState([]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [nurses, setNurses] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [month, setMonth] = useState(dayjs());
  const [viewMode, setViewMode] = useState('month');
  const [swapRequests, setSwapRequests] = useState([]);
  const [swapModalVisible, setSwapModalVisible] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    if (selectedDept) {
      loadNurses();
      loadSchedule();
      loadSwapRequests();
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

  const handleGenerateSchedule = async () => {
    if (!selectedDept) return;
    setLoading(true);
    try {
      const res = await generateSchedule(selectedDept.id, month.format('YYYY-MM'));
      message.success('排班生成成功');
      loadSchedule();
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
      message.error('确认失败');
    }
  };

  const handleApproveSwap = async (id) => {
    try {
      await approveSwapRequest(id);
      message.success('审批通过');
      loadSwapRequests();
      loadSchedule();
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
      message.error('操作失败');
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

  const days = getDaysInView();
  const pendingCount = swapRequests.filter(r => r.status === 'pending' || r.status === 'confirmed').length;

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
            </div>
          </div>
          <Button type="primary" loading={loading} onClick={handleGenerateSchedule}>
            生成排班
          </Button>
        </Header>
        <Layout>
          <Content style={{ padding: '24px', overflow: 'auto' }}>
            <div style={{ background: '#fff', padding: '24px', borderRadius: '8px' }}>
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
                          const shift = getShiftForNurseAndDate(nurse.id, day);
                          return (
                            <td 
                              key={day.format('YYYY-MM-DD')} 
                              style={{ border: '1px solid #e8e8e8', padding: '8px', textAlign: 'center', cursor: shift ? 'pointer' : 'default' }}
                              onClick={() => shift && handleCellClick(nurse, day.format('YYYY-MM-DD'), shift.shift, shift.id)}
                            >
                              {shift && (
                                <div 
                                  style={{ 
                                    padding: '4px 8px', 
                                    borderRadius: '4px', 
                                    color: '#fff', 
                                    fontSize: '12px',
                                    background: SHIFT_COLORS[shift.shift],
                                    transition: 'all 0.3s'
                                  }}
                                >
                                  {SHIFT_NAMES[shift.shift]}
                                </div>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Content>
          <Sider width={350} theme="light" style={{ borderLeft: '1px solid #e8e8e8' }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>换班审批</h3>
              {pendingCount > 0 && <Badge count={pendingCount} />}
            </div>
            <div style={{ padding: '16px', overflowY: 'auto', height: 'calc(100vh - 64px - 53px)' }}>
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
    </Layout>
  );
}

export default App;
