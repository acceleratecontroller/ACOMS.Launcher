'use strict';

const { app, BrowserWindow, ipcMain, shell, screen, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const updater = require('./updater');

// ---------------------------------------------------------------------------
// Portal config
// ---------------------------------------------------------------------------
// The portal list lives in portals.json at the project root so it can be
// edited without touching app logic. In a packaged build it is bundled
// alongside the app (see the "files" array in package.json).
const PORTALS_PATH = path.join(__dirname, '..', 'portals.json');

function loadConfig() {
  try {
    const raw = fs.readFileSync(PORTALS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.portals)) {
      throw new Error('portals.json must contain a "portals" array');
    }
    // Keep only the fields the UI needs, and ignore anything malformed.
    const list = parsed.portals.filter(
      (p) => p && typeof p.id === 'string' && typeof p.url === 'string'
    );
    // Optional Quick Note strip — two deep links into ACOMS.Controller: a
    // "new" action (compose a fresh note) and a "view" action (browse notes).
    // Older single-url configs still work as the "new" action.
    const qnRaw = parsed.quickNote;
    let qn = null;
    if (qnRaw && typeof qnRaw === 'object') {
      const newUrl =
        (qnRaw.new && typeof qnRaw.new.url === 'string' && qnRaw.new.url) ||
        (typeof qnRaw.url === 'string' && qnRaw.url) ||
        null;
      const viewUrl = qnRaw.view && typeof qnRaw.view.url === 'string' ? qnRaw.view.url : null;
      if (newUrl || viewUrl) {
        qn = {
          tagline: qnRaw.tagline || '',
          newUrl,
          newLabel: (qnRaw.new && qnRaw.new.label) || 'New Note',
          viewUrl,
          viewLabel: (qnRaw.view && qnRaw.view.label) || 'View Notes'
        };
      }
    }
    return { portals: list, quickNote: qn };
  } catch (err) {
    console.error('Failed to load portals.json:', err.message);
    return { portals: [], quickNote: null };
  }
}

let portals = [];
let quickNote = null;

// ---------------------------------------------------------------------------
// Window bookkeeping
// ---------------------------------------------------------------------------
let pickerWindow = null;
let tray = null;
// Map of portal id -> BrowserWindow for portals that are currently open.
const portalWindows = new Map();
// Dedicated Quick Note window (a single reusable scratchpad, separate from the
// portal windows above).
let quickNoteWindow = null;
// Sentinel id included in the "open" list so the picker can show a dot on the
// Quick Note button while its window is open.
const QUICK_NOTE_ID = '__quicknote__';

function openPortalIds() {
  const ids = Array.from(portalWindows.keys());
  if (quickNoteWindow && !quickNoteWindow.isDestroyed()) {
    ids.push(QUICK_NOTE_ID);
  }
  return ids;
}

// Tell the picker (if it's open) which portals currently have a window, so it
// can show the "open" indicator dots.
function notifyOpenStateChanged() {
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.webContents.send('portals:open-changed', openPortalIds());
  }
}

// Match a URL to one of the configured portals by host, so a cross-app link
// (e.g. WIP linking a job into GIS) can be recognised as "one of ours".
function findPortalForUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return (
    portals.find((p) => {
      try {
        return new URL(p.url).hostname.toLowerCase() === host;
      } catch {
        return false;
      }
    }) || null
  );
}

// Decide what happens when page content tries to open a new window
// (e.g. target="_blank" or window.open):
//   - If the link points at one of our portals, keep it inside the launcher:
//     open/focus that portal's window and load the linked page. This is what
//     makes WIP -> GIS (and any portal -> portal) link switch windows instead
//     of escaping to a browser tab.
//   - Otherwise it's a genuinely external site, so hand it to the default
//     browser as before.
function handleNewWindow(url) {
  const portal = findPortalForUrl(url);
  if (portal) {
    openPortal(portal.id, url);
  } else if (url && /^https?:\/\//i.test(url)) {
    shell.openExternal(url);
  }
  return { action: 'deny' };
}

function attachLinkHandling(contents) {
  contents.setWindowOpenHandler(({ url }) => handleNewWindow(url));
}

// ---------------------------------------------------------------------------
// Picker window
// ---------------------------------------------------------------------------
const PICKER_WIDTH = 420;
// Tall enough to show the Quick Note strip plus the current portals without a
// scrollbar; it only scrolls if you add a lot more portals.
const PICKER_HEIGHT = 700;
// Room left below the picker for an auto-hidden macOS Dock to slide up over,
// so the picker sits above it rather than behind it.
const AUTO_HIDE_DOCK_CLEARANCE = 96;

// Decide where the picker pops up.
//   macOS  – just above the Dock, centred on the cursor (the Dock icon sits
//            under the cursor when 'activate' fires), so it appears above the
//            icon you clicked. Assumes the Dock is along the bottom.
//   Windows/Linux – bottom-right, just above the taskbar, near the system tray
//            icon it is summoned from.
function positionPicker(win) {
  const cursor = screen.getCursorScreenPoint();
  const { workArea, bounds } = screen.getDisplayNearestPoint(cursor);
  const [width, height] = win.getSize();
  const margin = 12;

  // When the Dock auto-hides, macOS reserves no screen space for it, so the
  // work area reaches the bottom edge and our window would sit under the Dock
  // when it slides up. Detect "no inset on any edge" and leave clearance.
  const bottomInset = bounds.y + bounds.height - (workArea.y + workArea.height);
  const sideInset = Math.max(
    workArea.x - bounds.x,
    bounds.x + bounds.width - (workArea.x + workArea.width)
  );
  const dockAutoHidden = process.platform === 'darwin' && bottomInset < 2 && sideInset < 2;
  const bottomGap = dockAutoHidden ? AUTO_HIDE_DOCK_CLEARANCE : margin;

  let x;
  if (process.platform === 'darwin') {
    x = Math.round(cursor.x - width / 2);
    x = Math.max(workArea.x + margin, Math.min(x, workArea.x + workArea.width - width - margin));
  } else {
    x = workArea.x + workArea.width - width - margin;
  }
  const y = workArea.y + workArea.height - height - bottomGap;

  win.setPosition(x, y);
}

function showPicker() {
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    positionPicker(pickerWindow);
    pickerWindow.show();
    pickerWindow.focus();
    return;
  }

  pickerWindow = new BrowserWindow({
    width: PICKER_WIDTH,
    height: PICKER_HEIGHT,
    show: false,
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    title: 'ACOMS Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  attachLinkHandling(pickerWindow.webContents);
  pickerWindow.loadFile(path.join(__dirname, 'picker.html'));

  pickerWindow.once('ready-to-show', () => {
    positionPicker(pickerWindow);
    pickerWindow.show();
    pickerWindow.focus();
  });

  pickerWindow.on('closed', () => {
    pickerWindow = null;
  });
}

// Tuck the picker away after a portal is launched, so it isn't always sitting
// on screen. The Dock icon (macOS) or tray icon (Windows) brings it back.
function hidePicker() {
  if (pickerWindow && !pickerWindow.isDestroyed() && pickerWindow.isVisible()) {
    pickerWindow.hide();
  }
}

// ---------------------------------------------------------------------------
// System tray (Windows / Linux)
// ---------------------------------------------------------------------------
// Windows has no Dock, and clicking a running app's taskbar button focuses an
// open portal window rather than re-summoning the picker. A tray icon next to
// the clock is the reliable "bring the picker back" affordance there. macOS
// keeps its Dock-based behaviour and gets no tray.
function createTray() {
  if (process.platform === 'darwin') return;

  try {
    const iconFile = process.platform === 'win32' ? 'tray.ico' : 'tray.png';
    tray = new Tray(path.join(__dirname, iconFile));
    tray.setToolTip(`ACOMS Launcher ${app.getVersion()}`);
    refreshTrayMenu();

    // Left-click (or double-click) the tray icon pops the picker straight up.
    tray.on('click', () => showPicker());
    tray.on('double-click', () => showPicker());
  } catch (err) {
    // A missing system tray shouldn't take the app down; the picker still
    // opens on launch and via the single-instance relaunch handler.
    console.error('Could not create tray icon:', err.message);
  }
}

// The tray menu carries the update state, so it has to be rebuilt whenever
// that state moves — Electron menus are immutable once set.
function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;

  const u = updater.snapshot();
  const items = [
    { label: 'Open ACOMS Launcher', click: () => showPicker() },
    { type: 'separator' },
    { label: `Version ${u.version}`, enabled: false }
  ];

  if (u.status === 'ready') {
    items.push({
      label: `Restart to update to ${u.newVersion || 'the new version'}`,
      click: () => updater.quitAndInstall()
    });
  } else if (u.status === 'manual') {
    // Unsigned macOS build — we can spot the update but not apply it.
    items.push({
      label: `Download ${u.newVersion ? `version ${u.newVersion}` : 'the update'}…`,
      click: () => shell.openExternal(updater.RELEASES_PAGE)
    });
  } else if (u.status === 'downloading') {
    items.push({ label: u.message, enabled: false });
  } else {
    items.push({ label: 'Check for updates…', click: () => updater.check({ manual: true }) });
  }

  items.push({ type: 'separator' }, { label: 'Quit', click: () => app.quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

// ---------------------------------------------------------------------------
// Portal windows
// ---------------------------------------------------------------------------
// Open (or focus) a portal window.
//   - From the picker: openPortal(id) with no targetUrl — focus the existing
//     window untouched (never reload), matching the picker's contract.
//   - From a cross-app link: openPortal(id, targetUrl) — focus the window AND
//     navigate it to the linked page, so you land on the right job/record.
function openPortal(id, targetUrl) {
  const portal = portals.find((p) => p.id === id);
  if (!portal) {
    console.error('Unknown portal id:', id);
    return;
  }

  const existing = portalWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    // Only navigate when a specific deep link was requested and it differs
    // from what's already showing; a plain picker click never reloads.
    if (targetUrl && targetUrl !== existing.webContents.getURL()) {
      existing.loadURL(targetUrl);
    }
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    hidePicker();
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: portal.name,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  attachLinkHandling(win.webContents);
  win.loadURL(targetUrl || portal.url);

  portalWindows.set(id, win);
  notifyOpenStateChanged();
  hidePicker();

  win.on('closed', () => {
    portalWindows.delete(id);
    notifyOpenStateChanged();
  });
}

// ---------------------------------------------------------------------------
// Quick Note window
// ---------------------------------------------------------------------------
// A separate, smaller window that jumps straight to a fresh Quick Note in
// ACOMS.Controller (via the deep link in portals.json). Reused (focused) if
// already open rather than spawning duplicates, and shares the app session so
// it stays logged in like any portal.
function openQuickNote(action) {
  if (!quickNote) return;
  const url = action === 'view' ? quickNote.viewUrl : quickNote.newUrl;
  if (!url) return;

  if (quickNoteWindow && !quickNoteWindow.isDestroyed()) {
    // Navigate the existing window to the requested action (a fresh note for
    // "new", the list for "view") and bring it forward.
    quickNoteWindow.loadURL(url);
    if (quickNoteWindow.isMinimized()) quickNoteWindow.restore();
    quickNoteWindow.show();
    quickNoteWindow.focus();
    hidePicker();
    return;
  }

  quickNoteWindow = new BrowserWindow({
    width: 900,
    height: 720,
    title: 'Quick Notes',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  attachLinkHandling(quickNoteWindow.webContents);
  quickNoteWindow.loadURL(url);

  notifyOpenStateChanged();
  hidePicker();

  quickNoteWindow.on('closed', () => {
    quickNoteWindow = null;
    notifyOpenStateChanged();
  });
}

// ---------------------------------------------------------------------------
// IPC (renderer <-> main)
// ---------------------------------------------------------------------------
ipcMain.handle('portals:get', () => ({
  portals,
  openIds: openPortalIds(),
  quickNote: quickNote
    ? {
        tagline: quickNote.tagline,
        newLabel: quickNote.newLabel,
        viewLabel: quickNote.viewLabel,
        hasNew: !!quickNote.newUrl,
        hasView: !!quickNote.viewUrl
      }
    : null,
  quickNoteId: QUICK_NOTE_ID
}));

ipcMain.handle('portal:open', (_event, id) => {
  openPortal(id);
});

ipcMain.handle('quicknote:open', (_event, action) => {
  openQuickNote(action);
});

// Version + update state for the picker's footer.
ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  update: updater.snapshot()
}));

ipcMain.handle('update:check', () => {
  updater.check({ manual: true });
});

// "Restart now" from the footer. On an unsigned macOS build there is nothing
// to install, so the same button hands over the download page instead.
ipcMain.handle('update:install', () => {
  const u = updater.snapshot();
  if (u.status === 'ready') {
    updater.quitAndInstall();
  } else if (u.status === 'manual') {
    shell.openExternal(updater.RELEASES_PAGE);
  }
});

// ---------------------------------------------------------------------------
// Single-instance lock: launching the app twice just refocuses the picker.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showPicker();
  });

  app.whenReady().then(() => {
    const cfg = loadConfig();
    portals = cfg.portals;
    quickNote = cfg.quickNote;
    createTray();

    // Keep the tray menu and the picker footer in step with the updater.
    updater.onUpdateStatus((snapshot) => {
      refreshTrayMenu();
      if (pickerWindow && !pickerWindow.isDestroyed()) {
        pickerWindow.webContents.send('update:changed', snapshot);
      }
    });
    updater.init();

    showPicker();

    // Clicking the Dock icon (macOS) re-opens the picker.
    app.on('activate', () => {
      showPicker();
    });
  });

  app.on('before-quit', () => {
    updater.dispose();
  });
}

// Closing every window should NOT quit the app: on macOS the Dock icon stays
// usable, and on Windows/Linux the tray icon keeps the picker summonable.
// Quitting is explicit — Cmd+Q on macOS, the tray menu's Quit on Windows.
app.on('window-all-closed', () => {});
