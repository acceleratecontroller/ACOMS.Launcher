'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { otherReadAt, isSeen } = require('../src/chat-seen');

const convs = [
  { id: 'c1', with: [{ identityId: 'jd', lastReadAt: '2026-09-25T02:05:00.000Z' }] },
  { id: 'c2', with: [{ identityId: 'ab', lastReadAt: null }] },
  { id: 'c3', with: [{ identityId: 'old' }] } // a Controller from before the field
];

test('the read time is the other person in the conversation on screen', () => {
  assert.strictEqual(otherReadAt(convs, { conversationId: 'c1' }), '2026-09-25T02:05:00.000Z');
  assert.strictEqual(otherReadAt(convs, { conversationId: 'c2' }), null);
  assert.strictEqual(otherReadAt(convs, { conversationId: 'c3' }), null);
  assert.strictEqual(otherReadAt(convs, { toIdentityId: 'jd' }), null); // not started yet
  assert.strictEqual(otherReadAt(convs, null), null);
});

test('a message is seen when sent at or before their read time', () => {
  const readAt = '2026-09-25T02:05:00.000Z';
  assert.strictEqual(isSeen({ createdAt: '2026-09-25T02:04:59.000Z' }, readAt), true);
  assert.strictEqual(isSeen({ createdAt: readAt }, readAt), true);
  assert.strictEqual(isSeen({ createdAt: '2026-09-25T02:05:01.000Z' }, readAt), false);
  assert.strictEqual(isSeen({ createdAt: '2026-09-25T02:04:00.000Z' }, null), false);
});
