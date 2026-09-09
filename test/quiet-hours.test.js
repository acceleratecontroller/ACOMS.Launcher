'use strict';

// Run with `npm test` (node --test, no dependencies).
//
// The midnight-crossing window is the whole reason this file exists: getting
// it backwards suppresses every notification around the clock, which looks
// exactly like nothing being waiting. That is a bug you would not notice for
// weeks, so it gets tested rather than eyeballed.

const test = require('node:test');
const assert = require('node:assert');
const { isValidTime, toMinutes, inQuietWindow } = require('../src/quiet-hours');

function at(hh, mm) {
  const d = new Date(2026, 0, 15, hh, mm, 0, 0);
  return d;
}

test('isValidTime accepts 24-hour HH:MM and nothing else', () => {
  assert.equal(isValidTime('00:00'), true);
  assert.equal(isValidTime('23:59'), true);
  assert.equal(isValidTime('07:30'), true);

  assert.equal(isValidTime('24:00'), false);
  assert.equal(isValidTime('7:30'), false);
  assert.equal(isValidTime('23:60'), false);
  assert.equal(isValidTime(''), false);
  assert.equal(isValidTime(null), false);
  assert.equal(isValidTime(undefined), false);
  assert.equal(isValidTime(930), false);
});

test('toMinutes converts, or returns null for a non-time', () => {
  assert.equal(toMinutes('00:00'), 0);
  assert.equal(toMinutes('01:30'), 90);
  assert.equal(toMinutes('23:59'), 1439);
  assert.equal(toMinutes('nope'), null);
});

test('a window inside one day is quiet only between the bounds', () => {
  const from = '09:00';
  const to = '17:00';

  assert.equal(inQuietWindow(at(8, 59), from, to), false);
  assert.equal(inQuietWindow(at(9, 0), from, to), true, 'inclusive at the start');
  assert.equal(inQuietWindow(at(13, 0), from, to), true);
  assert.equal(inQuietWindow(at(16, 59), from, to), true);
  assert.equal(inQuietWindow(at(17, 0), from, to), false, 'exclusive at the end');
  assert.equal(inQuietWindow(at(23, 0), from, to), false);
});

test('a window crossing midnight covers the evening AND the small hours', () => {
  const from = '18:00';
  const to = '07:00';

  assert.equal(inQuietWindow(at(17, 59), from, to), false);
  assert.equal(inQuietWindow(at(18, 0), from, to), true, 'evening side');
  assert.equal(inQuietWindow(at(23, 59), from, to), true);
  assert.equal(inQuietWindow(at(0, 0), from, to), true, 'across midnight');
  assert.equal(inQuietWindow(at(6, 59), from, to), true, 'morning side');
  assert.equal(inQuietWindow(at(7, 0), from, to), false, 'exclusive at the end');
  assert.equal(inQuietWindow(at(12, 0), from, to), false, 'the middle of the day is not quiet');
});

test('never quiet when the window is missing, half-set, or invalid', () => {
  assert.equal(inQuietWindow(at(3, 0), null, null), false);
  assert.equal(inQuietWindow(at(3, 0), '18:00', null), false, 'half a range is not a range');
  assert.equal(inQuietWindow(at(3, 0), null, '07:00'), false);
  assert.equal(inQuietWindow(at(3, 0), 'garbage', '07:00'), false);
  assert.equal(inQuietWindow(at(3, 0), '18:00', '7:00'), false, 'unpadded hour is not a time');
});

test('from === to is never quiet, not a 24-hour blackout', () => {
  // Almost certainly a mis-set field, and silencing the app all day is the
  // worse of the two readings.
  assert.equal(inQuietWindow(at(9, 0), '09:00', '09:00'), false);
  assert.equal(inQuietWindow(at(3, 0), '09:00', '09:00'), false);
});
