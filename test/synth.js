'use strict';
// Синтетические «барабанные» треки с известным темпом для проверки точности.
const SR = 44100;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296 * 2 - 1;
  };
}

// bpmAt(t) -> темп в BPM в момент t (сек)
function drumTrack(bpmAt, seconds) {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  const rand = rng(12345);
  const hit = (t, fn, len) => {
    const s0 = Math.floor(t * SR);
    const l = Math.floor(len * SR);
    for (let i = 0; i < l && s0 + i < n; i++) out[s0 + i] += fn(i / SR, i);
  };
  let t = 0.2;
  let beat = 0;
  while (t < seconds - 0.5) {
    const p = 60 / bpmAt(t);
    // бочка на каждую долю
    hit(t, (x) => 0.9 * Math.sin(2 * Math.PI * (50 * x + 70 * (1 - Math.exp(-x * 30)) / 30)) * Math.exp(-x * 22), 0.25);
    // снейр на 2 и 4
    if (beat % 2 === 1) hit(t, (x) => 0.45 * rand() * Math.exp(-x * 25), 0.18);
    // хэт между долями
    hit(t + p / 2, (x) => 0.22 * rand() * Math.exp(-x * 90), 0.05);
    t += p;
    beat++;
  }
  return out;
}

function chord(freqs, seconds) {
  const n = Math.floor(seconds * SR);
  const out = new Float32Array(n);
  for (const f of freqs) {
    for (let h = 1; h <= 5; h++) {
      const a = 0.25 / h;
      for (let i = 0; i < n; i++) out[i] += a * Math.sin((2 * Math.PI * f * h * i) / SR);
    }
  }
  return out;
}

function wavBuffer(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

module.exports = { drumTrack, chord, wavBuffer, SR };
