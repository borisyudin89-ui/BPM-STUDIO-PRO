'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { Worker } = require('worker_threads');

// ---- Ничего не сохраняем между запусками: данные Chromium лежат во временной папке,
// которая удаляется при выходе (и чистятся «хвосты» от аварийно закрытых запусков).
const TMP_PREFIX = 'bpm-studio-pro-';
try {
  for (const d of fs.readdirSync(os.tmpdir())) {
    if (d.startsWith(TMP_PREFIX)) {
      try { fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true }); } catch (e) { /* занято другим запуском */ }
    }
  }
} catch (e) { /* ignore */ }
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
app.setPath('userData', tmpData);

const AUDIO_EXT = new Set([
  'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wma', 'aif', 'aiff', 'aifc',
  'mp4', 'm4b', 'webm', 'mka', 'ape', 'wv', 'amr', '3gp', 'caf', 'mp2', 'ac3', 'dts'
]);
const MAX_PARALLEL = 2;

let win = null;
let generation = 0;
const queue = [];
const active = new Map(); // id -> { worker, pid, done }

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function killPid(pid) {
  if (!pid) return;
  try { process.kill(pid); } catch (e) { /* уже завершён */ }
}

function stopJob(id) {
  const rec = active.get(id);
  if (!rec) return;
  rec.done = true;
  active.delete(id);
  killPid(rec.pid);
  rec.worker.terminate().catch(() => {});
}

function pump() {
  while (active.size < MAX_PARALLEL && queue.length) runJob(queue.shift());
}

function runJob(job) {
  const myGen = generation;
  const worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { path: job.path } });
  const rec = { worker, pid: null, done: false };
  active.set(job.id, rec);

  const finish = () => {
    if (rec.done) return;
    rec.done = true;
    if (active.get(job.id) === rec) active.delete(job.id);
    killPid(rec.pid);
    worker.terminate().catch(() => {});
    if (myGen === generation) pump();
  };

  worker.on('message', (m) => {
    if (rec.done || myGen !== generation) return;
    if (m.type === 'pid') rec.pid = m.pid;
    else if (m.type === 'progress') send('progress', { id: job.id, value: m.value });
    else if (m.type === 'done') { send('result', { id: job.id, result: m.result }); finish(); }
    else if (m.type === 'error') { send('failed', { id: job.id, message: m.message }); finish(); }
  });
  worker.on('error', (err) => {
    if (rec.done || myGen !== generation) return;
    send('failed', { id: job.id, message: 'внутренняя ошибка: ' + ((err && err.message) || err) });
    finish();
  });
  worker.on('exit', () => {
    if (rec.done || myGen !== generation) return;
    send('failed', { id: job.id, message: 'анализ прерван (не хватило памяти?)' });
    finish();
  });
}

function cancelAll() {
  generation++;
  queue.length = 0;
  for (const id of Array.from(active.keys())) stopJob(id);
}

async function expandPaths(paths) {
  const out = [];
  const seen = new Set();
  const add = (p) => {
    if (seen.has(p)) return;
    seen.add(p);
    out.push({ path: p, name: path.basename(p) });
  };
  async function walk(dir, depth) {
    if (depth > 12) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) await walk(full, depth + 1);
      else if (ent.isFile() && AUDIO_EXT.has(path.extname(ent.name).slice(1).toLowerCase())) add(full);
    }
  }
  for (const p of paths || []) {
    if (typeof p !== 'string' || !p) continue;
    let st;
    try { st = await fs.promises.stat(p); } catch (e) { continue; }
    if (st.isDirectory()) await walk(p, 0);
    else if (st.isFile()) add(p); // явно выбранный файл берём любой: решит ffmpeg
  }
  return out;
}

ipcMain.handle('expand', (_e, paths) => expandPaths(paths));
ipcMain.handle('analyze', (_e, items) => {
  for (const it of items || []) {
    if (it && typeof it.id === 'number' && typeof it.path === 'string') queue.push({ id: it.id, path: it.path });
  }
  pump();
});
ipcMain.handle('cancel', () => { cancelAll(); });
ipcMain.handle('drop', (_e, ids) => {
  const set = new Set(ids || []);
  for (let i = queue.length - 1; i >= 0; i--) if (set.has(queue[i].id)) queue.splice(i, 1);
  for (const id of set) stopJob(id);
  pump();
});
ipcMain.handle('pick', async (_e, kind) => {
  const opts = kind === 'folder'
    ? { properties: ['openDirectory', 'multiSelections'] }
    : {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Аудио', extensions: Array.from(AUDIO_EXT) }, { name: 'Все файлы', extensions: ['*'] }]
    };
  const r = await dialog.showOpenDialog(win, opts);
  return r.canceled ? [] : r.filePaths;
});

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 420,
    minWidth: 420,
    minHeight: 300,
    backgroundColor: '#1A1C1F',
    title: 'BPM Studio Pro',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'renderer', 'index.html')).then(() => {
    if (process.env.BPM_SMOKE === '1') require('./smoke')(win);
  });
  win.on('closed', () => { win = null; });
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  cancelAll();
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  {
    // Chromium ещё пишет файлы при выходе (даже после нашей очистки): после завершения программы отдельный маленький процесс удаляет папку окончательно
    try {
      const { spawn } = require('child_process');
      const code = "var fs=require('fs'),d=process.env.BPM_TMP,p=+process.env.BPM_PID,n=0;" +
        "function alive(){try{process.kill(p,0);return true}catch(e){return false}}" +
        "(function t(){if(alive()&&n<40){n++;return setTimeout(t,250)}" +
        "var k=0;(function r(){try{fs.rmSync(d,{recursive:true,force:true})}catch(e){}" +
        "if(fs.existsSync(d)&&k<20){k++;return setTimeout(r,500)}})()})()";
      spawn(process.execPath, ['-e', code], {
        detached: true, stdio: 'ignore', windowsHide: true,
        env: { ELECTRON_RUN_AS_NODE: '1', BPM_TMP: tmpData, BPM_PID: String(process.pid) }
      }).unref();
    } catch (e) { /* ignore */ }
  }
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }
  createWindow();
});
app.on('window-all-closed', () => { cleanup(); app.quit(); });
app.on('before-quit', cleanup);
app.on('will-quit', cleanup);
