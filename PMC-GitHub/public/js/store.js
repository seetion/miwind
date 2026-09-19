/* ============================================================
   store.js —— 全局状态 / 外观设置 / 二级密码
   ============================================================ */

import * as api from './api.js';
import { deleteGuard } from './api.js';
import { dialog, el, loadLocal, saveLocal, toast } from './util.js';

export const state = {
  settings: {},
  products: [],
  productLoaded: false,
};

export const isGuest = () => !api.session.logged;

/* ---------------- 外观 ---------------- */
export function applyAppearance() {
  const pad = state.settings.row_padding !== undefined ? Number(state.settings.row_padding) : loadLocal('pmc:rowPad', 2);
  document.documentElement.style.setProperty('--row-pad', `${Math.max(0, Math.min(14, pad))}px`);
}
export function setRowPadding(px) {
  const v = Math.max(0, Math.min(14, Number(px) || 0));
  document.documentElement.style.setProperty('--row-pad', `${v}px`);
  saveLocal('pmc:rowPad', v);
}

/* ---------------- 设置 ---------------- */
export async function loadSettings() {
  try {
    state.settings = (await api.getSettings()) || {};
  } catch (e) {
    state.settings = state.settings || {};
  }
  applyAppearance();
  return state.settings;
}
export function setting(key, fallback = '') {
  const v = state.settings[key];
  return v === undefined || v === null || v === '' ? fallback : v;
}
export function lineOptions() {
  return setting('line_options', '一线,二线,三线,四线')
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/* ---------------- 基础物品信息缓存 ---------------- */
export async function loadProducts(force = false) {
  if (state.productLoaded && !force) return state.products;
  state.products = (await api.listProducts()) || [];
  state.productLoaded = true;
  return state.products;
}
export function findProduct(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  return state.products.find((p) => p.code === c) || null;
}
export function searchProducts(keyword, limit = 40) {
  const kw = String(keyword || '').trim().toLowerCase();
  const list = state.products;
  if (!kw) return list.slice(0, limit);
  return list
    .filter((p) => `${p.code} ${p.name} ${p.spec}`.toLowerCase().includes(kw))
    .slice(0, limit);
}

/* ---------------- 二级密码 ---------------- */
export async function askDeletePassword(reason = '该操作会删除数据，请输入二级密码确认') {
  let value = '';
  const okRes = await dialog({
    title: '二级密码验证',
    width: 'dialog-sm',
    body: `
      <div style="line-height:1.7;font-size:12.5px;color:#5b6b82;margin-bottom:10px">${reason}</div>
      <div class="field" style="margin:0">
        <label>二级密码</label>
        <input type="password" id="guardPwd" placeholder="默认 888888" autocomplete="off" />
      </div>`,
    okText: '验证并继续',
    okType: 'btn-danger',
    onOk: ({ body }) => {
      const input = body.querySelector('#guardPwd');
      value = input.value;
      if (!value) {
        toast('请输入二级密码', 'warn');
        return false;
      }
      return true;
    },
  });
  if (!okRes) return false;

  try {
    const r = await api.verifyDeletePassword(value);
    if (r && r.valid) {
      deleteGuard.password = value; // 本次会话内复用
      return true;
    }
  } catch (e) {
    /* ignore */
  }
  toast('二级密码错误，操作已取消', 'error');
  return false;
}

/** 需要删除权限的操作：无缓存密码则先验证 */
export async function withDeleteGuard(fn) {
  if (isGuest()) {
    toast('游客模式无法删除，请先登录', 'warn');
    return false;
  }
  if (!deleteGuard.password) {
    const passed = await askDeletePassword();
    if (!passed) return false;
  }
  try {
    await fn();
    return true;
  } catch (e) {
    if (e.status === 403) {
      deleteGuard.password = '';
      toast('二级密码已失效，请重新验证', 'error');
    } else {
      toast(e.message || '操作失败', 'error');
    }
    return false;
  }
}

/** 登录校验：游客返回 false */
export function requireLogin(action = '录入数据') {
  if (!isGuest()) return true;
  toast(`游客模式无法${action}，请先登录`, 'warn');
  const btn = document.getElementById('btnLogin');
  if (btn) {
    btn.classList.remove('hidden');
    btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 420 });
  }
  return false;
}

/* ---------------- 顶部/底部状态 ---------------- */
export function refreshUserUI() {
  const logged = api.session.logged;
  const chip = document.getElementById('userChip');
  const nameEl = document.getElementById('userName');
  const btnLogin = document.getElementById('btnLogin');
  const btnLogout = document.getElementById('btnLogout');
  const statusUser = document.getElementById('statusUser');
  if (nameEl) nameEl.textContent = logged ? api.session.user.username : '游客';
  if (chip) chip.classList.toggle('guest', !logged);
  if (btnLogin) btnLogin.classList.toggle('hidden', logged);
  if (btnLogout) btnLogout.classList.toggle('hidden', !logged);
  if (statusUser) statusUser.textContent = logged ? `已登录：${api.session.user.username}` : '游客模式（只读）';
}

export function guestBar(message = '当前为游客模式，数据只读。登录后可录入、修改数据。') {
  const wrap = el('div', { class: 'guest-bar' });
  wrap.appendChild(el('span', { text: '⚠' }));
  wrap.appendChild(el('span', { text: message }));
  const btn = el('button', { class: 'btn btn-sm btn-primary', text: '立即登录' });
  btn.addEventListener('click', () => document.getElementById('btnLogin')?.click());
  wrap.appendChild(btn);
  return wrap;
}
