'use strict';

// job-folder.js against a real folder tree. On Windows every OneDrive folder is
// a reparse point and Node lists it as a link, not a directory — v1.0.32 only
// kept directories, so on a PC it found nothing (2026-10-13). Here every
// folder is reached through a symlink to reproduce that on any OS.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const opened = [];
let jobsRoot = null;
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      app: { getPath: () => os.tmpdir() },
      dialog: {},
      shell: { openPath: async (p) => (opened.push(p), '') }
    };
  }
  if (request === './store') {
    return { getJobsRoot: () => jobsRoot, setJobsRoot: (d) => (jobsRoot = d) };
  }
  return realLoad.call(this, request, ...rest);
};
const jobFolder = require('../src/job-folder');
Module._load = realLoad;

// Build `rel` as real folders under `store`, then link every level of it into
// `root`, so walking from `root` only ever meets links.
function linkedTree(root, store, rel) {
  let realDir = store;
  let linkDir = root;
  for (const part of rel.split('/')) {
    realDir = path.join(realDir, part);
    fs.mkdirSync(realDir, { recursive: true });
    const link = path.join(linkDir, part);
    if (!fs.existsSync(link)) fs.symlinkSync(realDir, link, 'junction');
    linkDir = realDir;
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'job-folder-'));
const ACOMS = path.join(tmp, 'ACOMS');
fs.mkdirSync(ACOMS);
linkedTree(ACOMS, path.join(tmp, 'store'), 'SEQ - Client Projects - Documents/UGL/NDM/A0939 - BRQ000000071551 - 52 Joyner Cct');
linkedTree(ACOMS, path.join(tmp, 'store'), 'SEQ - Client Projects - Documents/Private Clients/Smith/A1200 - Shed');
fs.writeFileSync(path.join(tmp, 'store', 'a-file.pdf'), 'x');
fs.symlinkSync(path.join(tmp, 'store', 'a-file.pdf'), path.join(ACOMS, 'Notes - file.pdf'));

const SEQ = path.join(ACOMS, 'SEQ - Client Projects - Documents');
const card = (library, p) => ({ folder: { library, path: p, url: 'https://sp.example/x' } });

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
test.beforeEach(() => {
  opened.length = 0;
  jobsRoot = ACOMS;
});

test('linked folders count as folders; a linked file does not', async () => {
  assert.deepEqual(await jobFolder.subfolders(ACOMS), ['SEQ - Client Projects - Documents']);
});

test('opens the recorded path through links', async () => {
  const res = await jobFolder.open('A0939', card('SEQ', 'UGL/NDM/A0939 - BRQ000000071551 - 52 Joyner Cct'));
  assert.equal(res.ok, true);
  assert.equal(opened[0], path.join(SEQ, 'UGL', 'NDM', 'A0939 - BRQ000000071551 - 52 Joyner Cct'));
});

test('finds a job with no record by searching through links', async () => {
  const res = await jobFolder.open('A1200', null);
  assert.equal(res.ok, true);
  assert.equal(opened[0], path.join(SEQ, 'Private Clients', 'Smith', 'A1200 - Shed'));
});

test('a library that is not synced says so', async () => {
  const res = await jobFolder.open('A0700', card('NQ', 'X/A0700'));
  assert.equal(res.reason, 'not-synced');
});

test('the wrong folder says no libraries are in it', async () => {
  jobsRoot = path.join(tmp, 'store', 'SEQ - Client Projects - Documents', 'UGL');
  const res = await jobFolder.open('A0939', null);
  assert.equal(res.reason, 'no-libraries');
});
