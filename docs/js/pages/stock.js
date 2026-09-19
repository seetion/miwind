/* ============================================================
   pages/stock.js —— 成品库存
   成品库存 = 生产数量（历史记录合计） + 其他入库 - 成品出库
   ============================================================ */

import * as api from '../api.js';
import { renderTable } from '../table.js';
import { el, num, fmtQty, toast, status, debounce } from '../util.js';

export async function render(view) {
  view.innerHTML = '';
  let rows = [];
  let keyword = '';

  const searchInput = el('input', { type: 'search', placeholder: '产品编号 / 产品名称' });
  const btnRefresh = el('button', { class: 'btn btn-sm', text: '↻ 刷新' });
  const btnExport = el('button', { class: 'btn btn-sm', text: '⤓ 导出 CSV' });
  const stat = el('span', { class: 'hint' });
  const tableHost = el('div');
  const kpiRow = el('div', { class: 'kpi-row' });

  const panel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('div', { class: 'title', text: '成品库存' }),
      el('div', { class: 'sub', text: '成品库存 = 生产数量 + 其他入库 − 成品出库（按产品编号 + 产品名称合计）' }),
      el('div', { class: 'tools' }, [stat, btnRefresh, btnExport]),
    ]),
    el('div', { class: 'toolbar' }, [el('div', { class: 'search' }, [searchInput]), el('span', { class: 'grow' }), el('span', { class: 'hint', text: '数据自动汇总自历史记录与入库/出库单据' })]),
    tableHost,
  ]);
  view.appendChild(kpiRow);
  view.appendChild(panel);

  function filtered() {
    const kw = keyword.toLowerCase();
    if (!kw) return rows;
    return rows.filter((r) => `${r.product_code} ${r.product_name} ${r.spec || ''}`.toLowerCase().includes(kw));
  }

  function renderRows() {
    const list = filtered();
    renderTable(tableHost, {
      key: 'stock',
      pageSize: 100,
      empty: '暂无库存数据，请先录入报表或入库/出库单据',
      rows: list,
      columns: [
        { key: 'product_code', title: '产品编号', width: 130 },
        { key: 'product_name', title: '产品名称', width: 220 },
        { key: 'spec', title: '规格型号', width: 160 },
        { key: 'unit', title: '单位', width: 66, align: 'center' },
        { key: 'produced', title: '生产数量', width: 110, align: 'right', render: (r) => fmtQty(r.produced) },
        { key: 'inbound', title: '其他入库', width: 110, align: 'right', render: (r) => fmtQty(r.inbound) },
        { key: 'outbound', title: '成品出库', width: 110, align: 'right', render: (r) => fmtQty(r.outbound) },
        {
          key: 'stock',
          title: '成品库存',
          width: 120,
          align: 'right',
          render: (r) =>
            `<b style="color:${num(r.stock) < 0 ? '#dc2626' : num(r.stock) > 0 ? '#15803d' : '#64748b'}">${fmtQty(r.stock)}</b>`,
        },
      ],
      footer: (rs) => [
        '合计',
        '',
        '',
        '',
        fmtQty(rs.reduce((s, x) => s + num(x.produced), 0)),
        fmtQty(rs.reduce((s, x) => s + num(x.inbound), 0)),
        fmtQty(rs.reduce((s, x) => s + num(x.outbound), 0)),
        fmtQty(rs.reduce((s, x) => s + num(x.stock), 0)),
      ],
      rowClass: (r) => (num(r.stock) < 0 ? 'row-danger' : num(r.stock) === 0 ? 'row-warn' : ''),
    });
  }

  function renderKpi(list) {
    const items = [
      ['库存品种', fmtQty(list.filter((x) => num(x.stock) !== 0).length), '种'],
      ['库存总量', fmtQty(list.reduce((s, x) => s + num(x.stock), 0)), '件'],
      ['累计生产', fmtQty(list.reduce((s, x) => s + num(x.produced), 0)), '件'],
      ['累计入库', fmtQty(list.reduce((s, x) => s + num(x.inbound), 0)), '件'],
      ['累计出库', fmtQty(list.reduce((s, x) => s + num(x.outbound), 0)), '件'],
      ['负库存预警', fmtQty(list.filter((x) => num(x.stock) < 0).length), '项'],
    ];
    kpiRow.innerHTML = '';
    items.forEach(([label, value, unit]) =>
      kpiRow.appendChild(
        el('div', { class: 'kpi' }, [
          el('div', { class: 'k-label', text: label }),
          el('div', { class: 'k-value', html: `${value}<span class="k-unit">${unit}</span>` }),
        ])
      )
    );
  }

  async function load() {
    status('汇总库存数据…');
    tableHost.innerHTML = '<div class="loading">正在汇总…</div>';
    try {
      rows = await api.getStock();
    } catch (e) {
      rows = [];
      toast(e.message || '加载失败', 'error');
    }
    stat.textContent = `共 ${rows.length} 项成品`;
    renderKpi(rows);
    renderRows();
    status('就绪');
  }

  searchInput.addEventListener('input', debounce(() => {
    keyword = searchInput.value.trim();
    renderRows();
  }, 250));
  btnRefresh.addEventListener('click', load);
  btnExport.addEventListener('click', () => api.exportDownload('stock'));

  await load();
}

export const meta = { title: '成品库存', key: 'stock' };
