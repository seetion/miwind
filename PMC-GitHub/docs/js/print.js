/* ============================================================
   print.js —— A4 报表打印 / 导出 PDF
   ============================================================ */

import { dialog, el, toast } from './util.js';

const pad2 = (n) => String(n).padStart(2, '0');
function nowStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 构造 A4 单据 DOM
 * @param {object} o
 *   title      单据标题，如「生产日报表」
 *   company    公司/系统名（抬头小字）
 *   meta       [[标签, 值], ...] 抬头信息条
 *   columns    [{ title, width, align: 'left'|'right'|'center' }]
 *   rows       二维数组（已格式化的字符串）
 *   footer     合计行（数组，长度与 columns 一致）或 null
 *   note       表格下方补充说明
 *   signRows   签字栏文本数组
 */
export function docElement(o = {}) {
  const { title = '报表', company = '生产管理系统', meta = [], columns = [], rows = [], footer = null, note = '', signRows = [] } = o;

  const doc = el('div', { class: 'doc' });

  const head = el('div', { class: 'doc-head' }, [
    el('div', { class: 'doc-company', text: company }),
    el('h1', { class: 'doc-title', text: title }),
  ]);
  doc.appendChild(head);

  if (meta.length) {
    const m = el('div', { class: 'doc-meta' });
    meta.forEach(([k, v]) => {
      if (v === null || v === undefined || v === '') return;
      m.appendChild(el('span', { class: 'mi' }, [el('b', { text: `${k}：` }), el('span', { text: String(v) })]));
    });
    doc.appendChild(m);
  }

  const table = el('table', { class: 'doc-table' });
  const cg = el('colgroup');
  columns.forEach((c) => cg.appendChild(el('col', { style: c.width ? `width:${c.width}px` : '' })));
  table.appendChild(cg);

  const thead = el('thead');
  const trh = el('tr');
  columns.forEach((c) => {
    const cls = c.align === 'right' ? 'num' : c.align === 'center' ? 'center' : '';
    trh.appendChild(el('th', { class: cls, text: c.title || '' }));
  });
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = el('tbody');
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colspan: String(columns.length), class: 'center', text: '（无数据）' })]));
  }
  rows.forEach((r) => {
    const tr = el('tr');
    columns.forEach((c, i) => {
      const cls = c.align === 'right' ? 'num' : c.align === 'center' ? 'center' : '';
      const v = r[i];
      tr.appendChild(el('td', { class: cls, text: v === null || v === undefined ? '' : String(v) }));
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  if (footer) {
    const tfoot = el('tfoot');
    const trf = el('tr');
    columns.forEach((c, i) => {
      const cls = c.align === 'right' ? 'num' : c.align === 'center' ? 'center' : '';
      const v = footer[i];
      trf.appendChild(el('td', { class: cls, text: v === null || v === undefined ? '' : String(v) }));
    });
    tfoot.appendChild(trf);
    table.appendChild(tfoot);
  }
  doc.appendChild(table);

  if (note) doc.appendChild(el('div', { class: 'doc-note', text: note }));

  if (signRows.length) {
    const sign = el('div', { class: 'doc-sign' });
    signRows.forEach((t) => sign.appendChild(el('span', { class: 'si', text: t })));
    doc.appendChild(sign);
  }

  doc.appendChild(el('div', { class: 'doc-foot', text: `打印时间：${nowStr()}　${company}` }));
  return doc;
}

/** 把单据送入打印区并调起浏览器打印窗口 */
export function printDoc(node) {
  const area = document.getElementById('printArea');
  if (!area) {
    toast('打印区域缺失，请刷新页面重试', 'error');
    return;
  }
  area.innerHTML = '';
  area.appendChild(node.cloneNode(true));
  document.body.classList.remove('print-empty');
  setTimeout(() => window.print(), 60);
}

/** 打开 A4 预览弹窗，确认后打印 / 另存为 PDF */
export function previewDoc(node, title = 'A4 打印预览') {
  const body = el('div', {}, [
    el('div', {
      class: 'print-hint',
      html:
        '点击右下角 <b>「🖨 打印 / 存为 PDF」</b> 会打开浏览器打印窗口：<br/>' +
        '· 选择真实打印机 → 直接打印出 A4 纸质报表交给车间签字；<br/>' +
        '· 目标打印机选择 <b>「另存为 PDF」</b> → 导出一份 PDF 文件存档或发微信。',
    }),
    el('div', { class: 'doc-preview' }, [node]),
  ]);

  return dialog({
    title,
    width: 'dialog-lg',
    body,
    okText: '🖨 打印 / 存为 PDF',
    cancelText: '关闭',
    onOk: () => {
      printDoc(node);
      return false; // 保留预览，便于重复打印
    },
  });
}
