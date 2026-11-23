'use strict';
// Состояние живёт только в памяти окна. Ничего не сохраняется между запусками.
(function () {
  const rows = []; // { id, path, name, status, progress, orig, shown, key, spread, floating, message, el }
  const byPath = new Set();
  let nextId = 1;
  let lastClicked = -1;

  const $rows = document.getElementById('rows');
  const $list = document.getElementById('list');
  const $empty = document.getElementById('empty');
  const $statusText = document.getElementById('status-text');
  const $menu = document.getElementById('menu');

  function plural(n, one, few, many) {
    const a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return one;
    if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
    return many;
  }

  function cell(cls, text, title) {
    const s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    if (title) s.title = title;
    return s;
  }

  function renderRow(r) {
    if (!r.el) {
      r.el = document.createElement('div');
      r.el.className = 'row item';
      r.el.dataset.id = String(r.id);
      $rows.appendChild(r.el);
    }
    r.el.classList.toggle('sel', !!r.selected);
    r.el.textContent = '';
    r.el.appendChild(cell('name', r.name, r.path));
    r.el.appendChild(cell('', r.status === 'done' ? r.key : '—'));
    const b = document.createElement('span');
    b.className = 'bpm';
    if (r.status === 'done') {
      b.textContent = r.shown.toFixed(1);
      if (r.floating) {
        const m = document.createElement('span');
        m.className = 'm';
        m.textContent = ' ~';
        b.appendChild(m);
        b.title = 'темп плавает ±' + r.spread.toFixed(1) + ' BPM';
      }
    } else if (r.status === 'busy') {
      b.className = 'bpm m';
      b.textContent = r.progress + '%';
    } else if (r.status === 'queued') {
      b.className = 'bpm m';
      b.textContent = '…';
    } else {
      b.className = 'bpm m';
      b.textContent = 'ошибка';
      b.title = r.message || '';
    }
    r.el.appendChild(b);
  }

  function updateButtons() {
    const can = selected().some((r) => r.status === 'done');
    document.getElementById('x2').disabled = !can;
    document.getElementById('d2').disabled = !can;
  }

  function updateStatus() {
    updateButtons();
    $empty.hidden = rows.length > 0;
    const total = rows.length;
    const done = rows.filter((r) => r.status === 'done').length;
    const errs = rows.filter((r) => r.status === 'error').length;
    const pending = rows.filter((r) => r.status === 'queued' || r.status === 'busy').length;
    if (!total) { $statusText.textContent = 'Готово'; return; }
    let t = (pending ? 'Анализ' : 'Готово') + ' · ' + done + ' из ' + total;
    if (errs) t += ' · ' + errs + ' ' + plural(errs, 'ошибка', 'ошибки', 'ошибок');
    $statusText.textContent = t;
  }

  async function addPaths(paths) {
    if (!paths || !paths.length) return;
    const found = await window.api.expand(paths);
    const items = [];
    for (const f of found) {
      if (byPath.has(f.path)) continue;
      byPath.add(f.path);
      const r = { id: nextId++, path: f.path, name: f.name, status: 'queued', progress: 0, selected: false };
      rows.push(r);
      renderRow(r);
      items.push({ id: r.id, path: r.path });
    }
    updateStatus();
    if (items.length) window.api.analyze(items);
  }

  function find(id) { return rows.find((r) => r.id === id); }

  window.api.on('progress', ({ id, value }) => {
    const r = find(id);
    if (!r || r.status === 'done' || r.status === 'error') return;
    r.status = 'busy';
    r.progress = value;
    renderRow(r);
    updateStatus();
  });
  window.api.on('result', ({ id, result }) => {
    const r = find(id);
    if (!r) return;
    r.status = 'done';
    r.orig = result.bpm;
    r.shown = result.bpm;
    r.key = result.key;
    r.spread = result.spread;
    r.floating = result.floating;
    renderRow(r);
    updateStatus();
  });
  window.api.on('failed', ({ id, message }) => {
    const r = find(id);
    if (!r) return;
    r.status = 'error';
    r.message = message;
    renderRow(r);
    updateStatus();
  });

  // ---- выбор строк
  function selected() { return rows.filter((r) => r.selected); }
  function setSelection(list) {
    rows.forEach((r) => { const s = list.includes(r); if (r.selected !== s) { r.selected = s; renderRow(r); } });
    updateButtons();
  }
  $rows.addEventListener('mousedown', (e) => {
    const el = e.target.closest('.row.item');
    if (!el) return;
    const idx = rows.findIndex((r) => r.id === Number(el.dataset.id));
    if (idx < 0) return;
    const r = rows[idx];
    if (e.button === 2 && r.selected) return; // правый клик по выбранному не сбрасывает выбор
    if (e.shiftKey && lastClicked >= 0) {
      const [a, b] = [Math.min(lastClicked, idx), Math.max(lastClicked, idx)];
      setSelection(rows.slice(a, b + 1));
    } else if (e.ctrlKey || e.metaKey) {
      setSelection(r.selected ? selected().filter((x) => x !== r) : selected().concat(r));
      lastClicked = idx;
    } else {
      setSelection([r]);
      lastClicked = idx;
    }
  });
  $list.addEventListener('mousedown', (e) => {
    if (e.target === $list || e.target === $empty) setSelection([]);
  });

  // ---- действия над BPM (меняется только показанное число)
  function scaleSelected(factor) {
    selected().forEach((r) => { if (r.status === 'done') { r.shown *= factor; renderRow(r); } });
  }
  function resetSelected() {
    selected().forEach((r) => { if (r.status === 'done') { r.shown = r.orig; renderRow(r); } });
  }
  function removeSelected() {
    const sel = selected();
    if (!sel.length) return;
    window.api.drop(sel.map((r) => r.id));
    sel.forEach((r) => {
      byPath.delete(r.path);
      if (r.el) r.el.remove();
      rows.splice(rows.indexOf(r), 1);
    });
    lastClicked = -1;
    updateStatus();
  }
  function copySelected() {
    const text = selected().map((r) => r.name + ' — ' + (r.status === 'done' ? r.shown.toFixed(1) + ' — ' + r.key : 'нет данных')).join('\n');
    if (text && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  }
  function clearAll() {
    window.api.cancel();
    rows.length = 0;
    byPath.clear();
    $rows.textContent = '';
    lastClicked = -1;
    updateStatus();
  }

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyA') { e.preventDefault(); setSelection(rows.slice()); }
    else if (mod && e.code === 'KeyC') { copySelected(); }
    else if (e.code === 'BracketRight' && !mod) { scaleSelected(2); }
    else if (e.code === 'BracketLeft' && !mod) { scaleSelected(0.5); }
    else if (e.code === 'Backspace') { resetSelected(); }
    else if (e.code === 'Delete') { removeSelected(); }
    else if (e.code === 'Escape') { hideMenu(); }
  });

  // ---- маленькое меню
  function showMenu(x, y, items) {
    $menu.textContent = '';
    items.forEach(([label, fn]) => {
      const d = document.createElement('div');
      d.textContent = label;
      d.addEventListener('click', () => { hideMenu(); fn(); });
      $menu.appendChild(d);
    });
    $menu.hidden = false;
    const w = $menu.offsetWidth, h = $menu.offsetHeight;
    $menu.style.left = Math.max(0, Math.min(x, window.innerWidth - w)) + 'px';
    $menu.style.top = Math.max(0, Math.min(y, window.innerHeight - h)) + 'px';
  }
  function hideMenu() { $menu.hidden = true; }
  document.addEventListener('mousedown', (e) => { if (!$menu.contains(e.target)) hideMenu(); });
  window.addEventListener('blur', hideMenu);

  $list.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!selected().length) return;
    showMenu(e.clientX, e.clientY, [
      ['BPM ×2', () => scaleSelected(2)],
      ['BPM ÷2', () => scaleSelected(0.5)],
      ['Сбросить к исходному', resetSelected]
    ]);
  });

  document.getElementById('add').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.top - 52, [
      ['Файлы…', async () => addPaths(await window.api.pick('file'))],
      ['Папку…', async () => addPaths(await window.api.pick('folder'))]
    ]);
  });
  document.getElementById('clear').addEventListener('click', clearAll);
  document.getElementById('x2').addEventListener('click', () => scaleSelected(2));
  document.getElementById('d2').addEventListener('click', () => scaleSelected(0.5));

  // ---- перетаскивание файлов и папок
  window.addEventListener('dragover', (e) => { e.preventDefault(); $list.classList.add('over'); });
  window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) $list.classList.remove('over'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    $list.classList.remove('over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      const files = Array.from(e.dataTransfer.files);
      addPaths(files.map((f) => window.api.pathForFile(f)).filter(Boolean));
    }
  });

  window.__bpmTest = { addPaths }; // используется только проверкой сборки
  updateStatus();
})();
