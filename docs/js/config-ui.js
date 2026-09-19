/* ============================================================
   config-ui.js —— 云库连接设置（静态版专用）
   ============================================================ */

import * as db from './db.js';
import { $, toast } from './util.js';

/** 建立连接并初始化表结构 */
export async function connectAndInit(cfg) {
  await db.connect(cfg);
  await db.ensureSchema();
  return true;
}

/**
 * 启动时确保已连接：
 *   1) 分享链接里的 #cfg=xxx
 *   2) 本机浏览器保存过的配置
 *   3) 都没有 → 弹出设置窗口
 */
export async function ensureConnected() {
  const fromHash = db.configFromHash();
  const cfg = fromHash || db.readConfig();

  if (cfg && cfg.url) {
    try {
      await connectAndInit(cfg);
      return true;
    } catch (e) {
      await openDialog(false, e.message);
      return db.dbState.connected;
    }
  }
  await openDialog(true);
  return db.dbState.connected;
}

/** 打开连接设置窗口 */
export function openDialog(isFirstRun = false, errMsg = '') {
  return new Promise((resolve) => {
    const mask = $('#connMask');
    const title = $('#connTitle');
    const tip = $('#connTip');
    const urlInput = $('#connUrl');
    const tokenInput = $('#connToken');
    const result = $('#connResult');
    const share = $('#connShare');
    const shareUrl = $('#connShareUrl');
    const btnClose = $('#connClose');
    const btnCancel = $('#connCancel');
    const btnTest = $('#connTest');
    const btnSave = $('#connSave');
    const btnCopy = $('#connCopy');
    const btnReset = $('#connReset');

    const saved = db.readConfig() || {};
    urlInput.value = saved.url || '';
    tokenInput.value = saved.token || '';
    share.style.display = 'none';
    result.textContent = errMsg ? `上次连接失败：${errMsg}` : '还没测试';
    result.style.color = errMsg ? '#dc2626' : '';

    title.textContent = isFirstRun ? '首次使用 · 配置数据库连接' : '数据库连接设置';
    tip.style.display = isFirstRun ? '' : 'none';
    btnClose.classList.toggle('hidden', isFirstRun);
    btnCancel.classList.toggle('hidden', isFirstRun);

    mask.classList.remove('hidden');
    setTimeout(() => urlInput.focus(), 60);

    function close() {
      mask.classList.add('hidden');
      cleanup();
      resolve(true);
    }
    function cleanup() {
      btnTest.onclick = btnSave.onclick = btnCopy.onclick = btnClose.onclick = btnCancel.onclick = btnReset.onclick = null;
    }

    async function tryConnect() {
      const cfg = { url: urlInput.value.trim(), token: tokenInput.value.trim() };
      if (!cfg.url) {
        result.textContent = '请填写 Database URL';
        result.style.color = '#dc2626';
        return false;
      }
      btnTest.disabled = btnSave.disabled = true;
      result.textContent = '正在连接云库…';
      result.style.color = '';
      try {
        await connectAndInit(cfg);
        db.writeConfig(cfg);
        result.textContent = `连接成功 ✔ 数据源：${db.dbState.host}`;
        result.style.color = '#15803d';
        share.style.display = '';
        shareUrl.value = db.buildShareLink(cfg);
        return true;
      } catch (e) {
        result.textContent = `连接失败：${e.message || e}`;
        result.style.color = '#dc2626';
        return false;
      } finally {
        btnTest.disabled = btnSave.disabled = false;
      }
    }

    btnTest.onclick = () => tryConnect();
    btnSave.onclick = async () => {
      const ok = await tryConnect();
      if (!ok) return;
      mask.classList.add('hidden');
      cleanup();
      resolve(true);
      // 连接已改变，重新载入以刷新全部页面数据
      setTimeout(() => location.reload(), 260);
    };
    btnCopy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(shareUrl.value);
        toast('分享链接已复制，发给同事即可', 'success');
      } catch (e) {
        shareUrl.select();
        toast('请按 Ctrl+C 复制', 'info');
      }
    };
    btnClose.onclick = close;
    btnCancel.onclick = close;
    btnReset.onclick = () => {
      db.clearConfig();
      urlInput.value = '';
      tokenInput.value = '';
      share.style.display = 'none';
      result.textContent = '已清空本机保存的连接信息';
      result.style.color = '';
    };
  });
}
