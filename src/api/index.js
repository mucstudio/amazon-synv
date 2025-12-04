import axios from 'axios';

const http = axios.create({
  baseURL: '/api',
  timeout: 300000,
});

export default {
  // 系统状态
  getStatus: () => http.get('/status'),
  
  // 任务相关
  getTasks: (params) => http.get('/tasks', { params }),
  createTask: (data) => http.post('/tasks', data),
  cancelTask: (id) => http.post(`/tasks/${id}/cancel`),
  retryTask: (id) => http.post(`/tasks/${id}/retry`),
  resumeTask: (id) => http.post(`/tasks/${id}/resume`),
  deleteTask: (id) => http.delete(`/tasks/${id}`),
  getTaskResults: (id, status) => http.get(`/tasks/${id}/results`, { params: { status } }),
  
  // 商品相关
  getProducts: (params) => http.get('/products', { params }),
  deleteProduct: (id) => http.delete(`/products/${id}`),
  batchDeleteProducts: (ids) => http.post('/products/batch-delete', { ids }),
  clearAllProducts: (taskId) => http.delete('/products/all/clear', { params: { taskId } }),
  exportProducts: (params) => http.get('/products/export', { params, responseType: 'blob' }),
  
  // 代理相关
  getProxies: () => http.get('/proxies'),
  addProxies: (data) => http.post('/proxies', data),
  updateProxy: (id, data) => http.put(`/proxies/${id}`, data),
  deleteProxy: (id) => http.delete(`/proxies/${id}`),
  testProxy: (id) => http.post(`/proxies/${id}/test`),
  testAllProxies: () => http.post('/proxies/test-all'),
  batchTestProxies: (ids) => http.post('/proxies/batch-test', { ids }),
  batchDeleteProxies: (ids) => http.post('/proxies/batch-delete', { ids }),
  clearFailedProxies: () => http.delete('/proxies/failed/all'),
  
  // 设置相关
  getSettings: () => http.get('/settings'),
  updateSettings: (data) => http.put('/settings', data),
  
  // 统计
  getStats: () => http.get('/stats'),
  
  // 黑名单相关
  getBlacklist: (params) => http.get('/blacklist', { params }),
  getAllBlacklist: () => http.get('/blacklist/all'),
  getBlacklistStats: () => http.get('/blacklist/stats'),
  addBlacklist: (data) => http.post('/blacklist', data),
  batchAddBlacklist: (data) => http.post('/blacklist/batch', data),
  updateBlacklist: (id, data) => http.put(`/blacklist/${id}`, data),
  deleteBlacklist: (id) => http.delete(`/blacklist/${id}`),
  batchDeleteBlacklist: (ids) => http.post('/blacklist/batch-delete', { ids }),
  clearBlacklist: (type) => http.delete(`/blacklist/clear/${type}`),
};
