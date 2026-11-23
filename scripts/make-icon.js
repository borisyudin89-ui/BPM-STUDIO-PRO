'use strict';
// Рисует иконку приложения (графит + три синие полоски) в build/icon.png без внешних библиотек.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const N = 512;
const px = Buffer.alloc(N * N * 4);
const bg = [0x1A, 0x1C, 0x1F];
const fg = [0x7A, 0x9C, 0xC6];

function inRound(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x >= x1 || y < y0 || y >= y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r - 1);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r - 1);
  return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
}
const bars = [[130, 240, 380], [230, 130, 380], [330, 190, 380]]; // [x, top, bottom]
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const o = (y * N + x) * 4;
    let c = null;
    if (inRound(x, y, 24, 24, N - 24, N - 24, 96)) {
      c = bg;
      for (const [bx, top, bot] of bars) {
        if (inRound(x, y, bx, top, bx + 52, bot, 26)) c = fg;
      }
    }
    if (c) { px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; }
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
