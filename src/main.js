'use strict';

const { app, BrowserWindow, ipcMain, shell, screen, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const updater = require('./updater');
const notifications = require('./notifications');
const {
  windowKey,
  normaliseViews,
  viewUrl,
  decideNewWindow,
  findPortalForUrl: findPortalForUrlRule,
  sameUrl,
  viewerBounds
} = require('./window-rules');
const chat = require('./chat');
const chatFiles = require('./chat-files');
const popup = require('./popup');
const store = require('./store');

// Thumbnails in chat load from acoms-file:// (chat-files.js); a scheme's
// privileges can only be granted before the app is ready.
chatFiles.registerScheme();

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
    // `summary` (optional) is the path to that portal's launcher-summary
    // route; a portal without one is simply never polled.
    const list = parsed.portals
      .filter((p) => p && typeof p.id === 'string' && typeof p.url === 'string')
      .map((p) => ({
        ...p,
        summary: typeof p.summary === 'string' ? p.summary : null,
        // Optional named pages that get their own tile half and window
        // (WIP's Scheduler). See window-rules.js.
        views: normaliseViews(p.views)
      }));
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
    // Optional chat block: which portal hosts the chat routes. No block, no
    // chat — the picker simply doesn't offer it.
    const chatRaw = parsed.chat;
    const chatCfg =
      chatRaw && typeof chatRaw === 'object' && typeof chatRaw.portal === 'string'
        ? {
            portal: chatRaw.portal,
            sync: typeof chatRaw.sync === 'string' ? chatRaw.sync : undefined,
            // Where an A-number in a message links to (chat-links.js). v1.0.11
            // shipped without this line, so every A-number stayed plain text.
            jobs: chatRaw.jobs && typeof chatRaw.jobs === 'object' ? chatRaw.jobs : undefined
          }
        : null;
    return { portals: list, quickNote: qn, chat: chatCfg };
  } catch (err) {
    console.error('Failed to load portals.json:', err.message);
    return { portals: [], quickNote: null, chat: null };
  }
}

let portals = [];
let quickNote = null;
let chatConfig = null;

// ---------------------------------------------------------------------------
// Window bookkeeping
// ---------------------------------------------------------------------------
let pickerWindow = null;
let tray = null;
// Map of window KEY -> BrowserWindow[] for every open portal window. The key
// is the portal id, or `<portal id>#<view id>` for a view's window (see
// window-rules.js). A portal can have several windows since 2026-09-22; the
// array is kept most-recently-focused first, so "bring WIP to the front"
// means the WIP window you were last in.
const portalWindows = new Map();

function liveWindows(key) {
  const wins = (portalWindows.get(key) || []).filter((w) => !w.isDestroyed());
  if (wins.length) portalWindows.set(key, wins);
  else portalWindows.delete(key);
  return wins;
}

function allPortalWindows() {
  const out = [];
  for (const key of Array.from(portalWindows.keys())) {
    for (const win of liveWindows(key)) out.push({ key, win });
  }
  return out;
}

function rememberFocus(key, win) {
  const wins = liveWindows(key).filter((w) => w !== win);
  wins.unshift(win);
  portalWindows.set(key, wins);
}
// Dedicated Quick Note window (a single reusable scratchpad, separate from the
// portal windows above).
let quickNoteWindow = null;
// The chat window — one, reused.
let chatWindow = null;
// Sentinel id included in the "open" list so the picker can show a dot on the
// Quick Note button while its window is open.
const QUICK_NOTE_ID = '__quicknote__';

// Keys with at least one live window (portal ids and view keys alike).
function openPortalIds() {
  const ids = Array.from(portalWindows.keys()).filter((key) => liveWindows(key).length > 0);
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

function findPortalForUrl(url) {
  return findPortalForUrlRule(url, portals);
}

// What happens when page content asks for a new window (target="_blank" or
// window.open). Until 2026-09-22 a link to one of our portals was routed INTO
// that portal's one existing window, which is what made "Open job in WIP"
// from the scheduler replace the board. Now (window-rules.decideNewWindow):
// a page already showing in one of our windows is focused; any other page of
// ours opens a brand-new window; anything else goes to the default browser.
function handleNewWindow(url) {
  const open = allPortalWindows().map(({ key, win }) => ({ key, url: win.webContents.getURL() }));
  const decision = decideNewWindow(url, portals, open);
  if (decision.action === 'focus') {
    const target = liveWindows(decision.key).find((w) => sameUrl(w.webContents.getURL(), url));
    if (target) bringForward(target);
  } else if (decision.action === 'new') {
    openPortal(decision.portalId, decision.url, { newWindow: true });
  } else if (decision.action === 'external') {
    shell.openExternal(decision.url);
  }
  return { action: 'deny' };
}

function bringForward(win) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
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
    refreshTrayTooltip();
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

// Windows has no badge on a tray icon, so the count lives in the tooltip —
// the thing you get by hovering the icon you were already reaching for.
function refreshTrayTooltip() {
  if (!tray || tray.isDestroyed()) return;
  const badge = notifications.totalBadge();
  const unread = chat.unreadTotal();
  const parts = [];
  if (badge > 0) parts.push(`${badge} waiting on you`);
  if (unread > 0) parts.push(`${unread} unread ${unread === 1 ? 'message' : 'messages'}`);
  tray.setToolTip(
    parts.length > 0 ? `ACOMS Launcher — ${parts.join(', ')}` : `ACOMS Launcher ${app.getVersion()}`
  );
}

// The tray menu carries the update and notification state, so it has to be
// rebuilt whenever either moves — Electron menus are immutable once set.
function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;

  const u = updater.snapshot();
  const badge = notifications.totalBadge();
  const items = [
    { label: 'Open ACOMS Launcher', click: () => showPicker() },
    { type: 'separator' },
    {
      label: badge > 0 ? `${badge} waiting on you` : 'Nothing waiting on you',
      enabled: false
    },
    { label: 'Check portals now', click: () => notifications.pollAll() },
    ...(chatConfig
      ? [
          {
            label: chat.unreadTotal() > 0 ? `Chat — ${chat.unreadTotal()} unread` : 'Chat',
            click: () => openChat()
          }
        ]
      : []),
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
//   - From the picker: openPortal(id) with no targetUrl — focus the window
//     you were last in, untouched (never reload), matching the picker's
//     contract. With opts.newWindow (the tile's "+" or Shift-click) a second
//     window opens beside it.
//   - opts.view: one of the portal's named views (WIP's Scheduler) — its own
//     window, keyed apart from the portal's ordinary windows, maximised if
//     the view asks for it.
//   - From a cross-app link / notification: openPortal(id, targetUrl) —
//     focus the window AND navigate it to the linked page. handleNewWindow
//     passes newWindow instead, so a link never hijacks a window.
function openPortal(id, targetUrl, opts = {}) {
  const portal = portals.find((p) => p.id === id);
  if (!portal) {
    console.error('Unknown portal id:', id);
    return;
  }
  const view = opts.view ? (portal.views || []).find((v) => v.id === opts.view) : null;
  if (opts.view && !view) {
    console.error('Unknown view', opts.view, 'for portal', id);
    return;
  }
  const key = windowKey(id, view ? view.id : null);

  const existing = liveWindows(key)[0];
  if (existing && !opts.newWindow) {
    // Only navigate when a specific deep link was requested and it differs
    // from what's already showing; a plain picker click never reloads.
    if (targetUrl && !sameUrl(targetUrl, existing.webContents.getURL())) {
      existing.loadURL(targetUrl);
    }
    bringForward(existing);
    hidePicker();
    return;
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: view ? `${portal.name} — ${view.label}` : portal.name,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  attachLinkHandling(win.webContents);
  win.loadURL(targetUrl || (view ? viewUrl(portal, view) : portal.url));
  if (view && view.maximize) win.maximize();

  rememberFocus(key, win);
  notifyOpenStateChanged();
  hidePicker();

  win.on('focus', () => rememberFocus(key, win));
  win.on('closed', () => {
    liveWindows(key);
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
// Chat window
// ---------------------------------------------------------------------------
// A local page (chat.html), not a portal: it gets its own preload and talks
// only to chat.js over IPC. Opened from the picker, the tray, or by clicking a
// message notification — which passes the conversation to land on.
function reportChatWindow() {
  const open = Boolean(chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible());
  chat.setWindowState({
    open: open && !chatWindow.isMinimized(),
    focused: open && chatWindow.isFocused()
  });
}

// All the picker gets: enough for a button and a number, no message text.
function chatBadge() {
  const { status, unreadTotal } = chat.snapshot();
  return { enabled: Boolean(chatConfig), status, unreadTotal };
}

function openChat(conversationId) {
  if (!chatConfig) return;
  if (conversationId) chat.selectConversation(conversationId);

  if (chatWindow && !chatWindow.isDestroyed()) {
    if (chatWindow.isMinimized()) chatWindow.restore();
    chatWindow.show();
    chatWindow.focus();
    hidePicker();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 820,
    height: 640,
    minWidth: 560,
    minHeight: 400,
    title: 'ACOMS Chat',
    webPreferences: {
      preload: path.join(__dirname, 'chat-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Links in messages open like any other link: a portal's in its window,
  // anything else in the browser. The chat page itself never navigates away.
  attachLinkHandling(chatWindow.webContents);
  chatWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  chatWindow.loadFile(path.join(__dirname, 'chat.html'));

  for (const evt of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore']) {
    chatWindow.on(evt, reportChatWindow);
  }
  chatWindow.on('closed', () => {
    chatWindow = null;
    reportChatWindow();
  });

  hidePicker();
}

// A file the chat window wants sent: a name, a type and the bytes, nothing
// else carried through.
function cleanOutgoingFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .filter((f) => f && typeof f.name === 'string' && f.data instanceof ArrayBuffer)
    .slice(0, 10)
    .map((f) => ({ name: f.name, type: typeof f.type === 'string' ? f.type : '', data: f.data }));
}

function attachmentArg(file) {
  if (!file || typeof file.id !== 'string' || !file.id) throw new Error('No such file');
  return { id: file.id, name: typeof file.name === 'string' ? file.name : 'file' };
}

// { ok: true } or { ok: false, error } — a failed open is shown in the window,
// not thrown across IPC.
async function runFileAction(fn) {
  try {
    return { ok: true, ...((await fn()) || {}) };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'That did not work' };
  }
}

// The picture viewer — one window, reused. Opened by clicking a picture in
// chat; nearly full screen on the monitor the chat window is on, so a small
// chat window no longer means a small picture.
let viewerWindow = null;
let viewerReady = false;
let viewerFile = null;

function openImageViewer(file) {
  viewerFile = file;

  if (viewerWindow && !viewerWindow.isDestroyed()) {
    if (viewerReady) viewerWindow.webContents.send('viewer:show', file);
    if (viewerWindow.isMinimized()) viewerWindow.restore();
    viewerWindow.show();
    viewerWindow.focus();
    return;
  }

  const near =
    chatWindow && !chatWindow.isDestroyed()
      ? screen.getDisplayMatching(chatWindow.getBounds())
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  viewerReady = false;
  viewerWindow = new BrowserWindow({
    ...viewerBounds(near.workArea),
    minWidth: 400,
    minHeight: 300,
    title: file.name,
    backgroundColor: '#05080b',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'image-viewer-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  viewerWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  viewerWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  viewerWindow.loadFile(path.join(__dirname, 'image-viewer.html'));
  viewerWindow.on('closed', () => {
    viewerWindow = null;
    viewerReady = false;
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

// opts: { view?: string, newWindow?: boolean } — see openPortal.
ipcMain.handle('portal:open', (_event, id, opts) => {
  openPortal(id, undefined, opts && typeof opts === 'object' ? opts : {});
});

ipcMain.handle('quicknote:open', (_event, action) => {
  openQuickNote(action);
});

// Per-portal notification state for the picker's badges.
ipcMain.handle('notifications:get', () => notifications.snapshot());

ipcMain.handle('notifications:refresh', () => notifications.pollAll());

// Open a portal window directly at one of its notification items.
ipcMain.handle('notifications:open', (_event, portalId, itemPath) => {
  const portal = portals.find((p) => p.id === portalId);
  if (!portal) return;
  openPortal(portalId, notifications.resolveItemUrl(portal, { path: itemPath }));
});

// Chat. The picker only needs to know whether to offer it and how many are
// unread; everything else is the chat window's.
ipcMain.handle('chat:open', () => openChat());
ipcMain.handle('chat:badge', () => chatBadge());
ipcMain.handle('chat:get', () => chat.snapshot());
ipcMain.handle('chat:select-conversation', (_event, id) => chat.selectConversation(id));
ipcMain.handle('chat:select-person', (_event, id) => chat.selectPerson(id));
ipcMain.handle('chat:send', (_event, text, files) => chat.send(text, cleanOutgoingFiles(files)));
// Files in chat (chat-files.js). Every argument comes from a renderer, so it
// is checked here rather than trusted.
ipcMain.handle('chat:open-file', (_event, file) => runFileAction(() => chatFiles.open(attachmentArg(file))));
ipcMain.handle('chat:save-file', (_event, file) =>
  runFileAction(() => chatFiles.save(attachmentArg(file), chatWindow))
);
ipcMain.handle('chat:view-image', (_event, file) => {
  openImageViewer(attachmentArg(file));
});
// The viewer page says when it can listen; the picture is sent then (and
// directly on later clicks, since the window is reused).
ipcMain.on('viewer:ready', (event) => {
  if (!viewerWindow || event.sender !== viewerWindow.webContents) return;
  viewerReady = true;
  if (viewerFile) viewerWindow.webContents.send('viewer:show', viewerFile);
});
ipcMain.on('viewer:close', (event) => {
  if (viewerWindow && event.sender === viewerWindow.webContents) viewerWindow.close();
});
ipcMain.handle('viewer:save-file', (_event, file) =>
  runFileAction(() => chatFiles.save(attachmentArg(file), viewerWindow))
);
ipcMain.handle('chat:clipboard-files', () => chatFiles.clipboardFiles());
ipcMain.handle('chat:read-clipboard-file', (_event, filePath) =>
  typeof filePath === 'string' ? chatFiles.readClipboardFile(filePath) : null
);
ipcMain.handle('chat:retry', () => chat.pollNow());
ipcMain.handle('chat:sign-in', () => {
  if (chatConfig) openPortal(chatConfig.portal);
});

ipcMain.handle('settings:get', () => store.getSettings());

ipcMain.handle('settings:set-muted', (_event, portalId, muted) => {
  const next = store.setMuted(portalId, muted);
  // Muting changes the badge total, so the tray has to catch up immediately.
  refreshTrayTooltip();
  refreshTrayMenu();
  return next;
});

ipcMain.handle('settings:set-quiet-hours', (_event, from, to) =>
  store.setQuietHours(from, to)
);

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
    chatConfig = cfg.chat;
    createTray();

    // Keep the tray menu and the picker footer in step with the updater.
    updater.onUpdateStatus((snapshot) => {
      refreshTrayMenu();
      if (pickerWindow && !pickerWindow.isDestroyed()) {
        pickerWindow.webContents.send('update:changed', snapshot);
      }
    });
    updater.init();

    // The launcher's own pop-up cards. Set up first: everything below raises them.
    popup.init();

    // Poll the portals that offer a summary route and raise notifications for
    // anything new. Clicking a notification opens that portal at the record.
    notifications.onChanged((snapshot) => {
      refreshTrayTooltip();
      refreshTrayMenu();
      app.setBadgeCount(notifications.totalBadge() + chat.unreadTotal()); // macOS dock; no-op on Windows
      if (pickerWindow && !pickerWindow.isDestroyed()) {
        pickerWindow.webContents.send('notifications:changed', snapshot);
      }
    });
    notifications.init({
      portals,
      openPortalAt: (portalId, url) => openPortal(portalId, url)
    });

    // Chat: same session, same cookie. Its state goes to the chat window in
    // full and to the picker for its unread badge.
    chat.onChanged((snapshot) => {
      refreshTrayTooltip();
      refreshTrayMenu();
      app.setBadgeCount(notifications.totalBadge() + chat.unreadTotal());
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat:changed', snapshot);
      }
      if (pickerWindow && !pickerWindow.isDestroyed()) {
        pickerWindow.webContents.send('chat:badge-changed', chatBadge());
      }
    });
    chat.init({
      portals,
      config: chatConfig,
      openChat: (conversationId) => openChat(conversationId)
    });

    showPicker();

    // Clicking the Dock icon (macOS) re-opens the picker.
    app.on('activate', () => {
      showPicker();
    });
  });

  app.on('before-quit', () => {
    updater.dispose();
    notifications.dispose();
    chat.dispose();
    popup.dispose();
  });
}

// Closing every window should NOT quit the app: on macOS the Dock icon stays
// usable, and on Windows/Linux the tray icon keeps the picker summonable.
// Quitting is explicit — Cmd+Q on macOS, the tray menu's Quit on Windows.
app.on('window-all-closed', () => {});
