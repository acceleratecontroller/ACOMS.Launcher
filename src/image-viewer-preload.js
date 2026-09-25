'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The picture viewer's whole reach into the app: be told which picture to
// show, and ask to open, save or close. Like chat, it makes no request of its
// own — the picture loads from acoms-file://, answered by the main process.
contextBridge.exposeInMainWorld('acomsViewer', {
  onShow: (callback) => {
    ipcRenderer.on('viewer:show', (_event, file) => callback(file));
    ipcRenderer.send('viewer:ready');
  },
  open: (file) => ipcRenderer.invoke('chat:open-file', file),
  save: (file) => ipcRenderer.invoke('viewer:save-file', file),
  close: () => ipcRenderer.send('viewer:close')
});
