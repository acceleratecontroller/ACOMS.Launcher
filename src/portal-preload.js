'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// What a portal page (WIP, …) can ask of the Launcher it's running in, as
// window.acomsLauncher. A page in a normal browser has no such object, which
// is how it tells the two apart (Dion 2026-10-13: "if someone is using the
// laucher it opens the folder and not the website version").
//
// Only the job number goes over; the main process checks the page is one of
// the configured portals and finds the folder itself.
contextBridge.exposeInMainWorld('acomsLauncher', {
  // Open a job's SharePoint folder on this computer. Resolves to { ok } or
  // { ok: false, reason, message, url? } — message is ready to show.
  openJobFolder: (number) => ipcRenderer.invoke('portal:open-job-folder', String(number || ''))
});
