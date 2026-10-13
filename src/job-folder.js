'use strict';

// ---------------------------------------------------------------------------
// Open a job's SharePoint folder on this computer — the main-process half
// ---------------------------------------------------------------------------
// The rules (which library, which names count) are in job-folder-rules.js.
// This module only looks at the disk and hands a folder to Explorer/Finder.
//
// Order, for a job card's "Open folder":
//   1. The path Job Creator recorded (Controller's card.folder), joined to the
//      person's ACOMS folder. Opened if it is there.
//   2. Otherwise the library is searched for a folder named after the job —
//      older jobs Job Creator never made, quick jobs since moved out of
//      "_Manager Created", folders someone moved by hand.
//   3. Otherwise it says why: no ACOMS folder chosen, that library not synced,
//      or the job's folder not synced here.
//
// Synced folders are OneDrive placeholders, so listing them reads names only;
// nothing is downloaded.

const { app, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const store = require('./store');
const {
  baseJobNumber,
  isJobFolderName,
  libraryFolderName,
  libraryFolderNames,
  pathSegments
} = require('./job-folder-rules');

// Client / contract / job is three deep; "Private Clients/<client>/<job>" and
// a stray extra level make four. The cap keeps a huge library from stalling a
// click.
const SEARCH_DEPTH = 4;
const SEARCH_MAX_FOLDERS = 20000;

async function isDir(p) {
  try {
    return (await fs.promises.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function subfolders(dir) {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);
  } catch {
    return [];
  }
}

// Breadth-first, so the shallowest match wins and the common case (client /
// contract / job) is found before the cap matters.
async function searchForJob(roots, number) {
  let level = roots.map((dir) => ({ dir, depth: 0 }));
  let seen = 0;
  while (level.length > 0 && seen < SEARCH_MAX_FOLDERS) {
    const next = [];
    for (const { dir, depth } of level) {
      for (const name of await subfolders(dir)) {
        if (++seen > SEARCH_MAX_FOLDERS) break;
        const full = path.join(dir, name);
        if (isJobFolderName(name, number)) return full;
        if (depth + 1 < SEARCH_DEPTH) next.push({ dir: full, depth: depth + 1 });
      }
    }
    level = next;
  }
  return null;
}

// Where the ACOMS folder usually is, for "Choose…" to start in and for a
// person who hasn't chosen one yet. Windows: %USERPROFILE%\ACOMS. Mac: the
// OneDrive shared-libraries folder under ~/Library/CloudStorage.
async function suggestedRoot() {
  const home = os.homedir();
  const candidates = [path.join(home, 'ACOMS')];
  const cloud = path.join(home, 'Library', 'CloudStorage');
  for (const name of await subfolders(cloud)) {
    if (/^OneDrive-SharedLibraries-/i.test(name)) candidates.push(path.join(cloud, name));
  }
  for (const c of candidates) {
    if (libraryFolderNames(await subfolders(c)).length > 0) return c;
  }
  return null;
}

// The chosen folder, or the usual one when it holds synced libraries.
async function currentRoot() {
  const chosen = store.getJobsRoot();
  if (chosen) return { root: chosen, chosen: true };
  const found = await suggestedRoot();
  return found ? { root: found, chosen: false } : { root: null, chosen: false };
}

// `card` is the job card the main process cached for this number — never a
// path from the window.
async function open(number, card) {
  const job = baseJobNumber(number);
  if (!job) return { ok: false, reason: 'error', error: 'Not a job number' };
  const url = card && card.folder && typeof card.folder.url === 'string' ? card.folder.url : null;
  const fail = (reason, extra = {}) => ({ ok: false, reason, number: job, url, ...extra });

  const { root } = await currentRoot();
  if (!root) return fail('no-root');
  if (!(await isDir(root))) return fail('root-missing', { root });

  const names = await subfolders(root);
  // Someone may have chosen a library itself ("SEQ - …") as their folder.
  const libraries = libraryFolderNames(names).map((n) => path.join(root, n));
  if (libraries.length === 0 && / - /.test(path.basename(root))) libraries.push(root);

  const folder = card && card.folder;
  let searchIn = libraries;
  if (folder && folder.library) {
    const libName = libraryFolderName(folder.library, names);
    const libDir = libName
      ? path.join(root, libName)
      : libraryFolderName(folder.library, [path.basename(root)])
        ? root
        : null;
    if (!libDir) return fail('not-synced', { library: folder.library });
    const segments = pathSegments(folder.path);
    if (segments) {
      const exact = path.join(libDir, ...segments);
      if (await isDir(exact)) return reveal(exact);
    }
    searchIn = [libDir, ...libraries.filter((l) => l !== libDir)];
  }

  const found = await searchForJob(searchIn, job);
  return found ? reveal(found) : fail('not-found');
}

async function reveal(dir) {
  const err = await shell.openPath(dir);
  return err ? { ok: false, reason: 'error', error: err } : { ok: true, path: dir };
}

// "Choose…": a folder picker starting where the ACOMS folder usually is.
// Resolves to the settings, chosen or not.
async function chooseRoot(parent) {
  const start = store.getJobsRoot() || (await suggestedRoot()) || app.getPath('home');
  const res = await dialog.showOpenDialog(parent || undefined, {
    title: 'Where is your ACOMS SharePoint folder?',
    message: 'Pick the folder that holds "SEQ - Client Projects - Documents" and the other libraries.',
    defaultPath: start,
    properties: ['openDirectory']
  });
  if (!res.canceled && res.filePaths[0]) store.setJobsRoot(res.filePaths[0]);
  return settings();
}

function clearRoot() {
  store.setJobsRoot(null);
  return settings();
}

// { root, chosen, libraries: ["SEQ - …"] } for the settings panel.
async function settings() {
  const { root, chosen } = await currentRoot();
  const libraries = root ? libraryFolderNames(await subfolders(root)) : [];
  return { root, chosen, libraries };
}

module.exports = { open, chooseRoot, clearRoot, settings };
