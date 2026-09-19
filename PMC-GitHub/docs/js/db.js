/* ============================================================
   db.js —— 静态版数据层：浏览器直连 libSQL（Turso 云库）
   ------------------------------------------------------------
   本文件是「主数据引擎」的唯一入口，所有业务 SQL 都经过 exec()。
   传输方式可切换：
     · libsql  —— 浏览器版 libSQL 客户端直连云端（默认，纯静态可用）
     · http    —— 走本机 Node 后端 /api/sql（仅本地开发调试用）
   ============================================================ */

import { createClient } from './vendor/libsql-web.js';
import { loadLocal, saveLocal } from './util.js';

const CFG_KEY = 'pmc:dbcfg';

export const dbState = {
  url: '',
  token: '',
  driver: 'libsql',
  client: null,
  connected: false,
  error: '',
  host: '',
};

/* ---------------- 配置存取 ---------------- */
export function readConfig() {
  return loadLocal(CFG_KEY, null);
}
export function writeConfig(cfg) {
  saveLocal(CFG_KEY, cfg);
}
export function clearConfig() {
  localStorage.removeItem(CFG_KEY);
}

/** 支持用 #cfg=xxx 的分享链接一键配置 */
export function configFromHash() {
  const hash = location.hash || '';
  const m = hash.match(/[#&?]cfg=([^&]+)/);
  if (!m) return null;
  try {
    const json = decodeURIComponent(escape(atob(decodeURIComponent(m[1]))));
    const cfg = JSON.parse(json);
    if (cfg && cfg.url) {
      writeConfig(cfg);
      history.replaceState(null, '', location.pathname + location.search + '#/home');
      return cfg;
    }
  } catch (e) {
    /* 忽略非法分享链接 */
  }
  return null;
}

/** 生成给同事用的分享链接（把连接信息带在链接里） */
export function buildShareLink(cfg) {
  const json = JSON.stringify({ url: cfg.url, token: cfg.token });
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return `${location.origin}${location.pathname}#cfg=${encodeURIComponent(b64)}`;
}

/* ---------------- 连接 ---------------- */
function hostOf(url) {
  try {
    return new URL(String(url).replace(/^libsql:/, 'https:')).host;
  } catch (e) {
    return url;
  }
}

export async function connect(cfg) {
  const url = String(cfg.url || '').trim();
  const token = String(cfg.token || '').trim();
  if (!url) throw new Error('请填写数据库地址');
  dbState.url = url;
  dbState.token = token;
  dbState.host = hostOf(url);
  dbState.driver = cfg.driver || 'libsql';

  if (dbState.driver === 'http') {
    dbState.client = null;
  } else {
    if (!/^(libsql|https|wss):\/\//i.test(url)) {
      throw new Error('地址格式不对，应以 libsql:// 开头（例如 libsql://pmc-xxx.turso.io）');
    }
    dbState.client = createClient({ url, authToken: token });
  }

  // 连通性自检
  await exec('SELECT 1 AS ok');
  dbState.connected = true;
  dbState.error = '';
  return true;
}

/* ---------------- 统一 SQL 执行 ---------------- */
export async function exec(sql, args = []) {
  if (dbState.driver === 'http') {
    const res = await fetch('/api/sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, args }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.message || 'SQL 执行失败');
    return { rows: json.data.rows, lastInsertRowid: Number(json.data.lastInsertRowid || 0), rowsAffected: Number(json.data.rowsAffected || 0) };
  }

  const rs = await dbState.client.execute({ sql, args });
  return {
    rows: (rs.rows || []).map((r) => ({ ...r })),
    lastInsertRowid: Number(rs.lastInsertRowid || 0),
    rowsAffected: Number(rs.rowsAffected || 0),
  };
}

export const all = async (sql, args = []) => (await exec(sql, args)).rows;
export const one = async (sql, args = []) => (await all(sql, args))[0] || null;
export const run = (sql, args = []) => exec(sql, args);

/* ---------------- 密码摘要（浏览器用 WebCrypto） ---------------- */
export async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(`${salt}::${password}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function makeSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function makePasswordHash(password) {
  const salt = makeSalt();
  return { salt, hash: await hashPassword(password, salt) };
}
export async function verifyPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  return (await hashPassword(password, salt)) === hash;
}

/* ---------------- 建表 & 初始化 ---------------- */
export const nowISO = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, report_date TEXT NOT NULL, line TEXT NOT NULL DEFAULT '一线', attendance REAL NOT NULL DEFAULT 0, work_hours REAL NOT NULL DEFAULT 0, remark TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(report_date, line))`,
  `CREATE TABLE IF NOT EXISTS report_items (id INTEGER PRIMARY KEY AUTOINCREMENT, report_id INTEGER NOT NULL, seq INTEGER NOT NULL DEFAULT 0, order_no TEXT NOT NULL DEFAULT '', product_code TEXT NOT NULL DEFAULT '', product_name TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', order_qty REAL NOT NULL DEFAULT 0, today_qty REAL NOT NULL DEFAULT 0, remark TEXT NOT NULL DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY AUTOINCREMENT, order_no TEXT NOT NULL, product_code TEXT NOT NULL DEFAULT '', product_name TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '', unit TEXT NOT NULL DEFAULT '', order_qty REAL NOT NULL DEFAULT 0, done_qty REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT '下达', manual INTEGER NOT NULL DEFAULT 0, first_date TEXT NOT NULL DEFAULT '', last_date TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(order_no, product_code))`,
  `CREATE TABLE IF NOT EXISTS inbound (id INTEGER PRIMARY KEY AUTOINCREMENT, in_date TEXT NOT NULL, product_code TEXT NOT NULL DEFAULT '', product_name TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '', qty REAL NOT NULL DEFAULT 0, summary TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS outbound (id INTEGER PRIMARY KEY AUTOINCREMENT, out_date TEXT NOT NULL, product_code TEXT NOT NULL DEFAULT '', product_name TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL DEFAULT '', qty REAL NOT NULL DEFAULT 0, summary TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
];

const DEFAULT_SETTINGS = {
  delete_password: '888888',
  company_name: '生产管理系统',
  default_line: '一线',
  line_options: '一线,二线,三线,四线',
  row_padding: '2',
  page_size: '50',
};

export async function ensureSchema() {
  for (const sql of SCHEMA) await run(sql);

  const admin = await one(`SELECT id FROM users WHERE username = 'admin'`);
  if (!admin) {
    const { salt, hash } = await makePasswordHash('admin123');
    await run(`INSERT INTO users(username, password_hash, salt, role, created_at) VALUES(?,?,?,?,?)`, [
      'admin',
      hash,
      salt,
      'admin',
      nowISO(),
    ]);
  }
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    const exists = await one(`SELECT key FROM settings WHERE key = ?`, [k]);
    if (!exists) await run(`INSERT INTO settings(key, value) VALUES(?,?)`, [k, v]);
  }
  return true;
}

export async function getSetting(key, fallback = '') {
  const row = await one(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row && row.value !== null && row.value !== undefined ? row.value : fallback;
}
export async function setSetting(key, value) {
  await run(`INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [
    key,
    String(value === null || value === undefined ? '' : value),
  ]);
}

export function engineInfo() {
  return {
    engine: 'libSQL（浏览器直连）',
    remote: true,
    label: dbState.driver === 'http' ? 'libSQL · 本机调试' : 'libSQL · Turso 云库',
    target: dbState.driver === 'http' ? '本机 Node 服务 /api/sql' : dbState.host,
    mode: dbState.driver === 'http' ? 'http(本地调试)' : `web(turso) ${dbState.host}`,
  };
}
