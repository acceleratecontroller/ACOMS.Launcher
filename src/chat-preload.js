'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The chat window's whole reach into the app. It can ask for the state, say
// what the person did, and nothing else — it never makes a network request of
// its own, so the page holds no URL, cookie or credential.
contextBridge.exposeInMainWorld('acomsChat', {
  // { status, me, people, conversations, unreadTotal, active, activeMessages,
  //   activeLoading, sendError }
  getState: () => ipcRenderer.invoke('chat:get'),

  // Subscribe to state changes. Returns an unsubscribe function.
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('chat:changed', listener);
    return () => ipcRenderer.removeListener('chat:changed', listener);
  },

  selectConversation: (conversationId) => ipcRenderer.invoke('chat:select-conversation', conversationId),
  selectPerson: (identityId) => ipcRenderer.invoke('chat:select-person', identityId),

  // Resolves to { ok: boolean }; a failure's reason arrives as state.sendError.
  send: (text) => ipcRenderer.invoke('chat:send', text),

  // Open ACOMS.Controller so the person can sign in again.
  signIn: () => ipcRenderer.invoke('chat:sign-in'),
  retry: () => ipcRenderer.invoke('chat:retry')
});
