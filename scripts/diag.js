'use strict';
// Замер скорости этапов анализа на длинном треке (4 минуты). Запуск: node scripts/diag.js
const { drumTrack, chord } = require('../test/synth');
const { decode, SR } = require('../src/analyze-core');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { wavBuffer } = require('../test/synth');

const ms = (t0) => Math.round(Number(process.hrtime.bigint() - t0) / 1e6);
const log = (k, v) => console.log('DIAG ' + k + ' = ' + v);

(async () => {
  let t = process.hrtime.bigint();
  const { Essentia, EssentiaWASM } = require('essentia.js');
  const e = new Essentia(EssentiaWASM);
  log('essentia_init_ms', ms(t));

  const secs = 240;
  const d = drumTrack(() => 126, secs);
  const c = chord([220, 261.63, 329.63], secs);
  for (let i = 0; i < d.length; i++) d[i] = d[i] * 0.4 + c[i] * 0.4;
  const f = path.join(os.tmpdir(), 'diag240.wav');
  fs.writeFileSync(f, wavBuffer(d));

  t = process.hrtime.bigint();
  const pcm = await decode(f);
  log('decode_240s_ms', ms(t));
  fs.unlinkSync(f);

  const run = (name, fn) => {
    const t0 = process.hrtime.bigint();
    let r;
    try { r = fn(); } catch (err) { r = 'ERR ' + err.message; }
    log(name + '_ms', ms(t0));
    return r;
  };
  const vecOf = (arr) => e.arrayToVector(arr);

  for (const [label, len] of [['240s', 240], ['120s', 120], ['60s', 60]]) {
    const sub = pcm.subarray(0, Math.min(pcm.length, len * SR));
    for (const method of ['multifeature', 'degara']) {
      const v = vecOf(sub);
      const r = run('rhythm_' + method + '_' + label, () => e.RhythmExtractor2013(v, 208, method, 40));
      if (r && r.bpm) log('rhythm_' + method + '_' + label + '_bpm', Number(r.bpm).toFixed(2));
    }
  }
  for (const len of [120, 60]) {
    const v = vecOf(pcm.subarray(0, len * SR));
    const r = run('key_' + len + 's', () => e.KeyExtractor(v));
    if (r && r.key) log('key_' + len + 's_result', r.key + ' ' + r.scale);
  }
})();
