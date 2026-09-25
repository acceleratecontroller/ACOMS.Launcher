'use strict';

// ---------------------------------------------------------------------------
// Pop-ups
// ---------------------------------------------------------------------------
// The launcher draws its own notification cards, in a small always-on-top
// window at the bottom-right of the screen, instead of asking the operating
// system to show them.
//
// Why: Windows notifications turned out to be switched off on most people's
// PCs. Dion, 2026-09-21: they "only come up in that notification side bar
// thing, not as separate pop ups... I have it turned off, as do most people."
// The first notification the launcher ever raised on his own work PC went
// straight to a panel he never opens — for months. A message from a person, or
// a reminder meant to be unmissable, can't depend on a setting like that; and
// chat is explicitly not something anyone gets to switch off.
//
// Drawing our own also means every PC behaves the same (no AppUserModelID, no
// code-signing requirement, no Do Not Disturb), and a card can grow buttons.
//
// The cost, accepted knowingly: a card also appears while someone is presenting
// or sharing their screen, because there is no longer an OS deciding not to.

const { BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const {
  DURATION_MS,
  AFTER_HOVER_MS,
  pushCard,
  removeCard,
  boundsFor,
  initialOf
} = require('./popup-rules');

let win = null;
let ready = false;
let cards = [];
let seq = 0;
let hovering = false;
const timers = new Map(); // card id -> timeout
const clickHandlers = new Map(); // card id -> () => void

function toWire(card) {
  return {
    id: card.id,
    kind: card.kind,
    label: card.label,
    title: card.title,
    body: card.body,
    initial: card.initial,
    sticky: card.sticky
  };
}

function ensureWindow() {
  if (win && !win.isDestroyed()) return win;

  ready = false;
  win = new BrowserWindow({
    width: 10,
    height: 10,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // Never take the keyboard away from whatever the person is typing into.
    // A non-focusable window still receives clicks.
    focusable: false,
    title: 'ACOMS Launcher notification',
    webPreferences: {
      preload: path.join(__dirname, 'popup-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The window spends most of its life hidden, and a hidden page is
      // throttled: a card sent to it could land a beat AFTER the window showed,
      // and a transparent window with nothing drawn yet is invisible.
      backgroundThrottling: false
    }
  });
  // Above ordinary always-on-top windows too; a pop-up hidden behind one of
  // those is the failure this module exists to end.
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'popup.html'));
  win.webContents.once('did-finish-load', () => {
    ready = true;
    sync();
  });
  win.on('closed', () => {
    win = null;
    ready = false;
  });
  return win;
}

// Make the window match the cards: gone when there are none, otherwise sized to
// hold exactly them and sitting in the corner of the primary display.
function sync() {
  if (cards.length === 0) {
    if (win && !win.isDestroyed()) win.hide();
    return;
  }
  const w = ensureWindow();
  if (!ready) return; // did-finish-load calls back in

  w.setBounds(boundsFor(screen.getPrimaryDisplay().workArea, cards.length));
  w.webContents.send('popup:cards', cards.map(toWire));
  // Windows can drop a hidden window's always-on-top, so a card could come
  // back BEHIND a maximised app - heard (the beep) but not seen. Re-assert it
  // and raise the window every time, not only when it was hidden.
  w.setAlwaysOnTop(true, 'pop-up-menu');
  if (!w.isVisible()) w.showInactive();
  w.moveTop();
}

function arm(card, ms) {
  clearTimeout(timers.get(card.id));
  timers.delete(card.id);
  if (card.sticky || hovering) return;
  timers.set(
    card.id,
    setTimeout(() => dismiss(card.id), ms)
  );
}

function dismiss(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  clickHandlers.delete(id);
  cards = removeCard(cards, id);
  sync();
}

// Show a card.
//   title, body — what it says. `name` (optional) is whose initial goes in the
//                 badge, defaulting to the title; `badge` sets it outright.
//   label       — the small line above the title: where this came from.
//   kind        — 'chat' | 'portal' | 'reminder'; only changes the accent.
//   sticky      — stays until clicked or dismissed (reminders).
//   key         — optional stable id: showing the same key again replaces the
//                 card instead of stacking a second one.
//   onClick     — what clicking the card does.
function show({
  title,
  body = '',
  label = '',
  kind = 'portal',
  sticky = false,
  key,
  name,
  badge,
  onClick
} = {}) {
  if (!title) return null;

  const id = key ? `k:${key}` : `n:${(seq += 1)}`;
  const card = {
    id,
    kind,
    label,
    title: String(title),
    body: String(body || ''),
    initial: badge ? String(badge).slice(0, 2) : initialOf(name || title),
    sticky: Boolean(sticky)
  };

  const before = new Set(cards.map((c) => c.id));
  cards = pushCard(cards, card);
  // Whatever pushCard dropped to make room no longer needs a timer or handler.
  const after = new Set(cards.map((c) => c.id));
  for (const old of before) {
    if (!after.has(old)) {
      clearTimeout(timers.get(old));
      timers.delete(old);
      clickHandlers.delete(old);
    }
  }

  if (typeof onClick === 'function') clickHandlers.set(id, onClick);
  else clickHandlers.delete(id);

  arm(card, DURATION_MS);
  sync();
  // Windows plays a sound for its own notifications; without one a card in the
  // corner of a second monitor is easy to miss.
  shell.beep();
  return id;
}

function init() {
  ipcMain.on('popup:click', (_event, id) => {
    const run = clickHandlers.get(id);
    dismiss(id);
    if (run) {
      try {
        run();
      } catch (err) {
        console.error('popup click handler failed:', err.message);
      }
    }
  });

  ipcMain.on('popup:dismiss', (_event, id) => dismiss(id));

  // Resting the mouse on the stack holds it; nothing vanishes from under a
  // cursor that was about to click it.
  ipcMain.on('popup:hover', (_event, over) => {
    hovering = Boolean(over);
    for (const card of cards) arm(card, AFTER_HOVER_MS);
  });

  // Build the window ahead of the first card so that one isn't late.
  ensureWindow();
}

function dispose() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  clickHandlers.clear();
  cards = [];
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { init, dispose, show, dismiss };
