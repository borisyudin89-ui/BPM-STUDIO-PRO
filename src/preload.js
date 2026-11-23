'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // File-объекты передаются по одному: список FileList через мост contextBridge теряет файлы
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch (e) { return ''; } },
  expand: (paths) => ipcRenderer.invoke('expand', paths),
  analyze: (items) => ipcRenderer.invoke('analyze', items),
  cancel: () => ipcRenderer.invoke('cancel'),
  drop: (ids) => ipcRenderer.invoke('drop', ids),
  pick: (kind) => ipcRenderer.invoke('pick', kind),
  on: (channel, fn) => {
    if (!['progress', 'result', 'failed'].includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => fn(data));
  }
});
