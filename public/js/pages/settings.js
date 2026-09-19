/* ============================================================
   pages/settings.js —— 系统配置
   ============================================================ */

import * as api from '../api.js';
import { renderTable } from '../table.js';
import { deleteGuard } from '../api.js';
import {
  guestBar,
  isGuest,
  loadProducts,
  loadSettings,
  refreshUserUI,
  requireLogin,
  state,
  setRowPadding,
  setting,
  withDeleteGuard,
} from '../store.js';
import {
  dialog,
  downloadText,
  el,
  escapeHtml,
  loadLocal,
  num,
  parseCSV,
  pickFile,
  saveLocal,
  toast,
  status,
} from '../util.js';

const TABLES = [
  ['history', '历史记录'],
  ['reports', '今日报表'],
  ['orders', '生产进度'],
  ['stock', '成品库存'],
  ['inbound', '其他入库'],
  ['outbound', '成品出库'],
  ['products', '基础物品信息'],
];

export async function render(view) {
  view.innerHTML = '';
  if (isGuest()) view.appendChild(guestBar('游客模式：可查看配置，但无法修改或录入基础数据。'));

  const tabsBar = el('div', { class: 'tabs' });
  const body = el('div');
  const sections = {};
  const tabDefs = [
    ['items', '基础物品信息'],
    ['data', '数据导出与备份'],
    ['auth', '账号与安全'],
    ['ui', '外观与显示'],
  ];
  tabDefs.forEach(([k, label], i) => {
    const t = el('div', { class: `tab ${i === 0 ? 'active' : ''}`, text: label });
    t.addEventListener('click', () => {
      Array.from(tabsBar.children).forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      Object.entries(sections).forEach(([kk, node]) => node.classList.toggle('hidden', kk !== k));
    });
    tabsBar.appendChild(t);
  });
  view.appendChild(tabsBar);
  view.appendChild(body);

  /* =======================================================
     ① 基础物品信息
     ======================================================= */
  const itemsSection = el('div');
  sections.items = itemsSection;
  body.appendChild(itemsSection);

  await loadProducts(true);
  let productRows = [...state.products];

  const pSearch = el('input', { type: 'search', placeholder: '搜索编号 / 名称 / 规格' });
  const pHost = el('div');
  const pStat = el('span', { class: 'hint' });

  const newCode = el('input', { placeholder: '产品编号', style: 'width:130px' });
  const newName = el('input', { placeholder: '产品名称', style: 'width:180px' });
  const newSpec = el('input', { placeholder: '规格型号', style: 'width:150px' });
  const newUnit = el('input', { placeholder: '单位', style: 'width:70px' });
  const btnAddOne = el('button', { class: 'btn btn-sm btn-primary', text: '＋ 新增' });

  function renderProducts() {
    const kw = pSearch.value.trim().toLowerCase();
    const rows = kw ? productRows.filter((r) => `${r.code} ${r.name} ${r.spec}`.toLowerCase().includes(kw)) : productRows;
    renderTable(pHost, {
      key: 'settings-products',
      pageSize: 50,
      empty: '暂无基础物品信息，可通过下方文本批量录入或 CSV 导入',
      rows,
      columns: [
        { key: 'code', title: '产品编号', width: 140 },
        { key: 'name', title: '产品名称', width: 230 },
        { key: 'spec', title: '规格型号', width: 180 },
        { key: 'unit', title: '单位', width: 80, align: 'center' },
        { key: 'created_at', title: '创建时间', width: 150 },
        {
          key: 'ops',
          title: '操作',
          width: 110,
          align: 'center',
          render: (r) => {
            const wrap = el('span');
            const bEdit = el('button', { class: 'btn-link', text: '修改' });
            bEdit.addEventListener('click', () => openProductEdit(r));
            const bDel = el('button', { class: 'btn-link danger', text: '删除' });
            bDel.addEventListener('click', async () => {
              const done = await withDeleteGuard(async () => api.deleteProduct(r.id));
              if (done) {
                toast('已删除', 'success');
                await reloadProducts();
              }
            });
            wrap.appendChild(bEdit);
            wrap.appendChild(bDel);
            return wrap;
          },
        },
      ],
      footer: (rs) => ['合计', '', '', '', '', `${rs.length} 项`],
    });
    pStat.textContent = `共 ${productRows.length} 项基础物品`;
  }

  function openProductEdit(row) {
    if (!requireLogin('修改基础物品信息')) return;
    const codeI = el('input', { value: row.code });
    const nameI = el('input', { value: row.name });
    const specI = el('input', { value: row.spec });
    const unitI = el('input', { value: row.unit });
    dialog({
      title: '修改基础物品信息',
      body: el('div', { class: 'form-grid' }, [
        el('div', { class: 'field' }, [el('label', { text: '产品编号' }), codeI]),
        el('div', { class: 'field' }, [el('label', { text: '产品名称' }), nameI]),
        el('div', { class: 'field' }, [el('label', { text: '规格型号' }), specI]),
        el('div', { class: 'field' }, [el('label', { text: '单位' }), unitI]),
      ]),
      okText: '保存',
      onOk: async () => {
        if (!codeI.value.trim()) {
          toast('产品编号不能为空', 'warn');
          return false;
        }
        await api.updateProduct(row.id, {
          code: codeI.value.trim(),
          name: nameI.value.trim(),
          spec: specI.value.trim(),
          unit: unitI.value.trim(),
        });
        toast('已保存', 'success');
        await reloadProducts();
      },
    });
  }

  async function reloadProducts() {
    await loadProducts(true);
    productRows = [...state.products];
    renderProducts();
  }

  btnAddOne.addEventListener('click', async () => {
    if (!requireLogin('录入基础物品信息')) return;
    if (!newCode.value.trim()) return toast('请填写产品编号', 'warn');
    try {
      const r = await api.saveProducts([
        { code: newCode.value.trim(), name: newName.value.trim(), spec: newSpec.value.trim(), unit: newUnit.value.trim() },
      ]);
      toast(`新增 ${r.created} 项，更新 ${r.updated} 项`, 'success');
      newCode.value = newName.value = newSpec.value = newUnit.value = '';
      await reloadProducts();
    } catch (e) {
      toast(e.message || '录入失败', 'error');
    }
  });

  /* ---------- 文本批量录入 ---------- */
  const batchText = el('textarea', {
    rows: '8',
    placeholder: '每行一条，字段顺序：产品编号,产品名称,规格型号,单位\n支持英文逗号、中文逗号、Tab 或空格分隔，例如：\nP-1001,散热片,120×80×5mm,件\nP-1002 支架 300mm 个',
  });
  const btnBatchImport = el('button', { class: 'btn btn-sm btn-primary', text: '解析并导入' });
  const btnDemo = el('button', { class: 'btn btn-sm', text: '填充示例' });

  function parseLines(text) {
    const items = [];
    String(text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .forEach((line) => {
        const parts = line.split(/[,，\t]+|\s{2,}|\s(?=\S+$)/).map((s) => s.trim()).filter((s) => s !== '');
        if (parts.length < 1) return;
        items.push({ code: parts[0] || '', name: parts[1] || '', spec: parts[2] || '', unit: parts[3] || '' });
      });
    return items.filter((i) => i.code);
  }

  btnDemo.addEventListener('click', () => {
    batchText.value = [
      'P-1001,散热片,120×80×5mm,件',
      'P-1002,主板支架,300mm,个',
      'P-1003,铝合金外壳,A型/银色,套',
      'P-1004,电源模块,24V 5A,只',
    ].join('\n');
  });

  btnBatchImport.addEventListener('click', async () => {
    if (!requireLogin('批量录入')) return;
    const items = parseLines(batchText.value);
    if (!items.length) return toast('没有解析到有效数据', 'warn');
    try {
      const r = await api.saveProducts(items);
      toast(`导入完成：新增 ${r.created} 项，更新 ${r.updated} 项，忽略 ${r.skipped} 项`, 'success');
      batchText.value = '';
      await reloadProducts();
    } catch (e) {
      toast(e.message || '导入失败', 'error');
    }
  });

  /* ---------- CSV 导入 ---------- */
  const csvName = el('span', { class: 'hint', text: '未选择文件' });
  const csvPreview = el('div', { class: 'preview-table hidden' });
  let csvItems = [];
  const btnCsvPick = el('button', { class: 'btn btn-sm', text: '📄 选择 CSV 文件' });
  const btnCsvImport = el('button', { class: 'btn btn-sm btn-primary', text: '确认导入', disabled: true });
  const btnCsvTemplate = el('button', { class: 'btn btn-sm', text: '⤓ 下载 CSV 模板' });

  btnCsvTemplate.addEventListener('click', () => {
    downloadText('物品信息导入模板.csv', '\uFEFF产品编号,产品名称,规格型号,单位\r\nP-1001,散热片,120×80×5mm,件\r\n', 'text/csv;charset=utf-8');
  });

  btnCsvPick.addEventListener('click', async () => {
    if (!requireLogin('CSV 导入')) return;
    const f = await pickFile('.csv,.txt');
    if (!f) return;
    csvName.textContent = f.name;
    const rows = parseCSV(f.text);
    if (!rows.length) {
      csvItems = [];
      csvPreview.classList.add('hidden');
      btnCsvImport.disabled = true;
      return toast('CSV 内容为空', 'warn');
    }
    let data = rows;
    const head = rows[0].join(',');
    if (/编号|code|名称|name/i.test(head)) data = rows.slice(1);
    csvItems = data
      .filter((r) => r[0] && r[0].trim())
      .map((r) => ({ code: (r[0] || '').trim(), name: (r[1] || '').trim(), spec: (r[2] || '').trim(), unit: (r[3] || '').trim() }));

    csvPreview.classList.remove('hidden');
    csvPreview.innerHTML = '';
    const t = el('table');
    t.innerHTML =
      '<thead><tr><th>产品编号</th><th>产品名称</th><th>规格型号</th><th>单位</th></tr></thead><tbody>' +
      csvItems.slice(0, 50).map((r) => `<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.spec)}</td><td>${escapeHtml(r.unit)}</td></tr>`).join('') +
      '</tbody>';
    csvPreview.appendChild(t);
    if (csvItems.length > 50) csvPreview.appendChild(el('div', { class: 'hint', style: 'padding:6px', text: `仅预览前 50 行，共 ${csvItems.length} 行` }));
    btnCsvImport.disabled = !csvItems.length;
    toast(`已解析 ${csvItems.length} 行，请确认后导入`, 'info');
  });

  btnCsvImport.addEventListener('click', async () => {
    if (!csvItems.length) return;
    try {
      const r = await api.saveProducts(csvItems);
      toast(`导入完成：新增 ${r.created} 项，更新 ${r.updated} 项`, 'success');
      csvItems = [];
      csvPreview.classList.add('hidden');
      csvName.textContent = '未选择文件';
      btnCsvImport.disabled = true;
      await reloadProducts();
    } catch (e) {
      toast(e.message || '导入失败', 'error');
    }
  });

  itemsSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [
        el('div', { class: 'title', text: '基础物品信息' }),
        el('div', { class: 'sub', text: '用于今日报表快速录入（产品编号 / 产品名称 / 规格型号 / 单位）' }),
        el('div', { class: 'tools' }, [pStat]),
      ]),
      el('div', { class: 'toolbar' }, [
        el('div', { class: 'search' }, [pSearch]),
        el('span', { class: 'sep' }),
        newCode,
        newName,
        newSpec,
        newUnit,
        btnAddOne,
        el('span', { class: 'grow' }),
        el('span', { class: 'hint', text: '编号已存在时将更新名称/规格/单位' }),
      ]),
      pHost,
    ])
  );

  itemsSection.appendChild(
    el('div', { class: 'cfg-grid' }, [
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('div', { class: 'title', text: '文本批量录入' }),
          el('div', { class: 'tools' }, [btnDemo, btnBatchImport]),
        ]),
        el('div', { class: 'panel-body' }, [
          batchText,
          el('div', { class: 'cfg-note', html: '格式：<code>产品编号,产品名称,规格型号,单位</code>，每行一条；支持中英文逗号、Tab 分隔。' }),
        ]),
      ]),
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [
          el('div', { class: 'title', text: 'CSV 表格录入' }),
          el('div', { class: 'tools' }, [csvName, btnCsvTemplate, btnCsvPick, btnCsvImport]),
        ]),
        el('div', { class: 'panel-body' }, [
          el('div', { class: 'file-drop', html: '点击「选择 CSV 文件」上传表格<br/><span style="font-size:11.5px">首行可为表头（产品编号,产品名称,规格型号,单位），列顺序需一致</span>' }),
          csvPreview,
        ]),
      ]),
    ])
  );

  /* =======================================================
     ② 数据导出与备份
     ======================================================= */
  const dataSection = el('div', { class: 'hidden' });
  sections.data = dataSection;
  body.appendChild(dataSection);

  const exportBtns = el('div', { class: 'cfg-actions' });
  TABLES.forEach(([key, label]) => {
    const b = el('button', { class: 'btn btn-sm', text: `⤓ ${label}` });
    b.addEventListener('click', () => api.exportDownload(key));
    exportBtns.appendChild(b);
  });
  const btnExportAll = el('button', { class: 'btn btn-sm btn-primary', text: '⤓ 导出全部表格（合并 CSV）' });
  btnExportAll.addEventListener('click', () => api.exportDownload('all'));
  exportBtns.appendChild(btnExportAll);

  const btnBackup = el('button', { class: 'btn btn-sm btn-success', text: '🔒 下载完整备份文件（JSON）' });
  btnBackup.addEventListener('click', () => api.downloadUrl(api.backupUrl()));

  const btnRestore = el('button', { class: 'btn btn-sm btn-danger', text: '⇧ 从备份文件还原' });
  btnRestore.addEventListener('click', async () => {
    if (!requireLogin('数据还原')) return;
    const f = await pickFile('.json');
    if (!f) return;
    let payload;
    try {
      payload = JSON.parse(f.text);
    } catch (e) {
      return toast('备份文件格式错误（JSON 解析失败）', 'error');
    }
    const okDel = await withDeleteGuard('数据还原将覆盖现有数据，请输入二级密码确认');
    if (!okDel) return;
    try {
      await api.restoreBackup(payload);
      toast('数据还原成功，正在刷新…', 'success');
      await loadProducts(true);
      await reloadProducts();
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      toast(e.message || '还原失败', 'error');
    }
  });

  dataSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '导出表格数据' })]),
      el('div', { class: 'panel-body' }, [
        exportBtns,
        el('div', { class: 'cfg-note', style: 'margin-top:8px', html: '导出为 CSV（含 UTF-8 BOM，可直接用 Excel 打开）：历史记录、今日报表、生产进度、成品库存、其他入库、成品出库、基础物品信息。' }),
      ]),
    ])
  );

  dataSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '备份与还原' })]),
      el('div', { class: 'panel-body' }, [
        el('div', { class: 'cfg-actions' }, [btnBackup, btnRestore]),
        el('div', { class: 'cfg-note', style: 'margin-top:8px', html: '备份文件包含 libSQL 数据库全部业务表（JSON 格式）；还原操作需要登录 + 二级密码，且会覆盖现有数据。' }),
      ]),
    ])
  );

  const engineNote = el('div', { class: 'cfg-note', text: '正在读取数据引擎信息…' });
  dataSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '数据引擎信息' })]),
      el('div', { class: 'panel-body' }, [engineNote]),
    ])
  );

  try {
    const eng = await api.getEngine();
    engineNote.innerHTML =
      `当前主数据存储：<b>${escapeHtml(eng.label)}</b><br/>` +
      `数据目标：<code>${escapeHtml(eng.target)}</code><br/>` +
      (eng.remote
        ? '当前运行的是 <b>Turso 云库版</b>（独立入口，与本地版互不干扰）。'
        : '当前运行的是 <b>本地文件版</b>，数据只存在这台电脑的项目目录 <code>./data/pmc.db</code>。<br/>如需手机或多台电脑共享同一份数据，可双击项目里的 <code>启动-云库版.bat</code> 使用 Turso 云库版（本地版完全不受影响）。');
  } catch (e) {
    engineNote.textContent = '数据引擎信息读取失败（后端服务可能未启动）';
  }

  /* =======================================================
     ③ 账号与安全
     ======================================================= */
  const authSection = el('div', { class: 'hidden' });
  sections.auth = authSection;
  body.appendChild(authSection);

  const oldPass = el('input', { type: 'password', placeholder: '原密码' });
  const newPass = el('input', { type: 'password', placeholder: '新密码（至少 6 位）' });
  const newPass2 = el('input', { type: 'password', placeholder: '确认新密码' });
  const btnChangePwd = el('button', { class: 'btn btn-sm btn-primary', text: '修改登录密码' });
  btnChangePwd.addEventListener('click', async () => {
    if (!requireLogin('修改密码')) return;
    if (!newPass.value || newPass.value.length < 6) return toast('新密码至少 6 位', 'warn');
    if (newPass.value !== newPass2.value) return toast('两次输入的新密码不一致', 'warn');
    try {
      await api.changePassword(oldPass.value, newPass.value);
      toast('登录密码已更新', 'success');
      oldPass.value = newPass.value = newPass2.value = '';
    } catch (e) {
      toast(e.message || '修改失败', 'error');
    }
  });

  const dpInput = el('input', { type: 'text', value: await safeSetting('delete_password', '888888') });
  const btnSaveDp = el('button', { class: 'btn btn-sm btn-primary', text: '保存二级密码' });
  btnSaveDp.addEventListener('click', async () => {
    if (!requireLogin('修改二级密码')) return;
    const current = window.prompt('请输入当前二级密码以确认：');
    if (current === null) return;
    try {
      const arr = await api.verifyDeletePassword(current);
      if (!arr.valid) return toast('当前二级密码错误', 'error');
      await api.saveSettings({ delete_password: dpInput.value.trim() || '888888' });
      deleteGuard.password = '';
      toast('二级密码已更新（删除/还原等敏感操作需使用）', 'success');
    } catch (e) {
      toast(e.message || '修改失败', 'error');
    }
  });

  authSection.appendChild(
    el('div', { class: 'cfg-grid' }, [
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '登录账号' })]),
        el('div', { class: 'panel-body' }, [
          el('div', { class: 'cfg-note', html: '打开网页默认为 <b>游客（只读）</b>，登录后才能录入、修改数据。默认管理员账号：<code>admin / admin123</code>，请登录后及时修改密码。' }),
          el('div', { class: 'form-row', style: 'margin-top:10px' }, [
            el('button', {
              class: 'btn btn-sm',
              text: '登录 / 切换账号',
              onclick: () => document.getElementById('btnLogin')?.click(),
            }),
            el('button', {
              class: 'btn btn-sm',
              text: '退出登录',
              onclick: async () => {
                await api.logout();
                api.session.clear();
                deleteGuard.password = '';
                refreshUserUI();
                toast('已退出登录', 'info');
                location.reload();
              },
            }),
          ]),
          el('div', { class: 'field', style: 'margin-top:12px' }, [el('label', { text: '原密码' }), oldPass]),
          el('div', { class: 'field' }, [el('label', { text: '新密码' }), newPass]),
          el('div', { class: 'field' }, [el('label', { text: '确认新密码' }), newPass2]),
          btnChangePwd,
        ]),
      ]),
      el('div', { class: 'panel' }, [
        el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '二级密码（删除保护）' })]),
        el('div', { class: 'panel-body' }, [
          el('div', { class: 'cfg-note', html: '删除任何记录（历史记录、生产进度、入库/出库、物品信息）以及数据还原，都需要输入 <b>二级密码</b>，用于防止误操作。' }),
          el('div', { class: 'field', style: 'margin-top:10px' }, [el('label', { text: '二级密码' }), dpInput]),
          btnSaveDp,
          el('div', { class: 'cfg-note', style: 'margin-top:10px', html: '默认二级密码：<code>888888</code>。验证通过后会在当前浏览器会话内记忆，刷新页面后需重新输入。' }),
        ]),
      ]),
    ])
  );

  /* =======================================================
     ④ 外观与显示
     ======================================================= */
  const uiSection = el('div', { class: 'hidden' });
  sections.ui = uiSection;
  body.appendChild(uiSection);

  const padSlider = el('input', { type: 'range', min: '0', max: '14', step: '1', value: String(setting('row_padding', loadLocal('pmc:rowPad', 2))) });
  const padVal = el('span', { class: 'slider-val', text: `${padSlider.value} px` });
  padSlider.addEventListener('input', () => {
    padVal.textContent = `${padSlider.value} px`;
    setRowPadding(num(padSlider.value));
  });
  const btnSavePad = el('button', { class: 'btn btn-sm btn-primary', text: '保存到服务端默认值' });
  btnSavePad.addEventListener('click', async () => {
    if (!requireLogin('保存外观设置')) return;
    await api.saveSettings({ row_padding: padSlider.value });
    await loadSettings();
    toast('已保存默认行间距', 'success');
  });

  const lineInput = el('input', { value: setting('line_options', '一线,二线,三线,四线') });
  const defLineInput = el('input', { value: setting('default_line', '一线'), style: 'width:110px' });
  const btnSaveLines = el('button', { class: 'btn btn-sm btn-primary', text: '保存线别设置' });
  btnSaveLines.addEventListener('click', async () => {
    if (!requireLogin('保存线别设置')) return;
    await api.saveSettings({ line_options: lineInput.value.trim(), default_line: defLineInput.value.trim() });
    await loadSettings();
    toast('线别设置已保存（刷新页面后生效）', 'success');
  });

  const btnResetCols = el('button', { class: 'btn btn-sm', text: '重置所有表格列宽' });
  btnResetCols.addEventListener('click', () => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('pmc:cols:'))
      .forEach((k) => localStorage.removeItem(k));
    toast('列宽已重置，刷新后生效', 'success');
  });

  uiSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '表格行间距 / 显示密度' })]),
      el('div', { class: 'panel-body' }, [
        el('div', { class: 'slider-row' }, [el('span', { class: 'hint', text: '紧凑' }), padSlider, padVal, el('span', { class: 'hint', text: '宽松' }), btnSavePad]),
        el('div', { class: 'cfg-note', style: 'margin-top:8px', text: '默认 2px（ERP 紧凑风格）。拖动即时生效并保存在本地，点击右侧按钮可写入服务端作为全局默认值。' }),
      ]),
    ])
  );

  uiSection.appendChild(
    el('div', { class: 'panel' }, [
      el('div', { class: 'panel-head' }, [el('div', { class: 'title', text: '线别与表格' })]),
      el('div', { class: 'panel-body' }, [
        el('div', { class: 'field' }, [el('label', { text: '线别选项（逗号分隔）' }), lineInput]),
        el('div', { class: 'form-row' }, [
          el('div', { class: 'inline-field' }, [el('label', { text: '默认线别' }), defLineInput]),
          btnSaveLines,
          el('span', { class: 'sep' }),
          btnResetCols,
        ]),
        el('div', { class: 'cfg-note', style: 'margin-top:8px', text: '所有表格表头右侧均可拖动调整列宽（双击分隔线恢复默认），列宽按表格记忆在本地浏览器。' }),
      ]),
    ])
  );

  /* ---------------- 初始化 ---------------- */
  pSearch.addEventListener('input', () => renderProducts());
  renderProducts();
}

async function safeSetting(key, fallback) {
  try {
    const s = await api.getSettings();
    return s[key] || fallback;
  } catch (e) {
    return fallback;
  }
}

export const meta = { title: '系统配置', key: 'settings' };
