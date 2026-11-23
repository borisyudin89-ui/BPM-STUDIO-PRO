'use strict';
// Запуск: npm test. Проверяет точность темпа, форматы, кириллицу в путях,
// плавающий темп, битый файл и отсутствие хранения данных между запусками.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { analyzeFile } = require('../src/analyze-core');
const { drumTrack, chord, wavBuffer } = require('./synth');

const results = [];
let failed = false;
function record(name, expected, got, ok) {
  results.push({ name, expected, got, ok });
  console.log((ok ? 'OK   ' : 'FAIL ') + name + ' | ожидалось: ' + expected + ' | получилось: ' + got);
  if (!ok) failed = true;
}

function ff(args) {
  const r = spawnSync(require('ffmpeg-static'), ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bpmtest-'));
  try {
    // 1. точность на разных темпах
    for (const bpm of [90, 120, 128, 140]) {
      const f = path.join(dir, 'click_' + bpm + '.wav');
      fs.writeFileSync(f, wavBuffer(drumTrack(() => bpm, 40)));
      const r = await analyzeFile(f);
      record('темп ' + bpm, bpm + ' ±0.5', r.bpm, Math.abs(r.bpm - bpm) <= 0.5);
      if (bpm === 128) record('ровный темп не «плавает»', 'false', r.floating, r.floating === false);
    }

    // 2. форматы
    const base = path.join(dir, 'click_128.wav');
    const fmts = [['mp3', []], ['flac', []], ['m4a', ['-c:a', 'aac']], ['ogg', ['-c:a', 'libvorbis']]];
    for (const [ext, extra] of fmts) {
      const out = path.join(dir, 'fmt_128.' + ext);
      try {
        ff(['-i', base, ...extra, out]);
      } catch (e) {
        record('формат ' + ext, 'файл создан', 'ffmpeg не умеет кодировать: ' + e.message.slice(0, 80), false);
        continue;
      }
      const r = await analyzeFile(out);
      console.log('DIAG ' + ext + ' ' + JSON.stringify(r.diag));
      record('формат ' + ext, '128 ±0.5, не «плавает»', r.bpm + ', floating=' + r.floating, Math.abs(r.bpm - 128) <= 0.5 && r.floating === false);
    }

    // 3. путь с пробелами, скобками и кириллицей
    const odd = path.join(dir, 'Тест трек (1) ёж & co.wav');
    fs.copyFileSync(base, odd);
    const ro = await analyzeFile(odd);
    record('кириллица и пробелы в пути', '128 ±0.5', ro.bpm, Math.abs(ro.bpm - 128) <= 0.5);

    // 4. плавающий темп 118 -> 126
    const fl = path.join(dir, 'float.wav');
    fs.writeFileSync(fl, wavBuffer(drumTrack((t) => 118 + (8 * t) / 60, 60)));
    const rf = await analyzeFile(fl);
    record('плавающий темп помечен', 'floating=true, среднее ~122', 'floating=' + rf.floating + ', bpm=' + rf.bpm,
      rf.floating === true && Math.abs(rf.bpm - 122) <= 2);

    // 5. битый файл
    const bad = path.join(dir, 'broken.mp3');
    fs.writeFileSync(bad, Buffer.from(Array.from({ length: 2000 }, (_, i) => (i * 37) % 251)));
    let msg = '';
    try { await analyzeFile(bad); } catch (e) { msg = e.message; }
    record('битый файл даёт ошибку, а не падение', 'ошибка', msg || 'нет ошибки', !!msg);

    // 6. тональность (информационно: A minor)
    const kf = path.join(dir, 'key.wav');
    const kbuf = drumTrack(() => 120, 30);
    const ch = chord([220, 261.63, 329.63], 30);
    for (let i = 0; i < kbuf.length; i++) kbuf[i] = kbuf[i] * 0.3 + ch[i] * 0.5;
    fs.writeFileSync(kf, wavBuffer(kbuf));
    const rk = await analyzeFile(kf);
    console.log('INFO тональность синтетического Am: ' + rk.key + ' (ожидается Am)');
    record('тональность определяется', 'любое значение, не «—»', rk.key, rk.key !== '—');

    // 7. нет хранения данных между запусками
    const srcDir = path.join(__dirname, '..', 'src');
    const bad2 = /localStorage|sessionStorage|indexedDB|writeFileSync|writeFile\(|createWriteStream|appendFile/;
    const offenders = [];
    (function walk(d) {
      for (const n of fs.readdirSync(d)) {
        const p = path.join(d, n);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (n !== 'smoke.js' && /\.(js|html)$/.test(n) && bad2.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(srcDir, p));
      }
    })(srcDir);
    record('в коде нет сохранения данных на диск', 'нет совпадений', offenders.join(', ') || 'нет совпадений', offenders.length === 0);
  } catch (e) {
    console.error('Тест упал с исключением:', e);
    failed = true;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('\nИтого: ' + results.filter((r) => r.ok).length + ' из ' + results.length + ' прошло');
  process.exit(failed ? 1 : 0);
})();
