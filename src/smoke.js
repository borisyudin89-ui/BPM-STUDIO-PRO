'use strict';
// Только для проверки сборки на GitHub Actions (переменная BPM_SMOKE=1). Обычный запуск этот файл не использует.
// Открывает настоящее окно, добавляет тестовый файл через тот же путь, что и перетаскивание,
// ждёт результат, делает снимок окна и записывает итог в файл.
const fs = require('fs');
const { app } = require('electron');

module.exports = async function smoke(win) {
  const wc = win.webContents;
  const out = process.env.BPM_SMOKE_RESULT;
  const finish = (ok, info) => {
    try { fs.writeFileSync(out, JSON.stringify({ ok, info })); } catch (e) { /* ignore */ }
    app.quit();
  };
  try {
    if (process.env.BPM_SMOKE_MODE === 'drop') {
      // настоящее перетаскивание: событие drop с путями файлов через протокол отладки
      wc.debugger.attach('1.3');
      const data = { items: [], files: [process.env.BPM_SMOKE_FILE], dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await wc.debugger.sendCommand('Input.dispatchDragEvent', { type, x: 200, y: 150, data });
      }
    } else {
      await wc.executeJavaScript('window.__bpmTest.addPaths([' + JSON.stringify(process.env.BPM_SMOKE_FILE) + '])');
    }
    const started = Date.now();
    let text = '';
    while (Date.now() - started < (process.env.BPM_SMOKE_MODE === 'drop' ? 25000 : 90000)) {
      await new Promise((r) => setTimeout(r, 500));
      text = await wc.executeJavaScript(
        "(function(){var r=document.querySelector('#rows .row.item');return r?Array.from(r.children).map(function(c){return c.textContent}).join('|'):''})()"
      );
      if (/\|\d+\.\d\s*$/.test(text) || /ошибка/.test(text)) break;
    }
    // выберем строку и применим ×2, как это делает пользователь
    await wc.executeJavaScript("(function(){var r=document.querySelector('#rows .row.item');if(r)r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))})()");
    await new Promise((r) => setTimeout(r, 300));
    const img = await wc.capturePage();
    fs.writeFileSync(process.env.BPM_SMOKE_OUT, img.toPNG());
    const status = await wc.executeJavaScript("document.getElementById('status-text').textContent");
    finish(/\|\d+\.\d\s*$/.test(text), { row: text, status });
  } catch (e) {
    finish(false, String((e && e.message) || e));
  }
};
