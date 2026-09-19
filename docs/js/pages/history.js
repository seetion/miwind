/* ============================================================
   pages/history.js —— 历史记录
   ============================================================ */

import * as api from '../api.js';
import { renderTable } from '../table.js';
import { lineOptions, setting, withDeleteGuard, isGuest, guestBar } from '../store.js';
import { el, num, todayStr, addDays, toast, status, debounce, fmtQty } from '../util.js';
import { docElement, previewDoc } from '../print.js';

export async function render(view) {
  view.innerHTML = '';
  if (isGuest()) view.appendChild(guestBar());

  let filters = { from: addDays(todayStr(), -29), to: todayStr(), q: '', line: '' };
  let rows = [];

  const fromInput = el('input', { type: 'date', class: 'input-sm', value: filters.from });
  const toInput = el('input', { type: 'date', class: 'input-sm', value: filters.to });
  const lineSel = el('select', { class: 'input-sm', style: 'width:auto' }, [el('option', { value: '', text: '全部线别' })]);
  lineOptions().forEach((l) => lineSel.appendChild(el('option', { value: l, text: l })));
  const searchInput = el('input', { type: 'search', placeholder: '订单号 / 产品编号 / 名称' });

  const quickRanges = {
    今天: () => ({ from: todayStr(), to: todayStr() }),
    本周: () => {
      const wd = (new Date().getDay() + 6) % 7;
      return { from: addDays(todayStr(), -wd), to: addDays(todayStr(), 6 - wd) };
    },
    本月: () => ({ from: `${todayStr().slice(0, 7)}-01`, to: todayStr() }),
    近30天: () => ({ from: addDays(todayStr(), -29), to: todayStr() }),
  };
  const quickGroup = el('div', { class: 'btn-group' });
  Object.entries(quickRanges).forEach(([k, fn]) => {
    const b = el('button', { class: 'btn btn-sm', text: k });
    b.addEventListener('click', () => {
      const r = fn();
      fromInput.value = r.from;
      toInput.value = r.to;
      applyFilters();
    });
    quickGroup.appendChild(b);
  });

  const btnQuery = el('button', { class: 'btn btn-sm btn-primary', text: '查询' });
  const btnReset = el('button', { class: 'btn btn-sm', text: '重置' });
  const btnExport = el('button', { class: 'btn btn-sm', text: '⤓ 导出 CSV' });
  const btnPrint = el('button', { class: 'btn btn-sm', text: '🖨 打印 / PDF', title: '按当前筛选条件打印 A4 生产记录明细表' });
  const stat = el('span', { class: 'hint' });
  const tableHost = el('div');

  const panel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('div', { class: 'title', text: '历史记录' }),
      el('div', { class: 'sub', text: '数据来源：今日报表保存记录' }),
      el('div', { class: 'tools' }, [btnPrint, btnExport]),
    ]),
    el('div', { class: 'toolbar' }, [
      el('div', { class: 'inline-field' }, [el('label', { text: '日期' }), fromInput, el('span', { text: '~' }), toInput]),
      quickGroup,
      el('div', { class: 'inline-field' }, [el('label', { text: '线别' }), lineSel]),
      el('span', { class: 'sep' }),
      btnQuery,
      btnReset,
      el('span', { class: 'grow' }),
      stat,
    ]),
    el('div', { class: 'toolbar' }, [
      el('div', { class: 'search' }, [searchInput]),
      el('span', { class: 'hint', text: '删除记录需输入二级密码' }),
    ]),
    tableHost,
  ]);
  view.appendChild(panel);

  function makeDeleteBtn(row) {
    const b = el('button', { class: 'btn-link danger', text: '删除', title: '删除该条历史记录' });
    b.addEventListener('click', async () => {
      const done = await withDeleteGuard(async () => {
        await api.deleteHistoryItem(row.item_id);
      });
      if (done) {
        toast('已删除该条记录', 'success');
        load();
      }
    });
    return b;
  }

  function renderRows() {
    renderTable(tableHost, {
      key: 'history',
      pageSize: 100,
      empty: '所选条件暂无历史记录',
      rows,
      columns: [
        { key: 'report_date', title: '日期', width: 105 },
        { key: 'line', title: '线别', width: 70, align: 'center' },
        { key: 'order_no', title: '订单号', width: 125 },
        { key: 'product_code', title: '产品编号', width: 120 },
        { key: 'product_name', title: '产品名称', width: 200 },
        { key: 'spec', title: '规格型号', width: 150 },
        { key: 'unit', title: '单位', width: 62, align: 'center' },
        { key: 'order_qty', title: '订单数量', width: 95, align: 'right', render: (r) => fmtQty(r.order_qty) },
        { key: 'today_qty', title: '完成数量', width: 95, align: 'right', render: (r) => `<b>${fmtQty(r.today_qty)}</b>` },
        { key: 'attendance', title: '出勤人数', width: 88, align: 'right', render: (r) => fmtQty(r.attendance) },
        { key: 'remark', title: '备注', width: 160 },
        { key: 'ops', title: '操作', width: 84, align: 'center', render: (r) => makeDeleteBtn(r) },
      ],
      footer: (rs) => [
        '合计',
        '',
        '',
        '',
        '',
        '',
        '',
        fmtQty(rs.reduce((s, x) => s + num(x.order_qty), 0)),
        fmtQty(rs.reduce((s, x) => s + num(x.today_qty), 0)),
        '',
        '',
        `${rs.length} 条`,
      ],
    });
  }

  async function load() {
    status('查询历史记录…');
    tableHost.innerHTML = '<div class="loading">正在查询…</div>';
    try {
      rows = await api.listHistory(filters);
    } catch (e) {
      rows = [];
      toast(e.message || '查询失败', 'error');
    }
    const total = rows.reduce((s, r) => s + num(r.today_qty), 0);
    stat.textContent = `共 ${rows.length} 条，完成数量合计 ${fmtQty(total)}`;
    renderRows();
    status('就绪');
  }

  function applyFilters() {
    filters = { from: fromInput.value, to: toInput.value, q: searchInput.value.trim(), line: lineSel.value };
    load();
  }

  btnQuery.addEventListener('click', applyFilters);
  btnReset.addEventListener('click', () => {
    fromInput.value = addDays(todayStr(), -29);
    toInput.value = todayStr();
    lineSel.value = '';
    searchInput.value = '';
    applyFilters();
  });
  searchInput.addEventListener('input', debounce(() => {
    filters.q = searchInput.value.trim();
    load();
  }, 350));
  [fromInput, toInput, lineSel].forEach((n) => n.addEventListener('change', applyFilters));
  btnExport.addEventListener('click', () => api.exportDownload('history'));

  btnPrint.addEventListener('click', () => {
    if (!rows.length) return toast('当前筛选条件下没有可打印的记录', 'warn');
    const totalQty = rows.reduce((s, r) => s + num(r.today_qty), 0);
    const totalOrder = rows.reduce((s, r) => s + num(r.order_qty), 0);
    const node = docElement({
      title: '生产记录明细表',
      company: setting('company_name', '生产管理系统'),
      meta: [
        ['统计区间', `${filters.from || '不限'} ~ ${filters.to || '不限'}`],
        ['线别', filters.line || '全部'],
        ['关键字', filters.q || '无'],
        ['记录条数', `${rows.length} 条`],
        ['完成数量合计', fmtQty(totalQty)],
      ],
      columns: [
        { title: '日期', width: 64 },
        { title: '订单号', width: 82 },
        { title: '产品编号', width: 112 },
        { title: '产品名称', width: 108 },
        { title: '规格型号', width: 86 },
        { title: '单位', width: 38, align: 'center' },
        { title: '订单数量', width: 62, align: 'right' },
        { title: '完成数量', width: 62, align: 'right' },
        { title: '出勤人数', width: 54, align: 'right' },
        { title: '备注', width: 58 },
      ],
      rows: rows.map((r) => [
        r.report_date,
        r.order_no || '',
        r.product_code || '',
        r.product_name || '',
        r.spec || '',
        r.unit || '',
        fmtQty(r.order_qty),
        fmtQty(r.today_qty),
        fmtQty(r.attendance),
        r.remark || '',
      ]),
      footer: ['合计', '', '', '', '', '', fmtQty(totalOrder), fmtQty(totalQty), '', `${rows.length} 条`],
      signRows: ['制表人：________________', '审核：________________', '车间主管：________________', '日期：________________'],
    });
    previewDoc(node, '生产记录明细表 · A4 打印预览');
  });

  await load();
}

export const meta = { title: '历史记录', key: 'history' };
