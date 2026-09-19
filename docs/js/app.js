/* ============================================================
   app.js —— 应用入口：路由 / 导航 / 登录
   ============================================================ */

import * as api from './api.js';
import { deleteGuard } from './api.js';
import { $, $$, el, toast, status, loadLocal, dialog } from './util.js';
import { applyAppearance, loadProducts, loadSettings, refreshUserUI } from './store.js';
import { ensureConnected, openDialog } from './config-ui.js';
import { dbState } from './db.js';

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
    if (e.code === 'LEGACY_HASH') await offerPasswordReset();
  } finally {
    btn.disabled = false;
  }
}

/** 账号密码由 Node 端创建、浏览器无法验证时，提供一次性重置（新密码由使用者自己设定） */
async function offerPasswordReset() {
  let pwd = '';
  const yes = await dialog({
    title: '密码格式不兼容',
    width: 'dialog-sm',
    body:
      '<div style="line-height:1.9;font-size:12.5px">' +
      '这个数据库的 <b>admin</b> 账号由桌面版 / 云库版创建，加密方式与网页版不同，浏览器无法验证它的密码。<br/><br/>' +
      '请为 <b>admin</b> 账号设置一个新密码（至少 6 位）：</div>' +
      '<div class="field" style="margin-top:10px"><label>新密码</label>' +
      '<input type="password" id="resetPwd1" autocomplete="new-password" /></div>' +
      '<div class="field"><label>确认新密码</label>' +
      '<input type="password" id="resetPwd2" autocomplete="new-password" /></div>' +
      '<div class="cfg-note">只有在密码格式不兼容时才允许重置，正常账号不会被覆盖。</div>',
    okText: '重置密码',
    okType: 'btn-danger',
    onOk: ({ body }) => {
      const a = body.querySelector('#resetPwd1').value;
      const b = body.querySelector('#resetPwd2').value;
      if (a.length < 6) {
        toast('新密码至少 6 位', 'warn');
        return false;
      }
      if (a !== b) {
        toast('两次输入的密码不一致', 'warn');
        return false;
      }
      pwd = a;
      return true;
    },
  });
  if (!yes || !pwd) return;
  try {
    await api.resetAdminPassword(pwd);
    toast('密码已重置，请用新密码登录', 'success', 5000);
    $('#loginPass').value = '';
    $('#loginPass').focus();
  } catch (err) {
    toast(err.message || '重置失败', 'error');
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

  // 云库连接设置
  $('#btnCloud').addEventListener('click', () => openDialog(false));

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

  // 先确保已连接云库（首次打开会弹出配置窗口）
  status('正在连接 libSQL（Turso 云库）…');
  try {
    await ensureConnected();
  } catch (e) {
    toast(e.message || '数据库连接失败', 'error', 5000);
  }

  if (dbState.connected) {
    try {
      await loadSettings();
      await loadProducts(true);
      const badge = $('#dbBadge');
      badge.textContent = 'libSQL · 云库';
      badge.title = `当前数据源：${dbState.host}`;
      badge.style.background = 'rgba(22,163,74,.28)';
      badge.style.color = '#9fe6bb';
      console.log('[数据引擎] libSQL(Turso) ->', dbState.host);
    } catch (e) {
      toast(`数据读取失败：${e.message || e}`, 'error', 5000);
    }
  } else {
    status('未连接数据库');
  }
  refreshUserUI();

  if (!location.hash) location.hash = '#/home';
  await navigate();
  status('就绪');
}

boot();
