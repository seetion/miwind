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

/* ---------------- 二级密码（删除保护） ---------------- */
/**
 * 每次删除都必须重新输入二级密码。
 * 弹窗里会明确写出「要删除什么」，验证通过后的密码只在本次操作期间有效，用完立即清空。
 */
export async function askDeletePassword(detail = '') {
  let value = '';

  const box = el('div', {}, [
    el('div', { class: 'danger-box' }, [
      el('div', { class: 'danger-title', text: '此操作将永久删除数据，删除后无法恢复' }),
      detail ? el('div', { class: 'danger-detail', text: detail }) : null,
      el('div', { class: 'danger-tip', text: '为防止误删，每一次删除都必须重新输入二级密码。' }),
    ]),
    el('div', { class: 'field', style: 'margin:0' }, [
      el('label', { text: '二级密码' }),
      el('input', { type: 'password', id: 'guardPwd', placeholder: '请输入二级密码', autocomplete: 'off' }),
    ]),
  ]);

  const pwdInput = box.querySelector('#guardPwd');
  pwdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const ok = document.querySelector('#modalRoot .dialog-foot .btn-danger');
      if (ok) ok.click();
    }
  });
  setTimeout(() => pwdInput.focus(), 80);

  const okRes = await dialog({
    title: '删除确认',
    width: 'dialog-sm',
    body: box,
    okText: '确认删除',
    okType: 'btn-danger',
    onOk: () => {
      value = pwdInput.value.trim();
      if (!value) {
        toast('请输入二级密码', 'warn');
        pwdInput.focus();
        return false;
      }
      return true;
    },
  });
  if (!okRes) return false;

  try {
    const r = await api.verifyDeletePassword(value);
    if (r && r.valid) {
      deleteGuard.password = value; // 仅供紧接着的这一次操作使用
      return true;
    }
  } catch (e) {
    /* ignore */
  }
  deleteGuard.password = '';
  toast('二级密码错误，删除已取消', 'error');
  return false;
}

/**
 * 需要二级密码的操作（删除记录 / 数据还原）
 * ——每次都弹窗验证，绝不记忆复用
 * @param {string} detail 弹窗中展示的删除对象描述
 * @param {Function} fn 验证通过后执行的操作
 */
export async function withDeleteGuard(detail, fn) {
  if (isGuest()) {
    toast('游客模式无法执行删除，请先登录', 'warn');
    return false;
  }
  // 兼容只传一个函数的老写法
  if (typeof detail === 'function' && fn === undefined) {
    fn = detail;
    detail = '';
  }
  const passed = await askDeletePassword(detail);
  if (!passed) return false;
  try {
    await fn();
    return true;
  } catch (e) {
    if (e.status === 403) toast('二级密码错误，操作已取消', 'error');
    else toast(e.message || '操作失败', 'error');
    return false;
  } finally {
    deleteGuard.password = ''; // 用完立刻失效，下次删除必须重新输入
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
