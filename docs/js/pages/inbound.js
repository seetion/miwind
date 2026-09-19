/* ============================================================
   pages/inbound.js —— 其他入库
   ============================================================ */

import { createIOPage } from './ioPage.js';

export async function render(view) {
  return createIOPage(view, 'inbound');
}

export const meta = { title: '其他入库', key: 'inbound' };
