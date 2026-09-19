/* ============================================================
   pages/outbound.js —— 成品出库
   ============================================================ */

import { createIOPage } from './ioPage.js';

export async function render(view) {
  return createIOPage(view, 'outbound');
}

export const meta = { title: '成品出库', key: 'outbound' };
