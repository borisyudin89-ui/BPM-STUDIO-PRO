'use strict';
// Рисует иконку приложения («Волна»: графит + синие круги) в build/icon.png без внешних библиотек.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 512;
const SS = 4; // сглаживание: каждый пиксель считается по 4x4 подточкам
const px = Buffer.alloc(N * N * 4);
const BG = [0x1A, 0x1C, 0x1F];
const LINE = [0x2E, 0x32, 0x38];
const BLUE = [0x7A, 0x9C, 0xC6];

function inRRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
}

// Иконка «Волна»: графитовая плитка, в центре точка и два расходящихся кольца
function sample(x, y) {
  if (!inRRect(x, y, 24, 24, 488, 488, 104)) return null;
  let c = inRRect(x, y, 26, 26, 486, 486, 102) ? BG : LINE;
  const d = Math.hypot(x - 256, y - 256);
  let a = 0;
  if (d <= 46) a = 1;
  else if (Math.abs(d - 100) <= 9) a = 0.8;
  else if (Math.abs(d - 152) <= 9) a = 0.45;
  if (a) c = [0, 1, 2].map((i) => c[i] * (1 - a) + BLUE[i] * a);
  return c;
}

for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let j = 0; j < SS; j++) {
      for (let i = 0; i < SS; i++) {
        const c = sample(x + (i + 0.5) / SS, y + (j + 0.5) / SS);
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
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
]);
const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('icon written', out, png.length, 'bytes');
