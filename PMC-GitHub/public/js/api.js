/* ============================================================
   api.js —— 后端接口封装（libSQL REST API）
   ============================================================ */

import { loadLocal, saveLocal } from './util.js';

const TOKEN_KEY = 'pmc:token';
const USER_KEY = 'pmc:user';

export const session = {
  token: loadLocal(TOKEN_KEY, '') || '',
  user: loadLocal(USER_KEY, null),
  get logged() {
    return !!this.token && !!this.user;
  },
  set(token, user) {
    this.token = token || '';
    this.user = user || null;
    saveLocal(TOKEN_KEY, this.token);
    saveLocal(USER_KEY, this.user);
  },
  clear() {
    this.token = '';
    this.user = null;
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

/** 二级密码（本次会话内复用，避免频繁输入；仅在浏览器内存中） */
export const deleteGuard = { password: '' };

async function request(path, { method = 'GET', body, raw = false, guard = false, headers = {} } = {}) {
  const h = { ...headers };
  if (session.token) h['x-auth-token'] = session.token;
  if (guard) h['x-delete-password'] = deleteGuard.password || '';
  let payload;
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers: h, body: payload });
  if (raw) {
    if (!res.ok) throw new Error(`请求失败 (${res.status})`);
    return res;
  }
  let json = null;
  try {
    json = await res.json();
  } catch (e) {
    throw new Error(`服务返回异常 (${res.status})`);
  }
  if (!json.ok) {
    const err = new Error(json.message || '请求失败');
    err.status = res.status;
    throw err;
  }
  return json.data;
}

/* ---------------- 认证 ---------------- */
export const login = (username, password) => request('/api/auth/login', { method: 'POST', body: { username, password } });
export const logout = () => request('/api/auth/logout', { method: 'POST' });
export const me = () => request('/api/auth/me');
export const changePassword = (oldPassword, newPassword) =>
  request('/api/auth/password', { method: 'POST', body: { oldPassword, newPassword } });

/* ---------------- 基础物品信息 ---------------- */
export const listProducts = (q = '') => request(`/api/products${q ? `?q=${encodeURIComponent(q)}` : ''}`);
export const saveProducts = (items) => request('/api/products', { method: 'POST', body: { items } });
export const updateProduct = (id, data) => request(`/api/products/${id}`, { method: 'PUT', body: data });
export const deleteProduct = (id) => request(`/api/products/${id}`, { method: 'DELETE', guard: true });

/* ---------------- 报表 / 历史 ---------------- */
export const getReportByDate = (date, line = '') =>
  request(`/api/reports?date=${encodeURIComponent(date)}${line ? `&line=${encodeURIComponent(line)}` : ''}`);
export const listReports = () => request('/api/reports');
export const saveReport = (data) => request('/api/reports', { method: 'POST', body: data });
export const deleteReport = (id) => request(`/api/reports/${id}`, { method: 'DELETE', guard: true });
export const listHistory = ({ from, to, q, line } = {}) => {
  const p = new URLSearchParams();
  if (from) p.set('from', from);
  if (to) p.set('to', to);
  if (q) p.set('q', q);
  if (line) p.set('line', line);
  return request(`/api/history?${p.toString()}`);
};
export const deleteHistoryItem = (id) => request(`/api/history/${id}`, { method: 'DELETE', guard: true });

/* ---------------- 生产进度 ---------------- */
export const listOrders = ({ q, status } = {}) => {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (status) p.set('status', status);
  return request(`/api/orders?${p.toString()}`);
};
export const updateOrder = (id, data) => request(`/api/orders/${id}`, { method: 'PUT', body: data });
export const deleteOrder = (id) => request(`/api/orders/${id}`, { method: 'DELETE', guard: true });

/* ---------------- 库存 ---------------- */
export const getStock = () => request('/api/stock');
export const listInbound = (opt = {}) => {
  const p = new URLSearchParams();
  Object.entries(opt).forEach(([k, v]) => v && p.set(k, v));
  return request(`/api/inbound?${p.toString()}`);
};
export const createInbound = (data) => request('/api/inbound', { method: 'POST', body: data });
export const updateInbound = (id, data) => request(`/api/inbound/${id}`, { method: 'PUT', body: data });
export const deleteInbound = (id) => request(`/api/inbound/${id}`, { method: 'DELETE', guard: true });

export const listOutbound = (opt = {}) => {
  const p = new URLSearchParams();
  Object.entries(opt).forEach(([k, v]) => v && p.set(k, v));
  return request(`/api/outbound?${p.toString()}`);
};
export const createOutbound = (data) => request('/api/outbound', { method: 'POST', body: data });
export const updateOutbound = (id, data) => request(`/api/outbound/${id}`, { method: 'PUT', body: data });
export const deleteOutbound = (id) => request(`/api/outbound/${id}`, { method: 'DELETE', guard: true });

/* ---------------- 系统 ---------------- */
export const getSettings = () => request('/api/settings');
export const saveSettings = (data) => request('/api/settings', { method: 'PUT', body: data });
export const verifyDeletePassword = (password) =>
  request('/api/verify-delete-password', { method: 'POST', body: { password } });
export const getOverview = () => request('/api/overview');
export const getEngine = () => request('/api/engine');
export const restoreBackup = (payload) => request('/api/restore', { method: 'POST', body: payload, guard: true });

export function exportUrl(table, format = 'csv') {
  return `/api/export?table=${encodeURIComponent(table)}&format=${format}`;
}
export function backupUrl() {
  return '/api/backup';
}

/** 通过浏览器直接下载后端生成的 CSV / 备份文件 */
export function downloadUrl(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 300);
}
export const exportDownload = (table, format = 'csv') => downloadUrl(exportUrl(table, format));
