/* ============================================================
   pages/today.js —— 今日报表（数据录入）
   ============================================================ */

import * as api from '../api.js';
import { findProduct, guestBar, isGuest, lineOptions, loadProducts, requireLogin, setting, state, withDeleteGuard } from '../store.js';
import { el, fmtNum, fmtQty, num, todayStr, toast, status, escapeHtml, debounce } from '../util.js';
import { makeResizable } from '../table.js';
import { docElement, previewDoc } from '../print.js';

const EMPTY_ROW = () => ({
  order_no: '',
  product_code: '',
  product_name: '',
  spec: '',
  unit: '',
  order_qty: '',
  today_qty: '',
  remark: '',
});

export async function render(view) {
  await loadProducts();
  view.innerHTML = '';

  if (isGuest()) view.appendChild(guestBar('游客模式：可以查看报表，但无法录入与保存。登录后可录入数据。'));

  const rows = [];
  let reportMeta = { id: null };

  /* ---------------- 报表头 ---------------- */
  const head = el('div', { class: 'today-head' });
  const mkCell = (label, node, extraClass = '') => {
    const c = el('div', { class: `cell ${extraClass}` }, [el('label', { text: label }), node]);
    head.appendChild(c);
    return c;
  };
  const mkMetric = (label, id) => {
    const val = el('div', { class: 'val', id }, ['0']);
    const c = el('div', { class: 'cell metric' }, [el('label', { text: label }), val]);
    head.appendChild(c);
    return val;
  };

  const dateInput = el('input', { type: 'date', id: 'repDate', value: todayStr() });
  const lineSelect = el('select', { id: 'repLine' });
  lineOptions().forEach((l) => lineSelect.appendChild(el('option', { value: l, text: l })));
  lineSelect.value = setting('default_line', '一线');

  const attInput = el('input', { type: 'number', min: '0', step: '1', value: '0', id: 'repAttendance' });
  const hourInput = el('input', { type: 'number', min: '0', step: '0.5', value: '0', id: 'repHours' });

  mkCell('日期', dateInput);
  mkCell('线别', lineSelect);
  mkCell('出勤人数', attInput);
  mkCell('出勤时间（小时）', hourInput);
  const totalEl = mkMetric('总产量（自动）', 'repTotal');
  const upphEl = mkMetric('人均产能 UPPH（自动）', 'repUpph');
  const uppdEl = mkMetric('人均产能 UPPD（自动）', 'repUppd');
  totalEl.classList.add('total');

  const headPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('div', { class: 'title', text: '报表信息' }),
      el('div', { class: 'sub', id: 'repHint', text: '选择日期与线别后录入明细' }),
    ]),
    head,
  ]);
  view.appendChild(headPanel);

  /* ---------------- 明细 ---------------- */
  const COLUMNS = [
    { title: '序号', width: 48, align: 'center' },
    { title: '订单号', width: 128 },
    { title: '产品编号', width: 118 },
    { title: '产品名称', width: 180 },
    { title: '规格型号', width: 140 },
    { title: '单位', width: 58, align: 'center' },
    { title: '订单数量', width: 92, align: 'right' },
    { title: '今日产量', width: 92, align: 'right' },
    { title: '备注', width: 150 },
    { title: '操作', width: 56, align: 'center' },
  ];

  const table = el('table', { class: 'grid detail' });
  const colgroup = el('colgroup');
  COLUMNS.forEach((c) => colgroup.appendChild(el('col', { style: `width:${c.width}px` })));
  table.appendChild(colgroup);

  const thead = el('thead');
  const trh = el('tr');
  COLUMNS.forEach((c) =>
    trh.appendChild(
      el('th', {
        class: c.align === 'right' ? 'num' : c.align === 'center' ? 'center' : '',
        dataset: { col: c.title, width: c.width, min: c.title === '序号' || c.title === '操作' ? 40 : 60 },
        text: c.title,
      })
    )
  );
  thead.appendChild(trh);
  table.appendChild(thead);

  const tbody = el('tbody');
  const tfoot = el('tfoot');
  table.appendChild(tbody);
  table.appendChild(tfoot);

  const tableWrap = el('div', { class: 'table-wrap' }, [table]);

  /* -------- 快速录入 -------- */
  const quickSelect = el('select', { id: 'quickProduct' }, [el('option', { value: '', text: '— 选择基础物品信息 —' })]);
  const fillQuickOptions = () => {
    quickSelect.innerHTML = '<option value="">— 选择基础物品信息 —</option>';
    state.products.forEach((p) =>
      quickSelect.appendChild(
        el('option', { value: p.code, text: `${p.code} ｜ ${p.name || '未命名'}${p.spec ? ' / ' + p.spec : ''}` })
      )
    );
  };
  fillQuickOptions();

  const btnQuickAdd = el('button', { class: 'btn btn-sm', text: '＋ 添加到明细' });
  const quickBar = el('div', { class: 'quick-add' }, [
    el('span', { class: 'qa-label', text: '快速录入：' }),
    quickSelect,
    btnQuickAdd,
    el('span', { class: 'hint', text: '（引用基础物品信息，也可在表格中直接输入产品编号自动带出）' }),
  ]);

  const btnAddRow = el('button', { class: 'btn btn-sm', text: '＋ 新增空行' });
  const btnClear = el('button', { class: 'btn btn-sm', text: '清空明细' });
  const btnSave = el('button', { class: 'btn btn-sm btn-success', text: '💾 保存数据' });
  const btnReload = el('button', { class: 'btn btn-sm', text: '↻ 载入已存报表' });
  const btnPrint = el('button', { class: 'btn btn-sm', text: '🖨 打印 / PDF', title: '按 A4 版式打印生产日报表，或另存为 PDF' });

  const detailPanel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('div', { class: 'title', text: '生产明细' }),
      el('div', { class: 'sub', text: '一天可录入多款不同订单的相同产品，表底自动合计' }),
      el('div', { class: 'tools' }, [btnAddRow, btnClear, btnReload, btnPrint, btnSave]),
    ]),
    quickBar,
    tableWrap,
  ]);
  view.appendChild(detailPanel);

  makeResizable(table, 'today-detail');

  /* ---------------- 明细渲染 ---------------- */
  const FIELD_ORDER = ['order_no', 'product_code', 'product_name', 'spec', 'unit', 'order_qty', 'today_qty', 'remark'];

  function buildRow(row, index) {
    const tr = el('tr');
    tr._row = row;
    tr._els = {};
    tr.appendChild(el('td', { class: 'center', text: String(index + 1) }));

    const mkInput = (field, opts = {}) => {
      const input = el('input', { type: opts.type || 'text', value: row[field] ?? '' });
      if (opts.step) input.step = opts.step;
      if (opts.placeholder) input.placeholder = opts.placeholder;
      if (opts.class) input.className = opts.class;
      input.dataset.field = field;
      input.autocomplete = 'off';
      input.addEventListener('input', () => {
        row[field] = input.value;
        if (field === 'product_code') applyProduct(row, tr, input.value);
        if (field === 'order_qty' || field === 'today_qty') updateTotals();
      });
      input.addEventListener('keydown', (e) => onCellKey(e, tr));
      tr._els[field] = input;
      return input;
    };

    const orderInput = mkInput('order_no', { placeholder: '订单号' });
    orderInput.setAttribute('list', 'orderNoList');
    tr.appendChild(el('td', { class: 'editable' }, [orderInput]));

    const codeInput = mkInput('product_code', { placeholder: '编号/可搜索' });
    codeInput.classList.add('code-input');
    tr.appendChild(el('td', { class: 'editable' }, [codeInput]));

    tr.appendChild(el('td', { class: 'editable' }, [mkInput('product_name', { placeholder: '产品名称' })]));
    tr.appendChild(el('td', { class: 'editable' }, [mkInput('spec', { placeholder: '规格型号' })]));

    const unitInput = mkInput('unit', { placeholder: '单位' });
    unitInput.style.textAlign = 'center';
    tr.appendChild(el('td', { class: 'editable' }, [unitInput]));

    tr.appendChild(el('td', { class: 'editable' }, [mkInput('order_qty', { type: 'number', step: 'any', class: 'num', placeholder: '0' })]));
    tr.appendChild(el('td', { class: 'editable' }, [mkInput('today_qty', { type: 'number', step: 'any', class: 'num', placeholder: '0' })]));
    tr.appendChild(el('td', { class: 'editable' }, [mkInput('remark', { placeholder: '备注' })]));

    const btnDel = el('button', { class: 'btn-link danger', text: '删除', title: '删除本行' });
    btnDel.addEventListener('click', () => {
      const i = rows.indexOf(row);
      if (i >= 0) rows.splice(i, 1);
      renderRows();
    });
    tr.appendChild(el('td', { class: 'actions' }, [btnDel]));

    attachAutocomplete(tr._els.product_code, row, tr);
    return tr;
  }

  /** 输入产品编号 → 自动带出基础物品信息 */
  function applyProduct(row, tr, value) {
    const p = findProduct(value);
    if (!p) return;
    row.product_code = p.code;
    row.product_name = p.name || row.product_name;
    row.spec = p.spec || '';
    row.unit = p.unit || '';
    tr._els.product_name.value = row.product_name;
    tr._els.spec.value = row.spec;
    tr._els.unit.value = row.unit;
  }

  function onCellKey(e, tr) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const field = e.target.dataset.field;
    const idx = FIELD_ORDER.indexOf(field);
    if (idx >= 0 && idx < FIELD_ORDER.length - 1) {
      tr._els[FIELD_ORDER[idx + 1]].focus();
    } else if (rows.indexOf(tr._row) === rows.length - 1) {
      addRow(true);
    }
  }

  function renderRows(focusLast = false) {
    tbody.innerHTML = '';
    rows.forEach((r, i) => tbody.appendChild(buildRow(r, i)));
    if (isGuest()) disableInputs();
    if (focusLast) {
      const last = tbody.lastElementChild;
      if (last && last._els) last._els.orderInput.focus();
    }
    updateTotals();
  }

  function updateTotals() {
    const tOrder = rows.reduce((s, r) => s + num(r.order_qty), 0);
    const tToday = rows.reduce((s, r) => s + num(r.today_qty), 0);
    tfoot.innerHTML = '';
    const tr = el('tr');
    tr.appendChild(el('td', { class: 'center', text: '合计' }));
    tr.appendChild(el('td', { text: `${rows.length} 行` }));
    tr.appendChild(el('td', { text: '' }));
    tr.appendChild(el('td', { text: '' }));
    tr.appendChild(el('td', { text: '' }));
    tr.appendChild(el('td', { class: 'center', text: '' }));
    tr.appendChild(el('td', { class: 'num', text: fmtNum(tOrder, 0) }));
    tr.appendChild(el('td', { class: 'num', text: fmtNum(tToday, 0) }));
    tr.appendChild(el('td', { text: '' }));
    tr.appendChild(el('td', { text: '' }));
    tfoot.appendChild(tr);
    calcMetrics(tToday);
    return tToday;
  }

  function calcMetrics(total) {
    const att = num(attInput.value);
    const hours = num(hourInput.value);
    const manHours = att * hours;
    totalEl.innerHTML = `${fmtNum(total, 0)}<small>件</small>`;
    upphEl.innerHTML = manHours > 0 ? `${fmtNum(total / manHours, 2)}<small>件/人·时</small>` : `0.00<small>件/人·时</small>`;
    uppdEl.innerHTML = att > 0 ? `${fmtNum(total / att, 2)}<small>件/人·天</small>` : `0.00<small>件/人·天</small>`;
  }

  function addRow(focus = false, preset = null) {
    rows.push(preset ? { ...EMPTY_ROW(), ...preset } : EMPTY_ROW());
    renderRows(focus);
  }

  function disableInputs() {
    // 打印与「载入已存报表」属于只读操作，游客也应可用
    const keepEnabled = [btnPrint, btnReload];
    detailPanel.querySelectorAll('input, select, button').forEach((n) => {
      if (keepEnabled.includes(n)) return;
      if (n.classList.contains('btn-link')) return;
      n.disabled = true;
    });
    detailPanel.querySelectorAll('.btn-link').forEach((n) => (n.style.display = 'none'));
    headPanel.querySelectorAll('input, select').forEach((n) => (n.disabled = true));
    btnSave.disabled = true;
    btnPrint.disabled = false;
    btnReload.disabled = false;
  }

  /* ---------------- 自动补全 ---------------- */
  let acBox = null;
  let acFor = null;
  const hideAC = () => {
    if (acBox) acBox.remove();
    acBox = null;
    acFor = null;
  };
  function attachAutocomplete(input, row, tr) {
    input.addEventListener('focus', () => {
      if (input.value.trim().length >= 0) showAC(input, row, tr);
    });
    input.addEventListener('input', debounce(() => showAC(input, row, tr), 120));
    input.addEventListener('blur', () => setTimeout(hideAC, 160));
    input.addEventListener('keydown', (e) => {
      if (!acBox) return;
      const items = Array.from(acBox.querySelectorAll('.ac-item'));
      if (!items.length) return;
      let idx = items.findIndex((i) => i.classList.contains('active'));
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        idx = (idx + 1) % items.length;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        idx = (idx - 1 + items.length) % items.length;
      } else if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault();
        items[idx].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        return;
      } else return;
      items.forEach((i) => i.classList.remove('active'));
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
    });
  }
  function showAC(input, row, tr) {
    const list = state.products
      .filter((p) => `${p.code} ${p.name} ${p.spec}`.toLowerCase().includes(input.value.trim().toLowerCase()))
      .slice(0, 30);
    hideAC();
    if (!list.length) return;
    acBox = el('div', { class: 'ac-list' });
    list.forEach((p, i) => {
      const item = el('div', { class: `ac-item ${i === 0 ? 'active' : ''}` }, [
        el('span', { class: 'code', text: p.code }),
        el('span', { class: 'name', text: p.name || '未命名' }),
        el('span', { class: 'spec', text: p.spec || '' }),
      ]);
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        row.product_code = p.code;
        row.product_name = p.name || '';
        row.spec = p.spec || '';
        row.unit = p.unit || '';
        input.value = p.code;
        tr._els.product_name.value = row.product_name;
        tr._els.spec.value = row.spec;
        tr._els.unit.value = row.unit;
        hideAC();
        tr._els.order_qty.focus();
      });
      acBox.appendChild(item);
    });
    acFor = input;
    document.body.appendChild(acBox);
    const r = input.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    acBox.style.left = `${r.left}px`;
    acBox.style.width = `${Math.max(r.width, 300)}px`;
    if (below < 180 && r.top > 200) acBox.style.top = `${r.top - acBox.offsetHeight - 2}px`;
    else acBox.style.top = `${r.bottom + 2}px`;
  }
  document.addEventListener('scroll', hideAC, true);

  /* ---------------- 事件 ---------------- */
  attInput.addEventListener('input', () => calcMetrics(rows.reduce((s, r) => s + num(r.today_qty), 0)));
  hourInput.addEventListener('input', () => calcMetrics(rows.reduce((s, r) => s + num(r.today_qty), 0)));

  btnAddRow.addEventListener('click', () => addRow(true));
  btnQuickAdd.addEventListener('click', () => {
    const code = quickSelect.value;
    if (!code) return toast('请先选择一个基础物品', 'warn');
    const p = findProduct(code);
    if (!p) return;
    addRow(false, { product_code: p.code, product_name: p.name, spec: p.spec, unit: p.unit });
    quickSelect.value = '';
    toast(`已添加：${p.code} ${p.name || ''}`, 'success', 1400);
  });
  btnClear.addEventListener('click', () => {
    if (!rows.length) return;
    rows.length = 0;
    renderRows();
  });

  btnReload.addEventListener('click', () => loadExisting(true));

  btnPrint.addEventListener('click', () => {
    const list = rows.filter(
      (r) => String(r.order_no).trim() || String(r.product_code).trim() || String(r.product_name).trim()
    );
    if (!list.length) return toast('当前没有可打印的生产明细', 'warn');
    const att = num(attInput.value);
    const hours = num(hourInput.value);
    const total = list.reduce((s, r) => s + num(r.today_qty), 0);
    const totalOrder = list.reduce((s, r) => s + num(r.order_qty), 0);
    const manHours = att * hours;

    const node = docElement({
      title: '生产日报表',
      company: setting('company_name', '生产管理系统'),
      meta: [
        ['日期', dateInput.value],
        ['线别', lineSelect.value],
        ['出勤人数', `${att} 人`],
        ['出勤时间', `${hours} 小时`],
        ['总产量', `${fmtQty(total)} 件`],
        ['UPPH', manHours > 0 ? fmtNum(total / manHours, 2) : '0.00'],
        ['UPPD', att > 0 ? fmtNum(total / att, 2) : '0.00'],
      ],
      columns: [
        { title: '序号', width: 38, align: 'center' },
        { title: '订单号', width: 92 },
        { title: '产品编号', width: 124 },
        { title: '产品名称', width: 116 },
        { title: '规格型号', width: 92 },
        { title: '单位', width: 40, align: 'center' },
        { title: '订单数量', width: 68, align: 'right' },
        { title: '今日产量', width: 68, align: 'right' },
        { title: '备注', width: 74 },
      ],
      rows: list.map((r, i) => [
        i + 1,
        r.order_no || '',
        r.product_code || '',
        r.product_name || '',
        r.spec || '',
        r.unit || '',
        fmtQty(num(r.order_qty)),
        fmtQty(num(r.today_qty)),
        r.remark || '',
      ]),
      footer: ['合计', '', '', '', '', '', fmtQty(totalOrder), fmtQty(total), ''],
      signRows: ['制表人：________________', '审核：________________', '车间主管：________________', '日期：________________'],
    });
    previewDoc(node, '生产日报表 · A4 打印预览');
  });

  btnSave.addEventListener('click', async () => {
    if (!requireLogin('保存报表')) return;
    const payload = {
      report_date: dateInput.value || todayStr(),
      line: lineSelect.value,
      attendance: num(attInput.value),
      work_hours: num(hourInput.value),
      remark: '',
      items: rows
        .filter((r) => String(r.order_no).trim() || String(r.product_code).trim() || String(r.product_name).trim())
        .map((r, i) => ({ ...r, seq: i + 1 })),
    };
    if (!payload.items.length) return toast('请至少录入一条生产明细', 'warn');
    btnSave.disabled = true;
    try {
      const r = await api.saveReport(payload);
      toast(`保存成功：${payload.items.length} 条明细已写入历史记录，生产进度已同步`, 'success');
      status(`最后保存：${payload.report_date} ${payload.line}`);
      await loadProducts(true);
      fillQuickOptions();
      reportMeta.id = r.report_id;
      document.getElementById('repHint').textContent = `已保存（${payload.report_date} ${payload.line}）`;
    } catch (e) {
      toast(e.message || '保存失败', 'error');
    } finally {
      btnSave.disabled = false;
    }
  });

  dateInput.addEventListener('change', () => loadExisting());
  lineSelect.addEventListener('change', () => loadExisting());

  /* ---------------- 载入已存报表 ---------------- */
  async function loadExisting(manual = false) {
    const d = dateInput.value;
    try {
      const rep = await api.getReportByDate(d, lineSelect.value);
      if (!rep) {
        if (manual) toast('该日期 + 线别暂无已保存报表', 'info');
        document.getElementById('repHint').textContent = '新报表（未保存）';
        return;
      }
      attInput.value = rep.attendance;
      hourInput.value = rep.work_hours;
      rows.length = 0;
      (rep.items || []).forEach((it) =>
        rows.push({
          order_no: it.order_no,
          product_code: it.product_code,
          product_name: it.product_name,
          spec: it.spec,
          unit: it.unit,
          order_qty: it.order_qty,
          today_qty: it.today_qty,
          remark: it.remark,
        })
      );
      if (!rows.length) rows.push(EMPTY_ROW()); // 明细被清空时也要保留一行可编辑
      reportMeta.id = rep.id;
      renderRows();
      document.getElementById('repHint').textContent = `已载入 ${rep.report_date} ${rep.line} 的报表（再次保存将覆盖该日该线别数据）`;
      if (manual) toast('已载入已保存报表', 'success');
    } catch (e) {
      toast(e.message || '载入失败', 'error');
    }
  }

  /* ---------------- 订单号 datalist ---------------- */
  const dl = el('datalist', { id: 'orderNoList' });
  document.body.appendChild(dl);
  api
    .listOrders({})
    .then((list) => {
      const seen = new Set();
      list.forEach((o) => {
        if (o.order_no && !seen.has(o.order_no)) {
          seen.add(o.order_no);
          dl.appendChild(el('option', { value: o.order_no }));
        }
      });
    })
    .catch(() => {});

  /* ---------------- 初始化 ---------------- */
  addRow();
  await loadExisting();
  if (isGuest()) disableInputs();

  return () => {
    dl.remove();
    document.removeEventListener('scroll', hideAC, true);
    hideAC();
  };
}

export const meta = { title: '今日报表', key: 'today' };
