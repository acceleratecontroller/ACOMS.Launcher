'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  baseJobNumber,
  isJobFolderName,
  libraryFolderName,
  libraryFolderNames,
  pathSegments,
  failureMessage
} = require('../src/job-folder-rules');

// The ACOMS folder on James's PC, 2026-10-13.
const JAMES = ['NNSW - Client Projects - Documents', 'NQ - Client Projects - Documents', 'SEQ - Client Projects - Documents'];

test('a variation opens its base job', () => {
  assert.equal(baseJobNumber('A1016B'), 'A1016');
  assert.equal(baseJobNumber('a0939'), 'A0939');
  assert.equal(baseJobNumber('nonsense'), null);
});

test('job folder names: the number, then nothing or a separator', () => {
  assert.ok(isJobFolderName('A0939 - BRQ000000071551 - 52 Joyner Cct', 'A0939'));
  assert.ok(isJobFolderName('A0939', 'A0939'));
  assert.ok(isJobFolderName('a0939_old', 'A0939'));
  assert.ok(isJobFolderName('A1016 - Pit', 'A1016B'));
  assert.ok(!isJobFolderName('A09390 - other', 'A0939'));
  assert.ok(!isJobFolderName('A0939B - other', 'A0939'));
  assert.ok(!isJobFolderName('Quotes A0939', 'A0939'));
});

test('finds the region library, not a lookalike', () => {
  assert.equal(libraryFolderName('SEQ', JAMES), 'SEQ - Client Projects - Documents');
  assert.equal(libraryFolderName('NQ', JAMES), 'NQ - Client Projects - Documents');
  assert.equal(libraryFolderName('NSW', JAMES), null);
  assert.equal(libraryFolderName('', JAMES), null);
  assert.equal(
    libraryFolderName('SEQ', ['SEQ - Templates - Documents', 'SEQ - Client Projects - Documents']),
    'SEQ - Client Projects - Documents'
  );
});

test('only synced libraries are searched', () => {
  assert.deepEqual(libraryFolderNames([...JAMES, 'desktop.ini', '.DS_Store', 'Notes']), JAMES);
});

test('a SharePoint path becomes safe segments', () => {
  assert.deepEqual(pathSegments('UGL/NDM/A0939 - BRQ000000071551 - 52 Joyner Cct'), [
    'UGL',
    'NDM',
    'A0939 - BRQ000000071551 - 52 Joyner Cct'
  ]);
  assert.deepEqual(pathSegments('/Private Clients/Smith/A1200/'), ['Private Clients', 'Smith', 'A1200']);
  assert.equal(pathSegments('UGL/../../Windows'), null);
  assert.equal(pathSegments('C:\\Windows'), null);
  assert.equal(pathSegments(''), null);
});

test('every failure says what to do', () => {
  assert.match(failureMessage({ reason: 'not-synced', library: 'SEQ' }), /SEQ library isn't synced/);
  assert.match(failureMessage({ reason: 'not-found', number: 'A0939' }), /A0939.*sync/);
  assert.match(failureMessage({ reason: 'no-root' }), /ACOMS SharePoint folder/);
});
