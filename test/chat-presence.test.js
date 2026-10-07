'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { presenceOf, compareVersions, latestVersion, behindLabel } = require('../src/chat-presence');

const NOW = Date.parse('2026-10-07T03:00:00.000Z');
const ago = (min) => new Date(NOW - min * 60000).toISOString();

test('green while active, orange with how long once idle 5 minutes, grey offline', () => {
  assert.deepStrictEqual(presenceOf({ online: true, idleSince: null }, NOW), { state: 'active', label: 'online' });
  assert.strictEqual(presenceOf({ online: true, idleSince: ago(4) }, NOW).state, 'active');
  assert.deepStrictEqual(presenceOf({ online: true, idleSince: ago(15) }, NOW), { state: 'idle', label: 'inactive 15m' });
  assert.strictEqual(presenceOf({ online: true, idleSince: ago(150) }, NOW).label, 'inactive 2h');
  assert.strictEqual(presenceOf({ online: true, idleSince: ago(60 * 50) }, NOW).label, 'inactive 2d');
  assert.deepStrictEqual(presenceOf({ online: false, idleSince: ago(15) }, NOW), { state: 'offline', label: 'offline' });
  assert.strictEqual(presenceOf({ online: true }, NOW).state, 'active'); // an older Controller
  assert.strictEqual(presenceOf(null, NOW).state, 'offline');
});

test('who is on an old Launcher', () => {
  assert.strictEqual(compareVersions('1.0.10', '1.0.9'), 1);
  assert.strictEqual(compareVersions('1.0.9', '1.0.10'), -1);
  const people = [{ appVersion: '1.0.18' }, { appVersion: '1.0.20' }, { appVersion: null }, {}];
  const latest = latestVersion(people, ['1.0.19', null, 'junk']);
  assert.strictEqual(latest, '1.0.20');
  assert.strictEqual(behindLabel(people[0], latest), 'v1.0.18');
  assert.strictEqual(behindLabel(people[1], latest), null);
  assert.strictEqual(behindLabel(people[2], latest), null); // never reported
  assert.strictEqual(latestVersion([], ['1.0.21']), '1.0.21'); // my updater knows better
});
