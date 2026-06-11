import { useState } from 'react';
import { Layout, Menu } from 'antd';
import SchedulePage from './SchedulePage';
import TrainingPage from './TrainingPage';
import EventPage from './EventPage';
import HandoverPage from './HandoverPage';
import AssessmentPage from './AssessmentPage';
import SuppliesPage from './SuppliesPage';
import CarePathPage from './CarePathPage';

const { Header } = Layout;

function App() {
  const [currentModule, setCurrentModule] = useState('schedule');

  const renderPage = () => {
    switch (currentModule) {
      case 'schedule': return <SchedulePage />;
      case 'training': return <TrainingPage />;
      case 'event': return <EventPage />;
      case 'handover': return <HandoverPage />;
      case 'assessment': return <AssessmentPage />;
      case 'supplies': return <SuppliesPage />;
      case 'carepath': return <CarePathPage />;
      default: return <SchedulePage />;
    }
  };

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
              { key: 'training', label: '培训管理' },
              { key: 'event', label: '事件管理' },
              { key: 'handover', label: '交接班' },
              { key: 'assessment', label: '考核管理' },
              { key: 'supplies', label: '耗材管理' },
              { key: 'carepath', label: '护理路径' }
            ]}
          />
        </div>
      </Header>
      {renderPage()}
    </Layout>
  );
}

export default App;
