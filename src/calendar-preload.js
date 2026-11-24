'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The Calendar window's whole reach into the app: it asks for a range of
// days. It never makes a network request of its own, so the page holds no
// URL, cookie or credential (the same rule as chat and tasks).
contextBridge.exposeInMainWorld('acomsCalendar', {
  // { ok: true, data: { holidays, rdoDays, events, leave } } | { ok: false, message }
  getRange: (from, to) => ipcRenderer.invoke('calendar:range', from, to)
});
