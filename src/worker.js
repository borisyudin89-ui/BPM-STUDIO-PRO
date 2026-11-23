'use strict';
const { parentPort, workerData } = require('worker_threads');
const { analyzeFile } = require('./analyze-core');

analyzeFile(workerData.path, {
  onPid: (pid) => parentPort.postMessage({ type: 'pid', pid }),
  onProgress: (value) => parentPort.postMessage({ type: 'progress', value })
}).then(
  (result) => parentPort.postMessage({ type: 'done', result }),
  (err) => parentPort.postMessage({ type: 'error', message: (err && err.message) || String(err) })
);
