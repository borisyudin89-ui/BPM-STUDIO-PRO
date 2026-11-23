'use strict';
// Анализ одного файла: ffmpeg -> PCM в памяти -> essentia.js (темп + тональность).
// Ничего не пишется на диск и не кэшируется.
const { spawn } = require('child_process');

const SR = 44100;
const MAX_SEC = 600; // анализируем не больше 10 минут
const KEY_SEC = 120; // тональность считаем по куску из середины

function ffmpegBin() {
  return require('ffmpeg-static');
}

function decode(file, onPid) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error', '-nostdin',
      '-i', file,
      '-vn', '-t', String(MAX_SEC),
      '-ac', '1', '-ar', String(SR),
      '-f', 'f32le', 'pipe:1'
    ];
    let p;
    try {
      p = spawn(ffmpegBin(), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) {
      return reject(new Error('не удалось запустить декодер'));
    }
    if (onPid) onPid(p.pid);
    const chunks = [];
    let size = 0;
    p.stdout.on('data', (c) => { chunks.push(c); size += c.length; });
    p.stderr.on('data', () => {});
    p.on('error', () => reject(new Error('не удалось запустить декодер')));
    p.on('close', () => {
      if (size === 0) return reject(new Error('файл не читается или это не аудио'));
      if (size < SR * 4 * 3) return reject(new Error('слишком короткий файл'));
      const n = size >> 2;
      const f = new Float32Array(n);
      new Uint8Array(f.buffer).set(Buffer.concat(chunks, size).subarray(0, n * 4));
      chunks.length = 0;
      resolve(f);
    });
  });
}

let essentia = null;
function getEssentia() {
  if (!essentia) {
    const { Essentia, EssentiaWASM } = require('essentia.js');
    essentia = new Essentia(EssentiaWASM);
  }
  return essentia;
}

function foldBpm(b) {
  while (b > 180) b /= 2;
  while (b < 70) b *= 2;
  return b;
}

function toOctave(v, ref) {
  while (v < ref / 1.5) v *= 2;
  while (v > ref * 1.5) v /= 2;
  return v;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

// Наклон прямой «время бита ~ номер бита» (метод наименьших квадратов): не зависит от кривых первого и последнего бита.
function slopePeriod(ticks) {
  const n = ticks.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += ticks[i]; sxx += i * i; sxy += i * ticks[i]; }
  const d = n * sxx - sx * sx;
  return d ? (n * sxy - sx * sy) / d : 0;
}

function tempoFromBeats(rhBpm, ticks) {
  let bpm = rhBpm;
  let spread = 0;
  let floating = false;
  const n = ticks.length;
  let reg = 0;
  if (n >= 12) {
    const period = slopePeriod(ticks);
    if (period > 0) reg = toOctave(60 / period, rhBpm);
    const W = 8;
    const w = [];
    for (let i = 0; i + W < n; i += 2) {
      const dt = ticks[i + W] - ticks[i];
      if (dt > 0) w.push(toOctave((60 * W) / dt, rhBpm));
    }
    if (w.length >= 3) {
      w.sort((a, b) => a - b);
      const range = percentile(w, 0.8) - percentile(w, 0.2); // 20–80%: одиночный сбой трекера бита не считается «плаванием»
      spread = range / 2;
      floating = range / rhBpm > 0.03;
    }
    // ровный темп: берём оценку самого алгоритма; плавающий: среднее по всему треку
    if (floating && reg && Math.abs(reg - rhBpm) / rhBpm < 0.1) bpm = reg;
  }
  const shown = foldBpm(bpm);
  const k = shown / bpm;
  return { bpm: shown, spread: spread * k, floating, diag: { rh: rhBpm, reg, ticks: n } };
}

function analyzeKey(e, pcm) {
  try {
    const len = KEY_SEC * SR;
    let sub = pcm;
    if (pcm.length > len) {
      const start = ((pcm.length - len) / 2) | 0;
      sub = pcm.subarray(start, start + len);
    }
    const vec = e.arrayToVector(sub);
    let res;
    try {
      res = e.KeyExtractor(vec);
    } finally {
      if (vec.delete) vec.delete();
    }
    if (!res || !res.key) return { key: '—', keyStrength: 0 };
    const key = String(res.key) + (res.scale === 'minor' ? 'm' : '');
    return { key, keyStrength: Number(res.strength) || 0 };
  } catch (err) {
    return { key: '—', keyStrength: 0 };
  }
}

async function analyzeFile(file, hooks = {}) {
  const { onPid, onProgress } = hooks;
  const progress = (v) => { if (onProgress) onProgress(v); };
  progress(3);
  const pcm = await decode(file, onPid);
  progress(35);
  const e = getEssentia();
  const truncated = pcm.length >= MAX_SEC * SR - SR;

  const vec = e.arrayToVector(pcm);
  let rh;
  try {
    rh = e.RhythmExtractor2013(vec, 208, 'multifeature', 40);
  } finally {
    if (vec.delete) vec.delete();
  }
  const ticks = Array.from(e.vectorToArray(rh.ticks));
  const rhBpm = Number(rh.bpm);
  ['ticks', 'estimates', 'bpmIntervals'].forEach((k) => {
    if (rh[k] && rh[k].delete) rh[k].delete();
  });
  progress(75);
  if (!rhBpm || !isFinite(rhBpm) || rhBpm < 20) throw new Error('ритм не найден');

  const t = tempoFromBeats(rhBpm, ticks);
  const k = analyzeKey(e, pcm);
  progress(100);
  return {
    bpm: Math.round(t.bpm * 10) / 10,
    spread: Math.round(t.spread * 10) / 10,
    floating: t.floating,
    key: k.key,
    keyStrength: k.keyStrength,
    truncated,
    diag: t.diag
  };
}

module.exports = { analyzeFile, decode, tempoFromBeats, SR };
