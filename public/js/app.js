/* ============================================================
   app.js —— 应用入口：路由 / 导航 / 登录
   ============================================================ */

import * as api from './api.js';
import { deleteGuard } from './api.js';
import { $, $$, el, toast, status, loadLocal } from './util.js';
import { applyAppearance, loadProducts, loadSettings, refreshUserUI } from './store.js';

import * as home from './pages/home.js';
import * as today from './pages/today.js';
import * as history from './pages/history.js';
import * as progress from './pages/progress.js';
import * as stock from './pages/stock.js';
import * as inbound from './pages/inbound.js';
import * as outbound from './pages/outbound.js';
import * as settings from './pages/settings.js';

const ROUTES = { home, today, history, progress, stock, inbound, outbound, settings };
const STOCK_ROUTES = ['stock', 'inbound', 'outbound'];

let cleanupFn = null;

/* ---------------- 路由 ---------------- */
function currentRoute() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0];
  return ROUTES[raw] ? raw : 'home';
}

function setActiveNav(key) {
  $$('.nav-item').forEach((n) => n.classList.remove('active'));
  $$(`.nav-item[data-route="${key}"]`).forEach((n) => n.classList.add('active'));
  const group = document.querySelector('.nav-group[data-group="stock"]');
  if (group) group.classList.toggle('open', STOCK_ROUTES.includes(key));
}

async function navigate() {
  const key = currentRoute();
  const mod = ROUTES[key];
  const view = $('#view');

  if (typeof cleanupFn === 'function') {
    try {
      cleanupFn();
    } catch (e) {
      /* ignore */
    }
    cleanupFn = null;
  }

  setActiveNav(key);
  $('#crumb').textContent = mod.meta.title;
  document.title = `${mod.meta.title} - 生产管理系统`;
  view.scrollTop = 0;
  view.innerHTML = '<div class="loading">正在加载…</div>';

  try {
    cleanupFn = await mod.render(view);
  } catch (e) {
    console.error(e);
    view.innerHTML = '';
    view.appendChild(
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-body' }, [
          el('div', { class: 'empty', html: `<span class="big">✖</span>页面加载失败：${e.message || e}` }),
        ]),
      ])
    );
  }
}

/* ---------------- 登录 ---------------- */
function openLogin() {
  $('#loginMask').classList.remove('hidden');
  setTimeout(() => {
    if (api.session.logged) $('#btnLogout');
    $('#loginUser').focus();
  }, 60);
}
function closeLogin() {
  $('#loginMask').classList.add('hidden');
  $('#loginTip').className = 'login-tip';
  $('#loginTip').textContent = '登录后可录入与修改数据；游客仅可查看';
}

async function doLogin() {
  const username = $('#loginUser').value.trim();
  const password = $('#loginPass').value;
  const tip = $('#loginTip');
  if (!username || !password) {
    tip.className = 'login-tip warn';
    tip.textContent = '请输入账号与密码';
    return;
  }
  const btn = $('#loginSubmit');
  btn.disabled = true;
  try {
    const r = await api.login(username, password);
    api.session.set(r.token, r.user);
    deleteGuard.password = '';
    refreshUserUI();
    closeLogin();
    $('#loginPass').value = '';
    toast(`欢迎回来，${r.user.username}`, 'success');
    await loadSettings();
    await loadProducts(true);
    await navigate();
  } catch (e) {
    tip.className = 'login-tip warn';
    tip.textContent = e.message || '登录失败';
  } finally {
    btn.disabled = false;
  }
}

async function doLogout() {
  try {
    await api.logout();
  } catch (e) {
    /* ignore */
  }
  api.session.clear();
  deleteGuard.password = '';
  refreshUserUI();
  toast('已退出登录，当前为游客模式', 'info');
  await navigate();
}

/* ---------------- 启动 ---------------- */
async function boot() {
  // 先应用本地外观设置，避免闪烁
  applyAppearance();

  // 导航交互
  $('#btnToggleSide').addEventListener('click', () => document.querySelector('.app').classList.toggle('collapsed'));
  $('.nav-group[data-group="stock"] .nav-parent').addEventListener('click', () => {
    document.querySelector('.nav-group[data-group="stock"]').classList.add('open');
  });
  window.addEventListener('hashchange', navigate);

  // 直接按 Ctrl+P 时若没有生成报表单据，则打印页面本身，避免空白页
  window.addEventListener('beforeprint', () => {
    const area = document.getElementById('printArea');
    document.body.classList.toggle('print-empty', !area || !area.childElementCount);
  });

  // 登录相关
  $('#btnLogin').addEventListener('click', openLogin);
  $('#btnLogout').addEventListener('click', doLogout);
  $('#loginSubmit').addEventListener('click', doLogin);
  $('#loginPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
  $('#loginUser').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#loginPass').focus();
  });
  $$('[data-close]').forEach((b) => b.addEventListener('click', () => closeLogin()));
  $('#loginMask').addEventListener('mousedown', (e) => {
    if (e.target === $('#loginMask')) closeLogin();
  });

  // 校验本地 token 是否仍然有效
  status('正在连接 libSQL 数据服务…');
  try {
    await loadSettings();
    if (api.session.token) {
      const r = await api.me();
      if (r && r.user) api.session.set(api.session.token, r.user);
      else api.session.clear();
    }
    await loadProducts(true);
    const eng = await api.getEngine();
    const badge = $('#dbBadge');
    badge.textContent = eng.remote ? 'libSQL · 云库' : 'libSQL · 本地';
    badge.title = `当前数据源：${eng.label}\n${eng.target}`;
    badge.style.background = eng.remote ? 'rgba(22,163,74,.28)' : 'rgba(31,111,235,.28)';
    badge.style.color = eng.remote ? '#9fe6bb' : '#9dc0f7';
    console.log('[数据引擎]', eng.label, eng.target);
  } catch (e) {
    toast('无法连接后端服务，请确认已运行 npm start', 'error', 5000);
    status('后端服务未连接');
  }
  refreshUserUI();

  if (!location.hash) location.hash = '#/home';
  await navigate();
  status('就绪');
}

boot();
