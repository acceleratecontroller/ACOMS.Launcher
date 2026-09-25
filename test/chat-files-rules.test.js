'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  MAX_BYTES,
  MAX_FILES,
  isImage,
  attachmentsOf,
  formatSize,
  summary,
  previewText,
  checkFiles,
  nameForPaste,
  safeDiskName,
  typeFromName
} = require('../src/chat-files-rules');
const { messageToastText } = require('../src/chat-rules');

const withFiles = (files, body = '') => ({
  id: 'm1',
  conversationId: 'c1',
  senderName: 'JD',
  body,
  payload: { attachments: files }
});
const png = { id: 'a1', name: 'snip.png', contentType: 'image/png', size: 2048 };
const pdf = { id: 'a2', name: 'Plan A1174.pdf', contentType: 'application/pdf', size: 3_500_000 };

test('pictures Chromium can draw get a thumbnail; HEIC and PDFs do not', () => {
  assert.equal(isImage('image/png'), true);
  assert.equal(isImage('IMAGE/JPEG'), true);
  assert.equal(isImage('image/heic'), false);
  assert.equal(isImage('application/pdf'), false);
  assert.equal(isImage(undefined), false);
});

test('attachments are read off the payload, and a plain message has none', () => {
  assert.deepEqual(attachmentsOf(withFiles([png])), [png]);
  assert.deepEqual(attachmentsOf({ body: 'hi', payload: null }), []);
  assert.deepEqual(attachmentsOf({ payload: { attachments: [null, { name: 'x' }] } }), []);
});

test('a file-only message still says something in the pop-up and the people list', () => {
  assert.equal(summary(withFiles([png])), '📷 Photo');
  assert.equal(summary(withFiles([pdf])), '📎 Plan A1174.pdf');
  assert.equal(summary(withFiles([png, { ...png, id: 'a3' }])), '📷 2 photos');
  assert.equal(summary(withFiles([png, pdf])), '📎 2 files');
  assert.equal(previewText(withFiles([png], 'look at this')), 'look at this');
  assert.equal(messageToastText([withFiles([png])]).body, '📷 Photo');
});

test('sizes read like a person would say them', () => {
  assert.equal(formatSize(500), '500 B');
  assert.equal(formatSize(2048), '2 KB');
  assert.equal(formatSize(3_500_000), '3.3 MB');
  assert.equal(formatSize(20 * 1024 * 1024), '20 MB');
});

test('empty and oversized files are refused with a reason; the rest go through', () => {
  const ok = { name: 'a.png', size: 10 };
  const { accepted, refused } = checkFiles([ok, { name: 'big.mp4', size: MAX_BYTES + 1 }, { name: 'e.txt', size: 0 }]);
  assert.deepEqual(accepted, [ok]);
  assert.deepEqual(refused, ['big.mp4 is over 25 MB', 'e.txt is empty']);
});

test('no more than the per-message limit, counting what is already waiting', () => {
  const many = Array.from({ length: 4 }, (_, i) => ({ name: `${i}.png`, size: 1 }));
  const { accepted, refused } = checkFiles(many, MAX_FILES - 2);
  assert.equal(accepted.length, 2);
  assert.deepEqual(refused, [`Up to ${MAX_FILES} files per message`]);
});

test('a pasted screenshot gets a dated name; a named file keeps its own', () => {
  const at = new Date(2026, 8, 25, 14, 5, 9);
  assert.equal(nameForPaste('image.png', 'image/png', at), 'Screenshot 2026-09-25 14.05.09.png');
  assert.equal(nameForPaste('', 'image/jpeg', at), 'Screenshot 2026-09-25 14.05.09.jpg');
  assert.equal(nameForPaste('site photo.jpg', 'image/jpeg', at), 'site photo.jpg');
});

test('a name from the server is made safe to write on Windows', () => {
  assert.equal(safeDiskName('a:b?.pdf'), 'a_b_.pdf');
  assert.equal(safeDiskName('CON.txt'), '_CON.txt');
  assert.equal(safeDiskName('trailing. '), 'trailing');
  assert.equal(safeDiskName(''), 'file');
  assert.equal(safeDiskName('..\\..\\x.png'), '.._.._x.png');
});

test('a file copied in Explorer gets a type from its extension', () => {
  assert.equal(typeFromName('Snip.PNG'), 'image/png');
  assert.equal(typeFromName('plan.pdf'), 'application/pdf');
  assert.equal(typeFromName('mystery.xyz'), 'application/octet-stream');
});

test('a deleted message reads as deleted wherever one line of it shows', () => {
  assert.equal(previewText({ body: '', payload: null, deletedAt: '2026-09-25T06:00:00Z' }), 'Message deleted');
});
