import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

export const getDepartments = () => api.get('/departments');
export const createDepartment = (name) => api.post('/departments', { name });

export const getNurses = (deptId) => api.get(`/departments/${deptId}/nurses`);
export const createNurse = (data) => api.post('/nurses', data);

export const getSchedule = (deptId, month) => 
  api.get(`/departments/${deptId}/schedule`, { params: { month } });

export const generateSchedule = (deptId, month) => 
  api.post(`/departments/${deptId}/generate-schedule`, { month });

export const updateSchedule = (scheduleId, nurseId) => 
  api.put(`/schedules/${scheduleId}`, { nurse_id: nurseId });

export const getSwapRequests = (deptId, status) => 
  api.get(`/departments/${deptId}/swap-requests`, { params: { status } });

export const createSwapRequest = (data) => api.post('/swap-requests', data);
export const confirmSwapRequest = (id, nurseId) => 
  api.put(`/swap-requests/${id}/confirm`, { nurse_id: nurseId });
export const approveSwapRequest = (id) => api.put(`/swap-requests/${id}/approve`);
export const rejectSwapRequest = (id) => api.put(`/swap-requests/${id}/reject`);

export const getOvertimeRequests = (deptId, status, month) => 
  api.get(`/departments/${deptId}/overtime-requests`, { params: { status, month } });

export const createOvertimeRequest = (data) => api.post('/overtime-requests', data);
export const approveOvertimeRequest = (id) => api.put(`/overtime-requests/${id}/approve`);
export const rejectOvertimeRequest = (id) => api.put(`/overtime-requests/${id}/reject`);

export const getMonthlyReport = (deptId, month) => 
  api.get(`/departments/${deptId}/monthly-report`, { params: { month } });

export default api;
