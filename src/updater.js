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

const { app, Notification, shell } = require('electron');

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
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

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
  });

  autoUpdater.on('update-not-available', () => {
    setState({ status: 'uptodate', newVersion: null, message: 'Up to date' });
  });

  autoUpdater.on('update-available', (info) => {
    const v = (info && info.version) || null;
    if (CAN_SELF_INSTALL) {
      setState({
        status: 'downloading',
        newVersion: v,
        percent: 0,
        message: 'Downloading update…'
      });
    } else {
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
  });

  autoUpdater.on('update-downloaded', (info) => {
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
    // A failed check is not worth interrupting anyone over — it is nearly
    // always no internet, or the machine waking from sleep mid-request.
    console.error('Update check failed:', message);
    setState({ status: 'error', message: 'Update check failed' });
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

  if (manual) {
    // checkForUpdates() resolves with info whether or not the version is
    // newer, so read the outcome off the events instead and report once.
    const off = onUpdateStatus((s) => {
      if (s.status === 'checking' || s.status === 'idle') return;
      if (s.status === 'uptodate') {
        notify('ACOMS Launcher', "You're on the latest version.");
      } else if (s.status === 'error') {
        notify('ACOMS Launcher', 'Could not check for updates — check your internet connection.');
      }
      off();
    });
  }

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('checkForUpdates rejected:', (err && err.message) || err);
    setState({ status: 'error', message: 'Update check failed' });
  });
}

// Restart into the new version. Safe to call when nothing is downloaded — it
// simply does nothing.
function quitAndInstall() {
  if (state.status !== 'ready' || !isEligible()) return;
  quittingToInstall = true;
  // isSilent=false so the person sees the installer run;
  // isForceRunAfter=true so the launcher comes back on its own.
  autoUpdater.quitAndInstall(false, true);
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
}

function dispose() {
  if (timer) clearInterval(timer);
  timer = null;
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
