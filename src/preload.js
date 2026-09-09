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
  },

  // Per-portal notification state, keyed by portal id:
  // { state: 'ok'|'signIn'|'error'|'off'|'idle', badge, summary, items }.
  getNotifications: () => ipcRenderer.invoke('notifications:get'),

  // Poll every portal now rather than waiting for the next tick.
  refreshNotifications: () => ipcRenderer.invoke('notifications:refresh'),

  // Open a portal window at one notification item's path.
  openNotificationItem: (portalId, itemPath) =>
    ipcRenderer.invoke('notifications:open', portalId, itemPath),

  // Subscribe to notification state. Returns an unsubscribe function.
  onNotificationsChanged: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('notifications:changed', listener);
    return () => ipcRenderer.removeListener('notifications:changed', listener);
  },

  // { muted: string[], quietFrom: "HH:MM"|null, quietTo: "HH:MM"|null }
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setMuted: (portalId, muted) => ipcRenderer.invoke('settings:set-muted', portalId, muted),
  setQuietHours: (from, to) => ipcRenderer.invoke('settings:set-quiet-hours', from, to)
});
