/* ============================================================
   pages/progress.js —— 生产进度
   ============================================================ */

import * as api from '../api.js';
import { progressBar, renderTable } from '../table.js';
import { guestBar, isGuest, requireLogin, withDeleteGuard } from '../store.js';
import { el, num, fmtQty, toast, status, debounce } from '../util.js';

const STATUSES = ['下达', '开工', '完工', '结单', '追加'];
const STATUS_DESC = {
  下达: '订单已下达，尚未开工',
  开工: '已开工，正在生产',
  完工: '完成数量已达订单数量',
  结单: '订单已结案',
  追加: '订单数量已追加',
};

export async function render(view) {
  view.innerHTML = '';
  if (isGuest()) view.appendChild(guestBar('游客模式：可查看生产进度，无法修改订单状态。'));

  let rows = [];
  let filter = { q: '', status: '' };

  const searchInput = el('input', { type: 'search', placeholder: '订单号 / 产品编号 / 名称' });
  const stat = el('span', { class: 'hint' });
  const btnExport = el('button', { class: 'btn btn-sm', text: '⤓ 导出 CSV' });
  const btnRefresh = el('button', { class: 'btn btn-sm', text: '↻ 刷新' });

  const tabs = el('div', { class: 'toolbar' });
  ['全部', ...STATUSES].forEach((s) => {
    const b = el('button', { class: `btn btn-sm ${s === '全部' ? 'active' : ''}`, text: s });
    b.addEventListener('click', () => {
      filter.status = s === '全部' ? '' : s;
      Array.from(tabs.querySelectorAll('.btn')).forEach((x) => x.classList.toggle('active', x === b));
      load();
    });
    tabs.appendChild(b);
  });
  tabs.appendChild(el('span', { class: 'grow' }));
  tabs.appendChild(el('span', { class: 'hint', text: '状态说明：' + STATUSES.map((s) => `${s}（${STATUS_DESC[s]}）`).join('；') }));

  const tableHost = el('div');

  const panel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('div', { class: 'title', text: '生产进度' }),
      el('div', { class: 'sub', text: '首次录入单据时自动生成，完成数量随报表同步累计' }),
      el('div', { class: 'tools' }, [stat, btnRefresh, btnExport]),
    ]),
    tabs,
    el('div', { class: 'toolbar' }, [el('div', { class: 'search' }, [searchInput]), el('span', { class: 'hint', text: '可手动调整订单状态（结单 / 追加 为人工状态，不会被自动覆盖）' })]),
    tableHost,
  ]);
  view.appendChild(panel);

  function statusSelect(row) {
    const sel = el('select', { class: 'input-sm', style: `width:auto;color:${statusColor(row.status)};font-weight:700` });
    STATUSES.forEach((s) => sel.appendChild(el('option', { value: s, text: s })));
    sel.value = row.status;
    sel.addEventListener('change', async () => {
      if (!requireLogin('修改订单状态')) {
        sel.value = row.status;
        return;
      }
      try {
        await api.updateOrder(row.id, { status: sel.value });
        row.status = sel.value;
        sel.style.color = statusColor(sel.value);
        toast(`订单 ${row.order_no} 状态已更新为「${sel.value}」`, 'success');
        load();
      } catch (e) {
        toast(e.message || '更新失败', 'error');
        sel.value = row.status;
      }
    });
    return sel;
  }

  function statusColor(s) {
    return { 下达: '#d9a400', 开工: '#1f6feb', 完工: '#16a34a', 结单: '#135c2b', 追加: '#7c3aed' }[s] || '#1f2937';
  }

  function renderRows() {
    renderTable(tableHost, {
      key: 'progress',
      pageSize: 100,
      empty: '暂无生产订单，请先在「今日报表」录入数据',
      rows,
      columns: [
        { key: 'order_no', title: '订单号', width: 125 },
        { key: 'product_code', title: '产品编号', width: 120 },
        { key: 'product_name', title: '产品名称', width: 190 },
        { key: 'spec', title: '规格型号', width: 140 },
        { key: 'unit', title: '单位', width: 60, align: 'center' },
        { key: 'order_qty', title: '订单数量', width: 95, align: 'right', render: (r) => fmtQty(r.order_qty) },
        { key: 'done_qty', title: '完成数量', width: 95, align: 'right', render: (r) => `<b>${fmtQty(r.done_qty)}</b>` },
        { key: 'progress', title: '进度', width: 130, render: (r) => progressBar(r.done_qty, r.order_qty) },
        {
          key: 'status',
          title: '订单状态',
          width: 120,
          align: 'center',
          render: (r) =>
            isGuest()
              ? `<span class="st-${r.status}">${r.status}</span>`
              : statusSelect(r),
        },
        { key: 'first_date', title: '开始日期', width: 105 },
        { key: 'last_date', title: '最近日期', width: 105 },
        {
          key: 'ops',
          title: '操作',
          width: 76,
          align: 'center',
          render: (r) => {
            const b = el('button', { class: 'btn-link danger', text: '删除' });
            b.addEventListener('click', async () => {
              const done = await withDeleteGuard(async () => api.deleteOrder(r.id));
              if (done) {
                toast('已删除该订单进度记录', 'success');
                load();
              }
            });
            return b;
          },
        },
      ],
      footer: (rs) => [
        '合计',
        '',
        '',
        '',
        '',
        fmtQty(rs.reduce((s, x) => s + num(x.order_qty), 0)),
        fmtQty(rs.reduce((s, x) => s + num(x.done_qty), 0)),
        '',
        '',
        '',
        '',
        `${rs.length} 单`,
      ],
    });
  }

  async function load() {
    status('加载生产进度…');
    tableHost.innerHTML = '<div class="loading">正在加载…</div>';
    try {
      rows = await api.listOrders(filter);
    } catch (e) {
      rows = [];
      toast(e.message || '加载失败', 'error');
    }
    const doing = rows.filter((r) => r.status === '开工').length;
    const done = rows.filter((r) => r.status === '完工' || r.status === '结单').length;
    stat.textContent = `共 ${rows.length} 单｜开工 ${doing}｜完工/结单 ${done}`;
    renderRows();
    status('就绪');
  }

  searchInput.addEventListener('input', debounce(() => {
    filter.q = searchInput.value.trim();
    load();
  }, 320));
  btnRefresh.addEventListener('click', load);
  btnExport.addEventListener('click', () => api.exportDownload('orders'));

  await load();
}

export const meta = { title: '生产进度', key: 'progress' };
