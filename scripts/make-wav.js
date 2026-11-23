'use strict';
// node scripts/make-wav.js <файл.wav> [bpm] — тестовый трек для проверки сборки
const fs = require('fs');
const { drumTrack, wavBuffer } = require('../test/synth');
const bpm = Number(process.argv[3]) || 128;
fs.writeFileSync(process.argv[2], wavBuffer(drumTrack(() => bpm, 30)));
