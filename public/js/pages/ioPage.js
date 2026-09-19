/* ============================================================
   pages/ioPage.js —— 其他入库 / 成品出库 通用页面
   ============================================================ */

import * as api from '../api.js';
import { renderTable } from '../table.js';
import { findProduct, guestBar, isGuest, loadProducts, requireLogin, state, withDeleteGuard } from '../store.js';
import { dialog, el, fmtQty, num, todayStr, toast, status, debounce, addDays, escapeHtml } from '../util.js';

/**
 * @param {HTMLElement} view 容器
 * @param {'inbound'|'outbound'} kind 单据类型
 */
export async function createIOPage(view, kind) {
  const isIn = kind === 'inbound';
  const T = {
    title: isIn ? '其他入库' : '成品出库',
    dateField: isIn ? 'in_date' : 'out_date',
    dateLabel: isIn ? '入库日期' : '出库日期',
    qtyLabel: isIn ? '入库数量' : '出库数量',
    summaryLabel: isIn ? '入库摘要' : '出库摘要',
    api: isIn ? api.listInbound : api.listOutbound,
    create: isIn ? api.createInbound : api.createOutbound,
    update: isIn ? api.updateInbound : api.updateOutbound,
    remove: isIn ? api.deleteInbound : api.deleteOutbound,
    desc: isIn ? '入库会增加到成品库存' : '出库会从成品库存中扣减',
  };

  await loadProducts();
  view.innerHTML = '';
  if (isGuest()) view.appendChild(guestBar('游客模式：可查看单据，无法新增 / 修改 / 删除。'));

  let rows = [];
  let filters = { from: addDays(todayStr(), -60), to: todayStr(), q: '' };

  const fromInput = el('input', { type: 'date', class: 'input-sm', value: filters.from });
  const toInput = el('input', { type: 'date', class: 'input-sm', value: filters.to });
  const searchInput = el('input', { type: 'search', placeholder: '产品编号 / 名称 / 摘要' });
  const btnNew = el('button', { class: 'btn btn-sm btn-primary', text: `＋ 新增${isIn ? '入库' : '出库'}单` });
  const btnExport = el('button', { class: 'btn btn-sm', text: '⤓ 导出 CSV' });
  const btnRefresh = el('button', { class: 'btn btn-sm', text: '↻ 刷新' });
  const stat = el('span', { class: 'hint' });
  const tableHost = el('div');

  const panel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('div', { class: 'title', text: `${T.title}记录` }),
      el('div', { class: 'sub', text: T.desc }),
      el('div', { class: 'tools' }, [stat, btnRefresh, btnExport, btnNew]),
    ]),
    el('div', { class: 'toolbar' }, [
      el('div', { class: 'inline-field' }, [el('label', { text: '日期' }), fromInput, el('span', { text: '~' }), toInput]),
      el('span', { class: 'sep' }),
      el('div', { class: 'search' }, [searchInput]),
      el('span', { class: 'grow' }),
      el('span', { class: 'hint', text: '删除需输入二级密码' }),
    ]),
    tableHost,
  ]);
  view.appendChild(panel);

  /* ---------------- 表单弹窗 ---------------- */
  function openForm(row) {
    if (!requireLogin(`${isIn ? '入库' : '出库'}录入`)) return;
    const data = row
      ? { ...row }
      : { [T.dateField]: todayStr(), product_code: '', product_name: '', spec: '', qty: '', summary: '', remark: '' };

    const dateInput = el('input', { type: 'date', value: data[T.dateField] });
    const codeInput = el('input', { value: data.product_code, placeholder: '输入编号自动带出' });
    const nameInput = el('input', { value: data.product_name });
    const specInput = el('input', { value: data.spec });
    const qtyInput = el('input', { type: 'number', step: 'any', value: data.qty });
    const summaryInput = el('input', { value: data.summary, placeholder: isIn ? '如：客退返修入库' : '如：客户发货' });
    const remarkInput = el('input', { value: data.remark });

    const body = el('div', {}, [
      el('div', { class: 'form-grid' }, [
        fieldWrap(T.dateLabel, dateInput),
        fieldWrap('产品编号', codeInput),
        fieldWrap('产品名称', nameInput),
        fieldWrap('规格型号', specInput),
        fieldWrap(T.qtyLabel, qtyInput),
        fieldWrap(T.summaryLabel, summaryInput),
      ]),
      el('div', { class: 'field' }, [el('label', { text: '备注' }), remarkInput]),
      el('div', { class: 'hint', text: '提示：产品编号可从基础物品信息自动带出名称与规格' }),
    ]);

    codeInput.setAttribute('list', 'ioProductList');
    codeInput.addEventListener('change', () => {
      const p = findProduct(codeInput.value);
      if (p) {
        nameInput.value = p.name || nameInput.value;
        specInput.value = p.spec || specInput.value;
      }
    });

    return dialog({
      title: row ? `修改${T.title}记录` : `新增${T.title}记录`,
      body,
      okText: '保存',
      onOk: async () => {
        const payload = {
          [T.dateField]: dateInput.value || todayStr(),
          product_code: codeInput.value.trim(),
          product_name: nameInput.value.trim(),
          spec: specInput.value.trim(),
          qty: num(qtyInput.value),
          summary: summaryInput.value.trim(),
          remark: remarkInput.value.trim(),
        };
        if (!payload.product_code && !payload.product_name) {
          toast('请填写产品编号或产品名称', 'warn');
          return false;
        }
        if (row) await T.update(row.id, payload);
        else await T.create(payload);
        await loadProducts(true);
        toast('保存成功', 'success');
        load();
      },
    });
  }

  function fieldWrap(label, input) {
    input.classList.add('input-sm');
    return el('div', { class: 'field', style: 'margin-bottom:8px' }, [el('label', { text: label }), input]);
  }

  /* ---------------- 表格 ---------------- */
  function renderRows() {
    renderTable(tableHost, {
      key: kind,
      pageSize: 100,
      empty: `暂无${T.title}记录`,
      rows,
      columns: [
        { key: T.dateField, title: T.dateLabel, width: 110 },
        { key: 'product_code', title: '产品编号', width: 130 },
        { key: 'product_name', title: '产品名称', width: 200 },
        { key: 'spec', title: '规格型号', width: 150 },
        { key: 'qty', title: T.qtyLabel, width: 105, align: 'right', render: (r) => `<b>${fmtQty(r.qty)}</b>` },
        { key: 'summary', title: T.summaryLabel, width: 170 },
        { key: 'remark', title: '备注', width: 160 },
        { key: 'created_at', title: '创建时间', width: 150 },
        {
          key: 'ops',
          title: '操作',
          width: 106,
          align: 'center',
          render: (r) => {
            const wrap = el('span');
            const bEdit = el('button', { class: 'btn-link', text: '修改' });
            bEdit.addEventListener('click', () => openForm(r));
            const bDel = el('button', { class: 'btn-link danger', text: '删除' });
            bDel.addEventListener('click', async () => {
              const detail = `${r[T.dateField]}　${r.product_code}　${r.product_name}　${T.qtyLabel} ${r.qty}${r.summary ? '　（' + r.summary + '）' : ''}`;
              const done = await withDeleteGuard(detail, async () => T.remove(r.id));
              if (done) {
                toast(`已删除${T.title}记录：${r.product_name || r.product_code}`, 'success');
                load();
              }
            });
            wrap.appendChild(bEdit);
            wrap.appendChild(bDel);
            return wrap;
          },
        },
      ],
      footer: (rs) => ['合计', '', '', '', fmtQty(rs.reduce((s, x) => s + num(x.qty), 0)), '', '', '', `${rs.length} 条`],
    });
  }

  async function load() {
    status(`加载${T.title}记录…`);
    tableHost.innerHTML = '<div class="loading">正在加载…</div>';
    try {
      rows = await T.api(filters);
    } catch (e) {
      rows = [];
      toast(e.message || '加载失败', 'error');
    }
    stat.textContent = `共 ${rows.length} 条｜数量合计 ${fmtQty(rows.reduce((s, x) => s + num(x.qty), 0))}`;
    renderRows();
    status('就绪');
  }

  btnNew.addEventListener('click', () => openForm(null));
  btnRefresh.addEventListener('click', load);
  btnExport.addEventListener('click', () => api.exportDownload(kind));
  searchInput.addEventListener('input', debounce(() => {
    filters.q = searchInput.value.trim();
    load();
  }, 330));
  [fromInput, toInput].forEach((n) =>
    n.addEventListener('change', () => {
      filters.from = fromInput.value;
      filters.to = toInput.value;
      load();
    })
  );

  // 产品编号 datalist
  const dl = el('datalist', { id: 'ioProductList' });
  state.products.forEach((p) => dl.appendChild(el('option', { value: p.code, label: `${p.name || ''} ${p.spec || ''}` })));
  document.body.appendChild(dl);

  await load();

  return () => dl.remove();
}
