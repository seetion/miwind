/**
 * ============================================================
 *  生产管理系统 · 桌面版主程序（Electron）
 *  ------------------------------------------------------------
 *  · 在本进程内直接启动 libSQL 数据服务（server.js）
 *  · 自动挑选空闲端口，避免与网页版冲突
 *  · 数据默认保存在用户目录，首次运行会把随包数据迁移过去
 * ============================================================
 */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const APP_NAME = '生产管理系统';
app.setName(APP_NAME);
app.setAppUserModelId('com.pmc.production');

const isDev = !app.isPackaged;
let mainWindow = null;
let dataDir = '';

/* ---------------- 数据目录 ---------------- */
function prepareDataDir() {
  if (isDev) {
    // 开发模式：直接用项目里的 data 文件夹
    const dir = path.join(__dirname, '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  const dbFile = path.join(dir, 'pmc.db');
  if (!fs.existsSync(dbFile)) {
    // 首次运行：把打包时随附的数据（含 WAL 文件）复制过来
    const seedDir = path.join(process.resourcesPath, 'seed');
    if (fs.existsSync(seedDir)) {
      for (const f of fs.readdirSync(seedDir)) {
        if (f.startsWith('pmc.db')) {
          try {
            fs.copyFileSync(path.join(seedDir, f), path.join(dir, f));
          } catch (e) {
            /* 忽略复制失败，服务会自行建库 */
          }
        }
      }
    }
  }
  return dir;
}

/* ---------------- 端口占用检测 ---------------- */
function isPortFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}
async function findFreePort(start = 5173, end = 5299) {
  for (let p = start; p <= end; p++) {
    if (await isPortFree(p)) return p;
  }
  return 0; // 交给系统随机分配
}

/* ---------------- 菜单 ---------------- */
function buildMenu() {
  const dataItem = { label: `数据位置：${dataDir}`, enabled: false };
  return Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        { label: '打开数据文件夹', click: () => shell.openPath(dataDir) },
        { label: '刷新页面', accelerator: 'F5', click: () => mainWindow && mainWindow.reload() },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { label: '恢复默认大小', role: 'resetZoom' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: `${APP_NAME} v${app.getVersion()}（数据引擎：libSQL）`, enabled: false },
        { type: 'separator' },
        dataItem,
        {
          label: '提示：数据备份请在「系统配置 → 数据导出与备份」中操作',
          enabled: false,
        },
      ],
    },
  ]);
}

/* ---------------- 窗口 ---------------- */
function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 680,
    title: APP_NAME,
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#eef1f6',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(buildMenu());
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/* ---------------- 启动 ---------------- */
async function start() {
  dataDir = prepareDataDir();
  const port = await findFreePort(5173);

  process.env.LIBSQL_DATA_DIR = dataDir;
  process.env.PORT = String(port);
  process.env.HOST = '127.0.0.1'; // 桌面版只监听本机，避免防火墙弹窗
  process.env.PMC_DESKTOP = '1';

  try {
    await import(pathToFileURL(path.join(__dirname, '..', 'server.js')).href);
  } catch (err) {
    dialog.showErrorBox('启动失败', `数据服务无法启动：\n\n${(err && err.stack) || err}`);
    app.quit();
    return;
  }
  createWindow(port);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.whenReady().then(start);
  app.on('window-all-closed', () => app.quit());
}
