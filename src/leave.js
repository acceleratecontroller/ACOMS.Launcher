'use strict';

// ---------------------------------------------------------------------------
// Leave cards
// ---------------------------------------------------------------------------
// When someone asks for leave, the approver it is flagged to gets a card with
// Approve and Reject on it (Dion 2026-11-24). Reject asks for a reason. The
// person who asked gets a small card back with the answer.
//
// Why this is its own module and its own feed, like chat:
//   - It does not depend on the per-person pop-up switch in Controller. That
//     switch is for the task nags; an approval that is yours has to reach you.
//   - Controller decides WHO a request is flagged to (the approvers of the
//     person's region; after two days, the Office approver as well). The
//     Launcher shows what it is given and never works that out itself.
//
// The card is its own small window, not the shared pop-up (src/popup.js):
// that window can never take the keyboard, by design, and a reject reason
// has to be typed. This one takes the keyboard only when its text box is
// clicked; it is shown without stealing focus.
//
// Same session as everything else: the request goes out through the app's
// own session, so Controller's login cookie rides along. No token is held.

const path = require('path');
const { BrowserWindow, ipcMain, net, screen } = require('electron');
const store = require('./store');
const popup = require('./popup');
const rules = require('./leave-rules');

const POLL_MS = 60 * 1000;
// Straight after start, so the picker has the leave list when it is first
// opened (it was 12 seconds, and the strip sat on "Loading"; Dion 2026-11-25).
const FIRST_POLL_DELAY_MS = 1500;
// If that first read fails (the sign-in is still being restored), one more go.
const FIRST_RETRY_MS = 8 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;
const SEEN_SCOPE = 'leave-answers';

let portal = null; // the portal that hosts the routes (Controller)
// Where a card's link opens. ACOMS.OS, not Controller: the Leave page there
// is the one everybody has, and not everyone should be in Controller
// (Dion 2026-11-24). Falls back to the routes' portal if it is not set.
let pagePortal = null;
let config = null; // { portal, feed, act, page }
let openPage = null; // injected by main.js: (portalId, url) => void
let timer = null;
let polling = false;
// Upcoming leave, soonest first, as the picker shows it. Kept as it
// was last read, so the picker has it the moment it opens.
// status: 'off' (no leave set up), 'loading', 'ready', 'unavailable'.
let upcoming = { status: 'off', lines: [], more: '', all: [] };
let listeners = [];

function onUpcomingChanged(callback) {
  listeners.push(callback);
}

function setUpcoming(next) {
  if (JSON.stringify(next) === JSON.stringify(upcoming)) return;
  upcoming = next;
  for (const fn of listeners) {
    try {
      fn(upcoming);
    } catch {
      // A listener that throws must not stop the poll.
    }
  }
}

// key -> { win, content, height }
const cards = new Map();
// "Later" hides a card for a while; it comes back if it is still waiting.
const LATER_MS = 2 * 60 * 60 * 1000;
const hiddenUntil = new Map(); // key -> time (ms)

function hiddenKeys(now = Date.now()) {
  for (const [key, until] of hiddenUntil) if (until <= now) hiddenUntil.delete(key);
  return [...hiddenUntil.keys()];
}

function absolute(relative) {
  return new URL(relative, portal.url).toString();
}

function openLeavePage() {
  if (!openPage || !pagePortal) return;
  openPage(pagePortal.id, new URL(config.page, pagePortal.url).toString());
}

// One window of the Calendar for the Calendar window: { ok, data } | { ok: false, message }.
async function calendarRange(from, to) {
  const isDay = (v) => typeof v === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v);
  if (!portal || !config.calendar) return { ok: false, message: 'The calendar is not set up on this Launcher.' };
  if (!isDay(from) || !isDay(to)) return { ok: false, message: 'Could not load the calendar.' };
  const r = await request(`${config.calendar}?from=${from}&to=${to}`);
  if (!r.ok) return { ok: false, message: r.signIn ? 'Sign in to ACOMS.Controller to see the calendar.' : 'Could not load the calendar.' };
  return { ok: true, data: r.data };
}

// The picker's "On leave" strip: the leave requests list in Controller, where
// the detail is (Dion 2026-11-24). The cards still open ACOMS.OS.
function openLeaveList() {
  if (!openPage || !portal) return;
  openPage(portal.id, absolute(config.listPage));
}

// { ok, data } | { ok: false, signIn } | { ok: false, message }
async function request(relative, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await net.fetch(absolute(relative), {
      method,
      credentials: 'include',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // A login redirect must stay visible as a redirect (see notifications.js).
      redirect: 'manual',
      signal: controller.signal
    });
    const isRedirect = res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400);
    if (isRedirect || res.status === 401) return { ok: false, signIn: true, message: 'Sign in to ACOMS.Controller, then try again.' };
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) return { ok: false, message: (json && json.error) || `That did not go through (HTTP ${res.status}).` };
    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, message: 'Could not reach ACOMS.Controller. Nothing was changed.' };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Card windows ───────────────────────────────────────────────────────────

// The screen the cards sit on: the one the mouse is on when the first card
// opens, so it is seen on a desk with several screens. It stays put while
// any card is open; cards do not chase the mouse.
let cardArea = null;

function layout() {
  const workArea = cardArea || screen.getPrimaryDisplay().workArea;
  const list = [...cards.values()];
  const heights = list.map((c) => c.height);
  list.forEach((card, i) => {
    if (card.win.isDestroyed()) return;
    card.win.setBounds(rules.cardBounds(workArea, heights, i));
  });
}

function closeCard(key) {
  const card = cards.get(key);
  if (!card) return;
  cards.delete(key);
  if (!card.win.isDestroyed()) card.win.destroy();
  layout();
}

function openCard(content) {
  if (cards.has(content.key)) return;
  if (cards.size === 0) {
    try {
      cardArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    } catch {
      cardArea = null;
    }
  }
  const win = new BrowserWindow({
    width: rules.CARD_WIDTH,
    height: rules.CARD_MIN_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#1b2530',
    title: 'Leave request',
    webPreferences: {
      preload: path.join(__dirname, 'leave-card-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  cards.set(content.key, { win, content, height: rules.CARD_MIN_HEIGHT });
  win.webContents.once('did-finish-load', () => {
    if (win.isDestroyed()) return;
    win.webContents.send('leave-card:show', content);
    layout();
    // Shown without taking the keyboard from whatever the person is typing in.
    win.showInactive();
  });
  win.on('closed', () => {
    const card = cards.get(content.key);
    if (card && card.win === win) cards.delete(content.key);
  });
  win.loadFile(path.join(__dirname, 'leave-card.html'));
}

function keyOf(sender) {
  for (const [key, card] of cards) {
    if (!card.win.isDestroyed() && card.win.webContents === sender) return key;
  }
  return null;
}

// ── Polling ────────────────────────────────────────────────────────────────

async function poll() {
  if (!portal || polling) return;
  polling = true;
  try {
    const r = await request(config.feed);
    // Signed out or unreachable: leave what is on screen alone. A card that is
    // still open says so when its button is pressed.
    if (!r.ok || !r.data) {
      // Never read yet: stop saying "loading". A list already shown stays.
      if (upcoming.status === 'loading') {
        setUpcoming({ status: 'unavailable', lines: [], more: '', all: [] });
        setTimeout(poll, FIRST_RETRY_MS);
      }
      return;
    }
    const quiet = store.inQuietHours();
    setUpcoming({ status: 'ready', ...rules.upcomingLines(r.data.upcoming), dates: rules.keyDates(r.data.dates) });

    const plan = rules.planCards({
      toDecide: Array.isArray(r.data.toDecide) ? r.data.toDecide : [],
      openKeys: [...cards.keys()],
      hiddenKeys: hiddenKeys(),
      quiet
    });
    for (const key of plan.close) closeCard(key);
    for (const content of plan.open) openCard(content);

    const answers = rules.planAnswers({
      answers: Array.isArray(r.data.answers) ? r.data.answers : [],
      seen: store.seenMap(),
      primed: store.isPrimed(SEEN_SCOPE),
      quiet
    });
    if (answers.baseline) store.markPrimed(SEEN_SCOPE);
    if (answers.markSeen.length) store.recordSeen({ markSeen: answers.markSeen });
    for (const a of answers.announce) {
      popup.show({
        key: a.seenId,
        kind: a.rejected ? 'reminder' : 'portal',
        label: a.label,
        title: a.title,
        body: a.body,
        badge: 'L',
        // An answer is news the person asked for: it stays until they look.
        sticky: true,
        onClick: () => openLeavePage()
      });
    }
  } finally {
    polling = false;
  }
}

function schedule() {
  if (timer) clearInterval(timer);
  timer = setInterval(poll, POLL_MS);
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

function init({ portals = [], config: cfg = null, openPortalAt = null } = {}) {
  if (!cfg || !cfg.portal || !cfg.feed || !cfg.act) return;
  portal = portals.find((p) => p.id === cfg.portal) || null;
  if (!portal) return;
  config = { page: '/leave-requests', listPage: '/leave-requests', ...cfg };
  upcoming = { status: 'loading', lines: [], more: '', all: [] };
  pagePortal = portals.find((p) => p.id === cfg.pagePortal) || portal;
  openPage = openPortalAt;

  // The card says how tall it needs to be (its text, then the reject box).
  ipcMain.on('leave-card:height', (event, height) => {
    const key = keyOf(event.sender);
    const card = key && cards.get(key);
    if (!card) return;
    card.height = rules.clampHeight(height);
    layout();
  });

  ipcMain.handle('leave-card:decide', async (event, payload) => {
    const key = keyOf(event.sender);
    const card = key && cards.get(key);
    if (!card) return { ok: false, message: 'This request is no longer waiting.' };
    const decision = payload && payload.decision === 'reject' ? 'reject' : 'approve';
    const comment = payload && typeof payload.comment === 'string' ? payload.comment.trim() : '';
    if (decision === 'reject' && !comment) return { ok: false, message: 'Say why it is rejected. One line is enough.' };

    const r = await request(config.act, {
      method: 'POST',
      body: { action: 'decide', id: card.content.id, decision, comment: comment || null }
    });
    if (!r.ok) return { ok: false, message: r.message };
    // changed:false = someone else already decided it. Either way it is done.
    const already = r.data && r.data.changed === false && r.data.message ? r.data.message : null;
    setTimeout(() => {
      closeCard(key);
      poll();
    }, already ? 2500 : 600);
    return { ok: true, message: already };
  });

  ipcMain.on('leave-card:open-page', () => {
    openLeavePage();
  });

  // Hidden until the next poll; the request is still waiting and comes back.
  ipcMain.on('leave-card:later', (event) => {
    const key = keyOf(event.sender);
    if (!key) return;
    hiddenUntil.set(key, Date.now() + LATER_MS);
    closeCard(key);
  });

  // A screen unplugged or rearranged: fall back to the primary one.
  const screensChanged = () => {
    cardArea = null;
    layout();
  };
  screen.on('display-metrics-changed', layout);
  screen.on('display-removed', screensChanged);
  setTimeout(() => {
    poll();
    schedule();
  }, FIRST_POLL_DELAY_MS);
}

function dispose() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const key of [...cards.keys()]) closeCard(key);
}

module.exports = { init, dispose, poll, onUpcomingChanged, upcoming: () => upcoming, openLeaveList, calendarRange, hasCalendar: () => Boolean(portal && config.calendar) };
