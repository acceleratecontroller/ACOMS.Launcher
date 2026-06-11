'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a tiny, explicit API to the picker renderer. Nothing else from Node
// or Electron is reachable from the page (contextIsolation + sandbox).
contextBridge.exposeInMainWorld('acoms', {
  // Returns { portals: [...], openIds: [...] }.
  getPortals: () => ipcRenderer.invoke('portals:get'),

  // Ask the main process to open (or focus, if already open) a portal.
  openPortal: (id) => ipcRenderer.invoke('portal:open', id),

  // Subscribe to changes in which portals are currently open. Returns an
  // unsubscribe function. The callback receives an array of open portal ids.
  onOpenStateChanged: (callback) => {
    const listener = (_event, openIds) => callback(openIds);
    ipcRenderer.on('portals:open-changed', listener);
    return () => ipcRenderer.removeListener('portals:open-changed', listener);
  }
});
