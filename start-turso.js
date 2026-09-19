/**
 * ============================================================
 *  Turso 云库版 启动器（备选方案，与本地版完全隔离）
 * ------------------------------------------------------------
 *  · 本地版  : npm start            → 端口 5173，数据在 ./data/pmc.db
 *  · 云库版  : npm run turso        → 端口 5174，数据在 Turso 云端
 *
 *  本文件不会修改任何本地数据；配置缺失或连不上云库时，
 *  只会打印提示并退出，本地版照常可用。
 * ============================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CFG_PATH = path.join(ROOT, 'turso.config.json');
const EXAMPLE_PATH = path.join(ROOT, 'turso.config.example.json');
const LOCAL_DB = path.join(ROOT, 'data', 'pmc.db');

const C = {
  reset: '\x1b[0m',
  b: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
};

function printGuide(reason) {
  const lines = [
    '',
    `${C.yellow}${C.b}⚠  ${reason}${C.reset}`,
    '',
    `${C.b}【云库版使用步骤】（一共 3 步，做错了也没关系，本地版不会受影响）${C.reset}`,
    '',
    `  ${C.blue}第 1 步｜注册 Turso 并建库${C.reset}`,
    '     打开 https://turso.tech 用 GitHub 或邮箱注册 →',
    '     进入控制台 → Create Database → 名字随便填（例如 pmc）→ 地区选 Singapore 或 Tokyo。',
    '',
    `  ${C.blue}第 2 步｜拿到两串东西${C.reset}`,
    '     数据库详情页里复制：',
    `       · Database URL  形如 ${C.dim}libsql://pmc-xxxx.turso.io${C.reset}`,
    '       · Auth Token    点 Create Token 生成，一长串以 ey 开头的字符',
    '',
    `  ${C.blue}第 3 步｜填进配置文件${C.reset}`,
    `     用记事本打开本文件夹里的 ${C.b}turso.config.json${C.reset}，`,
    '     把这两串东西分别粘贴到 url 和 authToken 后面（引号别删），保存。',
    `     然后重新运行本程序（或双击 ${C.b}启动-云库版.bat${C.reset}）。`,
    '',
    `${C.b}【常见疑问】${C.reset}`,
    '  · 会不会把现在的系统搞坏？不会。云库版是另一个程序、另一个端口(5174)、另一份数据，',
    '    本地版仍是 npm start / 端口 5173 / data/pmc.db，两者互不干扰。',
    `  · 本地已有的数据怎么搬到云库？先开本地版 → 系统配置 → 下载备份文件；`,
    '    再开云库版 → 系统配置 → 从备份文件还原（需二级密码）。',
    '  · 想撤销？把 turso.config.json 删掉即可，本地版一直没变过。',
    '',
    `  ${C.dim}本地版数据文件：${LOCAL_DB}${C.reset}`,
    '',
  ];
  console.log(lines.join('\n'));
}

function fail(msg) {
  console.error(`${C.red}${C.b}✖ ${msg}${C.reset}`);
  console.error(`${C.dim}本地版不受影响，可继续使用：npm start（端口 5173）${C.reset}\n`);
  process.exit(1);
}

/* ---------------- 读取配置 ---------------- */
let cfg = {};
if (process.env.LIBSQL_URL) {
  // 直接通过环境变量传入（进阶用法，优先级最高）
  cfg = { url: process.env.LIBSQL_URL, authToken: process.env.LIBSQL_AUTH_TOKEN || '', port: process.env.PORT || 5174 };
} else {
  if (!fs.existsSync(CFG_PATH)) {
    if (fs.existsSync(EXAMPLE_PATH)) fs.copyFileSync(EXAMPLE_PATH, CFG_PATH);
    printGuide('还没有配置文件，已为你生成 turso.config.json，请先填写后再运行。');
    process.exit(1);
  }
  try {
    cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    printGuide('turso.config.json 不是合法的 JSON（可能是少了引号、逗号或大括号）。');
    process.exit(1);
  }
}

const url = String(cfg.url || '').trim();
const authToken = String(cfg.authToken || '').trim();
const port = Number(cfg.port || process.env.PORT || 5174);

if (!url || url.includes('这里填')) {
  printGuide('配置文件里的 url 还没填写。');
  process.exit(1);
}
if (!/^(libsql|https|wss):\/\//i.test(url)) {
  printGuide('url 格式不对，应形如 libsql://xxxx.turso.io（注意开头的 libsql://）。');
  process.exit(1);
}
if (!authToken || authToken.includes('这里填')) {
  printGuide('配置文件里的 authToken 还没填写。');
  process.exit(1);
}

/* ---------------- 连通性自检（只读，不写数据） ---------------- */
console.log(`\n${C.dim}正在连接 Turso 云库：${url}${C.reset}`);
let probe;
try {
  probe = createClient({ url, authToken });
  await probe.execute('SELECT 1 AS ok');
  await probe.close();
  console.log(`${C.green}✔ 云库连接成功${C.reset}`);
} catch (e) {
  try {
    if (probe) await probe.close();
  } catch (_) {}
  console.error(`${C.red}${C.b}✖ 云库连接失败：${e.message || e}${C.reset}`);
  console.error(`${C.dim}可能原因：地址/令牌填错、令牌已失效、网络不通。${C.reset}`);
  console.error(`${C.dim}本地版不受影响，可继续使用：npm start（端口 5173）${C.reset}\n`);
  process.exit(1);
}

/* ---------------- 启动云库版 ---------------- */
process.env.LIBSQL_URL = url;
process.env.LIBSQL_AUTH_TOKEN = authToken;
process.env.PORT = String(port);

console.log(`${C.green}${C.b}▶ 启动 Turso 云库版（本地版仍在 5173 运行，互不影响）${C.reset}`);
console.log(`${C.dim}  本次不会创建或修改本地文件：${LOCAL_DB}${C.reset}`);

await import('./server.js');
