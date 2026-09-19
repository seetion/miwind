/**
 * 生产管理系统 - 后端服务
 * 数据存储：libSQL（Turso 官方客户端）
 *   - 本地文件模式（默认）：file:./data/pmc.db
 *   - 远程模式：设置环境变量 LIBSQL_URL / LIBSQL_AUTH_TOKEN 即可切换到 Turso 云库
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { createClient } from '@libsql/client';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.LIBSQL_DATA_DIR || path.join(ROOT, 'data');
const PORT = Number(process.env.PORT || 5173);

/* ------------------------------------------------------------------ *
 * libSQL 连接
 * ------------------------------------------------------------------ */
function resolveTarget() {
  if (process.env.LIBSQL_URL) {
    return {
      url: process.env.LIBSQL_URL,
      authToken: process.env.LIBSQL_AUTH_TOKEN || undefined,
      mode: 'remote(libSQL/Turso)',
    };
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'pmc.db').split(path.sep).join('/');
  return { url: `file:${file}`, authToken: undefined, mode: `local(libSQL file) ${file}` };
}

const HOST = process.env.HOST || '0.0.0.0';
const TARGET = resolveTarget();
const db = TARGET.authToken
  ? createClient({ url: TARGET.url, authToken: TARGET.authToken })
  : createClient({ url: TARGET.url });

const all = async (sql, args = []) => (await db.execute({ sql, args })).rows.map((r) => ({ ...r }));
const one = async (sql, args = []) => (await all(sql, args))[0] || null;
const run = (sql, args = []) => db.execute({ sql, args });

/* ------------------------------------------------------------------ *
 * 建表 & 初始化
 * ------------------------------------------------------------------ */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     salt TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'user',
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     username TEXT NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS products (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     code TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL DEFAULT '',
     spec TEXT NOT NULL DEFAULT '',
     unit TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS reports (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     report_date TEXT NOT NULL,
     line TEXT NOT NULL DEFAULT '一线',
     attendance REAL NOT NULL DEFAULT 0,
     work_hours REAL NOT NULL DEFAULT 0,
     remark TEXT NOT NULL DEFAULT '',
     created_by TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE(report_date, line)
   )`,
  `CREATE TABLE IF NOT EXISTS report_items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     report_id INTEGER NOT NULL,
     seq INTEGER NOT NULL DEFAULT 0,
     order_no TEXT NOT NULL DEFAULT '',
     product_code TEXT NOT NULL DEFAULT '',
     product_name TEXT NOT NULL DEFAULT '',
     spec TEXT NOT NULL DEFAULT '',
     unit TEXT NOT NULL DEFAULT '',
     order_qty REAL NOT NULL DEFAULT 0,
     today_qty REAL NOT NULL DEFAULT 0,
     remark TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE TABLE IF NOT EXISTS orders (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     order_no TEXT NOT NULL,
     product_code TEXT NOT NULL DEFAULT '',
     product_name TEXT NOT NULL DEFAULT '',
     spec TEXT NOT NULL DEFAULT '',
     unit TEXT NOT NULL DEFAULT '',
     order_qty REAL NOT NULL DEFAULT 0,
     done_qty REAL NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT '下达',
     manual INTEGER NOT NULL DEFAULT 0,
     first_date TEXT NOT NULL DEFAULT '',
     last_date TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     UNIQUE(order_no, product_code)
   )`,
  `CREATE TABLE IF NOT EXISTS inbound (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     in_date TEXT NOT NULL,
     product_code TEXT NOT NULL DEFAULT '',
     product_name TEXT NOT NULL DEFAULT '',
     spec TEXT NOT NULL DEFAULT '',
     qty REAL NOT NULL DEFAULT 0,
     summary TEXT NOT NULL DEFAULT '',
     remark TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS outbound (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     out_date TEXT NOT NULL,
     product_code TEXT NOT NULL DEFAULT '',
     product_name TEXT NOT NULL DEFAULT '',
     spec TEXT NOT NULL DEFAULT '',
     qty REAL NOT NULL DEFAULT 0,
     summary TEXT NOT NULL DEFAULT '',
     remark TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_items_report ON report_items(report_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reports_date ON reports(report_date)`,
];

const nowISO = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const str = (v) => (v === null || v === undefined ? '' : String(v));

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function makeHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: hashPassword(password, salt) };
}
function verifyPassword(password, salt, hash) {
  const h = Buffer.from(hashPassword(password, salt));
  const o = Buffer.from(hash);
  return h.length === o.length && crypto.timingSafeEqual(h, o);
}

async function getSetting(key, fallback = '') {
  const row = await one(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}
async function setSetting(key, value) {
  await run(
    `INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, str(value)]
  );
}

async function initDatabase() {
  for (const sql of SCHEMA) await run(sql);

  // 默认账号
  const admin = await one(`SELECT id FROM users WHERE username = 'admin'`);
  if (!admin) {
    const { salt, hash } = makeHash('admin123');
    await run(
      `INSERT INTO users(username, password_hash, salt, role, created_at) VALUES(?,?,?,?,?)`,
      ['admin', hash, salt, 'admin', nowISO()]
    );
  }

  // 默认配置
  const defaults = {
    delete_password: '888888',
    company_name: '生产管理系统',
    default_line: '一线',
    line_options: '一线,二线,三线,四线',
    row_padding: '2',
    page_size: '50',
  };
  for (const [k, v] of Object.entries(defaults)) {
    const exists = await one(`SELECT key FROM settings WHERE key = ?`, [k]);
    if (!exists) await setSetting(k, v);
  }
  // 关键：确保二级密码存在
  if (!(await getSetting('delete_password'))) await setSetting('delete_password', '888888');

  console.log(`[libSQL] 数据源：${TARGET.mode}`);
}

/* ------------------------------------------------------------------ *
 * 业务：生产进度同步
 * ------------------------------------------------------------------ */
function deriveStatus(done, qty) {
  if (done <= 0) return '下达';
  if (qty > 0 && done >= qty) return '完工';
  return '开工';
}

/** 依据生产明细重算生产进度表（订单号 + 产品编号 维度） */
async function syncOrders() {
  const rows = await all(
    `SELECT ri.order_no, ri.product_code, ri.product_name, ri.spec, ri.unit,
            ri.order_qty, ri.today_qty, r.report_date
       FROM report_items ri
       JOIN reports r ON r.id = ri.report_id
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
    g.order_qty = num(r.order_qty); // 取最近一次录入的订单数量
    if (r.product_name) g.product_name = r.product_name;
    if (r.spec) g.spec = r.spec;
    if (r.unit) g.unit = r.unit;
    g.last_date = r.report_date;
  }

  const existing = await all(`SELECT * FROM orders`);
  const existMap = new Map(existing.map((o) => [`${o.order_no}||${o.product_code}`, o]));
  const stamp = nowISO();

  for (const g of map.values()) {
    const key = `${g.order_no}||${g.product_code}`;
    const old = existMap.get(key);
    if (!old) {
      const st = deriveStatus(g.done_qty, g.order_qty);
      await run(
        `INSERT INTO orders(order_no, product_code, product_name, spec, unit, order_qty, done_qty, status, manual, first_date, last_date, created_at, updated_at)
         VALUES(?,?,?,?,?,?,?,?,0,?,?,?,?)`,
        [g.order_no, g.product_code, g.product_name, g.spec, g.unit, g.order_qty, g.done_qty, st, g.first_date, g.last_date, stamp, stamp]
      );
      continue;
    }
    let status = old.status;
    if (Number(old.manual) === 1) {
      status = old.status; // 人工指定状态保留
    } else if (num(g.order_qty) > num(old.order_qty) && num(old.order_qty) > 0) {
      status = '追加'; // 订单数量增加 -> 追加
    } else {
      status = deriveStatus(g.done_qty, g.order_qty);
    }
    await run(
      `UPDATE orders SET product_name=?, spec=?, unit=?, order_qty=?, done_qty=?, status=?, first_date=?, last_date=?, updated_at=? WHERE id=?`,
      [g.product_name, g.spec, g.unit, g.order_qty, g.done_qty, status, g.first_date, g.last_date, stamp, old.id]
    );
  }
}

/** 单据中出现的新产品自动登记到基础物品信息（不覆盖已有档案的名称/规格） */
async function registerProduct(code, name, spec, unit) {
  const c = str(code).trim();
  if (!c) return;
  const exist = await one(`SELECT id FROM products WHERE code = ?`, [c]);
  if (exist) return;
  const stamp = nowISO();
  await run(`INSERT INTO products(code, name, spec, unit, created_at, updated_at) VALUES(?,?,?,?,?,?)`, [
    c,
    str(name).trim(),
    str(spec).trim(),
    str(unit).trim(),
    stamp,
    stamp,
  ]);
}

/* ------------------------------------------------------------------ *
 * 查询组装
 * ------------------------------------------------------------------ */
async function getHistoryRows({ from, to, q, line } = {}) {
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
  const sql = `SELECT ri.id AS item_id, ri.report_id, r.report_date, r.line, r.attendance, r.work_hours, r.remark AS report_remark,
                      ri.seq, ri.order_no, ri.product_code, ri.product_name, ri.spec, ri.unit,
                      ri.order_qty, ri.today_qty, ri.remark
                 FROM report_items ri
                 JOIN reports r ON r.id = ri.report_id
                ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                ORDER BY r.report_date DESC, r.line ASC, ri.seq ASC, ri.id ASC`;
  return all(sql, args);
}

async function getStock() {
  const prod = await all(
    `SELECT product_code, product_name,
            MAX(spec) AS spec, MAX(unit) AS unit,
            SUM(today_qty) AS produced
       FROM report_items
      WHERE TRIM(product_code) <> '' OR TRIM(product_name) <> ''
      GROUP BY product_code, product_name`
  );
  const inb = await all(`SELECT product_code, SUM(qty) AS qty FROM inbound GROUP BY product_code`);
  const outb = await all(`SELECT product_code, SUM(qty) AS qty FROM outbound GROUP BY product_code`);

  const inMap = new Map(inb.map((r) => [r.product_code, num(r.qty)]));
  const outMap = new Map(outb.map((r) => [r.product_code, num(r.qty)]));
  const map = new Map();

  for (const p of prod) {
    const key = `${p.product_code}||${p.product_name}`;
    map.set(key, {
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
  // 仅入库/出库中存在的基础数据
  const products = await all(`SELECT code, name, spec, unit FROM products`);
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
  for (const r of await all(`SELECT DISTINCT product_code, product_name FROM inbound`)) ensure(r.product_code, r.product_name);
  for (const r of await all(`SELECT DISTINCT product_code, product_name FROM outbound`)) ensure(r.product_code, r.product_name);

  const list = [...map.values()].map((r) => ({ ...r, stock: r.produced + r.inbound - r.outbound }));
  list.sort((a, b) => String(a.product_code).localeCompare(String(b.product_code), 'zh-CN'));
  return list;
}

/* ------------------------------------------------------------------ *
 * HTTP 工具
 * ------------------------------------------------------------------ */
function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}
const ok = (res, data = {}) => send(res, 200, { ok: true, data });
const fail = (res, message, status = 400) => send(res, status, { ok: false, message });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 64 * 1024 * 1024) reject(new Error('请求体过大'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error('JSON 解析失败'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([\\/])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // 前端为 hash 路由，未匹配路径回退首页
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) return send(res, 404, 'Not Found');
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        res.end(html);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* ------------------------------------------------------------------ *
 * 鉴权
 * ------------------------------------------------------------------ */
async function currentUser(req) {
  const token = req.headers['x-auth-token'] || '';
  if (!token) return null;
  const row = await one(`SELECT * FROM sessions WHERE token = ?`, [token]);
  if (!row) return null;
  return { id: row.user_id, username: row.username };
}

async function checkDeletePassword(req) {
  const pwd = str(req.headers['x-delete-password']);
  if (!pwd) return false;
  const expected = await getSetting('delete_password', '888888');
  const admin = await one(`SELECT * FROM users WHERE username = 'admin'`);
  const isAdminPwd = admin ? verifyPassword(pwd, admin.salt, admin.password_hash) : false;
  return pwd === expected || isAdminPwd;
}

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */
const routes = [];
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const regex = new RegExp(
    '^' +
      pattern.replace(/:([A-Za-z0-9_]+)/g, (_, k) => {
        keys.push(k);
        return '([^/]+)';
      }) +
      '$'
  );
  routes.push({ method, regex, keys, handler, opts });
}

/* ---------------- 认证 ---------------- */
route('POST', '/api/auth/login', async (req, res) => {
  const body = await readBody(req);
  const username = str(body.username).trim();
  const password = str(body.password);
  if (!username || !password) return fail(res, '请输入账号与密码');
  const user = await one(`SELECT * FROM users WHERE username = ?`, [username]);
  if (!user || !verifyPassword(password, user.salt, user.password_hash)) return fail(res, '账号或密码错误', 401);
  const token = crypto.randomBytes(24).toString('hex');
  await run(`INSERT INTO sessions(token, user_id, username, created_at) VALUES(?,?,?,?)`, [token, user.id, user.username, nowISO()]);
  ok(res, { token, user: { id: user.id, username: user.username, role: user.role } });
});

route('POST', '/api/auth/logout', async (req) => {
  const token = req.headers['x-auth-token'];
  if (token) await run(`DELETE FROM sessions WHERE token = ?`, [token]);
});

route('GET', '/api/auth/me', async (req, res) => {
  const u = await currentUser(req);
  ok(res, { user: u });
});

route('POST', '/api/auth/password', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录', 401);
  const body = await readBody(req);
  const user = await one(`SELECT * FROM users WHERE id = ?`, [u.id]);
  if (!verifyPassword(str(body.oldPassword), user.salt, user.password_hash)) return fail(res, '原密码错误');
  const { salt, hash } = makeHash(str(body.newPassword));
  await run(`UPDATE users SET password_hash=?, salt=? WHERE id=?`, [hash, salt, user.id]);
  ok(res, {});
});

/* ---------------- 基础物品信息 ---------------- */
route('GET', '/api/products', async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = str(u.searchParams.get('q')).trim();
  const rows = q
    ? await all(
        `SELECT * FROM products WHERE code LIKE ? OR name LIKE ? OR spec LIKE ? ORDER BY code ASC LIMIT 500`,
        [`%${q}%`, `%${q}%`, `%${q}%`]
      )
    : await all(`SELECT * FROM products ORDER BY code ASC LIMIT 5000`);
  ok(res, rows);
});

route('POST', '/api/products', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录后再录入数据', 401);
  const body = await readBody(req);
  const list = Array.isArray(body.items) ? body.items : [body];
  const stamp = nowISO();
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
    const exist = await one(`SELECT id FROM products WHERE code = ?`, [code]);
    if (exist) {
      await run(`UPDATE products SET name=?, spec=?, unit=?, updated_at=? WHERE id=?`, [name, spec, unit, stamp, exist.id]);
      updated++;
    } else {
      await run(
        `INSERT INTO products(code, name, spec, unit, created_at, updated_at) VALUES(?,?,?,?,?,?)`,
        [code, name, spec, unit, stamp, stamp]
      );
      created++;
    }
  }
  ok(res, { created, updated, skipped, total: list.length });
});

route('PUT', '/api/products/:id', async (req, res, params) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录后再录入数据', 401);
  const body = await readBody(req);
  await run(`UPDATE products SET code=?, name=?, spec=?, unit=?, updated_at=? WHERE id=?`, [
    str(body.code).trim(),
    str(body.name).trim(),
    str(body.spec).trim(),
    str(body.unit).trim(),
    nowISO(),
    Number(params.id),
  ]);
  ok(res, {});
});

route('DELETE', '/api/products/:id', async (req, res, params) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录', 401);
  if (!(await checkDeletePassword(req))) return fail(res, '二级密码错误，删除已取消', 403);
  await run(`DELETE FROM products WHERE id = ?`, [Number(params.id)]);
  ok(res, {});
});

/* ---------------- 今日报表 / 历史记录 ---------------- */
route('GET', '/api/reports', async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const date = str(u.searchParams.get('date'));
  const line = str(u.searchParams.get('line'));
  if (date) {
    const rep = line
      ? await one(`SELECT * FROM reports WHERE report_date=? AND line=?`, [date, line])
      : await one(`SELECT * FROM reports WHERE report_date=? ORDER BY id DESC LIMIT 1`, [date]);
    if (!rep) return ok(res, null);
    const items = await all(`SELECT * FROM report_items WHERE report_id=? ORDER BY seq ASC, id ASC`, [rep.id]);
    return ok(res, { ...rep, items });
  }
  const rows = await all(`SELECT * FROM reports ORDER BY report_date DESC LIMIT 200`);
  ok(res, rows);
});

route('POST', '/api/reports', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '游客模式无法录入，请先登录', 401);
  const body = await readBody(req);
  const date = str(body.report_date).trim() || today();
  const line = str(body.line).trim() || '一线';
  const attendance = num(body.attendance);
  const hours = num(body.work_hours);
  const items = (Array.isArray(body.items) ? body.items : []).filter(
    (it) => str(it.order_no).trim() || str(it.product_code).trim() || str(it.product_name).trim()
  );
  if (!items.length) return fail(res, '请至少录入一条生产明细');

  const stamp = nowISO();
  const exist = await one(`SELECT id FROM reports WHERE report_date=? AND line=?`, [date, line]);
  let reportId;
  if (exist) {
    reportId = Number(exist.id);
    await run(`UPDATE reports SET attendance=?, work_hours=?, remark=?, created_by=?, updated_at=? WHERE id=?`, [
      attendance,
      hours,
      str(body.remark),
      u.username,
      stamp,
      reportId,
    ]);
    await run(`DELETE FROM report_items WHERE report_id=?`, [reportId]);
  } else {
    const r = await run(
      `INSERT INTO reports(report_date, line, attendance, work_hours, remark, created_by, created_at, updated_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      [date, line, attendance, hours, str(body.remark), u.username, stamp, stamp]
    );
    reportId = Number(r.lastInsertRowid);
  }

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const code = str(it.product_code).trim();
    const name = str(it.product_name).trim();
    // 录入即带入基础物品信息
    if (code && (name || it.unit)) {
      const p = await one(`SELECT id, name, spec, unit FROM products WHERE code=?`, [code]);
      if (!p) {
        await run(`INSERT INTO products(code, name, spec, unit, created_at, updated_at) VALUES(?,?,?,?,?,?)`, [
          code,
          name,
          str(it.spec || it.spec_model).trim(),
          str(it.unit).trim(),
          stamp,
          stamp,
        ]);
      }
    }
    await run(
      `INSERT INTO report_items(report_id, seq, order_no, product_code, product_name, spec, unit, order_qty, today_qty, remark)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
      [
        reportId,
        i + 1,
        str(it.order_no).trim(),
        code,
        name,
        str(it.spec).trim(),
        str(it.unit).trim(),
        num(it.order_qty),
        num(it.today_qty),
        str(it.remark),
      ]
    );
  }

  await syncOrders();
  ok(res, { report_id: reportId, count: items.length });
});

route('DELETE', '/api/reports/:id', async (req, res, params) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录', 401);
  if (!(await checkDeletePassword(req))) return fail(res, '二级密码错误，删除已取消', 403);
  const id = Number(params.id);
  await run(`DELETE FROM report_items WHERE report_id=?`, [id]);
  await run(`DELETE FROM reports WHERE id=?`, [id]);
  await syncOrders();
  ok(res, {});
});

route('GET', '/api/history', async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const rows = await getHistoryRows({
    from: str(u.searchParams.get('from')),
    to: str(u.searchParams.get('to')),
    q: str(u.searchParams.get('q')).trim(),
    line: str(u.searchParams.get('line')),
  });
  ok(res, rows);
});

route('DELETE', '/api/history/:id', async (req, res, params) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录', 401);
  if (!(await checkDeletePassword(req))) return fail(res, '二级密码错误，删除已取消', 403);
  await run(`DELETE FROM report_items WHERE id=?`, [Number(params.id)]);
  await syncOrders();
  ok(res, {});
});

/* ---------------- 生产进度 ---------------- */
route('GET', '/api/orders', async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = str(u.searchParams.get('q')).trim();
  const status = str(u.searchParams.get('status'));
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
  const rows = await all(
    `SELECT * FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC, id DESC`,
    args
  );
  ok(res, rows);
});

route('PUT', '/api/orders/:id', async (req, res, params) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录后再修改数据', 401);
  const body = await readBody(req);
  const id = Number(params.id);
  const fields = [];
  const args = [];
  if (body.status !== undefined) {
    fields.push('status=?', 'manual=?');
    args.push(str(body.status), 1);
  }
  if (body.order_qty !== undefined) {
    fields.push('order_qty=?');
    args.push(num(body.order_qty));
  }
  if (!fields.length) return ok(res, {});
  args.push(nowISO(), id);
  await run(`UPDATE orders SET ${fields.join(', ')}, updated_at=? WHERE id=?`, args);
  ok(res, {});
});

route('DELETE', '/api/orders/:id', async (req, res, params) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录', 401);
  if (!(await checkDeletePassword(req))) return fail(res, '二级密码错误，删除已取消', 403);
  await run(`DELETE FROM orders WHERE id=?`, [Number(params.id)]);
  ok(res, {});
});

/* ---------------- 成品库存 ---------------- */
route('GET', '/api/stock', async (req, res) => ok(res, await getStock()));

route('GET', '/api/inbound', async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = str(u.searchParams.get('q')).trim();
  const from = str(u.searchParams.get('from'));
  const to = str(u.searchParams.get('to'));
  const where = [];
  const args = [];
  if (q) {
    where.push(`(product_code LIKE ? OR product_name LIKE ? OR summary LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (from) {
    where.push(`in_date >= ?`);
    args.push(from);
  }
  if (to) {
    where.push(`in_date <= ?`);
    args.push(to);
  }
  ok(res, await all(`SELECT * FROM inbound ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY in_date DESC, id DESC`, args));
});

route('POST', '/api/inbound', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '游客模式无法录入，请先登录', 401);
  const body = await readBody(req);
  const stamp = nowISO();
  const r = await run(
    `INSERT INTO inbound(in_date, product_code, product_name, spec, qty, summary, remark, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      str(body.in_date) || today(),
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
  ok(res, { id: Number(r.lastInsertRowid) });
});

route('PUT', '/api/inbound/:id', async (req, res, params) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录后再修改数据', 401);
  const body = await readBody(req);
  await run(`UPDATE inbound SET in_date=?, product_code=?, product_name=?, spec=?, qty=?, summary=?, remark=?, updated_at=? WHERE id=?`, [
    str(body.in_date),
    str(body.product_code).trim(),
    str(body.product_name).trim(),
    str(body.spec).trim(),
    num(body.qty),
    str(body.summary),
    str(body.remark),
    nowISO(),
    Number(params.id),
  ]);
  ok(res, {});
});

route('DELETE', '/api/inbound/:id', async (req, res, params) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录', 401);
  if (!(await checkDeletePassword(req))) return fail(res, '二级密码错误，删除已取消', 403);
  await run(`DELETE FROM inbound WHERE id=?`, [Number(params.id)]);
  ok(res, {});
});

route('GET', '/api/outbound', async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const q = str(u.searchParams.get('q')).trim();
  const from = str(u.searchParams.get('from'));
  const to = str(u.searchParams.get('to'));
  const where = [];
  const args = [];
  if (q) {
    where.push(`(product_code LIKE ? OR product_name LIKE ? OR summary LIKE ?)`);
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (from) {
    where.push(`out_date >= ?`);
    args.push(from);
  }
  if (to) {
    where.push(`out_date <= ?`);
    args.push(to);
  }
  ok(res, await all(`SELECT * FROM outbound ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY out_date DESC, id DESC`, args));
});

route('POST', '/api/outbound', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '游客模式无法录入，请先登录', 401);
  const body = await readBody(req);
  const stamp = nowISO();
  const r = await run(
    `INSERT INTO outbound(out_date, product_code, product_name, spec, qty, summary, remark, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    [
      str(body.out_date) || today(),
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
  ok(res, { id: Number(r.lastInsertRowid) });
});

route('PUT', '/api/outbound/:id', async (req, res, params) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录后再修改数据', 401);
  const body = await readBody(req);
  await run(`UPDATE outbound SET out_date=?, product_code=?, product_name=?, spec=?, qty=?, summary=?, remark=?, updated_at=? WHERE id=?`, [
    str(body.out_date),
    str(body.product_code).trim(),
    str(body.product_name).trim(),
    str(body.spec).trim(),
    num(body.qty),
    str(body.summary),
    str(body.remark),
    nowISO(),
    Number(params.id),
  ]);
  ok(res, {});
});

route('DELETE', '/api/outbound/:id', async (req, res, params) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录', 401);
  if (!(await checkDeletePassword(req))) return fail(res, '二级密码错误，删除已取消', 403);
  await run(`DELETE FROM outbound WHERE id=?`, [Number(params.id)]);
  ok(res, {});
});

/* ---------------- 系统配置 ---------------- */
route('GET', '/api/settings', async (req, res) => {
  const rows = await all(`SELECT key, value FROM settings`);
  ok(res, Object.fromEntries(rows.map((r) => [r.key, r.value])));
});

route('PUT', '/api/settings', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录', 401);
  const body = await readBody(req);
  for (const [k, v] of Object.entries(body || {})) {
    if (k === 'delete_password' && !str(v)) continue;
    await setSetting(k, v);
  }
  ok(res, {});
});

route('POST', '/api/verify-delete-password', async (req, res) => {
  const body = await readBody(req);
  const u = await currentUser(req);
  const pwd = str(body.password);
  const expected = await getSetting('delete_password', '888888');
  const admin = await one(`SELECT * FROM users WHERE username='admin'`);
  const pass = pwd === expected || (admin ? verifyPassword(pwd, admin.salt, admin.password_hash) : false);
  if (!pass) {
    await ensureDeletePasswordExists();
    void u;
  }
  ok(res, { valid: pass });
});

async function ensureDeletePasswordExists() {
  if (!(await getSetting('delete_password'))) await setSetting('delete_password', '888888');
}

/* ---------------- 导出 / 备份 ---------------- */
const EXPORT_DEFS = {
  products: {
    title: '基础物品信息',
    headers: ['产品编号', '产品名称', '规格型号', '单位'],
    async rows() {
      const r = await all(`SELECT code, name, spec, unit FROM products ORDER BY code`);
      return r.map((x) => [x.code, x.name, x.spec, x.unit]);
    },
  },
  reports: {
    title: '今日报表',
    headers: ['日期', '线别', '出勤人数', '出勤时间', '总产量', 'UPPH', 'UPPD', '录入人', '更新时间'],
    async rows() {
      const list = await all(`SELECT * FROM reports ORDER BY report_date DESC`);
      const out = [];
      for (const rep of list) {
        const items = await all(`SELECT today_qty FROM report_items WHERE report_id=?`, [rep.id]);
        const total = items.reduce((s, i) => s + num(i.today_qty), 0);
        const manHours = num(rep.attendance) * num(rep.work_hours);
        out.push([
          rep.report_date,
          rep.line,
          rep.attendance,
          rep.work_hours,
          total,
          manHours ? (total / manHours).toFixed(2) : '0.00',
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
      const r = await getHistoryRows({});
      return r.map((x) => [
        x.report_date,
        x.line,
        x.order_no,
        x.product_code,
        x.product_name,
        x.spec,
        x.unit,
        x.order_qty,
        x.today_qty,
        x.attendance,
        x.remark,
      ]);
    },
  },
  orders: {
    title: '生产进度',
    headers: ['订单号', '产品编号', '产品名称', '规格型号', '单位', '订单数量', '完成数量', '进度', '订单状态', '开始日期', '最近日期'],
    async rows() {
      const r = await all(`SELECT * FROM orders ORDER BY id DESC`);
      return r.map((x) => [
        x.order_no,
        x.product_code,
        x.product_name,
        x.spec,
        x.unit,
        x.order_qty,
        x.done_qty,
        num(x.order_qty) ? `${Math.min(100, (num(x.done_qty) / num(x.order_qty)) * 100).toFixed(1)}%` : '0%',
        x.status,
        x.first_date,
        x.last_date,
      ]);
    },
  },
  stock: {
    title: '成品库存',
    headers: ['产品编号', '产品名称', '规格型号', '单位', '生产数量', '其他入库', '成品出库', '成品库存'],
    async rows() {
      const r = await getStock();
      return r.map((x) => [x.product_code, x.product_name, x.spec, x.unit, x.produced, x.inbound, x.outbound, x.stock]);
    },
  },
  inbound: {
    title: '其他入库',
    headers: ['入库日期', '产品编号', '产品名称', '规格型号', '入库数量', '入库摘要', '备注'],
    async rows() {
      const r = await all(`SELECT * FROM inbound ORDER BY in_date DESC`);
      return r.map((x) => [x.in_date, x.product_code, x.product_name, x.spec, x.qty, x.summary, x.remark]);
    },
  },
  outbound: {
    title: '成品出库',
    headers: ['出库日期', '产品编号', '产品名称', '规格型号', '出库数量', '出库摘要', '备注'],
    async rows() {
      const r = await all(`SELECT * FROM outbound ORDER BY out_date DESC`);
      return r.map((x) => [x.out_date, x.product_code, x.product_name, x.spec, x.qty, x.summary, x.remark]);
    },
  },
};

function toCSV(headers, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n');
}

route('GET', '/api/export', async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const table = str(u.searchParams.get('table'));
  const format = str(u.searchParams.get('format') || 'csv').toLowerCase();
  if (table === 'all' || !table) {
    const parts = [];
    for (const [key, def] of Object.entries(EXPORT_DEFS)) {
      const rows = await def.rows();
      parts.push(`# ${def.title}`);
      parts.push(toCSV(def.headers, rows).replace(/^\uFEFF/, ''));
      parts.push('');
    }
    return send(res, 200, '\uFEFF' + parts.join('\r\n'), {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="production-all-${today()}.csv"`,
    });
  }
  const def = EXPORT_DEFS[table];
  if (!def) return fail(res, '未知的数据表');
  const rows = await def.rows();
  if (format === 'json') return ok(res, { headers: def.headers, rows });
  send(res, 200, toCSV(def.headers, rows), {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${table}-${today()}.csv"`,
  });
});

route('GET', '/api/backup', async (req, res) => {
  const tables = ['products', 'reports', 'report_items', 'orders', 'inbound', 'outbound', 'settings'];
  const data = {};
  for (const t of tables) data[t] = await all(`SELECT * FROM ${t}`);
  const payload = {
    app: '生产管理系统',
    engine: 'libSQL',
    source: TARGET.mode,
    version: 1,
    exported_at: nowISO(),
    data,
  };
  send(res, 200, JSON.stringify(payload, null, 2), {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="pmc-backup-${today()}.json"`,
  });
});

route('POST', '/api/restore', async (req, res) => {
  const u = await currentUser(req);
  if (!u) return fail(res, '请先登录', 401);
  const body = await readBody(req);
  if (!(await checkDeletePassword(req))) return fail(res, '二级密码错误，还原已取消', 403);
  const data = body.data || body;
  const tables = ['report_items', 'reports', 'orders', 'inbound', 'outbound', 'products'];
  for (const t of tables) {
    if (!Array.isArray(data[t])) continue;
    await run(`DELETE FROM ${t}`);
    for (const row of data[t]) {
      const keys = Object.keys(row).filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
      if (!keys.length) continue;
      await run(
        `INSERT INTO ${t}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
        keys.map((k) => (row[k] === null || row[k] === undefined ? '' : row[k]))
      );
    }
  }
  if (Array.isArray(data.settings)) {
    for (const s of data.settings) {
      if (s.key) await setSetting(s.key, s.value);
    }
  }
  await syncOrders();
  ok(res, {});
});

/* ---------------- 首页统计 ---------------- */
route('GET', '/api/overview', async (req, res) => {
  const total = await one(`SELECT COALESCE(SUM(today_qty),0) AS v FROM report_items`);
  const days = await one(`SELECT COUNT(DISTINCT report_date) AS v FROM reports`);
  const orders = await all(`SELECT status, COUNT(*) AS c FROM orders GROUP BY status`);
  const stockCount = (await getStock()).reduce((s, x) => s + num(x.stock), 0);
  ok(res, {
    total_output: num(total.v),
    days: num(days.v),
    orders: Object.fromEntries(orders.map((o) => [o.status, num(o.c)])),
    stock_total: stockCount,
    products: num((await one(`SELECT COUNT(*) AS v FROM products`)).v),
  });
});

/* ---------------- 数据引擎标识 ---------------- */
route('GET', '/api/engine', async (req, res) => {
  const remote = !!process.env.LIBSQL_URL;
  let target = '';
  if (remote) {
    try {
      target = new URL(TARGET.url.replace(/^libsql:/, 'https:')).host;
    } catch (e) {
      target = '远程 libSQL 数据库';
    }
  } else {
    target = TARGET.url.replace(/^file:/, '');
  }
  ok(res, {
    engine: 'libSQL',
    remote,
    label: remote ? 'libSQL · Turso 云库' : 'libSQL · 本地文件',
    target,
    mode: TARGET.mode,
  });
});

/* ------------------------------------------------------------------ *
 * 主服务
 * ------------------------------------------------------------------ */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;

  if (!pathname.startsWith('/api/')) return serveStatic(res, pathname);

  const { method } = req;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.regex.exec(pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    try {
      await r.handler(req, res, params);
    } catch (err) {
      console.error(`[API ERROR] ${method} ${pathname}`, err);
      if (!res.headersSent) fail(res, `服务器错误：${err.message}`, 500);
    }
    return;
  }
  fail(res, `接口不存在：${method} ${pathname}`, 404);
});

await initDatabase();
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╭──────────────────────────────────────────────╮');
  console.log('  │            生产管理系统  已启动               │');
  console.log('  ╰──────────────────────────────────────────────╯');
  console.log(`  访问地址 : http://localhost:${PORT}`);
  console.log(`  监听地址 : ${HOST}${HOST === '127.0.0.1' ? '（仅本机，不触发防火墙提示）' : ''}`);
  console.log(`  数据引擎 : ${TARGET.mode}`);
  console.log(`  默认账号 : admin / admin123       二级密码 : 888888`);
  console.log('');
});
