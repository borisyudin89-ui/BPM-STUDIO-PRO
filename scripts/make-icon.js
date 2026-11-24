'use strict';
// Рисует иконку приложения («Свет»: синяя плитка + графитовый метроном) в build/icon.png без внешних библиотек.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BG = [0x1A, 0x1C, 0x1F];
const BLUE = [0x7A, 0x9C, 0xC6];

function inRRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
}

function distSeg(px_, py_, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px_ - ax) * dx + (py_ - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px_ - (ax + t * dx), py_ - (ay + t * dy));
}

// контур корпуса метронома (замкнутая ломаная, углы сверху скруглены кривыми)
const body = [[200, 404], [226, 132]];
for (let i = 1; i <= 12; i++) { // Q 228 118 242 118
  const t = i / 12, u = 1 - t;
  body.push([u * u * 226 + 2 * u * t * 228 + t * t * 242, u * u * 132 + 2 * u * t * 118 + t * t * 118]);
}
body.push([270, 118]);
for (let i = 1; i <= 12; i++) { // Q 284 118 286 132
  const t = i / 12, u = 1 - t;
  body.push([u * u * 270 + 2 * u * t * 284 + t * t * 286, u * u * 118 + 2 * u * t * 118 + t * t * 132]);
}
body.push([312, 404]);

function strokeBody(x, y, half) {
  if (x < 180 || x > 332 || y < 100 || y > 424) return false;
  for (let i = 0; i < body.length; i++) {
    const a = body[i], b = body[(i + 1) % body.length];
    if (distSeg(x, y, a[0], a[1], b[0], b[1]) <= half) return true;
  }
  return false;
}

// (x, y) — в координатах рисунка 512x512
// Иконка «Свет»: синяя плитка на весь холст, графитовый метроном
function sample(x, y) {
  // плитка занимает почти весь холст (как у стандартных иконок): масштаб 1.086 от центра
  x = 256 + (x - 256) / 1.086;
  y = 256 + (y - 256) / 1.086;
  if (!inRRect(x, y, 24, 24, 488, 488, 104)) return null;
  // знак крупнее и линии толще, чтобы читался в маленьком размере (30–40 px)
  x = 256 + (x - 256) / 1.3;
  y = 261 + (y - 261) / 1.3;
  if (strokeBody(x, y, 14)) return BG;
  if (distSeg(x, y, 170, 404, 342, 404) <= 14) return BG;
  if (distSeg(x, y, 256, 372, 296, 196) <= 10) return BG;
  if (Math.hypot(x - 285, y - 246) <= 25) return BG;
  return BLUE;
}

// Каждый размер рисуем заново с нуля (а не уменьшаем большую картинку) — так линии всегда чёткие.
function render(N) {
  const SS = N <= 64 ? 8 : 4; // сглаживание: каждый пиксель считается по SS x SS подточкам
  const px = Buffer.alloc(N * N * 4);
  const k = 512 / N;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const c = sample((x + (i + 0.5) / SS) * k, (y + (j + 0.5) / SS) * k);
          if (c) { r += c[0]; g += c[1]; b += c[2]; n++; }
        }
      }
      const o = (y * N + x) * 4;
      if (n) {
        px[o] = Math.round(r / n); px[o + 1] = Math.round(g / n); px[o + 2] = Math.round(b / n);
        px[o + 3] = Math.round((255 * n) / (SS * SS));
      }
    }
  }
  return px;
}

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = crcTable[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(N, px) {
  const raw = Buffer.alloc((N * 4 + 1) * N);
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0;
    px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]);
}

const cache = {};
const pngOf = (n) => (cache[n] = cache[n] || encodePng(n, render(n)));

// Windows .ico: набор готовых размеров (PNG внутри)
function makeIco(sizes) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  const dir = []; const datas = [];
  let off = 6 + 16 * sizes.length;
  for (const n of sizes) {
    const d = pngOf(n);
    const e = Buffer.alloc(16);
    e[0] = n >= 256 ? 0 : n; e[1] = n >= 256 ? 0 : n;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(d.length, 8); e.writeUInt32LE(off, 12);
    off += d.length; dir.push(e); datas.push(d);
  }
  return Buffer.concat([head, ...dir, ...datas]);
}

// Mac .icns: те же PNG, разложенные по типам
function makeIcns() {
  const types = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  const parts = types.map(([t, n]) => {
    const d = pngOf(n);
    const h = Buffer.alloc(8); h.write(t, 0, 'latin1'); h.writeUInt32BE(d.length + 8, 4);
    return Buffer.concat([h, d]);
  });
  const total = 8 + parts.reduce((a, b) => a + b.length, 0);
  const h = Buffer.alloc(8); h.write('icns', 0, 'latin1'); h.writeUInt32BE(total, 4);
  return Buffer.concat([h, ...parts]);
}

const dir = path.join(__dirname, '..', 'build');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon.png'), pngOf(1024));
fs.writeFileSync(path.join(dir, 'icon.ico'), makeIco([16, 20, 24, 32, 40, 48, 64, 128, 256]));
fs.writeFileSync(path.join(dir, 'icon.icns'), makeIcns());
console.log('icons written to', dir);
