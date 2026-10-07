'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { allowedModes, mentionQuery, mentionMatches, insertMention } = require('../src/chat-rooms');

const members = [
  { identityId: 'dion', name: 'Dion Harre' },
  { identityId: 'jd', name: 'James Denison' },
  { identityId: 'jb', name: 'James Buttenshaw' },
  { identityId: 'warrick', name: 'Warrick Heaney' }
];

test('a DM cycles all three modes; The Void only plain text; a room never a task', () => {
  assert.deepStrictEqual(allowedModes({ kind: 'dm' }), ['text', 'question', 'task']);
  assert.deepStrictEqual(allowedModes({ room: { allowCards: false } }), ['text']);
  assert.deepStrictEqual(allowedModes({ room: { allowCards: true } }), ['text', 'question']);
});

test('spots "@name" being typed, but not an email address', () => {
  assert.deepStrictEqual(mentionQuery('hey @war', 8), { start: 4, query: 'war' });
  assert.deepStrictEqual(mentionQuery('@', 1), { start: 0, query: '' });
  assert.deepStrictEqual(mentionQuery('ask @James De', 13), { start: 4, query: 'James De' });
  assert.strictEqual(mentionQuery('mail warrick@acoms', 18), null);
  assert.strictEqual(mentionQuery('no mention here', 15), null);
});

test('matches first or last name, never me', () => {
  assert.deepStrictEqual(mentionMatches(members, 'jam', 'dion').map((p) => p.identityId), ['jb', 'jd']);
  assert.deepStrictEqual(mentionMatches(members, 'hea', 'dion').map((p) => p.identityId), ['warrick']);
  assert.deepStrictEqual(mentionMatches(members, 'di', 'dion'), []);
  assert.strictEqual(mentionMatches(members, '', 'dion').length, 3);
});

test('picking a name writes the full name and puts the caret after it', () => {
  const r = insertMention('hey @war you there', { start: 4, query: 'war' }, 8, 'Warrick Heaney');
  assert.strictEqual(r.text, 'hey @Warrick Heaney  you there');
  assert.strictEqual(r.caret, 20);
});
