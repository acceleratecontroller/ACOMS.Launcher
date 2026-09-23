'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  POLL_FOCUSED_MS,
  POLL_OPEN_MS,
  POLL_BACKGROUND_MS,
  POLL_TROUBLE_MS,
  pollIntervalMs,
  decideMessageToasts,
  messageToastText,
  firstPollToastText,
  mergeMessages
} = require('../src/chat-rules');

const msg = (over = {}) => ({
  id: 'm1',
  conversationId: 'c1',
  senderName: 'Jordan',
  body: 'hello',
  createdAt: '2026-09-21T02:00:00.000Z',
  ...over
});

// ── Polling ────────────────────────────────────────────────────────────────

test('polls fastest when the chat window is focused, slowest in the background', () => {
  assert.strictEqual(pollIntervalMs({ windowOpen: true, windowFocused: true }), POLL_FOCUSED_MS);
  assert.strictEqual(pollIntervalMs({ windowOpen: true, windowFocused: false }), POLL_OPEN_MS);
  assert.strictEqual(pollIntervalMs({ windowOpen: false }), POLL_BACKGROUND_MS);
  assert.ok(POLL_FOCUSED_MS <= POLL_OPEN_MS && POLL_OPEN_MS <= POLL_BACKGROUND_MS);
});

test('a closed window is never more than five seconds behind (v1.0.9: was twenty)', () => {
  assert.ok(POLL_BACKGROUND_MS <= 5000);
});

test('backs off when signed out or erroring, even with the window focused', () => {
  for (const status of ['signIn', 'error', 'unavailable']) {
    assert.strictEqual(
      pollIntervalMs({ windowOpen: true, windowFocused: true, status }),
      POLL_TROUBLE_MS
    );
  }
});

// ── What raises a notification ─────────────────────────────────────────────

test('a message is never announced twice', () => {
  // The server re-sends a few seconds of overlap on purpose.
  const first = decideMessageToasts({ incoming: [msg()] });
  assert.deepStrictEqual(first.toast.map((m) => m.id), ['m1']);

  const again = decideMessageToasts({ incoming: [msg()], handledIds: new Set(first.handled) });
  assert.deepStrictEqual(again.toast, []);
  assert.deepStrictEqual(again.handled, []);
});

test('the conversation you are looking at does not notify', () => {
  const d = decideMessageToasts({
    incoming: [msg()],
    activeConversationId: 'c1',
    windowFocused: true
  });
  assert.deepStrictEqual(d.toast, []);
  assert.deepStrictEqual(d.handled, ['m1']);
});

test('the same conversation DOES notify when the window is behind something', () => {
  const d = decideMessageToasts({
    incoming: [msg()],
    activeConversationId: 'c1',
    windowFocused: false
  });
  assert.deepStrictEqual(d.toast.map((m) => m.id), ['m1']);
});

test('a different conversation notifies even while chat is focused', () => {
  const d = decideMessageToasts({
    incoming: [msg({ conversationId: 'c2' })],
    activeConversationId: 'c1',
    windowFocused: true
  });
  assert.strictEqual(d.toast.length, 1);
});

test('chat cannot be silenced from inside the app', () => {
  // Not opt-in: a `quiet` or `muted` flag, if anyone passes one, changes nothing.
  const d = decideMessageToasts({ incoming: [msg()], quiet: true, muted: true });
  assert.deepStrictEqual(d.toast.map((m) => m.id), ['m1']);
});

// ── What it says ───────────────────────────────────────────────────────────

test('one message is quoted under the sender’s name', () => {
  assert.deepStrictEqual(messageToastText([msg()]), {
    title: 'Jordan',
    body: 'hello',
    conversationId: 'c1'
  });
});

test('a long message is cut, and newlines flattened', () => {
  const t = messageToastText([msg({ body: `line one\n\nline two ${'x'.repeat(300)}` })]);
  assert.ok(t.body.startsWith('line one line two'));
  assert.ok(t.body.length <= 140);
  assert.ok(t.body.endsWith('…'));
});

test('a burst from one person is ONE notification, counted', () => {
  const t = messageToastText([msg({ id: 'a' }), msg({ id: 'b' }), msg({ id: 'c', body: 'last' })]);
  assert.strictEqual(t.title, 'Jordan');
  assert.strictEqual(t.body, '3 new messages — last');
});

test('a burst from several people names them and opens the latest', () => {
  const t = messageToastText([
    msg({ id: 'a' }),
    msg({ id: 'b', senderName: 'Sam', conversationId: 'c2' })
  ]);
  assert.strictEqual(t.body, '2 new messages from Jordan, Sam');
  assert.strictEqual(t.conversationId, 'c2');
});

test('nothing to say is null, not an empty toast', () => {
  assert.strictEqual(messageToastText([]), null);
});

// ── Coming back online ─────────────────────────────────────────────────────

test('messages left while the launcher was closed get one summary', () => {
  const t = firstPollToastText([
    { id: 'c1', unread: 2, with: [{ name: 'Jordan' }] },
    { id: 'c2', unread: 0, with: [{ name: 'Sam' }] },
    { id: 'c3', unread: 1, with: [{ name: 'Alex' }] }
  ]);
  assert.strictEqual(t.body, '3 unread messages from Jordan, Alex');
  assert.strictEqual(t.conversationId, 'c1');
});

test('one unread message is singular', () => {
  const t = firstPollToastText([{ id: 'c1', unread: 1, with: [{ name: 'Jordan' }] }]);
  assert.strictEqual(t.body, '1 unread message from Jordan');
});

test('nothing unread at start-up says nothing', () => {
  assert.strictEqual(firstPollToastText([{ id: 'c1', unread: 0, with: [] }]), null);
  assert.strictEqual(firstPollToastText([]), null);
});

// ── Merging ────────────────────────────────────────────────────────────────

test('merging drops duplicates and keeps oldest first', () => {
  const merged = mergeMessages(
    [msg({ id: 'b', createdAt: '2026-09-21T02:00:02.000Z' })],
    [
      msg({ id: 'b', createdAt: '2026-09-21T02:00:02.000Z' }),
      msg({ id: 'a', createdAt: '2026-09-21T02:00:01.000Z' }),
      msg({ id: 'c', createdAt: '2026-09-21T02:00:03.000Z' })
    ]
  );
  assert.deepStrictEqual(merged.map((m) => m.id), ['a', 'b', 'c']);
});
