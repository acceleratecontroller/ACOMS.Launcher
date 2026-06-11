'use strict';

const { app, BrowserWindow, ipcMain, shell, screen, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Portal config
// ---------------------------------------------------------------------------
// The portal list lives in portals.json at the project root so it can be
// edited without touching app logic. In a packaged build it is bundled
// alongside the app (see the "files" array in package.json).
const PORTALS_PATH = path.join(__dirname, '..', 'portals.json');

function loadPortals() {
  try {
    const raw = fs.readFileSync(PORTALS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.portals)) {
      throw new Error('portals.json must contain a "portals" array');
    }
    // Keep only the fields the UI needs, and ignore anything malformed.
    return parsed.portals.filter(
      (p) => p && typeof p.id === 'string' && typeof p.url === 'string'
    );
  } catch (err) {
    console.error('Failed to load portals.json:', err.message);
    return [];
  }
}

let portals = [];

// ---------------------------------------------------------------------------
// Window bookkeeping
// ---------------------------------------------------------------------------
let pickerWindow = null;
let tray = null;
// Map of portal id -> BrowserWindow for portals that are currently open.
const portalWindows = new Map();

function openPortalIds() {
  return Array.from(portalWindows.keys());
}

// Tell the picker (if it's open) which portals currently have a window, so it
// can show the "open" indicator dots.
function notifyOpenStateChanged() {
  if (pickerWindow && !pickerWindow.isDestroyed()) {
    pickerWindow.webContents.send('portals:open-changed', openPortalIds());
  }
}

// Any attempt by page content to open a new window (e.g. target="_blank")
// is sent to the user's default browser instead of spawning app windows.
function routeNewWindowsToBrowser(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (url && /^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------------------
// Picker window
// ---------------------------------------------------------------------------
const PICKER_WIDTH = 420;
const PICKER_HEIGHT = 560;

// Decide where the picker pops up.
//   macOS  – just above the Dock, centred on the cursor (the Dock icon sits
//            under the cursor when 'activate' fires), so it appears above the
//            icon you clicked. Assumes the Dock is along the bottom.
//   Windows/Linux – bottom-right, just above the taskbar, near the system tray
//            icon it is summoned from.
function positionPicker(win) {
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const [width, height] = win.getSize();
  const margin = 12;

  let x;
  if (process.platform === 'darwin') {
    x = Math.round(cursor.x - width / 2);
    x = Math.max(workArea.x + margin, Math.min(x, workArea.x + workArea.width - width - margin));
  } else {
    x = workArea.x + workArea.width - width - margin;
  }
  const y = workArea.y + workArea.height - height - margin;

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

  routeNewWindowsToBrowser(pickerWindow.webContents);
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
    tray.setToolTip('ACOMS Launcher');

    const menu = Menu.buildFromTemplate([
      { label: 'Open ACOMS Launcher', click: () => showPicker() },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]);
    tray.setContextMenu(menu);

    // Left-click the tray icon pops the picker straight up.
    tray.on('click', () => showPicker());
  } catch (err) {
    // A missing system tray shouldn't take the app down; the picker still
    // opens on launch and via the single-instance relaunch handler.
    console.error('Could not create tray icon:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Portal windows
// ---------------------------------------------------------------------------
function openPortal(id) {
  const existing = portalWindows.get(id);
  if (existing && !existing.isDestroyed()) {
    // Already open — just bring it to the front, never reload.
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    hidePicker();
    return;
  }

  const portal = portals.find((p) => p.id === id);
  if (!portal) {
    console.error('Unknown portal id:', id);
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

  routeNewWindowsToBrowser(win.webContents);
  win.loadURL(portal.url);

  portalWindows.set(id, win);
  notifyOpenStateChanged();
  hidePicker();

  win.on('closed', () => {
    portalWindows.delete(id);
    notifyOpenStateChanged();
  });
}

// ---------------------------------------------------------------------------
// IPC (renderer <-> main)
// ---------------------------------------------------------------------------
ipcMain.handle('portals:get', () => ({
  portals,
  openIds: openPortalIds()
}));

ipcMain.handle('portal:open', (_event, id) => {
  openPortal(id);
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
    portals = loadPortals();
    createTray();
    showPicker();

    // Clicking the Dock icon (macOS) re-opens the picker.
    app.on('activate', () => {
      showPicker();
    });
  });
}

// Closing every window should NOT quit the app: on macOS the Dock icon stays
// usable, and on Windows/Linux the tray icon keeps the picker summonable.
// Quitting is explicit — Cmd+Q on macOS, the tray menu's Quit on Windows.
app.on('window-all-closed', () => {});
