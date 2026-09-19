/* ============================================================
   chart.js —— 轻量 SVG 走势图（无外部依赖）
   ============================================================ */

import { el, fmtNum, num } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) n.setAttribute(k, v);
  return n;
};

function niceMax(max) {
  if (max <= 0) return 10;
  const exp = Math.floor(Math.log10(max));
  const base = Math.pow(10, exp);
  const n = max / base;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * base;
}

/**
 * @param {HTMLElement} container 容器（需有 position: relative 的父级用于 tooltip）
 * @param {object} opt { labels:[], values:[], unit, type: 'line'|'bar', height, compareValues, compareLabel }
 */
export function renderTrendChart(container, opt = {}) {
  const labels = opt.labels || [];
  const values = (opt.values || []).map(num);
  const compare = opt.compareValues ? opt.compareValues.map(num) : null;
  const unit = opt.unit || '件';
  const type = opt.type || 'line';
  const height = opt.height || 320;

  container.innerHTML = '';
  const box = el('div', { class: 'chart-box' });
  const plot = el('div', { class: 'chart-plot' });
  const tip = el('div', { class: 'chart-tip' });
  box.appendChild(plot);
  box.appendChild(tip);
  container.appendChild(box);

  if (!labels.length) {
    plot.appendChild(el('div', { class: 'empty', html: '<span class="big">📈</span>所选区间暂无产量数据' }));
    return;
  }

  let lastWidth = 0;
  const draw = () => {
    plot.innerHTML = '';
    const width = Math.max(360, plot.clientWidth || container.clientWidth || 800);
    lastWidth = width;
    const pad = { l: 58, r: 20, t: 18, b: 40 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;

    const allVals = compare ? values.concat(compare) : values;
    const maxV = niceMax(Math.max(1, ...allVals));
    const n = labels.length;
    const xAt = (i) => pad.l + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
    const yAt = (v) => pad.t + plotH - (Math.max(0, v) / maxV) * plotH;

    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, style: `height:${height}px` });

    // 背景
    svg.appendChild(svgEl('rect', { x: pad.l, y: pad.t, width: plotW, height: plotH, fill: '#fbfdff', stroke: '#e6ebf3' }));

    // Y 轴网格
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const v = (maxV / ticks) * i;
      const y = yAt(v);
      svg.appendChild(svgEl('line', { x1: pad.l, x2: pad.l + plotW, y1: y, y2: y, stroke: i === 0 ? '#c9d6e8' : '#eef2f8', 'stroke-width': 1 }));
      const t = svgEl('text', { x: pad.l - 8, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#8b98ab', 'font-family': 'Consolas, monospace' });
      t.textContent = fmtNum(v, v >= 1000 ? 0 : v % 1 === 0 ? 0 : 1);
      svg.appendChild(t);
    }
    // 轴标题
    const yTitle = svgEl('text', { x: pad.l - 8, y: pad.t - 6, 'text-anchor': 'end', 'font-size': 11, fill: '#8b98ab' });
    yTitle.textContent = `单位：${unit}`;
    svg.appendChild(yTitle);

    // X 轴标签
    const stepX = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(plotW / 62))));
    labels.forEach((lb, i) => {
      if (i % stepX !== 0 && i !== n - 1) return;
      const t = svgEl('text', {
        x: xAt(i), y: height - 16, 'text-anchor': 'middle', 'font-size': 11, fill: '#5b6b82',
      });
      t.textContent = lb;
      svg.appendChild(t);
    });

    if (type === 'bar') {
      const bw = Math.max(3, Math.min(40, (plotW / n) * 0.62));
      values.forEach((v, i) => {
        const x = (n === 1 ? pad.l + plotW / 2 : pad.l + (plotW * i) / (n - 1)) - bw / 2;
        const h = Math.max(0, plotH - (yAt(v) - pad.t));
        svg.appendChild(
          svgEl('rect', { x, y: yAt(v), width: bw, height: h, rx: 2, fill: 'url(#barGrad)', class: 'bar', 'data-i': i })
        );
      });
    } else {
      // 渐变定义
      const defs = svgEl('defs');
      const grad = svgEl('linearGradient', { id: 'areaGrad', x1: 0, y1: 0, x2: 0, y2: 1 });
      grad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#1f6feb', 'stop-opacity': .28 }));
      grad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#1f6feb', 'stop-opacity': .02 }));
      defs.appendChild(grad);
      const bgrad = svgEl('linearGradient', { id: 'barGrad', x1: 0, y1: 0, x2: 0, y2: 1 });
      bgrad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#4a90f5' }));
      bgrad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#9dc0f7' }));
      defs.appendChild(bgrad);
      svg.appendChild(defs);

      const pts = values.map((v, i) => [xAt(i), yAt(v)]);
      const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${pad.t + plotH} L${pts[0][0].toFixed(1)},${pad.t + plotH} Z`;
      svg.appendChild(svgEl('path', { d: area, fill: 'url(#areaGrad)' }));
      svg.appendChild(svgEl('path', { d: line, fill: 'none', stroke: '#1f6feb', 'stroke-width': 2, 'stroke-linejoin': 'round' }));

      if (compare) {
        const cp = compare.map((v, i) => [xAt(i), yAt(v)]);
        const cline = cp.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
        svg.appendChild(svgEl('path', { d: cline, fill: 'none', stroke: '#94a3b8', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }));
      }

      if (n <= 60) {
        pts.forEach((p, i) => {
          svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 3, fill: '#fff', stroke: '#1f6feb', 'stroke-width': 2, class: 'dot', 'data-i': i }));
        });
      }
    }

    // 悬停辅助线
    const guide = svgEl('line', { x1: 0, x2: 0, y1: pad.t, y2: pad.t + plotH, stroke: '#1f6feb', 'stroke-dasharray': '3 3', opacity: 0 });
    svg.appendChild(guide);
    plot.appendChild(svg);

    // 交互
    const hit = svgEl('rect', { x: pad.l, y: pad.t, width: plotW, height: plotH, fill: 'transparent', style: 'cursor:crosshair' });
    svg.appendChild(hit);

    const showTip = (i) => {
      const x = xAt(i);
      const y = yAt(values[i]);
      guide.setAttribute('x1', x);
      guide.setAttribute('x2', x);
      guide.setAttribute('opacity', 0.85);
      const delta = i > 0 ? values[i] - values[i - 1] : 0;
      tip.innerHTML =
        `<b>${labels[i]}</b><br/>产量：<b>${fmtNum(values[i], 0)}</b> ${unit}` +
        (i > 0 ? `<br/>环比：<b style="color:${delta >= 0 ? '#7ee2a8' : '#ff9a9a'}">${delta >= 0 ? '+' : ''}${fmtNum(delta, 0)}</b>` : '') +
        (compare ? `<br/>${opt.compareLabel || '对比'}：<b>${fmtNum(compare[i], 0)}</b>` : '');
      tip.style.display = 'block';
      const tw = tip.offsetWidth;
      const bx = box.getBoundingClientRect();
      let left = x + 14;
      if (left + tw > bx.width) left = x - tw - 14;
      tip.style.left = `${Math.max(4, left)}px`;
      tip.style.top = `${Math.max(4, y - 10)}px`;
    };

    const hideTip = () => {
      tip.style.display = 'none';
      guide.setAttribute('opacity', 0);
    };

    hit.addEventListener('mousemove', (e) => {
      const rect = svg.getBoundingClientRect();
      const scale = width / rect.width;
      const mx = (e.clientX - rect.left) * scale;
      const ratio = n === 1 ? 0 : (mx - pad.l) / plotW;
      const i = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
      showTip(i);
    });
    hit.addEventListener('mouseleave', hideTip);

    // 折线模式才需要渐变（bar 模式补一个）
    if (type === 'bar' && !svg.querySelector('#barGrad')) {
      const defs = svgEl('defs');
      const bgrad = svgEl('linearGradient', { id: 'barGrad', x1: 0, y1: 0, x2: 0, y2: 1 });
      bgrad.appendChild(svgEl('stop', { offset: '0%', 'stop-color': '#4a90f5' }));
      bgrad.appendChild(svgEl('stop', { offset: '100%', 'stop-color': '#9dc0f7' }));
      defs.appendChild(bgrad);
      svg.insertBefore(defs, svg.firstChild);
    }
  };

  draw();
  let timer = null;
  const ro = new ResizeObserver(() => {
    const w = plot.clientWidth || container.clientWidth;
    if (!w || Math.abs(w - lastWidth) < 2) return;
    clearTimeout(timer);
    timer = setTimeout(draw, 120);
  });
  ro.observe(container);
}
