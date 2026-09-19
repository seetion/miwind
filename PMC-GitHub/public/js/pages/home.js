/* ============================================================
   pages/home.js —— 首页：每日产量走势图
   ============================================================ */

import * as api from '../api.js';
import { renderTrendChart } from '../chart.js';
import { renderTable } from '../table.js';
import { el, fmtNum, num, todayStr, addDays, shortDate, status, toast, debounce } from '../util.js';

let mode = 'month';
let chartType = 'line';
let params = { year: new Date().getFullYear(), month: todayStr().slice(0, 7), weekBase: todayStr(), from: '', to: '' };

export async function render(view) {
  view.innerHTML = '';
  chartType = 'line';

  const chartHost = el('div');
  const rankHost = el('div');
  const recentHost = el('div');
  const rangeLabel = el('span', { class: 'sub' });

  const btnLine = el('button', { class: 'btn btn-sm active', text: '折线图' });
  const btnBar = el('button', { class: 'btn btn-sm', text: '柱状图' });
  btnLine.addEventListener('click', () => {
    chartType = 'line';
    btnLine.classList.add('active');
    btnBar.classList.remove('active');
    drawChart();
  });
  btnBar.addEventListener('click', () => {
    chartType = 'bar';
    btnBar.classList.add('active');
    btnLine.classList.remove('active');
    drawChart();
  });

  /* ---------------- 条件区 ---------------- */
  const modeBtns = {};
  const modeGroup = el('div', { class: 'btn-group' });
  [
    ['year', '年'],
    ['month', '月'],
    ['week', '周'],
    ['custom', '自定义'],
  ].forEach(([k, label]) => {
    const b = el('button', { class: `btn btn-sm ${mode === k ? 'active' : ''}`, text: label });
    b.addEventListener('click', () => {
      mode = k;
      Object.entries(modeBtns).forEach(([kk, bb]) => bb.classList.toggle('active', kk === k));
      syncInputs();
      load();
    });
    modeBtns[k] = b;
    modeGroup.appendChild(b);
  });

  const yearSelect = el('select', { class: 'input-sm', style: 'width:auto' });
  const monthInput = el('input', { type: 'month', class: 'input-sm', style: 'width:130px' });
  const weekInput = el('input', { type: 'date', class: 'input-sm', style: 'width:140px' });
  const fromInput = el('input', { type: 'date', class: 'input-sm', style: 'width:140px' });
  const toInput = el('input', { type: 'date', class: 'input-sm', style: 'width:140px' });
  const condBox = el('div', { class: 'form-row' });

  [yearSelect, monthInput, weekInput, fromInput, toInput].forEach((n) => {
    n.addEventListener('change', () => {
      if (n === yearSelect) params.year = Number(yearSelect.value);
      if (n === monthInput) params.month = monthInput.value;
      if (n === weekInput) params.weekBase = weekInput.value;
      if (n === fromInput) params.from = fromInput.value;
      if (n === toInput) params.to = toInput.value;
      if (mode === 'custom' && params.from && params.to) load();
      else if (mode !== 'custom') load();
    });
  });

  const btnRefresh = el('button', { class: 'btn btn-sm', text: '↻ 刷新' });
  btnRefresh.addEventListener('click', () => load());

  const panel = el('div', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [
      el('div', { class: 'title', text: '每日产量走势图' }),
      rangeLabel,
      el('div', { class: 'tools' }, [modeGroup, condBox, el('span', { class: 'sep' }), btnLine, btnBar, btnRefresh]),
    ]),
    chartHost,
  ]);
  view.appendChild(panel);

  const kpiRow = el('div', { class: 'kpi-row' });
  view.appendChild(kpiRow);

  view.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '区段产品产量排行（Top 10）' })]),
      rankHost,
    ])
  );

  view.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '最近报表' })]),
      recentHost,
    ])
  );

  /* ---------------- 输入同步 ---------------- */
  function syncInputs() {
    condBox.innerHTML = '';
    const label = (t, node) => condBox.appendChild(el('div', { class: 'inline-field' }, [el('label', { text: t }), node]));
    if (mode === 'year') label('年份', yearSelect);
    else if (mode === 'month') label('月份', monthInput);
    else if (mode === 'week') label('选择周内任意日期', weekInput);
    else {
      label('开始', fromInput);
      label('结束', toInput);
    }
  }

  async function loadYears() {
    try {
      const reps = await api.listReports();
      const years = [...new Set(reps.map((r) => String(r.report_date).slice(0, 4)))].sort();
      if (!years.includes(String(params.year))) years.push(String(params.year));
      yearSelect.innerHTML = '';
      years.sort().forEach((y) => yearSelect.appendChild(el('option', { value: y, text: `${y} 年` })));
      yearSelect.value = String(params.year);
    } catch (e) {
      yearSelect.innerHTML = `<option value="${params.year}">${params.year} 年</option>`;
    }
  }

  /* ---------------- 计算区间 ---------------- */
  function resolveRange() {
    if (mode === 'year') {
      const y = params.year;
      return { from: `${y}-01-01`, to: `${y}-12-31`, bucket: 'month', title: `${y} 年` };
    }
    if (mode === 'month') {
      const m = params.month || todayStr().slice(0, 7);
      const [y, mm] = m.split('-').map(Number);
      const lastDay = new Date(y, mm, 0).getDate();
      return { from: `${m}-01`, to: `${m}-${String(lastDay).padStart(2, '0')}`, bucket: 'day', title: `${y} 年 ${mm} 月` };
    }
    if (mode === 'week') {
      const base = params.weekBase || todayStr();
      const d = new Date(base);
      const wd = (d.getDay() + 6) % 7;
      const start = addDays(base, -wd);
      const end = addDays(start, 6);
      return { from: start, to: end, bucket: 'day', title: `${shortDate(start)} ~ ${shortDate(end)}` };
    }
    const from = params.from || addDays(todayStr(), -29);
    const to = params.to || todayStr();
    return { from, to, bucket: from.slice(0, 7) === to.slice(0, 7) ? 'day' : 'day', title: `${from} ~ ${to}` };
  }

  /* ---------------- 数据聚合 ---------------- */
  let cacheRows = [];
  let cacheRange = null;

  function aggregate() {
    const { bucket, from, to } = cacheRange;
    const map = new Map();
    if (bucket === 'month') {
      for (let m = 1; m <= 12; m++) map.set(`${cacheRange.from.slice(0, 4)}-${String(m).padStart(2, '0')}`, 0);
      cacheRows.forEach((r) => {
        const k = String(r.report_date).slice(0, 7);
        if (map.has(k)) map.set(k, map.get(k) + num(r.today_qty));
      });
      return {
        labels: [...map.keys()].map((k) => `${Number(k.slice(5, 7))}月`),
        values: [...map.values()],
      };
    }
    // 按天补齐（区间过大会生成过多点，改为仅出现过的日期）
    const days = [];
    let cur = from;
    let guard = 0;
    while (cur <= to && guard++ < 400) {
      days.push(cur);
      cur = addDays(cur, 1);
    }
    const dayMap = new Map(days.map((d) => [d, 0]));
    cacheRows.forEach((r) => {
      const k = String(r.report_date);
      if (dayMap.has(k)) dayMap.set(k, dayMap.get(k) + num(r.today_qty));
      else dayMap.set(k, num(r.today_qty));
    });
    const keys = [...dayMap.keys()].sort();
    return {
      labels: keys.map((k) => shortDate(k)),
      rawKeys: keys,
      values: keys.map((k) => dayMap.get(k)),
    };
  }

  function drawChart() {
    const agg = aggregate();
    renderTrendChart(chartHost, {
      labels: agg.labels,
      values: agg.values,
      unit: '件',
      type: chartType,
      height: 330,
    });
  }

  function renderRank() {
    const prodMap = new Map();
    cacheRows.forEach((r) => {
      const k = `${r.product_code}||${r.product_name}`;
      const cur = prodMap.get(k) || { product_code: r.product_code, product_name: r.product_name, spec: r.spec, unit: r.unit, qty: 0, orders: new Set() };
      cur.qty += num(r.today_qty);
      if (r.order_no) cur.orders.add(r.order_no);
      prodMap.set(k, cur);
    });
    const list = [...prodMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 10);
    renderTable(rankHost, {
      key: 'home-rank',
      pageSize: 0,
      empty: '所选区间暂无数据',
      columns: [
        { key: 'idx', title: '排名', width: 62, align: 'center', render: (r, i) => i + 1 },
        { key: 'product_code', title: '产品编号', width: 130 },
        { key: 'product_name', title: '产品名称', width: 220 },
        { key: 'spec', title: '规格型号', width: 150 },
        { key: 'unit', title: '单位', width: 70, align: 'center' },
        { key: 'qty', title: '产量', width: 110, align: 'right', render: (r) => fmtNum(r.qty, 0) },
        { key: 'orders', title: '涉及订单数', width: 100, align: 'right', render: (r) => r.orders.size },
      ],
      rows: list,
      footer: (rs) => ['合计', '', '', '', '', fmtNum(rs.reduce((s, x) => s + x.qty, 0), 0), ''],
    });
  }

  async function loadKpi() {
    try {
      const ov = await api.getOverview();
      const items = [
        ['累计总产量', fmtNum(ov.total_output, 0), '件'],
        ['报表天数', fmtNum(ov.days, 0), '天'],
        ['成品库存合计', fmtNum(ov.stock_total, 0), '件'],
        ['物品档案', fmtNum(ov.products, 0), '项'],
        ['在制订单', fmtNum((ov.orders['开工'] || 0) + (ov.orders['追加'] || 0), 0), '单'],
        ['已完工订单', fmtNum(ov.orders['完工'] || 0, 0), '单'],
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
    } catch (e) {
      /* ignore */
    }
  }

  async function loadRecent() {
    try {
      const reps = (await api.listReports()).slice(0, 8);
      const rows = [];
      for (const rep of reps) {
        const items = await api.getReportByDate(rep.report_date, rep.line);
        const total = (items?.items || []).reduce((s, x) => s + num(x.today_qty), 0);
        rows.push({ ...rep, total });
      }
      renderTable(recentHost, {
        key: 'home-recent',
        pageSize: 0,
        empty: '暂无报表记录',
        columns: [
          { key: 'report_date', title: '日期', width: 110 },
          { key: 'line', title: '线别', width: 80, align: 'center' },
          { key: 'attendance', title: '出勤人数', width: 90, align: 'right' },
          { key: 'work_hours', title: '出勤时间', width: 90, align: 'right' },
          { key: 'total', title: '总产量', width: 100, align: 'right', render: (r) => fmtNum(r.total, 0) },
          { key: 'upph', title: 'UPPH', width: 90, align: 'right', render: (r) => (num(r.attendance) * num(r.work_hours) ? fmtNum(r.total / (num(r.attendance) * num(r.work_hours)), 2) : '0.00') },
          { key: 'created_by', title: '录入人', width: 90 },
          { key: 'updated_at', title: '更新时间', width: 160 },
        ],
        rows,
      });
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------------- 主加载 ---------------- */
  async function load() {
    cacheRange = resolveRange();
    rangeLabel.textContent = cacheRange.title;
    chartHost.innerHTML = '<div class="loading">正在加载产量数据…</div>';
    status('加载产量走势数据…');
    try {
      cacheRows = await api.listHistory({ from: cacheRange.from, to: cacheRange.to });
    } catch (e) {
      cacheRows = [];
      toast(e.message || '加载失败', 'error');
    }
    drawChart();
    renderRank();
    const total = cacheRows.reduce((s, r) => s + num(r.today_qty), 0);
    rangeLabel.textContent = `${cacheRange.title}　合计 ${fmtNum(total, 0)} 件　${cacheRows.length} 条记录`;
    status('就绪');
  }

  /* ---------------- 初始化 ---------------- */
  if (!params.from) {
    params.from = addDays(todayStr(), -29);
    params.to = todayStr();
    fromInput.value = params.from;
    toInput.value = params.to;
  }
  monthInput.value = params.month;
  weekInput.value = params.weekBase;
  await loadYears();
  syncInputs();
  await Promise.all([load(), loadKpi(), loadRecent()]);
}

export const meta = { title: '首页', key: 'home' };
