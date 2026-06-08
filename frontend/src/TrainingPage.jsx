import { useState, useEffect } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, Tag, message,
  Space, Popconfirm, DatePicker, Switch, Progress, Card
} from 'antd';
import dayjs from 'dayjs';
import {
  getDepartments, getNurses, getTrainingCourses, createTrainingCourse,
  updateTrainingCourse, deleteTrainingCourse, getTrainingRecords,
  createTrainingRecord, updateTrainingRecord, deleteTrainingRecord,
  getTrainingConfig, updateTrainingConfig, getDepartmentTrainingCompliance
} from './api';

const { Option } = Select;

const TYPE_MAP = { theory: '理论', skill: '技能', comprehensive: '综合' };
const METHOD_MAP = { written: '笔试', practical: '操作', mixed: '混合' };
const TYPE_COLOR = { theory: 'blue', skill: 'green', comprehensive: 'purple' };
const METHOD_COLOR = { written: 'geekblue', practical: 'lime', mixed: 'volcano' };

function TrainingPage() {
  const [departments, setDepartments] = useState([]);
  const [selectedDept, setSelectedDept] = useState(null);
  const [nurses, setNurses] = useState([]);
  const [courses, setCourses] = useState([]);
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [records, setRecords] = useState([]);
  const [compliance, setCompliance] = useState(null);
  const [config, setConfig] = useState(null);
  const [year, setYear] = useState(dayjs().year());

  const [courseModalVisible, setCourseModalVisible] = useState(false);
  const [recordModalVisible, setRecordModalVisible] = useState(false);
  const [configModalVisible, setConfigModalVisible] = useState(false);
  const [editingCourse, setEditingCourse] = useState(null);
  const [editingRecord, setEditingRecord] = useState(null);

  const [courseForm] = Form.useForm();
  const [recordForm] = Form.useForm();
  const [configForm] = Form.useForm();

  useEffect(() => {
    loadDepartments();
  }, []);

  useEffect(() => {
    if (selectedDept) {
      loadNurses();
      loadCourses();
      loadCompliance();
      loadConfig();
    }
  }, [selectedDept, year]);

  useEffect(() => {
    if (selectedCourse) {
      loadRecords();
    } else {
      setRecords([]);
    }
  }, [selectedCourse]);

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

  const loadCourses = async () => {
    if (!selectedDept) return;
    try {
      const res = await getTrainingCourses(selectedDept.id);
      setCourses(res.data);
      if (res.data.length > 0) {
        setSelectedCourse(prev => prev && res.data.find(c => c.id === prev.id) ? prev : res.data[0]);
      } else {
        setSelectedCourse(null);
      }
    } catch (err) {
      message.error('加载课程列表失败');
    }
  };

  const loadRecords = async () => {
    if (!selectedCourse) return;
    try {
      const res = await getTrainingRecords(selectedCourse.id);
      setRecords(res.data);
    } catch (err) {
      message.error('加载培训记录失败');
    }
  };

  const loadCompliance = async () => {
    if (!selectedDept) return;
    try {
      const res = await getDepartmentTrainingCompliance(selectedDept.id, year);
      setCompliance(res.data);
    } catch (err) {
      message.error('加载达标率失败');
    }
  };

  const loadConfig = async () => {
    if (!selectedDept) return;
    try {
      const res = await getTrainingConfig(selectedDept.id, year);
      setConfig(res.data);
    } catch (err) {
      message.error('加载培训配置失败');
    }
  };

  const handleAddCourse = () => {
    setEditingCourse(null);
    courseForm.resetFields();
    courseForm.setFieldsValue({
      type: 'theory',
      assessment_method: 'written',
      pass_score: 60,
      is_mandatory: false,
      hours: 4
    });
    setCourseModalVisible(true);
  };

  const handleEditCourse = (course) => {
    setEditingCourse(course);
    courseForm.setFieldsValue({
      ...course,
      is_mandatory: course.is_mandatory === 1
    });
    setCourseModalVisible(true);
  };

  const handleCourseSubmit = async () => {
    try {
      const values = await courseForm.validateFields();
      const data = {
        ...values,
        department_id: selectedDept.id,
        is_mandatory: values.is_mandatory ? 1 : 0
      };
      if (editingCourse) {
        await updateTrainingCourse(editingCourse.id, data);
        message.success('课程更新成功');
      } else {
        await createTrainingCourse(data);
        message.success('课程添加成功');
      }
      setCourseModalVisible(false);
      loadCourses();
      loadCompliance();
    } catch (err) {
      message.error(`操作失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleDeleteCourse = async (id) => {
    try {
      await deleteTrainingCourse(id);
      message.success('课程已删除');
      if (selectedCourse?.id === id) {
        setSelectedCourse(null);
      }
      loadCourses();
      loadCompliance();
    } catch (err) {
      message.error(`删除失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleAddRecord = () => {
    setEditingRecord(null);
    recordForm.resetFields();
    recordForm.setFieldsValue({
      training_date: dayjs()
    });
    setRecordModalVisible(true);
  };

  const handleEditRecord = (record) => {
    setEditingRecord(record);
    recordForm.setFieldsValue({
      nurse_id: record.nurse_id,
      training_date: dayjs(record.training_date),
      score: record.score
    });
    setRecordModalVisible(true);
  };

  const handleRecordSubmit = async () => {
    try {
      const values = await recordForm.validateFields();
      const data = {
        ...values,
        training_date: values.training_date.format('YYYY-MM-DD'),
        course_id: selectedCourse.id
      };
      if (editingRecord) {
        await updateTrainingRecord(editingRecord.id, data);
        message.success('成绩更新成功');
      } else {
        await createTrainingRecord(data);
        message.success('成绩录入成功');
      }
      setRecordModalVisible(false);
      loadRecords();
      loadCompliance();
    } catch (err) {
      message.error(`操作失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleDeleteRecord = async (id) => {
    try {
      await deleteTrainingRecord(id);
      message.success('记录已删除');
      loadRecords();
      loadCompliance();
    } catch (err) {
      message.error(`删除失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const handleConfigSubmit = async () => {
    try {
      const values = await configForm.validateFields();
      await updateTrainingConfig({
        department_id: selectedDept.id,
        year: String(year),
        annual_target_hours: values.annual_target_hours
      });
      message.success('配置已更新');
      setConfigModalVisible(false);
      loadConfig();
      loadCompliance();
    } catch (err) {
      message.error(`操作失败: ${err.response?.data?.error || err.message}`);
    }
  };

  const openConfigModal = () => {
    configForm.setFieldsValue({
      annual_target_hours: config?.annual_target_hours || 40
    });
    setConfigModalVisible(true);
  };

  const recordColumns = [
    {
      title: '护士姓名',
      dataIndex: 'nurse_name',
      key: 'nurse_name',
      width: 120,
      render: (text, record, index) => {
        let attempt = 1;
        for (let i = 0; i < index; i++) {
          if (records[i]?.nurse_id === record.nurse_id) attempt++;
        }
        return (
          <span>{text} <span style={{ fontSize: 12, color: record.nurse_level === 'senior' ? '#fa8c16' : '#999' }}>({record.nurse_level === 'senior' ? '资深' : '普通'})</span> <Tag style={{ marginLeft: 4, fontSize: 11 }}>第{attempt}次</Tag></span>
        );
      }
    },
    {
      title: '参加日期',
      dataIndex: 'training_date',
      key: 'training_date',
      width: 120,
      align: 'center'
    },
    {
      title: '考核成绩',
      dataIndex: 'score',
      key: 'score',
      width: 100,
      align: 'center',
      render: (score) => score != null ? score : '-'
    },
    {
      title: '是否通过',
      dataIndex: 'passed',
      key: 'passed',
      width: 100,
      align: 'center',
      render: (passed) => (
        <Tag color={passed ? 'success' : 'error'}>{passed ? '通过' : '未通过'}</Tag>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      align: 'center',
      render: (_, record) => (
        <Space size="small">
          <Button size="small" type="link" onClick={() => handleEditRecord(record)}>编辑</Button>
          <Popconfirm title="确定删除此记录？" onConfirm={() => handleDeleteRecord(record.id)}>
            <Button size="small" type="link" danger>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const complianceColumns = [
    {
      title: '护士姓名',
      dataIndex: 'nurse_name',
      key: 'nurse_name',
      width: 120,
      render: (text, record) => (
        <span>{text} <span style={{ fontSize: 12, color: record.nurse_level === 'senior' ? '#fa8c16' : '#999' }}>({record.nurse_level === 'senior' ? '资深' : '普通'})</span></span>
      )
    },
    {
      title: '已完成学时',
      dataIndex: 'completed_hours',
      key: 'completed_hours',
      width: 110,
      align: 'center'
    },
    {
      title: '目标学时',
      dataIndex: 'target_hours',
      key: 'target_hours',
      width: 90,
      align: 'center'
    },
    {
      title: '缺口学时',
      dataIndex: 'gap_hours',
      key: 'gap_hours',
      width: 90,
      align: 'center',
      render: (val) => <span style={{ color: val > 0 ? '#ff4d4f' : '#52c41a' }}>{val}</span>
    },
    {
      title: '必修课问题',
      key: 'mandatory_issue',
      width: 120,
      align: 'center',
      render: (_, record) => {
        const issues = [];
        if (record.mandatory_failed) issues.push('未通过');
        if (record.mandatory_not_attempted > 0) issues.push(`未参加${record.mandatory_not_attempted}门`);
        return issues.length > 0 ? <Tag color="error">{issues.join(' / ')}</Tag> : <Tag color="success">无</Tag>;
      }
    },
    {
      title: '达标进度',
      key: 'progress',
      render: (_, record) => {
        const percent = Math.min(100, Math.round((record.completed_hours / record.target_hours) * 100));
        return (
          <Progress
            percent={record.is_compliant ? 100 : percent}
            status={record.is_compliant ? 'success' : (record.mandatory_failed || record.mandatory_not_attempted > 0 ? 'exception' : 'active')}
            size="small"
            format={() => `${record.completed_hours}/${record.target_hours}h`}
          />
        );
      }
    },
    {
      title: '达标状态',
      dataIndex: 'is_compliant',
      key: 'is_compliant',
      width: 100,
      align: 'center',
      render: (val) => <Tag color={val ? 'success' : 'error'}>{val ? '已达标' : '未达标'}</Tag>
    }
  ];

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 64px)' }}>
      <div style={{ width: 320, borderRight: '1px solid #e8e8e8', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e8e8e8', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold', fontSize: 15 }}>课程列表</span>
          <Button type="primary" size="small" onClick={handleAddCourse}>新增课程</Button>
        </div>
        <div style={{ padding: 12, borderBottom: '1px solid #e8e8e8' }}>
          <Select
            style={{ width: '100%' }}
            value={selectedDept?.id}
            onChange={(val) => {
              const dept = departments.find(d => d.id === val);
              setSelectedDept(dept);
              setSelectedCourse(null);
            }}
            placeholder="选择科室"
          >
            {departments.map(d => <Option key={d.id} value={d.id}>{d.name}</Option>)}
          </Select>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {courses.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#999', padding: '40px 16px' }}>暂无培训课程</div>
          ) : (
            courses.map(course => (
              <div
                key={course.id}
                onClick={() => setSelectedCourse(course)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  background: selectedCourse?.id === course.id ? '#e6f7ff' : 'transparent',
                  borderLeft: selectedCourse?.id === course.id ? '3px solid #1890ff' : '3px solid transparent',
                  borderBottom: '1px solid #f0f0f0'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 500, fontSize: 14 }}>{course.name}</span>
                  {course.is_mandatory ? <Tag color="red" style={{ marginLeft: 4, fontSize: 11 }}>必修</Tag> : <Tag style={{ fontSize: 11 }}>选修</Tag>}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: '#666', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Tag color={TYPE_COLOR[course.type]} style={{ fontSize: 11 }}>{TYPE_MAP[course.type]}</Tag>
                  <Tag color={METHOD_COLOR[course.assessment_method]} style={{ fontSize: 11 }}>{METHOD_MAP[course.assessment_method]}</Tag>
                  <span>{course.hours}学时</span>
                  <span>及格{course.pass_score}分</span>
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: '#999' }}>讲师: {course.instructor}</div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <div style={{ flex: 1, padding: 20, overflow: 'auto' }}>
          {selectedCourse ? (
            <>
              <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: 0 }}>{selectedCourse.name}
                    {selectedCourse.is_mandatory ? <Tag color="red" style={{ marginLeft: 8 }}>必修</Tag> : <Tag style={{ marginLeft: 8 }}>选修</Tag>}
                  </h3>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>
                    {TYPE_MAP[selectedCourse.type]} | {METHOD_MAP[selectedCourse.assessment_method]} | {selectedCourse.hours}学时 | 及格分{selectedCourse.pass_score} | 讲师: {selectedCourse.instructor}
                  </div>
                </div>
                <Space>
                  <Button onClick={() => handleEditCourse(selectedCourse)}>编辑课程</Button>
                  <Popconfirm title="确定删除此课程？会同时删除所有参训记录" onConfirm={() => handleDeleteCourse(selectedCourse.id)}>
                    <Button danger>删除课程</Button>
                  </Popconfirm>
                  <Button type="primary" onClick={handleAddRecord}>录入成绩</Button>
                </Space>
              </div>
              <Table
                columns={recordColumns}
                dataSource={records}
                rowKey="id"
                size="small"
                pagination={false}
              />
            </>
          ) : (
            <div style={{ textAlign: 'center', color: '#999', padding: '80px 0' }}>
              请从左侧选择一门课程查看参训记录
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid #e8e8e8', padding: 20, background: '#fafafa' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h4 style={{ margin: 0 }}>科室年度培训达标率</h4>
              <Select
                value={year}
                onChange={setYear}
                style={{ width: 100 }}
              >
                {[year, year - 1, year - 2, year - 3].map(y => <Option key={y} value={y}>{y}年</Option>)}
              </Select>
              {compliance && (
                <span style={{ fontSize: 14, color: '#666' }}>
                  达标率: <strong style={{ color: compliance.compliance_rate >= 80 ? '#52c41a' : '#ff4d4f', fontSize: 18 }}>{compliance.compliance_rate}%</strong>
                  <span style={{ marginLeft: 8 }}>({compliance.compliant_nurses}/{compliance.total_nurses}人)</span>
                </span>
              )}
            </div>
            <Space>
              <Button size="small" onClick={openConfigModal}>
                年度目标: {config?.annual_target_hours || 40}学时
              </Button>
            </Space>
          </div>

          {compliance && compliance.nurses.length > 0 && (
            <>
              <div style={{ marginBottom: 12 }}>
                <Progress
                  type="line"
                  percent={Math.round(compliance.compliance_rate)}
                  strokeColor={compliance.compliance_rate >= 80 ? '#52c41a' : compliance.compliance_rate >= 60 ? '#faad14' : '#ff4d4f'}
                  format={() => `${compliance.compliance_rate}%`}
                  style={{ marginBottom: 4 }}
                />
              </div>
              <Table
                columns={complianceColumns}
                dataSource={compliance.nurses}
                rowKey="nurse_id"
                size="small"
                pagination={false}
                scroll={{ y: 200 }}
              />
            </>
          )}
        </div>
      </div>

      <Modal
        title={editingCourse ? '编辑课程' : '新增课程'}
        open={courseModalVisible}
        onOk={handleCourseSubmit}
        onCancel={() => setCourseModalVisible(false)}
        width={560}
      >
        <Form form={courseForm} layout="vertical">
          <Form.Item name="name" label="课程名称" rules={[{ required: true, message: '请输入课程名称' }]}>
            <Input placeholder="请输入课程名称" />
          </Form.Item>
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item name="type" label="课程类型" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select>
                <Option value="theory">理论</Option>
                <Option value="skill">技能</Option>
                <Option value="comprehensive">综合</Option>
              </Select>
            </Form.Item>
            <Form.Item name="assessment_method" label="考核方式" rules={[{ required: true }]} style={{ flex: 1 }}>
              <Select>
                <Option value="written">笔试</Option>
                <Option value="practical">操作</Option>
                <Option value="mixed">混合</Option>
              </Select>
            </Form.Item>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <Form.Item name="hours" label="学时" rules={[{ required: true, message: '请输入学时' }]} style={{ flex: 1 }}>
              <InputNumber min={0.5} step={0.5} style={{ width: '100%' }} placeholder="学时" />
            </Form.Item>
            <Form.Item name="pass_score" label="及格分" rules={[{ required: true, message: '请输入及格分' }]} style={{ flex: 1 }}>
              <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="及格分" />
            </Form.Item>
          </div>
          <Form.Item name="instructor" label="讲师" rules={[{ required: true, message: '请输入讲师' }]}>
            <Input placeholder="请输入讲师姓名" />
          </Form.Item>
          <Form.Item name="is_mandatory" label="是否必修" valuePropName="checked">
            <Switch checkedChildren="必修" unCheckedChildren="选修" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingRecord ? '编辑成绩' : '录入成绩'}
        open={recordModalVisible}
        onOk={handleRecordSubmit}
        onCancel={() => setRecordModalVisible(false)}
        width={480}
      >
        <Form form={recordForm} layout="vertical">
          <Form.Item name="nurse_id" label="护士" rules={[{ required: true, message: '请选择护士' }]}>
            <Select placeholder="请选择护士" showSearch optionFilterProp="children">
              {nurses.map(n => (
                <Option key={n.id} value={n.id}>{n.name} ({n.level === 'senior' ? '资深' : '普通'})</Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item name="training_date" label="参加日期" rules={[{ required: true, message: '请选择日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="score" label="考核成绩">
            <InputNumber min={0} max={100} style={{ width: '100%' }} placeholder="请输入成绩（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="年度培训学时目标配置"
        open={configModalVisible}
        onOk={handleConfigSubmit}
        onCancel={() => setConfigModalVisible(false)}
        width={400}
      >
        <Form form={configForm} layout="vertical">
          <Form.Item name="annual_target_hours" label="年度目标学时" rules={[{ required: true, message: '请输入目标学时' }]}>
            <InputNumber min={1} style={{ width: '100%' }} placeholder="默认40学时" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

export default TrainingPage;
