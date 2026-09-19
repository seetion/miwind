/* ============================================================
   api.js（静态版）—— 业务接口层
   与云端 Node 版的 server.js 一一对应，但 SQL 直接跑在浏览器里，
   数据落在 libSQL（Turso 云库）。界面代码完全不用改。
   ============================================================ */

import * as db from './db.js';
import { downloadText, loadLocal, saveLocal } from './util.js';

const USER_KEY = 'pmc:user';

export const session = {
  token: '',
  user: loadLocal(USER_KEY, null),
  get logged() {
    return !!this.user;
  },
  // 兼容两种调用：set(user) 与 set(token, user)
  set(a, b) {
    this.user = b || a || null;
    saveLocal(USER_KEY, this.user);
  },
  clear() {
    this.user = null;
    localStorage.removeItem(USER_KEY);
  },
};

export const deleteGuard = { password: '' };

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v) => (v === null || v === undefined ? '' : String(v));

function requireLogin() {
  if (!session.logged) {
    const e = new Error('游客模式无法录入，请先登录');
    e.status = 401;
    throw e;
  }
}
async function checkGuard() {
  if (!session.logged) {
    const e = new Error('请先登录');
    e.status = 401;
    throw e;
  }
  const expected = await db.getSetting('delete_password', '888888');
  if (!deleteGuard.password || deleteGuard.password !== expected) {
    const e = new Error('二级密码错误，删除已取消');
    e.status = 403;
    throw e;
  }
}

/* ============================================================
   认证
   ============================================================ */
export async function login(username, password) {
  const user = await db.one(`SELECT * FROM users WHERE username = ?`, [str(username).trim()]);
  if (!user || !(await db.verifyPassword(str(password), user.salt, user.password_hash))) {
    const e = new Error('账号或密码错误');
    e.status = 401;
    throw e;
  }
  const info = { id: user.id, username: user.username, role: user.role };
  session.set(info);
  return { token: 'local', user: info };
}

export async function logout() {
  session.clear();
}

export async function me() {
  return { user: session.user };
}

export async function changePassword(oldPassword, newPassword) {
  requireLogin();
  const user = await db.one(`SELECT * FROM users WHERE id = ?`, [session.user.id]);
  if (!user || !(await db.verifyPassword(str(oldPassword), user.salt, user.password_hash))) {
    throw new Error('原密码错误');
  }
  const { salt, hash } = await db.makePasswordHash(str(newPassword));
  await db.run(`UPDATE users SET password_hash=?, salt=? WHERE id=?`, [hash, salt, user.id]);
  return {};
}

export async function verifyDeletePassword(password) {
  const expected = await db.getSetting('delete_password', '888888');
  let valid = str(password) === expected;
  if (!valid && session.user) {
    const user = await db.one(`SELECT * FROM users WHERE id = ?`, [session.user.id]);
    if (user) valid = await db.verifyPassword(str(password), user.salt, user.password_hash);
  }
  return { valid };
}

/* ============================================================
   基础物品信息
   ============================================================ */
export async function listProducts(q = '') {
  const kw = str(q).trim();
  if (kw) {
    return db.all(
      `SELECT * FROM products WHERE code LIKE ? OR name LIKE ? OR spec LIKE ? ORDER BY code ASC LIMIT 500`,
      [`%${kw}%`, `%${kw}%`, `%${kw}%`]
    );
  }
  return db.all(`SELECT * FROM products ORDER BY code ASC LIMIT 5000`);
}

export async function saveProducts(items) {
  requireLogin();
  const list = Array.isArray(items) ? items : [items];
  const stamp = db.nowISO();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const it of list) {
    const code = str(it.code ?? it.product_code).trim();
    if (!code) {
      skipped++;
      continue;
    }
    const name = str(it.name ?? it.product_name).trim();
    const spec = str(it.spec).trim();
    const unit = str(it.unit).trim();
    const exist = await db.one(`SELECT id FROM products WHERE code = ?`, [code]);
    if (exist) {
      await db.run(`UPDATE products SET name=?, spec=?, unit=?, updated_at=? WHERE id=?`, [name, spec, unit, stamp, exist.id]);
      updated++;
    } else {
      await db.run(`INSERT INTO products(code, name, spec, unit, created_at, updated_at) VALUES(?,?,?,?,?,?)`, [
        code,
        name,
        spec,
        unit,
        stamp,
        stamp,
      ]);
      created++;
    }
  }
  return { created, updated, skipped, total: list.length };
}

export async function updateProduct(id, data) {
  requireLogin();
  await db.run(`UPDATE products SET code=?, name=?, spec=?, unit=?, updated_at=? WHERE id=?`, [
    str(data.code).trim(),
    str(data.name).trim(),
    str(data.spec).trim(),
    str(data.unit).trim(),
    db.nowISO(),
    Number(id),
  ]);
  return {};
}

export async function deleteProduct(id) {
  await checkGuard();
  await db.run(`DELETE FROM products WHERE id = ?`, [Number(id)]);
  return {};
}

/* ============================================================
   生产进度同步（与 server.js 完全一致的规则）
   ============================================================ */
const deriveStatus = (done, qty) => {
  if (done <= 0) return '下达';
  if (qty > 0 && done >= qty) return '完工';
  return '开工';
};

export async function syncOrders() {
  const rows = await db.all(
    `SELECT ri.order_no, ri.product_code, ri.product_name, ri.spec, ri.unit, ri.order_qty, ri.today_qty, r.report_date
       FROM report_items ri JOIN reports r ON r.id = ri.report_id
      WHERE TRIM(ri.order_no) <> ''
      ORDER BY r.report_date ASC, ri.id ASC`
  );

  const map = new Map();
  for (const r of rows) {
    const key = `${r.order_no}||${r.product_code}`;
    let g = map.get(key);
    if (!g) {
      g = {
        order_no: r.order_no,
        product_code: r.product_code,
        product_name: r.product_name,
        spec: r.spec,
        unit: r.unit,
        order_qty: num(r.order_qty),
        done_qty: 0,
        first_date: r.report_date,
        last_date: r.report_date,
      };
      map.set(key, g);
    }
    g.done_qty += num(r.today_qty);
    g.order_qty = num(r.order_qty);
    if (r.product_name) g.product_name = r.product_name;
    if (r.spec) g.spec = r.spec;
    if (r.unit) g.unit = r.unit;
    g.last_date = r.report_date;
  }

  const existing = await db.all(`SELECT * FROM orders`);
  const existMap = new Map(existing.map((o) => [`${o.order_no}||${o.product_code}`, o]));
  const stamp = db.nowISO();

  for (const g of map.values()) {
    const old = existMap.get(`${g.order_no}||${g.product_code}`);
    if (!old) {
      await db.run(
        `INSERT INTO orders(order_no, product_code, product_name, spec, unit, order_qty, done_qty, status, manual, first_date, last_date, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,0,?,?,?,?)`,
        [g.order_no, g.product_code, g.product_name, g.spec, g.unit, g.order_qty, g.done_qty, deriveStatus(g.done_qty, g.order_qty), g.first_date, g.last_date, stamp, stamp]
      );
      continue;
    }
    let status;
    if (Number(old.manual) === 1) status = old.status;
    else if (num(g.order_qty) > num(old.order_qty) && num(old.order_qty) > 0) status = '追加';
    else status = deriveStatus(g.done_qty, g.order_qty);

    await db.run(
      `UPDATE orders SET product_name=?, spec=?, unit=?, order_qty=?, done_qty=?, status=?, first_date=?, last_date=?, updated_at=? WHERE id=?`,
      [g.product_name, g.spec, g.unit, g.order_qty, g.done_qty, status, g.first_date, g.last_date, stamp, old.id]
    );
  }
  return true;
}

/** 单据中的新产品自动登记到基础物品信息 */
async function registerProduct(code, name, spec, unit) {
  const c = str(code).trim();
  if (!c) return;
  const exist = await db.one(`SELECT id FROM products WHERE code = ?`, [c]);
  if (exist) return;
  const stamp = db.nowISO();
  await db.run(`INSERT INTO products(code, name, spec, unit, created_at, updated_at) VALUES(?,?,?,?,?,?)`, [
    c,
    str(name).trim(),
    str(spec).trim(),
    str(unit).trim(),
    stamp,
    stamp,
  ]);
}

/* ============================================================
   今日报表 / 历史记录
   ============================================================ */
export async function getReportByDate(date, line = '') {
  if (!date) return null;
  const rep = line
    ? await db.one(`SELECT * FROM reports WHERE report_date=? AND line=?`, [date, line])
    : await db.one(`SELECT * FROM reports WHERE report_date=? ORDER BY id DESC LIMIT 1`, [date]);
  if (!rep) return null;
  const items = await db.all(`SELECT * FROM report_items WHERE report_id=? ORDER BY seq ASC, id ASC`, [rep.id]);
  return { ...rep, items };
}

export async function listReports() {
  return db.all(`SELECT * FROM reports ORDER BY report_date DESC LIMIT 200`);
}

export async function saveReport(body) {
  requireLogin();
  const date = str(body.report_date).trim() || db.today();
  const line = str(body.line).trim() || '一线';
  const attendance = num(body.attendance);
  const hours = num(body.work_hours);
  const items = (Array.isArray(body.items) ? body.items : []).filter(
    (it) => str(it.order_no).trim() || str(it.product_code).trim() || str(it.product_name).trim()
  );
  if (!items.length) throw new Error('请至少录入一条生产明细');

  const stamp = db.nowISO();
  const exist = await db.one(`SELECT id FROM reports WHERE report_date=? AND line=?`, [date, line]);
  let reportId;
  if (exist) {
    reportId = Number(exist.id);
    await db.run(`UPDATE reports SET attendance=?, work_hours=?, remark=?, created_by=?, updated_at=? WHERE id=?`, [
      attendance,
      hours,
      str(body.remark),
      session.user.username,
      stamp,
      reportId,
    ]);
    await db.run(`DELETE FROM report_items WHERE report_id=?`, [reportId]);
  } else {
    const r = await db.run(
      `INSERT INTO reports(report_date, line, attendance, work_hours, remark, created_by, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)`,
      [date, line, attendance, hours, str(body.remark), session.user.username, stamp, stamp]
    );
    reportId = r.lastInsertRowid;
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const code = str(it.product_code).trim();
    if (code) await registerProduct(code, it.product_name, it.spec, it.unit);
    await db.run(
      `INSERT INTO report_items(report_id, seq, order_no, product_code, product_name, spec, unit, order_qty, today_qty, remark)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        reportId,
        i + 1,
        str(it.order_no).trim(),
        code,
        str(it.product_name).trim(),
        str(it.spec).trim(),
        str(it.unit).trim(),
        num(it.order_qty),
        num(it.today_qty),
        str(it.remark),
      ]
    );
  }

  await syncOrders();
  return { report_id: reportId, count: items.length };
}

export async function deleteReport(id) {
  await checkGuard();
  await db.run(`DELETE FROM report_items WHERE report_id=?`, [Number(id)]);
  await db.run(`DELETE FROM reports WHERE id=?`, [Number(id)]);
  await syncOrders();
  return {};
}

export async function listHistory({ from, to, q, line } = {}) {
  const where = [];
  const args = [];
  if (from) {
    where.push(`r.report_date >= ?`);
    args.push(from);
  }
  if (to) {
    where.push(`r.report_date <= ?`);
    args.push(to);
  }
  if (line) {
    where.push(`r.line = ?`);
    args.push(line);
  }
  if (q) {
    where.push(`(ri.order_no LIKE ? OR ri.product_code LIKE ? OR ri.product_name LIKE ? OR ri.spec LIKE ?)`);
    const like = `%${q}%`;
    args.push(like, like, like, like);
  }
  return db.all(
    `SELECT ri.id AS item_id, ri.report_id, r.report_date, r.line, r.attendance, r.work_hours, r.remark AS report_remark,
            ri.seq, ri.order_no, ri.product_code, ri.product_name, ri.spec, ri.unit, ri.order_qty, ri.today_qty, ri.remark
       FROM report_items ri JOIN reports r ON r.id = ri.report_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY r.report_date DESC, r.line ASC, ri.seq ASC, ri.id ASC`,
    args
  );
}

export async function deleteHistoryItem(id) {
  await checkGuard();
  await db.run(`DELETE FROM report_items WHERE id=?`, [Number(id)]);
  await syncOrders();
  return {};
}

/* ============================================================
   生产进度
   ============================================================ */
export async function listOrders({ q, status } = {}) {
  const where = [];
  const args = [];
  if (q) {
    where.push(`(order_no LIKE ? OR product_code LIKE ? OR product_name LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (status) {
    where.push(`status = ?`);
    args.push(status);
  }
  return db.all(`SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC, id DESC`, args);
}

export async function updateOrder(id, data) {
  requireLogin();
  const fields = [];
  const args = [];
  if (data.status !== undefined) {
    fields.push('status=?', 'manual=?');
    args.push(str(data.status), 1);
  }
  if (data.order_qty !== undefined) {
    fields.push('order_qty=?');
    args.push(num(data.order_qty));
  }
  if (!fields.length) return {};
  args.push(db.nowISO(), Number(id));
  await db.run(`UPDATE orders SET ${fields.join(', ')}, updated_at=? WHERE id=?`, args);
  return {};
}

export async function deleteOrder(id) {
  await checkGuard();
  await db.run(`DELETE FROM orders WHERE id=?`, [Number(id)]);
  return {};
}

/* ============================================================
   成品库存
   ============================================================ */
export async function getStock() {
  const prod = await db.all(
    `SELECT product_code, product_name, MAX(spec) AS spec, MAX(unit) AS unit, SUM(today_qty) AS produced
       FROM report_items
      WHERE TRIM(product_code) <> '' OR TRIM(product_name) <> ''
      GROUP BY product_code, product_name`
  );
  const inb = await db.all(`SELECT product_code, SUM(qty) AS qty FROM inbound GROUP BY product_code`);
  const outb = await db.all(`SELECT product_code, SUM(qty) AS qty FROM outbound GROUP BY product_code`);
  const inMap = new Map(inb.map((r) => [r.product_code, num(r.qty)]));
  const outMap = new Map(outb.map((r) => [r.product_code, num(r.qty)]));
  const map = new Map();

  for (const p of prod) {
    map.set(`${p.product_code}||${p.product_name}`, {
      product_code: p.product_code,
      product_name: p.product_name,
      spec: p.spec,
      unit: p.unit,
      produced: num(p.produced),
      inbound: inMap.get(p.product_code) || 0,
      outbound: outMap.get(p.product_code) || 0,
      stock: 0,
    });
  }
  const products = await db.all(`SELECT code, name, spec, unit FROM products`);
  const pMap = new Map(products.map((p) => [p.code, p]));
  const ensure = (code, name) => {
    const key = `${code}||${name}`;
    if (!map.has(key)) {
      const p = pMap.get(code) || {};
      map.set(key, {
        product_code: code,
        product_name: name || p.name || '',
        spec: p.spec || '',
        unit: p.unit || '',
        produced: 0,
        inbound: inMap.get(code) || 0,
        outbound: outMap.get(code) || 0,
        stock: 0,
      });
    }
    return map.get(key);
  };
  for (const r of await db.all(`SELECT DISTINCT product_code, product_name FROM inbound`)) ensure(r.product_code, r.product_name);
  for (const r of await db.all(`SELECT DISTINCT product_code, product_name FROM outbound`)) ensure(r.product_code, r.product_name);

  const list = [...map.values()].map((r) => ({ ...r, stock: r.produced + r.inbound - r.outbound }));
  list.sort((a, b) => String(a.product_code).localeCompare(String(b.product_code), 'zh-CN'));
  return list;
}

/* ============================================================
   其他入库 / 成品出库
   ============================================================ */
async function listIO(table, dateField, { q, from, to } = {}) {
  const where = [];
  const args = [];
  if (q) {
    where.push(`(product_code LIKE ? OR product_name LIKE ? OR summary LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (from) {
    where.push(`${dateField} >= ?`);
    args.push(from);
  }
  if (to) {
    where.push(`${dateField} <= ?`);
    args.push(to);
  }
  return db.all(`SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${dateField} DESC, id DESC`, args);
}
async function createIO(table, dateField, body) {
  requireLogin();
  const stamp = db.nowISO();
  const r = await db.run(
    `INSERT INTO ${table}(${dateField}, product_code, product_name, spec, qty, summary, remark, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      str(body[dateField]) || db.today(),
      str(body.product_code).trim(),
      str(body.product_name).trim(),
      str(body.spec).trim(),
      num(body.qty),
      str(body.summary),
      str(body.remark),
      stamp,
      stamp,
    ]
  );
  await registerProduct(body.product_code, body.product_name, body.spec, body.unit);
  return { id: r.lastInsertRowid };
}
async function updateIO(table, dateField, id, body) {
  requireLogin();
  await db.run(
    `UPDATE ${table} SET ${dateField}=?, product_code=?, product_name=?, spec=?, qty=?, summary=?, remark=?, updated_at=? WHERE id=?`,
    [
      str(body[dateField]),
      str(body.product_code).trim(),
      str(body.product_name).trim(),
      str(body.spec).trim(),
      num(body.qty),
      str(body.summary),
      str(body.remark),
      db.nowISO(),
      Number(id),
    ]
  );
  return {};
}
async function deleteIO(table, id) {
  await checkGuard();
  await db.run(`DELETE FROM ${table} WHERE id=?`, [Number(id)]);
  return {};
}

export const listInbound = (opt) => listIO('inbound', 'in_date', opt);
export const createInbound = (body) => createIO('inbound', 'in_date', body);
export const updateInbound = (id, body) => updateIO('inbound', 'in_date', id, body);
export const deleteInbound = (id) => deleteIO('inbound', id);

export const listOutbound = (opt) => listIO('outbound', 'out_date', opt);
export const createOutbound = (body) => createIO('outbound', 'out_date', body);
export const updateOutbound = (id, body) => updateIO('outbound', 'out_date', id, body);
export const deleteOutbound = (id) => deleteIO('outbound', id);

/* ============================================================
   系统配置
   ============================================================ */
export async function getSettings() {
  const rows = await db.all(`SELECT key, value FROM settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function saveSettings(data) {
  requireLogin();
  for (const [k, v] of Object.entries(data || {})) {
    if (k === 'delete_password' && !str(v)) continue;
    await db.setSetting(k, v);
  }
  return {};
}

export async function getOverview() {
  const total = await db.one(`SELECT COALESCE(SUM(today_qty),0) AS v FROM report_items`);
  const days = await db.one(`SELECT COUNT(DISTINCT report_date) AS v FROM reports`);
  const orders = await db.all(`SELECT status, COUNT(*) AS c FROM orders GROUP BY status`);
  const stockTotal = (await getStock()).reduce((s, x) => s + num(x.stock), 0);
  const products = await db.one(`SELECT COUNT(*) AS v FROM products`);
  return {
    total_output: num(total.v),
    days: num(days.v),
    orders: Object.fromEntries(orders.map((o) => [o.status, num(o.c)])),
    stock_total: stockTotal,
    products: num(products.v),
  };
}

export const getEngine = async () => db.engineInfo();

/* ============================================================
   导出 / 备份 / 还原
   ============================================================ */
function toCSV(headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

const EXPORT_DEFS = {
  products: {
    title: '基础物品信息',
    headers: ['产品编号', '产品名称', '规格型号', '单位'],
    async rows() {
      return (await db.all(`SELECT code, name, spec, unit FROM products ORDER BY code`)).map((x) => [x.code, x.name, x.spec, x.unit]);
    },
  },
  reports: {
    title: '今日报表',
    headers: ['日期', '线别', '出勤人数', '出勤时间', '总产量', 'UPPH', 'UPPD', '录入人', '更新时间'],
    async rows() {
      const list = await db.all(`SELECT * FROM reports ORDER BY report_date DESC`);
      const out = [];
      for (const rep of list) {
        const items = await db.all(`SELECT today_qty FROM report_items WHERE report_id=?`, [rep.id]);
        const total = items.reduce((s, i) => s + num(i.today_qty), 0);
        const mh = num(rep.attendance) * num(rep.work_hours);
        out.push([
          rep.report_date,
          rep.line,
          rep.attendance,
          rep.work_hours,
          total,
          mh ? (total / mh).toFixed(2) : '0.00',
          num(rep.attendance) ? (total / num(rep.attendance)).toFixed(2) : '0.00',
          rep.created_by,
          rep.updated_at,
        ]);
      }
      return out;
    },
  },
  history: {
    title: '历史记录',
    headers: ['日期', '线别', '订单号', '产品编号', '产品名称', '规格型号', '单位', '订单数量', '完成数量', '出勤人数', '备注'],
    async rows() {
      return (await listHistory({})).map((x) => [
        x.report_date, x.line, x.order_no, x.product_code, x.product_name, x.spec, x.unit, x.order_qty, x.today_qty, x.attendance, x.remark,
      ]);
    },
  },
  orders: {
    title: '生产进度',
    headers: ['订单号', '产品编号', '产品名称', '规格型号', '单位', '订单数量', '完成数量', '进度', '订单状态', '开始日期', '最近日期'],
    async rows() {
      return (await db.all(`SELECT * FROM orders ORDER BY id DESC`)).map((x) => [
        x.order_no, x.product_code, x.product_name, x.spec, x.unit, x.order_qty, x.done_qty,
        num(x.order_qty) ? `${Math.min(100, (num(x.done_qty) / num(x.order_qty)) * 100).toFixed(1)}%` : '0%',
        x.status, x.first_date, x.last_date,
      ]);
    },
  },
  stock: {
    title: '成品库存',
    headers: ['产品编号', '产品名称', '规格型号', '单位', '生产数量', '其他入库', '成品出库', '成品库存'],
    async rows() {
      return (await getStock()).map((x) => [x.product_code, x.product_name, x.spec, x.unit, x.produced, x.inbound, x.outbound, x.stock]);
    },
  },
  inbound: {
    title: '其他入库',
    headers: ['入库日期', '产品编号', '产品名称', '规格型号', '入库数量', '入库摘要', '备注'],
    async rows() {
      return (await db.all(`SELECT * FROM inbound ORDER BY in_date DESC`)).map((x) => [x.in_date, x.product_code, x.product_name, x.spec, x.qty, x.summary, x.remark]);
    },
  },
  outbound: {
    title: '成品出库',
    headers: ['出库日期', '产品编号', '产品名称', '规格型号', '出库数量', '出库摘要', '备注'],
    async rows() {
      return (await db.all(`SELECT * FROM outbound ORDER BY out_date DESC`)).map((x) => [x.out_date, x.product_code, x.product_name, x.spec, x.qty, x.summary, x.remark]);
    },
  },
};

const stamp = () => db.today();

export async function exportDownload(table, format = 'csv') {
  if (table === 'all' || !table) {
    const parts = [];
    for (const def of Object.values(EXPORT_DEFS)) {
      parts.push(`# ${def.title}`);
      parts.push(toCSV(def.headers, await def.rows()).replace(/^\uFEFF/, ''));
      parts.push('');
    }
    downloadText(`production-all-${stamp()}.csv`, '\uFEFF' + parts.join('\r\n'), 'text/csv;charset=utf-8');
    return;
  }
  const def = EXPORT_DEFS[table];
  if (!def) throw new Error('未知的数据表');
  const rows = await def.rows();
  if (format === 'json') {
    downloadText(`${table}-${stamp()}.json`, JSON.stringify({ headers: def.headers, rows }, null, 2), 'application/json');
    return;
  }
  downloadText(`${table}-${stamp()}.csv`, toCSV(def.headers, rows), 'text/csv;charset=utf-8');
}

export async function backupDownload() {
  const tables = ['products', 'reports', 'report_items', 'orders', 'inbound', 'outbound', 'settings'];
  const data = {};
  for (const t of tables) data[t] = await db.all(`SELECT * FROM ${t}`);
  const payload = {
    app: '生产管理系统',
    engine: 'libSQL (browser)',
    source: db.dbState.host,
    version: 1,
    exported_at: db.nowISO(),
    data,
  };
  downloadText(`pmc-backup-${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

export async function restoreBackup(payload) {
  await checkGuard();
  const data = payload.data || payload;
  const tables = ['report_items', 'reports', 'orders', 'inbound', 'outbound', 'products'];
  for (const t of tables) {
    if (!Array.isArray(data[t])) continue;
    await db.run(`DELETE FROM ${t}`);
    for (const row of data[t]) {
      const keys = Object.keys(row).filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
      if (!keys.length) continue;
      await db.run(
        `INSERT INTO ${t}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
        keys.map((k) => (row[k] === null || row[k] === undefined ? '' : row[k]))
      );
    }
  }
  if (Array.isArray(data.settings)) {
    for (const s of data.settings) {
      if (s.key && s.key !== 'delete_password') await db.setSetting(s.key, s.value);
    }
  }
  await syncOrders();
  return {};
}
