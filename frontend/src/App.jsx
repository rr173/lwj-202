import { useState } from 'react';
import { Layout, Menu } from 'antd';
import SchedulePage from './SchedulePage';
import TrainingPage from './TrainingPage';

const { Header } = Layout;

function App() {
  const [currentModule, setCurrentModule] = useState('schedule');

  return (
    <Layout style={{ height: '100vh' }}>
      <Header style={{ background: '#fff', padding: '0 24px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', height: 48, lineHeight: '48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <h2 style={{ margin: 0, fontSize: 16, whiteSpace: 'nowrap' }}>护理管理系统</h2>
          <Menu
            mode="horizontal"
            selectedKeys={[currentModule]}
            onClick={({ key }) => setCurrentModule(key)}
            style={{ border: 'none', lineHeight: '46px' }}
            items={[
              { key: 'schedule', label: '排班管理' },
              { key: 'training', label: '培训管理' }
            ]}
          />
        </div>
      </Header>
      {currentModule === 'schedule' ? <SchedulePage /> : <TrainingPage />}
    </Layout>
  );
}

export default App;
