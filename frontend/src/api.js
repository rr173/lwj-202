import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

export const getDepartments = () => api.get('/departments');
export const createDepartment = (name) => api.post('/departments', { name });

export const getNurses = (deptId, month) => api.get(`/departments/${deptId}/nurses`, { params: month ? { month } : {} });
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

export const getLeaveRequests = (deptId, status, month) =>
  api.get(`/departments/${deptId}/leave-requests`, { params: { status, month } });

export const createLeaveRequest = (data) => api.post('/leave-requests', data);

export const approveLeaveRequest = (id) => api.put(`/leave-requests/${id}/approve`);

export const rejectLeaveRequest = (id) => api.put(`/leave-requests/${id}/reject`);

export const confirmSubstitute = (id, substituteNurseId) =>
  api.put(`/leave-requests/${id}/confirm-substitute`, { substitute_nurse_id: substituteNurseId });

export const manualSubstitute = (id, substituteNurseId) =>
  api.put(`/leave-requests/${id}/manual-substitute`, { substitute_nurse_id: substituteNurseId });

export const getLeaveSummary = (deptId, month) =>
  api.get(`/departments/${deptId}/leave-summary`, { params: { month } });

export const getAvailableSubstitutes = (deptId, date, excludeNurseId) =>
  api.get(`/departments/${deptId}/available-substitutes`, { params: { date, exclude_nurse_id: excludeNurseId } });

export const getFatigueStatus = (deptId, date) =>
  api.get(`/departments/${deptId}/fatigue-status`, { params: { date } });

export const getTrainingCourses = (deptId) => 
  api.get(`/departments/${deptId}/training-courses`);

export const createTrainingCourse = (data) => api.post('/training-courses', data);
export const updateTrainingCourse = (id, data) => api.put(`/training-courses/${id}`, data);
export const deleteTrainingCourse = (id) => api.delete(`/training-courses/${id}`);

export const getTrainingRecords = (courseId) => 
  api.get(`/training-courses/${courseId}/records`);

export const createTrainingRecord = (data) => api.post('/training-records', data);
export const updateTrainingRecord = (id, data) => api.put(`/training-records/${id}`, data);
export const deleteTrainingRecord = (id) => api.delete(`/training-records/${id}`);

export const getTrainingConfig = (deptId, year) => 
  api.get(`/departments/${deptId}/training-config`, { params: { year } });

export const updateTrainingConfig = (data) => api.post('/training-config', data);

export const getNurseTrainingProgress = (deptId, nurseId, year) => 
  api.get(`/departments/${deptId}/nurses/${nurseId}/training-progress`, { params: { year } });

export const getDepartmentTrainingCompliance = (deptId, year) =>
  api.get(`/departments/${deptId}/training-compliance`, { params: { year } });

export const getAdverseEvents = (params) =>
  api.get('/adverse-events', { params });

export const getAdverseEvent = (id) =>
  api.get(`/adverse-events/${id}`);

export const createAdverseEvent = (data) =>
  api.post('/adverse-events', data);

export const approveAdverseEvent = (id, data) =>
  api.put(`/adverse-events/${id}/approve`, data);

export const submitRectification = (id, data) =>
  api.put(`/adverse-events/${id}/submit-rectification`, data);

export const acceptAdverseEvent = (id, data) =>
  api.put(`/adverse-events/${id}/accept`, data);

export const rejectAdverseEvent = (id, data) =>
  api.put(`/adverse-events/${id}/reject`, data);

export const getAdverseEventStatistics = (params) =>
  api.get('/adverse-event-statistics/overview', { params });

export const getAdverseEventNurseStatistics = (deptId) =>
  api.get('/adverse-event-statistics/by-nurse', { params: { department_id: deptId } });

export const getSkillTags = (deptId) =>
  api.get(`/departments/${deptId}/skill-tags`);

export const createSkillTag = (deptId, name) =>
  api.post(`/departments/${deptId}/skill-tags`, { name });

export const deleteSkillTag = (id) =>
  api.delete(`/skill-tags/${id}`);

export const getNurseSkills = (nurseId) =>
  api.get(`/nurses/${nurseId}/skills`);

export const updateNurseSkills = (nurseId, skillIds) =>
  api.put(`/nurses/${nurseId}/skills`, { skill_ids: skillIds });

export const getShiftSkillRequirements = (deptId) =>
  api.get(`/departments/${deptId}/shift-skill-requirements`);

export const updateShiftSkillRequirements = (deptId, requirements) =>
  api.put(`/departments/${deptId}/shift-skill-requirements`, { requirements });

export const getSkillCoverageReport = (deptId, month) =>
  api.get(`/departments/${deptId}/skill-coverage-report`, { params: { month } });

export const getNurseLeaveBalance = (nurseId, year) =>
  api.get(`/nurses/${nurseId}/leave-balance`, { params: { year } });

export const getLeaveQuotaOverview = (deptId, year) =>
  api.get(`/departments/${deptId}/leave-quota-overview`, { params: { year } });

export const getLeaveQuotaConfig = (deptId, year) =>
  api.get(`/departments/${deptId}/leave-quota-config`, { params: { year } });

export const updateLeaveQuotaConfig = (deptId, data) =>
  api.put(`/departments/${deptId}/leave-quota-config`, data);

export const getHandovers = (params) =>
  api.get('/handovers', { params });

export const getHandover = (id) =>
  api.get(`/handovers/${id}`);

export const createHandover = (data) =>
  api.post('/handovers', data);

export const signoffHandoverItem = (id, data) =>
  api.put(`/handovers/${id}/signoff`, data);

export const headNurseConfirmHandover = (id, data) =>
  api.put(`/handovers/${id}/head-nurse-confirm`, data);

export const getHandoverStatistics = (params) =>
  api.get('/handover-statistics', { params });

export const getSecondmentRequests = (params) =>
  api.get('/secondment-requests', { params });

export const getSecondmentRequest = (id) =>
  api.get(`/secondment-requests/${id}`);

export const createSecondmentRequest = (data) =>
  api.post('/secondment-requests', data);

export const approveSecondmentRequest = (id, data) =>
  api.put(`/secondment-requests/${id}/approve`, data);

export const rejectSecondmentRequest = (id, data) =>
  api.put(`/secondment-requests/${id}/reject`, data);

export const cancelSecondmentRequest = (id) =>
  api.put(`/secondment-requests/${id}/cancel`);

export const getSecondmentNurses = (deptId, date) =>
  api.get(`/departments/${deptId}/secondment-nurses`, { params: { date } });

export const getLentOutNurses = (deptId, date) =>
  api.get(`/departments/${deptId}/lent-out-nurses`, { params: { date } });

export const getSecondmentMonthlyReport = (deptId, month) =>
  api.get(`/departments/${deptId}/secondment-monthly-report`, { params: { month } });

export const getAssessmentWeightConfig = (deptId) =>
  api.get(`/assessment-weight-config/${deptId}`);

export const updateAssessmentWeightConfig = (data) =>
  api.post('/assessment-weight-config', data);

export const createQualityAssessment = (data) =>
  api.post('/quality-assessments', data);

export const getAssessmentHistory = (params) =>
  api.get('/quality-assessments/history', { params });

export const getAssessmentById = (id) =>
  api.get(`/quality-assessments/${id}`);

export const getAssessmentRanking = (deptId, month) =>
  api.get(`/quality-assessments/ranking/${deptId}`, { params: { month } });

export const getAssessmentMonthPreview = (deptId, month) =>
  api.get(`/quality-assessments/month-preview/${deptId}`, { params: { month } });

export const getAssessmentTrend = (nurseId, params) =>
  api.get(`/quality-assessments/trend/${nurseId}`, { params });

export const deleteAssessment = (id) =>
  api.delete(`/quality-assessments/${id}`);

export const getAssessmentAutoInfo = (nurseId, params) =>
  api.get(`/quality-assessments/auto-info/${nurseId}`, { params });

export const createAppeal = (assessmentId, data) =>
  api.post(`/quality-assessments/${assessmentId}/appeal`, data);

export const getAppealStatus = (assessmentId) =>
  api.get(`/quality-assessments/${assessmentId}/appeal-status`);

export const getAppeals = (params) =>
  api.get('/assessment-appeals', { params });

export const getAppealById = (id) =>
  api.get(`/assessment-appeals/${id}`);

export const handleAppeal = (id, data) =>
  api.put(`/assessment-appeals/${id}/handle`, data);

export const getSupplies = (deptId) =>
  api.get(`/departments/${deptId}/supplies`);

export const createSupply = (deptId, data) =>
  api.post(`/departments/${deptId}/supplies`, data);

export const updateSupply = (id, data) =>
  api.put(`/supplies/${id}`, data);

export const deleteSupply = (id) =>
  api.delete(`/supplies/${id}`);

export const getSupplyBatches = (supplyId) =>
  api.get(`/supplies/${supplyId}/batches`);

export const receiveSupply = (supplyId, data) =>
  api.post(`/supplies/${supplyId}/receive`, data);

export const createRequisition = (deptId, data) =>
  api.post(`/departments/${deptId}/requisitions`, data);

export const getRequisitions = (deptId, params) =>
  api.get(`/departments/${deptId}/requisitions`, { params });

export const getSupplyFlow = (supplyId, limit) =>
  api.get(`/supplies/${supplyId}/flow`, { params: { limit } });

export const getSupplyTransactions = (deptId, supplyId, days) =>
  api.get(`/departments/${deptId}/supplies/${supplyId}/transactions`, { params: { days } });

export const getSupplyStockTrend = (deptId, supplyId, days) =>
  api.get(`/departments/${deptId}/supplies/${supplyId}/stock-trend`, { params: { days } });

export const getSupplyWarnings = (deptId) =>
  api.get(`/departments/${deptId}/supply-warnings`);

export const getSupplyMonthlyStatistics = (deptId, month) =>
  api.get(`/departments/${deptId}/supply-monthly-statistics`, { params: { month } });

export const getCarePathTemplates = (deptId) =>
  api.get('/care-path-templates', { params: deptId ? { department_id: deptId } : {} });

export const getCarePathTemplate = (id) =>
  api.get(`/care-path-templates/${id}`);

export const createCarePathTemplate = (data) =>
  api.post('/care-path-templates', data);

export const updateCarePathTemplate = (id, data) =>
  api.put(`/care-path-templates/${id}`, data);

export const deleteCarePathTemplate = (id) =>
  api.delete(`/care-path-templates/${id}`);

export const createPatientCarePath = (data) =>
  api.post('/patient-care-paths', data);

export const getActivePatientCarePaths = (deptId) =>
  api.get('/patient-care-paths/active', { params: deptId ? { department_id: deptId } : {} });

export const getPatientCarePath = (id) =>
  api.get(`/patient-care-paths/${id}`);

export const signCarePathOperation = (id, nurseId) =>
  api.post(`/care-path-operation-executions/${id}/sign`, { nurse_id: nurseId });

export const getCarePathWarnings = (params) =>
  api.get('/care-path-warnings', { params });

export const handleCarePathWarning = (id, handledBy) =>
  api.put(`/care-path-warnings/${id}/handle`, { handled_by: handledBy });

export const getCarePathStatistics = (deptId, month) =>
  api.get('/care-path-statistics/overview', { params: { department_id: deptId, month } });

export const getScheduleVersions = (deptId, month) =>
  api.get(`/departments/${deptId}/schedule-versions`, { params: { month } });

export const getScheduleVersion = (versionId) =>
  api.get(`/schedule-versions/${versionId}`);

export const compareScheduleVersions = (deptId, versionAId, versionBId) =>
  api.get(`/departments/${deptId}/schedule-versions/compare`, {
    params: { version_a_id: versionAId, version_b_id: versionBId }
  });

export const rollbackScheduleVersion = (deptId, versionId, force) =>
  api.post(`/departments/${deptId}/schedule-versions/${versionId}/rollback`, { force });

export const getNursePreferences = (nurseId, month) =>
  api.get(`/nurses/${nurseId}/preferences`, { params: { month } });

export const updateNursePreferences = (nurseId, data) =>
  api.put(`/nurses/${nurseId}/preferences`, data);

export const getPreferencesSummary = (deptId, month) =>
  api.get(`/departments/${deptId}/preferences-summary`, { params: { month } });

export const getPreferenceSatisfaction = (deptId, month) =>
  api.get(`/departments/${deptId}/preference-satisfaction`, { params: { month } });

export default api;
