/* ============================================================
   util.js —— 通用工具函数
   ============================================================ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function escapeHtml(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** 数字格式化：千分位 + 最多 2 位小数 */
export function fmtNum(v, digits = 2) {
  const n = num(v);
  const s = digits === 0 ? Math.round(n).toString() : n.toFixed(digits);
  const [i, d] = s.split('.');
  const ii = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return d ? `${ii}.${d}` : ii;
}

/** 数量显示：整数不带小数 */
export function fmtQty(v) {
  const n = num(v);
  return Number.isInteger(n) ? fmtNum(n, 0) : fmtNum(n, 2);
}

/* ---------------- 日期 ---------------- */
export function fmtDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export const todayStr = () => fmtDate(new Date());
export function parseDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
export function addDays(s, n) {
  const d = s instanceof Date ? new Date(s) : parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}
export function monthStart(d = new Date()) {
  return fmtDate(new Date(d.getFullYear(), d.getMonth(), 1));
}
export function monthEnd(d = new Date()) {
  return fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
export function yearStart(y) {
  return `${y}-01-01`;
}
export function yearEnd(y) {
  return `${y}-12-31`;
}
/** 周一为一周起点 */
export function weekRange(anyDate = new Date()) {
  const d = anyDate instanceof Date ? new Date(anyDate) : parseDate(anyDate);
  const day = (d.getDay() + 6) % 7;
  const start = new Date(d);
  start.setDate(d.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { from: fmtDate(start), to: fmtDate(end) };
}
export function monthLabel(s) {
  const [, m, d] = String(s).split('-');
  return `${Number(m)}/${Number(d)}`;
}
export function shortDate(s) {
  const [, m, d] = String(s).split('-');
  return `${Number(m)}月${Number(d)}日`;
}

/* ---------------- 交互 ---------------- */
let toastTimer = null;
export function toast(message, type = 'info', duration = 2400) {
  const root = $('#toastRoot');
  if (!root) return;
  const icons = { success: '✔', error: '✖', warn: '!', info: 'i' };
  const node = el('div', { class: `toast ${type}` }, [
    el('span', { class: 't-ico', text: icons[type] || 'i' }),
    el('span', { text: message }),
  ]);
  root.appendChild(node);
  clearTimeout(toastTimer);
  setTimeout(() => {
    node.style.transition = 'opacity .2s, transform .2s';
    node.style.opacity = '0';
    node.style.transform = 'translateY(-8px)';
    setTimeout(() => node.remove(), 220);
  }, duration);
}

export const status = (msg) => {
  const n = $('#statusMsg');
  if (n) n.textContent = msg || '就绪';
};

export function debounce(fn, wait = 260) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/* ---------------- 弹窗 ---------------- */
export function dialog({ title, body, width, okText = '确定', cancelText = '取消', okType = 'btn-primary', onOk, footer = true }) {
  return new Promise((resolve) => {
    const root = $('#modalRoot');
    const bodyNode = typeof body === 'string' ? el('div', { html: body }) : body;
    const dlg = el('div', { class: `dialog ${width || ''}` });
    const head = el('div', { class: 'dialog-head' }, [
      el('span', { text: title || '提示' }),
      el('button', { class: 'dialog-x', text: '×', onclick: () => close(false) }),
    ]);
    const bodyWrap = el('div', { class: 'dialog-body' }, [bodyNode]);
    dlg.appendChild(head);
    dlg.appendChild(bodyWrap);

    function close(val) {
      mask.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(false);
    }

    if (footer) {
      const okBtn = el('button', { class: `btn ${okType}`, text: okText });
      okBtn.addEventListener('click', async () => {
        if (onOk) {
          okBtn.disabled = true;
          try {
            const r = await onOk({ close, body: bodyNode });
            if (r === false) {
              okBtn.disabled = false;
              return;
            }
            close(r === undefined ? true : r);
          } catch (e) {
            okBtn.disabled = false;
            toast(e.message || '操作失败', 'error');
          }
        } else close(true);
      });
      const foot = el('div', { class: 'dialog-foot' }, [
        el('button', { class: 'btn', text: cancelText, onclick: () => close(false) }),
        okBtn,
      ]);
      dlg.appendChild(foot);
      setTimeout(() => okBtn.focus(), 30);
    }

    const mask = el('div', { class: 'mask' }, [dlg]);
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) close(false);
    });
    document.addEventListener('keydown', onKey);
    root.appendChild(mask);
    setTimeout(() => {
      const first = bodyWrap.querySelector('input, select, textarea');
      if (first && !footer) first.focus();
    }, 40);
  });
}

export const alertDialog = (message, title = '提示') =>
  dialog({ title, body: `<div style="line-height:1.8;font-size:13px">${escapeHtml(message)}</div>`, footer: true, cancelText: '关闭', okText: '确定' });

export function confirmDialog(message, title = '操作确认', okType = 'btn-danger') {
  return dialog({
    title,
    body: `<div style="line-height:1.8;font-size:13px">${escapeHtml(message)}</div>`,
    okText: '确定执行',
    okType,
  });
}

/* ---------------- 文件下载 / 读取 ---------------- */
export function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  downloadBlob(filename, blob);
}
export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 200);
}
export function pickFile(accept = '.csv,.txt') {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, style: 'display:none' });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.remove();
      if (!f) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: f.name, text: String(reader.result || '') });
      reader.onerror = () => resolve(null);
      reader.readAsText(f, 'UTF-8');
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** 解析 CSV（支持引号、逗号、换行） */
export function parseCSV(text) {
  const src = String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuote = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuote) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuote = false;
      } else cell += ch;
    } else if (ch === '"') inQuote = true;
    else if (ch === ',') {
      row.push(cell.trim());
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.trim());
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

export function saveLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* ignore */
  }
}
export function loadLocal(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

export function debounceInput(fn) {
  return debounce(fn, 180);
}
