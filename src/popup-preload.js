'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The pop-up page can be told which card to draw and can say what the person
// did with it. Nothing else.
contextBridge.exposeInMainWorld('acomsPopup', {
  onCard: (callback) => {
    ipcRenderer.on('popup:card', (_event, message) => callback(message));
  },
  click: (id) => ipcRenderer.send('popup:click', id),
  dismiss: (id) => ipcRenderer.send('popup:dismiss', id),
  hover: (id, over) => ipcRenderer.send('popup:hover', id, over),
  dragStart: (id, point) => ipcRenderer.send('popup:drag-start', id, point),
  dragMove: (id, point) => ipcRenderer.send('popup:drag-move', id, point),
  dragEnd: (id) => ipcRenderer.send('popup:drag-end', id)
});
