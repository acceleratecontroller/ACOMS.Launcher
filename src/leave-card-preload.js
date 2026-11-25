'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// The leave card can be told what to show, say how tall it needs to be, and
// send the person's decision. Nothing else.
contextBridge.exposeInMainWorld('acomsLeaveCard', {
  onShow: (callback) => {
    ipcRenderer.on('leave-card:show', (_event, content) => callback(content));
  },
  height: (px) => ipcRenderer.send('leave-card:height', px),
  // rateKind: LAFHA only, the amount a night the approver picked.
  decide: (decision, comment, rateKind) => ipcRenderer.invoke('leave-card:decide', { decision, comment, rateKind }),
  openPage: () => ipcRenderer.send('leave-card:open-page'),
  later: () => ipcRenderer.send('leave-card:later')
});
