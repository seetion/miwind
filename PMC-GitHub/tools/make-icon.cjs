/**
 * 生成应用图标 electron/icon.ico + icon.png（纯 Node 实现，无第三方依赖）
 * 运行： node tools/make-icon.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

/* ---------------- PNG 编码 ---------------- */
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------------- 图形定义（归一化 0~1 坐标） ---------------- */
const R = 0.225; // 外框圆角
const BR = 0.026; // 柱子圆角
const BASE = 0.745; // 柱状图底线
const BARS = [
  { x: 0.228, w: 0.132, top: 0.485 },
  { x: 0.434, w: 0.132, top: 0.262 },
  { x: 0.640, w: 0.132, top: 0.378 },
];

/** 圆角矩形命中检测 */
function inRoundRect(u, v, x, y, w, h, r) {
  if (u < x || u > x + w || v < y || v > y + h) return false;
  const cx = Math.min(Math.max(u, x + r), x + w - r);
  const cy = Math.min(Math.max(v, y + r), y + h - r);
  const dx = u - cx;
  const dy = v - cy;
  return dx * dx + dy * dy <= r * r;
}

/** 返回 [r,g,b,a] */
function sample(u, v) {
  if (!inRoundRect(u, v, 0, 0, 1, 1, R)) return [0, 0, 0, 0];
  for (const b of BARS) {
    if (inRoundRect(u, v, b.x, b.top, b.w, BASE - b.top, BR)) return [255, 255, 255, 255];
  }
  // 竖向渐变 #2f7ef3 -> #1554bb
  const t = v;
  return [
    Math.round(0x2f + (0x15 - 0x2f) * t),
    Math.round(0x7e + (0x54 - 0x7e) * t),
    Math.round(0xf3 + (0xbb - 0xf3) * t),
    255,
  ];
}

function render(size) {
  const SS = 4; // 4x 超采样抗锯齿
  const S = size * SS;
  const sum = new Float64Array(size * size * 4);
  for (let py = 0; py < S; py++) {
    const v = (py + 0.5) / S;
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S;
      const c = sample(u, v);
      const a = c[3] / 255;
      const oy = Math.floor(py / SS);
      const ox = Math.floor(px / SS);
      const i = (oy * size + ox) * 4;
      sum[i] += c[0] * a;
      sum[i + 1] += c[1] * a;
      sum[i + 2] += c[2] * a;
      sum[i + 3] += c[3];
    }
  }
  const n = SS * SS;
  const out = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const aSum = sum[i * 4 + 3]; // 已按 0~255 累加
    out[i * 4 + 3] = Math.round(aSum / n);
    if (aSum > 0) {
      const aFrac = aSum / 255; // 预乘还原用（颜色 × alpha 的和 / alpha 和）
      out[i * 4] = Math.min(255, Math.round(sum[i * 4] / aFrac));
      out[i * 4 + 1] = Math.min(255, Math.round(sum[i * 4 + 1] / aFrac));
      out[i * 4 + 2] = Math.min(255, Math.round(sum[i * 4 + 2] / aFrac));
    }
  }
  return out;
}

/* ---------------- ICO 封装（经典 BMP/DIB 条目，兼容性最好） ---------------- */
function encodeDIB(size, rgba) {
  const rowSize = size * 4;
  const andRow = ((size + 31) >> 5) * 4; // 1bpp 掩码行，按 4 字节对齐
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); // biSize
  header.writeInt32LE(size, 4); // biWidth
  header.writeInt32LE(size * 2, 8); // biHeight = XOR 图 + AND 掩码
  header.writeUInt16LE(1, 12); // biPlanes
  header.writeUInt16LE(32, 14); // biBitCount
  header.writeUInt32LE(0, 16); // BI_RGB
  header.writeUInt32LE(rowSize * size, 20); // biSizeImage

  const xor = Buffer.alloc(rowSize * size);
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y) * size * 4; // BMP 自下而上
    for (let x = 0; x < size; x++) {
      const i = srcRow + x * 4;
      const o = y * rowSize + x * 4;
      xor[o] = rgba[i + 2]; // B
      xor[o + 1] = rgba[i + 1]; // G
      xor[o + 2] = rgba[i]; // R
      xor[o + 3] = rgba[i + 3]; // A
    }
  }
  const and = Buffer.alloc(andRow * size); // 全 0，透明度交给 alpha 通道
  return Buffer.concat([header, xor, and]);
}

const SIZES = [256, 128, 64, 48, 32, 16];
const images = SIZES.map((s) => ({ size: s, data: encodeDIB(s, render(s)) }));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);

let offset = 6 + images.length * 16;
const entries = [];
for (const img of images) {
  const e = Buffer.alloc(16);
  e[0] = img.size >= 256 ? 0 : img.size;
  e[1] = img.size >= 256 ? 0 : img.size;
  e[2] = 0;
  e[3] = 0;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(img.data.length, 8);
  e.writeUInt32LE(offset, 12);
  entries.push(e);
  offset += img.data.length;
}
const ico = Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'electron');
const buildDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);
fs.writeFileSync(path.join(outDir, 'icon.png'), encodePNG(256, render(256)));
// 打包工具默认从 build/ 目录读取图标
fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
fs.writeFileSync(path.join(buildDir, 'icon.png'), encodePNG(256, render(256)));
console.log(`已生成图标（尺寸 ${SIZES.join('/')}，${(ico.length / 1024).toFixed(1)} KB）：electron/icon.ico、build/icon.ico`);
