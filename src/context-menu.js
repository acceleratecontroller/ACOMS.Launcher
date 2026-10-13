'use strict';

// Right-click menu for every window the launcher opens — portals, Quick Note,
// chat, the image viewer and pop-ups alike. Hooked once at the app level so a
// window added later gets it without anyone remembering to wire it up.

const { app, BrowserWindow, Menu } = require('electron');
const { menuItems } = require('./context-menu-rules');

function toMenuItem(item, contents) {
  switch (item.kind) {
    case 'replace':
      return { label: item.label, click: () => contents.replaceMisspelling(item.word) };
    case 'learn':
      return {
        label: item.label,
        click: () => contents.session.addWordToSpellCheckerDictionary(item.word)
      };
    case 'note':
      return { label: item.label, enabled: false };
    case 'role':
      return { role: item.role, label: item.label, enabled: item.enabled };
    default:
      return { type: 'separator' };
  }
}

function attach(contents) {
  contents.on('context-menu', (_event, params) => {
    const items = menuItems(params);
    if (items.length === 0) return;
    const menu = Menu.buildFromTemplate(items.map((item) => toMenuItem(item, contents)));
    const win = BrowserWindow.fromWebContents(contents);
    menu.popup(win ? { window: win } : {});
  });
}

function init() {
  app.on('web-contents-created', (_event, contents) => attach(contents));
}

module.exports = { init };
