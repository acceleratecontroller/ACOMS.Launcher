'use strict';

// ---------------------------------------------------------------------------
// Files in chat — the main-process half
// ---------------------------------------------------------------------------
// The chat window never makes a request of its own (chat-preload.js), and
// that holds for files too:
//
//   - Sending: the window hands the bytes over IPC; this module asks
//     ACOMS.Controller for an upload slot and PUTs them straight to R2.
//   - Showing: a thumbnail is <img src="acoms-file://attachment/<id>">. That
//     scheme is answered here, through the app's session, so the Controller
//     cookie rides along and the page still holds no URL or credential.
//   - Opening / saving a file that isn't a picture: fetched here, written to
//     disk, handed to the OS.
//
// Fetched bytes are kept in memory for the session (bounded), so scrolling a
// thread back and forth doesn't fetch every screenshot again.

const { app, net, protocol, shell, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { safeDiskName } = require('./chat-files-rules');

const SCHEME = 'acoms-file';
const CACHE_MAX_BYTES = 150 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

let request = null; // chat.js's request(): Controller JSON calls through the session
let baseUrl = () => null;

// id -> { bytes: Buffer, contentType }. Map order is use order (re-set on hit).
const cache = new Map();
let cacheBytes = 0;

// Must run before app 'ready': a scheme's privileges can't be granted later.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ]);
}

function remember(id, entry) {
  if (entry.bytes.length > CACHE_MAX_BYTES / 4) return; // a big video isn't worth holding
  cache.set(id, entry);
  cacheBytes += entry.bytes.length;
  for (const [key, old] of cache) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    cache.delete(key);
    cacheBytes -= old.bytes.length;
  }
}

// The bytes of one attachment: from memory, or from Controller (which answers
// with a redirect to a short-lived R2 link — followed here).
async function fetchBytes(id) {
  const hit = cache.get(id);
  if (hit) {
    cache.delete(id);
    cache.set(id, hit);
    return hit;
  }
  const base = baseUrl();
  if (!base) throw new Error('Chat is not set up');
  const res = await net.fetch(
    new URL(`/api/chat/attachments/${encodeURIComponent(id)}`, base).toString(),
    { credentials: 'include' }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const entry = {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type') || 'application/octet-stream'
  };
  remember(id, entry);
  return entry;
}

function init(opts) {
  request = opts.request;
  baseUrl = opts.baseUrl;

  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url);
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (url.hostname !== 'attachment' || !id) return new Response('Not found', { status: 404 });
    try {
      const { bytes, contentType } = await fetchBytes(id);
      return new Response(bytes, { headers: { 'Content-Type': contentType } });
    } catch (err) {
      return new Response(String((err && err.message) || 'failed'), { status: 502 });
    }
  });
}

// Upload one file; resolves to the attachment id to send, or throws with a
// sentence the person can read.
async function upload({ name, type, data }) {
  const bytes = Buffer.from(data);
  const slot = await request('/api/chat/attachments', {
    method: 'POST',
    body: { fileName: name, contentType: type || 'application/octet-stream', size: bytes.length }
  });
  if (!slot.ok) {
    throw new Error(
      slot.state === 'signIn' ? 'Sign in to ACOMS.Controller to send files' : slot.message
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    // The content type is part of the signed URL, so it must be sent as given.
    const put = await net.fetch(slot.data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': slot.data.contentType },
      body: bytes,
      signal: controller.signal
    });
    if (!put.ok) throw new Error(`${name} didn't upload (HTTP ${put.status})`);
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error(`${name} took too long to upload`);
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  // It's ours now — no need to fetch back what we just sent.
  remember(slot.data.id, { bytes, contentType: slot.data.contentType });
  return slot.data.id;
}

// Open a file in whatever the computer opens that kind of file with. It is
// written under the app's temp folder, one folder per attachment so two files
// both called "plan.pdf" don't overwrite each other.
async function open({ id, name }) {
  const { bytes } = await fetchBytes(id);
  const dir = path.join(app.getPath('temp'), 'acoms-chat', safeDiskName(id));
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, safeDiskName(name));
  await fs.promises.writeFile(file, bytes);
  const failure = await shell.openPath(file);
  if (failure) throw new Error(failure);
}

async function save({ id, name }, parentWindow) {
  const choice = await dialog.showSaveDialog(parentWindow || undefined, {
    defaultPath: path.join(app.getPath('downloads'), safeDiskName(name))
  });
  if (choice.canceled || !choice.filePath) return { saved: false };
  const { bytes } = await fetchBytes(id);
  await fs.promises.writeFile(choice.filePath, bytes);
  return { saved: true };
}

// Files copied in Explorer (Ctrl+C on a file, then Ctrl+V in chat). Chromium's
// paste event doesn't always carry those, so the clipboard's file list is read
// here. Windows only; elsewhere, and when nothing is there, an empty list.
async function clipboardFiles() {
  if (process.platform !== 'win32') return [];
  let paths = [];
  try {
    const raw = clipboard.readBuffer('FileNameW');
    paths = raw.toString('utf16le').split('\0').filter(Boolean);
  } catch {
    return [];
  }
  const files = [];
  for (const p of paths) {
    try {
      const stat = await fs.promises.stat(p);
      if (!stat.isFile()) continue;
      files.push({ path: p, name: path.basename(p), size: stat.size });
    } catch {
      // Gone since it was copied — skip it.
    }
  }
  return files;
}

// Read one of the files clipboardFiles() listed. Only a path the clipboard
// actually holds right now is read, so the window can't ask for any file.
async function readClipboardFile(filePath) {
  const listed = await clipboardFiles();
  if (!listed.some((f) => f.path === filePath)) throw new Error('That file is no longer copied');
  const data = await fs.promises.readFile(filePath);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

module.exports = {
  SCHEME,
  registerScheme,
  init,
  upload,
  open,
  save,
  clipboardFiles,
  readClipboardFile
};
