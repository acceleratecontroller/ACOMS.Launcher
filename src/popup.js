'use strict';

// ---------------------------------------------------------------------------
// Pop-ups
// ---------------------------------------------------------------------------
// The launcher draws its own notification cards, in small always-on-top
// windows at the bottom-right of the screen, instead of asking the operating
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
//
// Each card has a window of its own, so that one card can be dragged somewhere
// else on its own (Dion, 2026-10-09: "click and hold to drag it around ... just
// for that pop up not as a remembered thing"). A moved card stays where it was
// put for as long as it is on screen; the next card still comes up in the
// corner, and so does this one if it pops up again.

const { BrowserWindow, ipcMain, powerMonitor, screen, shell } = require('electron');
const path = require('path');
const {
  DURATION_MS,
  AFTER_HOVER_MS,
  REFRESH_MS,
  pushCard,
  removeCard,
  slotBounds,
  dragBounds,
  onSomeScreen,
  initialOf
} = require('./popup-rules');

let cards = []; // newest last — the docked one nearest the corner
let seq = 0;
// card id -> { win, ready, bornAt, bounds, animate, old }
const views = new Map();
// card id -> bounds the person dragged it to. Forgotten with the card.
const moved = new Map();
const hovered = new Set(); // card ids with the mouse resting on them
let drag = null; // { id, start, pressAt } while a card is being dragged
let refreshTimer = null;
let screensTimer = null;
const timers = new Map(); // card id -> timeout
const clickHandlers = new Map(); // card id -> () => void
// card id -> () => void, run ONLY when the person closes the card with ×.
// A card replaced by a newer one under the same key, evicted by the cap, or
// taken down by code did not get dealt with — nobody is told.
const dismissHandlers = new Map();

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

function cardById(id) {
  return cards.find((c) => c.id === id);
}

function buildWindow() {
  const win = new BrowserWindow({
    width: 10,
    height: 10,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    // Moved by popup:drag-* below, never by the OS.
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
      // Nothing is drawn until the card arrives; a not-yet-shown page must not
      // be throttled into drawing it late — a transparent window with nothing
      // drawn yet is invisible.
      backgroundThrottling: false
    }
  });
  // Above ordinary always-on-top windows too; a pop-up hidden behind one of
  // those is the failure this module exists to end.
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'popup.html'));
  return win;
}

function destroyView(view) {
  if (!view) return;
  for (const w of [view.win, view.old && view.old.win]) {
    if (w && !w.isDestroyed()) w.destroy();
  }
}

// Give card `id` a window: a new one, or — when `replacing` — a fresh one that
// takes over from the current window once it has drawn the card, so nothing
// blinks.
function openView(id, bounds, { replacing = null } = {}) {
  const view = {
    win: buildWindow(),
    ready: false,
    bornAt: Date.now(),
    bounds,
    animate: !replacing,
    old: replacing
  };
  if (replacing) {
    // Only ever one window behind the current one.
    if (replacing.old) destroyView({ win: replacing.old.win });
    replacing.old = null;
  }
  views.set(id, view);

  const { win } = view;
  win.webContents.once('did-finish-load', () => {
    if (views.get(id) !== view) return;
    const card = cardById(id);
    if (!card) {
      views.delete(id);
      destroyView(view);
      return;
    }
    view.ready = true;
    win.setBounds(view.bounds);
    win.webContents.send('popup:card', { card: toWire(card), animate: view.animate });
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.showInactive();
    win.moveTop();
    if (view.old) {
      destroyView(view.old);
      view.old = null;
    }
  });
  // A page that died or hung would leave a card on screen that nothing answers.
  win.webContents.on('render-process-gone', () => replaceSoon(id, view));
  win.on('unresponsive', () => replaceSoon(id, view));
  win.on('closed', () => {
    if (views.get(id) !== view) return;
    // Closed by something other than us; the card is still owed a window.
    views.delete(id);
    hovered.delete(id);
    if (cardById(id)) setTimeout(sync, 0);
  });
  return view;
}

function replaceSoon(id, view) {
  setTimeout(() => {
    if (views.get(id) === view) refresh(id, { force: true });
  }, 0);
}

// Swap a card's window for a fresh one in the same place.
//
// On Windows a pop-up window can go deaf to clicks: the page sees the mouse
// arrive but never the click. First seen with a window hidden and re-shown
// (Dion, 2026-09-25: "works the first time ... then other notifications pop up
// for chat and just stay there and you can't make them go away") — fixed then
// by never re-showing a window. It came back on cards that stay up a long time
// (Dion, 2026-10-09: the permanent one, "if its up for a while when you go to
// click it or close it it stops working ... the only way to get rid of it is to
// close and reopen the whole app"). A newly built window has always taken the
// click, so no card keeps one window for long: it is renewed every REFRESH_MS,
// and at once after sleep, unlock, or a change of screens — the likeliest
// moments for Windows to lose track of it.
function refresh(id, { force = false } = {}) {
  const view = views.get(id);
  if (!view || !cardById(id)) return;
  // Never swap a window out from under the mouse; once it leaves, the next
  // sweep gets it.
  if (!force && (hovered.has(id) || (drag && drag.id === id))) return;
  if (!view.ready) return; // already new
  if (drag && drag.id === id) drag = null;
  hovered.delete(id);
  openView(id, view.bounds, { replacing: view });
}

function refreshAll(opts) {
  for (const id of [...views.keys()]) refresh(id, opts);
}

// The page's own word on where the mouse is can go stale: after a drag the
// mouse-leave sometimes never comes. Left that way, the card would never be
// renewed and no card would ever time out again. Ask the OS instead.
function forgetLostHovers() {
  if (hovered.size === 0 || drag) return;
  const at = screen.getCursorScreenPoint();
  let changed = false;
  for (const id of [...hovered]) {
    const view = views.get(id);
    const b = view && view.bounds;
    const inside =
      b && at.x >= b.x && at.x < b.x + b.width && at.y >= b.y && at.y < b.y + b.height;
    if (!inside) {
      hovered.delete(id);
      changed = true;
    }
  }
  if (changed && hovered.size === 0) {
    for (const card of cards) arm(card, AFTER_HOVER_MS);
  }
}

function sweepStale() {
  forgetLostHovers();
  const now = Date.now();
  for (const [id, view] of [...views]) {
    if (view.ready && now - view.bornAt > REFRESH_MS) refresh(id);
  }
}

// Make the windows match the cards: one per card, docked cards stacked up from
// the corner of the primary display, moved cards where they were put; a window
// whose card has gone is destroyed.
//
// A window is never hidden and re-shown — that is what went deaf on
// 2026-09-25 (see refresh). Cards come and go by building and destroying.
function sync() {
  const live = new Set(cards.map((c) => c.id));
  for (const [id, view] of [...views]) {
    if (live.has(id)) continue;
    views.delete(id);
    // It went with the cursor still on it, so no mouseleave will ever come;
    // left set, non-sticky cards would never fade again.
    hovered.delete(id);
    if (drag && drag.id === id) drag = null;
    destroyView(view);
  }

  const workArea = screen.getPrimaryDisplay().workArea;
  const docked = cards.filter((c) => !moved.has(c.id));
  for (const card of cards) {
    const slot = docked.length - 1 - docked.indexOf(card);
    const bounds = moved.get(card.id) || slotBounds(workArea, slot);
    const view = views.get(card.id);
    if (!view) {
      openView(card.id, bounds);
      continue;
    }
    if (drag && drag.id === card.id) continue; // the mouse has it
    view.bounds = bounds;
    if (!view.ready) continue; // did-finish-load places and draws it
    const w = view.win;
    w.setBounds(bounds);
    w.webContents.send('popup:card', { card: toWire(card), animate: false });
    // Windows can drop a window's always-on-top, so a card could sit BEHIND a
    // maximised app - heard (the beep) but not seen. Re-assert it and raise
    // the window whenever the cards change.
    w.setAlwaysOnTop(true, 'pop-up-menu');
    w.moveTop();
  }
}

// The screens changed (monitor plugged or unplugged, resolution, taskbar): a
// moved card no longer on any screen goes back to the corner, and every window
// is renewed.
function screensChanged() {
  const areas = screen.getAllDisplays().map((d) => d.workArea);
  for (const [id, bounds] of [...moved]) {
    if (!onSomeScreen(bounds, areas)) moved.delete(id);
  }
  sync();
  refreshAll({ force: true });
}

function arm(card, ms) {
  clearTimeout(timers.get(card.id));
  timers.delete(card.id);
  if (card.sticky || hovered.size > 0) return;
  timers.set(
    card.id,
    setTimeout(() => dismiss(card.id), ms)
  );
}

function forget(id) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  clickHandlers.delete(id);
  dismissHandlers.delete(id);
  moved.delete(id);
}

function dismiss(id, { byUser = false } = {}) {
  const onDismiss = dismissHandlers.get(id);
  forget(id);
  cards = removeCard(cards, id);
  sync();
  if (byUser && typeof onDismiss === 'function') {
    try {
      onDismiss();
    } catch (err) {
      console.error('popup dismiss handler failed:', err.message);
    }
  }
}

// Take down the card shown under `key`, if any, with no note. The caller's
// own code is doing it, so onDismiss does not run.
function dismissKey(key) {
  if (!key) return;
  const id = `k:${key}`;
  if (cards.some((c) => c.id === id)) dismiss(id);
}

// Show a card.
//   title, body — what it says. `name` (optional) is whose initial goes in the
//                 badge, defaulting to the title; `badge` sets it outright.
//   label       — the small line above the title: where this came from.
//   kind        — 'chat' | 'portal' | 'reminder' | 'update'; only changes the accent.
//   sticky      — stays until clicked or dismissed (reminders).
//   key         — optional stable id: showing the same key again replaces the
//                 card instead of stacking a second one.
//   onClick     — what clicking the card does.
//   onDismiss   — runs only when the person closes the card with ×.
function show({
  title,
  body = '',
  label = '',
  kind = 'portal',
  sticky = false,
  key,
  name,
  badge,
  onClick,
  onDismiss
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
    if (!after.has(old)) forget(old);
  }
  // Popping up again is a new pop-up: back in the corner, even if the last one
  // under this key had been dragged away.
  moved.delete(id);
  if (drag && drag.id === id) drag = null;

  if (typeof onClick === 'function') clickHandlers.set(id, onClick);
  else clickHandlers.delete(id);
  if (typeof onDismiss === 'function') dismissHandlers.set(id, onDismiss);
  else dismissHandlers.delete(id);

  arm(card, DURATION_MS);
  sync();
  // Windows plays a sound for its own notifications; without one a card in the
  // corner of a second monitor is easy to miss.
  shell.beep();
  return id;
}

// Take down every card of one kind (all chat cards once the chat window is in
// front: whatever they said is on screen now).
function dismissKind(kind) {
  const ids = cards.filter((c) => c.kind === kind).map((c) => c.id);
  if (ids.length === 0) return;
  for (const id of ids) {
    forget(id);
    cards = removeCard(cards, id);
  }
  sync();
}

function workAreas() {
  return screen.getAllDisplays().map((d) => d.workArea);
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

  ipcMain.on('popup:dismiss', (_event, id) => dismiss(id, { byUser: true }));

  // Resting the mouse on any card holds them all; nothing vanishes from under
  // a cursor that was about to click it.
  ipcMain.on('popup:hover', (_event, id, over) => {
    if (over && cardById(id)) hovered.add(id);
    else hovered.delete(id);
    for (const card of cards) arm(card, AFTER_HOVER_MS);
  });

  // Click and hold, then move: the card follows the mouse. Points are screen
  // coordinates from the page, so they stay true while the window moves.
  ipcMain.on('popup:drag-start', (_event, id, pressAt) => {
    const view = views.get(id);
    if (!view || !view.ready || !pressAt) return;
    // From our own record, not getBounds(): at fractional scaling (110%) the
    // OS rounds the size, and each drag would grow the card by a pixel.
    drag = { id, start: view.bounds, pressAt };
  });

  ipcMain.on('popup:drag-move', (_event, id, mouseAt) => {
    if (!drag || drag.id !== id || !mouseAt) return;
    const view = views.get(id);
    if (!view) return;
    const bounds = dragBounds(drag.start, drag.pressAt, mouseAt);
    view.bounds = bounds;
    view.win.setBounds(bounds);
    const leavingDock = !moved.has(id);
    moved.set(id, bounds);
    if (leavingDock) sync(); // the rest close up the gap it left
  });

  ipcMain.on('popup:drag-end', (_event, id) => {
    if (!drag || drag.id !== id) return;
    drag = null;
    const bounds = moved.get(id);
    if (bounds && !onSomeScreen(bounds, workAreas())) moved.delete(id);
    sync();
    // A hover the drag left behind may not be real; check once it settles.
    setTimeout(forgetLostHovers, 1000);
  });

  // Screen events come in bursts (one per display, the taskbar settling);
  // act once they stop.
  const screensSettled = () => {
    clearTimeout(screensTimer);
    screensTimer = setTimeout(screensChanged, 500);
  };
  screen.on('display-added', screensSettled);
  screen.on('display-removed', screensSettled);
  screen.on('display-metrics-changed', screensSettled);
  try {
    powerMonitor.on('resume', () => refreshAll({ force: true }));
    powerMonitor.on('unlock-screen', () => refreshAll({ force: true }));
  } catch {
    // powerMonitor is unavailable on some setups; the sweep still covers us.
  }
  refreshTimer = setInterval(sweepStale, 15 * 1000);
}

function dispose() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  clearInterval(refreshTimer);
  refreshTimer = null;
  clearTimeout(screensTimer);
  clickHandlers.clear();
  dismissHandlers.clear();
  cards = [];
  moved.clear();
  hovered.clear();
  drag = null;
  for (const view of views.values()) destroyView(view);
  views.clear();
}

module.exports = { init, dispose, show, dismiss, dismissKey, dismissKind };
