'use strict';

// ---------------------------------------------------------------------------
// Start with the computer
// ---------------------------------------------------------------------------
// Dion, 2026-10-07: "if there is a way on windows pc to make it through the
// app update or whatever somehow auto start when pc does i want that too".
// Pop-ups, chat and reminders only reach someone whose launcher is running,
// so it registers itself to start at sign-in — on by default, switched off
// (and kept off) from the tray menu's "Start with Windows" tick.
//
// Started that way it opens quietly to the tray: the picker appearing on
// every boot would be one more window to close. The NSIS install is per-user
// and updates in place, so the registered path survives updates.

const { app } = require('electron');
const store = require('./store');

const STARTUP_ARG = '--startup';

// Only a packaged build: registering `electron.exe` from a dev checkout would
// start a bare Electron at every sign-in.
function supported() {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');
}

function apply() {
  if (!supported()) return;
  const on = !store.isAutoStartOff();
  app.setLoginItemSettings({ openAtLogin: on, args: on ? [STARTUP_ARG] : [] });
}

function isOn() {
  return supported() && !store.isAutoStartOff();
}

function set(on) {
  store.setAutoStartOff(!on);
  apply();
}

// Was this launch the computer starting up (rather than a person)?
function launchedAtStartup(argv = process.argv) {
  return argv.includes(STARTUP_ARG) || Boolean(app.getLoginItemSettings().wasOpenedAtLogin);
}

module.exports = { init: apply, supported, isOn, set, launchedAtStartup };
