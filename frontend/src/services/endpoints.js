// Single place that defines the frontend ↔ backend contract (mirrors backend/app/api/v1/*).
import { api, setCsrfToken } from '../lib/api'

export const authApi = {
  config: () => api.get('/auth/config'),
  me: async () => { const d = await api.get('/auth/me'); setCsrfToken(d.csrf_token); return d },
  login: async (body) => { const d = await api.post('/auth/login', body); setCsrfToken(d.csrf_token); return d },
  signup: async (body) => { const d = await api.post('/auth/signup', body); setCsrfToken(d.csrf_token); return d },
  logout: () => api.post('/auth/logout', undefined),
  forgot: (email) => api.post('/auth/forgot-password', { email }),
  reset: (body) => api.post('/auth/reset-password', body),
  changePassword: (body) => api.post('/auth/change-password', body),
}
export const usersApi = {
  update: (body) => api.patch('/users/me', body),
  sessions: () => api.get('/users/me/sessions'),
  revokeSessions: () => api.del('/users/me/sessions'),
}
export const agentsApi = {
  list: (params) => api.get('/agents', { params }),
  get: (id) => api.get(`/agents/${id}`),
  create: (b) => api.post('/agents', b),
  update: (id, b) => api.patch(`/agents/${id}`, b),
  remove: (id) => api.del(`/agents/${id}`),
  duplicate: (id) => api.post(`/agents/${id}/duplicate`),
}
export const toolsApi = {
  list: () => api.get('/tools'),
  create: (b) => api.post('/tools', b),
  update: (id, b) => api.patch(`/tools/${id}`, b),
  remove: (id) => api.del(`/tools/${id}`),
  test: (id, b) => api.post(`/tools/${id}/test`, b),
}
export const keysApi = {
  list: () => api.get('/api-keys'),
  create: (b) => api.post('/api-keys', b),
  rotate: (id) => api.post(`/api-keys/${id}/rotate`),
  revoke: (id) => api.del(`/api-keys/${id}`),
}
export const workflowsApi = {
  list: (params) => api.get('/workflows', { params }),
  get: (id) => api.get(`/workflows/${id}`),
  create: (b) => api.post('/workflows', b),
  update: (id, b) => api.patch(`/workflows/${id}`, b),
  remove: (id) => api.del(`/workflows/${id}`),
}
export const executionsApi = {
  list: (params) => api.get('/executions', { params }),
  get: (id) => api.get(`/executions/${id}`),
  create: (b) => api.post('/executions', b),
  cancel: (id) => api.post(`/executions/${id}/cancel`),
  decide: (id, approve) => api.post(`/executions/${id}/approval`, { approve }),
  events: (id, afterId = 0) => api.get(`/executions/${id}/events`, { params: { after_id: afterId } }),
}
export const dashboardApi = {
  summary: (days) => api.get('/dashboard/summary', { params: { days } }),
  analytics: (days) => api.get('/dashboard/analytics', { params: { days } }),
}
