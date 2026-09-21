'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The pop-up page can be told which cards to draw and can say what the person
// did with one. Nothing else.
contextBridge.exposeInMainWorld('acomsPopup', {
  onCards: (callback) => {
    ipcRenderer.on('popup:cards', (_event, cards) => callback(cards));
  },
  click: (id) => ipcRenderer.send('popup:click', id),
  dismiss: (id) => ipcRenderer.send('popup:dismiss', id),
  hover: (over) => ipcRenderer.send('popup:hover', over)
});
