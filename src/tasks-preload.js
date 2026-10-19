'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The Tasks window's whole reach into the app. It can ask for the state and say
// what the person did — it never makes a network request of its own, so the
// page holds no URL, cookie or credential (the same rule as chat).
contextBridge.exposeInMainWorld('acomsTasks', {
  // { status, errorMessage, actionError, me, isAdmin, quick, notes, recurring,
  //   company, dismissed, archivedQuick, archivedNotes, assignees,
  //   myEmployeeId, jobLinkBase, emailBase }
  getState: () => ipcRenderer.invoke('tasks:get'),

  // Subscribe to state changes. Returns an unsubscribe function.
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('tasks:changed', listener);
    return () => ipcRenderer.removeListener('tasks:changed', listener);
  },

  // { type: 'task:create'|'task:update'|…, id?, fields?, content?, fromNoteId? }
  // Resolves to { ok, data?, error? }. See ACTIONS in tasks.js.
  act: (action) => ipcRenderer.invoke('tasks:act', action),

  // The "Archived" toggles: kind 'quick' | 'notes'.
  loadArchived: (kind, open) => ipcRenderer.invoke('tasks:archived', kind, open),

  // The Project (WIP job) search: [{ value, sublabel }].
  searchJobs: (q) => ipcRenderer.invoke('tasks:search-jobs', q),

  clearError: () => ipcRenderer.invoke('tasks:clear-error'),
  retry: () => ipcRenderer.invoke('tasks:retry'),
  // Session expired: open Controller's window to sign in.
  signIn: () => ipcRenderer.invoke('tasks:sign-in'),

  // Shown when another part of the app asks the window to do something
  // (the tray menu's "New task" / "New note").
  onCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('tasks:command', listener);
    return () => ipcRenderer.removeListener('tasks:command', listener);
  }
});
