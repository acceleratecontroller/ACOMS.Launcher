'use strict';

// ---------------------------------------------------------------------------
// Self-update
// ---------------------------------------------------------------------------
// Why this exists: before this, putting a new version of the launcher on a
// machine meant cloning the repo, installing Node and running `npm run build`
// — on each operating system separately. That is a chore for a developer and
// impossible for anyone else, so it capped who could ever use the app. A
// release published by CI now installs itself.
//
// Platform reality worth knowing: Squirrel.Mac only applies an update to a
// *signed* app bundle, and these builds are deliberately unsigned. So macOS
// gets check-and-tell — a notification that opens the releases page — while
// Windows gets the real download-and-install. Once the app is signed, macOS
// can move onto the same path by widening CAN_SELF_INSTALL.

const { app, Notification, shell, powerMonitor } = require('electron');

// electron-updater is a production dependency, but requiring it must never be
// what stops the launcher opening.
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  console.error('electron-updater unavailable:', err.message);
}

// Windows (NSIS) can download and apply an update to an unsigned build.
// macOS cannot without a signature — see the note above.
const CAN_SELF_INSTALL = process.platform === 'win32';

const FIRST_CHECK_DELAY_MS = 30 * 1000; // let the picker paint first

// Every 30 minutes. This was 6 hours, chosen when the launcher was a bookmark
// folder and a stale copy cost nothing. It now carries notifications and
// fixes, and 6 hours meant Dion sat on a known-broken version twice waiting
// for a check that was hours away. The request is one small YAML file against
// a CDN, so the cost of asking more often is nil.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

// A laptop that was asleep since yesterday has a timer that has not fired and
// will not fire until its next full interval. Waking is exactly the moment a
// person is most likely to be behind, so check then too — debounced, because
// resume can fire more than once.
const RESUME_CHECK_DELAY_MS = 10 * 1000;

// Where a person is sent when the app cannot install the update itself.
// The repo is public (Dion, 2026-09-09) so the app can read its update feed
// with no credential — a credential baked into a distributed binary is
// readable by anyone holding the installer, which is why this matters.
// Audited 2026-09-09: nothing that ships grants access to any ACOMS app, and
// every portal turns an unauthenticated request away at the door.
const RELEASES_PAGE =
  'https://github.com/acceleratecontroller/ACOMS.Launcher/releases/latest';

// One shared view of what the updater is doing, so the tray menu and the
// picker footer both render it without asking twice.
//   idle | checking | uptodate | downloading | ready | manual | error
const state = {
  status: 'idle',
  version: app.getVersion(),
  newVersion: null,
  percent: 0,
  message: '',
  canSelfInstall: CAN_SELF_INSTALL
};

let listeners = [];
let timer = null;
let quittingToInstall = false;

// Set while a person is waiting on the answer to a "Check for updates" they
// clicked themselves, so the outcome can be reported once, from whichever
// event actually settles it. Reporting from an immediate state callback (the
// first version of this) answered with the PREVIOUS check's result before the
// new one had run.
let manualCheckPending = false;

// A check or download that never settles would otherwise leave the UI with no
// usable control. If either is still outstanding after this, call it failed.
const STALL_TIMEOUT_MS = 3 * 60 * 1000;
let stallTimer = null;
let resumeTimer = null;

function armStallTimer() {
  clearStallTimer();
  stallTimer = setTimeout(() => {
    if (state.status === 'checking' || state.status === 'downloading') {
      failed(state.status === 'downloading' ? 'download' : 'check', 'timed out');
    }
  }, STALL_TIMEOUT_MS);
}

function clearStallTimer() {
  if (stallTimer) clearTimeout(stallTimer);
  stallTimer = null;
}

function snapshot() {
  return { ...state };
}

function emit() {
  for (const fn of listeners) {
    try {
      fn(snapshot());
    } catch (err) {
      console.error('update listener failed:', err.message);
    }
  }
}

function setState(patch) {
  Object.assign(state, patch);
  emit();
}

// Subscribe to update status. Fires immediately with the current state and
// returns an unsubscribe function.
function onUpdateStatus(fn) {
  listeners.push(fn);
  fn(snapshot());
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}

// Land in a state that always leaves the person something to do.
//
// A failed DOWNLOAD is not a dead end: the release exists, we just couldn't
// fetch it, so fall back to the same "here's the download page" path macOS
// uses. That is what turns a stuck spinner into a working button.
function failed(phase, detail) {
  clearStallTimer();
  const known = state.newVersion;
  if (phase === 'download' && known) {
    setState({
      status: 'manual',
      message: `Couldn't download ${known} — open the releases page`
    });
    notify(
      'ACOMS Launcher update',
      `Version ${known} is available but couldn't be downloaded. Click to open the releases page.`,
      () => shell.openExternal(RELEASES_PAGE)
    );
  } else {
    setState({
      status: 'error',
      message: phase === 'download' ? 'Update download failed' : 'Update check failed'
    });
  }
  reportManual(phase === 'download' ? 'download-error' : 'error', detail);
}

// Answer a manually requested check exactly once.
function reportManual(outcome) {
  if (!manualCheckPending) return;
  manualCheckPending = false;

  if (outcome === 'uptodate') {
    notify('ACOMS Launcher', "You're on the latest version.");
  } else if (outcome === 'error') {
    notify('ACOMS Launcher', 'Could not check for updates — check your internet connection.');
  }
  // 'available' / 'download-error' say nothing extra here: the download
  // progress, the ready prompt, or failed()'s own notification covers it.
}

function notify(title, body, onClick) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  if (onClick) n.on('click', onClick);
  n.show();
}

// An update check is only meaningful in a packaged build. In development the
// app runs from source and there is nothing to update to, so the whole
// subsystem stays quiet rather than erroring on a loop.
function isEligible() {
  return !!autoUpdater && app.isPackaged;
}

function wireEvents() {
  autoUpdater.on('checking-for-update', () => {
    setState({ status: 'checking', message: 'Checking for updates…' });
    armStallTimer();
  });

  autoUpdater.on('update-not-available', () => {
    clearStallTimer();
    setState({ status: 'uptodate', newVersion: null, message: 'Up to date' });
    reportManual('uptodate');
  });

  autoUpdater.on('update-available', (info) => {
    const v = (info && info.version) || null;
    reportManual('available');
    if (CAN_SELF_INSTALL) {
      setState({
        status: 'downloading',
        newVersion: v,
        percent: 0,
        message: 'Downloading update…'
      });
      armStallTimer();
    } else {
      clearStallTimer();
      // Unsigned macOS: tell the person and hand them the download.
      setState({
        status: 'manual',
        newVersion: v,
        message: v ? `Version ${v} available to download` : 'An update is available'
      });
      notify(
        'ACOMS Launcher update available',
        `Version ${v || 'newer'} is ready to download. Click to open the releases page.`,
        () => shell.openExternal(RELEASES_PAGE)
      );
    }
  });

  autoUpdater.on('download-progress', (p) => {
    const percent = Math.round((p && p.percent) || 0);
    setState({ status: 'downloading', percent, message: `Downloading update… ${percent}%` });
    armStallTimer(); // progress means it's alive; restart the clock
  });

  autoUpdater.on('update-downloaded', (info) => {
    clearStallTimer();
    const v = (info && info.version) || state.newVersion;
    setState({
      status: 'ready',
      newVersion: v,
      percent: 100,
      message: v ? `Version ${v} ready — restart to apply` : 'Update ready — restart to apply'
    });
    // Deliberately NOT restarting on its own: the launcher owns the windows
    // someone is working in, and yanking those away mid-job is worse than
    // running yesterday's build for another hour.
    notify(
      'ACOMS Launcher update ready',
      `Version ${v || 'newer'} applies next time you restart. Click to restart now.`,
      () => quitAndInstall()
    );
  });

  autoUpdater.on('error', (err) => {
    const message = (err && err.message) || String(err);
    // Which half failed changes what the person can do about it, so don't
    // flatten both into "update check failed" the way the first version did.
    const phase = state.status === 'downloading' ? 'download' : 'check';
    console.error(`Update ${phase} failed:`, message);
    failed(phase, message);
  });
}

// Ask the feed whether there is anything newer.
// `manual` = a person clicked "Check for updates", so the answer is worth a
// notification even when it is "you are already current".
function check({ manual = false } = {}) {
  if (!isEligible()) {
    setState({ status: 'uptodate', message: 'Development build — updates disabled' });
    if (manual) {
      notify('ACOMS Launcher', 'This is a development build — updates are disabled.');
    }
    return;
  }

  // Answered once, from whichever event settles it — see reportManual.
  if (manual) manualCheckPending = true;

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('checkForUpdates rejected:', (err && err.message) || err);
    failed('check', (err && err.message) || String(err));
  });
}

// Restart into the new version. Safe to call when nothing is downloaded — it
// simply does nothing.
function quitAndInstall() {
  if (state.status !== 'ready' || !isEligible()) return;
  quittingToInstall = true;
  // isSilent=TRUE: apply the update without showing the NSIS wizard again.
  //
  // This was false at first, on the reasoning that a person should see what is
  // happening to their machine. Wrong reasoning for an UPDATE: they already
  // clicked Restart, so they know. Walking them back through "choose an
  // install directory" for a version they asked for is friction, not
  // transparency — and it is not how any other desktop app updates. The full
  // wizard still runs for a first install, which is where it belongs.
  //
  // Safe to do silently here because the app installs per-user
  // (nsis.perMachine = false), so nothing needs elevation and no UAC prompt is
  // suppressed by this.
  //
  // isForceRunAfter=true so the launcher comes back on its own afterwards.
  autoUpdater.quitAndInstall(true, true);
}

function isQuittingToInstall() {
  return quittingToInstall;
}

function init() {
  if (!isEligible()) {
    setState({ status: 'uptodate', message: 'Development build — updates disabled' });
    return;
  }

  // We hand people the restart ourselves (see update-downloaded), so on
  // macOS nothing should download or install behind their back.
  autoUpdater.autoDownload = CAN_SELF_INSTALL;
  autoUpdater.autoInstallOnAppQuit = CAN_SELF_INSTALL;
  autoUpdater.allowPrerelease = false;

  wireEvents();

  setTimeout(() => check(), FIRST_CHECK_DELAY_MS);
  timer = setInterval(() => check(), CHECK_INTERVAL_MS);

  // Catch the machine coming back from sleep — the interval timer did not run
  // while it was suspended, so without this a laptop opened in the morning
  // waits another full interval before it notices anything.
  try {
    powerMonitor.on('resume', () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => check(), RESUME_CHECK_DELAY_MS);
    });
  } catch (err) {
    // powerMonitor is unavailable on some setups; the interval still covers us.
    console.error('Could not watch for resume:', err.message);
  }
}

function dispose() {
  if (timer) clearInterval(timer);
  if (resumeTimer) clearTimeout(resumeTimer);
  clearStallTimer();
  timer = null;
  resumeTimer = null;
  listeners = [];
}

module.exports = {
  init,
  dispose,
  check,
  quitAndInstall,
  isQuittingToInstall,
  onUpdateStatus,
  snapshot,
  RELEASES_PAGE
};
