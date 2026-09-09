'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a tiny, explicit API to the picker renderer. Nothing else from Node
// or Electron is reachable from the page (contextIsolation + sandbox).
contextBridge.exposeInMainWorld('acoms', {
  // Returns { portals: [...], openIds: [...] }.
  getPortals: () => ipcRenderer.invoke('portals:get'),

  // Ask the main process to open (or focus, if already open) a portal.
  openPortal: (id) => ipcRenderer.invoke('portal:open', id),

  // Open (or focus) the Quick Notes window. action is 'new' or 'view'.
  openQuickNote: (action) => ipcRenderer.invoke('quicknote:open', action),

  // Subscribe to changes in which portals are currently open. Returns an
  // unsubscribe function. The callback receives an array of open portal ids.
  onOpenStateChanged: (callback) => {
    const listener = (_event, openIds) => callback(openIds);
    ipcRenderer.on('portals:open-changed', listener);
    return () => ipcRenderer.removeListener('portals:open-changed', listener);
  },

  // Returns { version, update: { status, newVersion, percent, message, ... } }.
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  // Ask the updater to check now (the answer arrives via onUpdateChanged).
  checkForUpdates: () => ipcRenderer.invoke('update:check'),

  // Restart into a downloaded update — or, where the app can't self-install,
  // open the releases page instead.
  installUpdate: () => ipcRenderer.invoke('update:install'),

  // Subscribe to update status. Returns an unsubscribe function.
  onUpdateChanged: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('update:changed', listener);
    return () => ipcRenderer.removeListener('update:changed', listener);
  }
});
