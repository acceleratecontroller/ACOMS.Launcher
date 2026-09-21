'use strict';

// ---------------------------------------------------------------------------
// Chat rules
// ---------------------------------------------------------------------------
// The decisions chat makes, kept free of Electron so they can be unit-tested:
// how often to poll, what deserves a notification, and what it should say.

// Polling is the whole transport, so the interval IS the latency. Fast while
// someone is looking at a conversation, slower when the window is merely open,
// slowest in the background — where the only job is raising a notification.
const POLL_FOCUSED_MS = 3 * 1000;
const POLL_OPEN_MS = 8 * 1000;
const POLL_BACKGROUND_MS = 20 * 1000;
// After a failure, don't hammer a server that is down or a session that has
// expired; the picker shows the state in the meantime.
const POLL_TROUBLE_MS = 60 * 1000;

const PREVIEW_MAX = 140;

function pollIntervalMs({ windowOpen = false, windowFocused = false, status = 'ok' } = {}) {
  if (status !== 'ok' && status !== 'idle') return POLL_TROUBLE_MS;
  if (windowOpen && windowFocused) return POLL_FOCUSED_MS;
  if (windowOpen) return POLL_OPEN_MS;
  return POLL_BACKGROUND_MS;
}

function preview(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_MAX ? `${flat.slice(0, PREVIEW_MAX - 1)}…` : flat;
}

// Which of the messages that just arrived should raise a notification.
//
//   - Never twice: the server re-sends a few seconds of overlap on purpose, so
//     ids already handled are dropped here.
//   - Not for the conversation you are LOOKING at — focused window, that
//     conversation open. Open-but-unfocused still notifies: the window being
//     somewhere behind a portal is not the same as having read it.
//
// There is deliberately NO mute and NO quiet-hours input here. Dion, 2026-09-21:
// chat is not opt-in — "if you have the launcher installed then you are
// available to chat", and nobody can turn its notifications off inside the app.
// A message from a person is not a badge to be tuned out. (The operating
// system's own Do Not Disturb still applies; that is not ours to override.)
function decideMessageToasts({
  incoming = [],
  handledIds = new Set(),
  activeConversationId = null,
  windowFocused = false
} = {}) {
  const fresh = incoming.filter((m) => m && m.id && !handledIds.has(m.id));
  const handled = fresh.map((m) => m.id);

  const toast = fresh.filter(
    (m) => !(windowFocused && activeConversationId && m.conversationId === activeConversationId)
  );
  return { toast, handled };
}

// One message is quoted. Several are counted — a burst of six toasts is how a
// person learns to ignore them (the same rule the portal notifications use).
// Returns null when there is nothing to say.
function messageToastText(messages) {
  if (!messages || messages.length === 0) return null;

  if (messages.length === 1) {
    const m = messages[0];
    return { title: m.senderName || 'New message', body: preview(m.body), conversationId: m.conversationId };
  }

  const senders = [...new Set(messages.map((m) => m.senderName || 'Someone'))];
  const last = messages[messages.length - 1];
  if (senders.length === 1) {
    return {
      title: senders[0],
      body: `${messages.length} new messages — ${preview(last.body)}`,
      conversationId: last.conversationId
    };
  }
  return {
    title: 'ACOMS Chat',
    body: `${messages.length} new messages from ${senders.join(', ')}`,
    conversationId: last.conversationId
  };
}

// The first poll after the launcher starts has no cursor, so the server sends
// no "incoming" — replaying history would be a toast per old message. But
// "when he's next online it pops up" is the whole point of leaving someone a
// message, so what was left unread while the launcher was closed gets ONE
// summary notification.
function firstPollToastText(conversations) {
  const unread = (conversations || []).filter((c) => c && c.unread > 0);
  if (unread.length === 0) return null;

  const total = unread.reduce((n, c) => n + c.unread, 0);
  const names = [
    ...new Set(unread.flatMap((c) => (c.with || []).map((p) => p.name)).filter(Boolean))
  ];
  const from = names.length > 0 ? ` from ${names.join(', ')}` : '';
  return {
    title: 'ACOMS Chat',
    body: `${total} unread ${total === 1 ? 'message' : 'messages'}${from}`,
    // Most recent first is how the server orders them.
    conversationId: unread[0].id
  };
}

// Fold newly arrived messages into a conversation's list: no duplicates (the
// overlap again, and a sent message also comes back from the POST), oldest
// first.
function mergeMessages(existing, arriving) {
  const byId = new Map();
  for (const m of existing || []) if (m && m.id) byId.set(m.id, m);
  for (const m of arriving || []) if (m && m.id) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

module.exports = {
  POLL_FOCUSED_MS,
  POLL_OPEN_MS,
  POLL_BACKGROUND_MS,
  POLL_TROUBLE_MS,
  pollIntervalMs,
  preview,
  decideMessageToasts,
  messageToastText,
  firstPollToastText,
  mergeMessages
};
