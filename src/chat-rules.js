'use strict';

// ---------------------------------------------------------------------------
// Chat rules
// ---------------------------------------------------------------------------
// The decisions chat makes, kept free of Electron so they can be unit-tested:
// how often to poll, what deserves a notification, and what it should say.

// Polling is the whole transport, so the interval IS the latency. Fast while
// someone is looking at a conversation, a little slower otherwise. The
// background rate was 20 s until v1.0.9: with the window closed — which is
// nearly always — a message could sit for twenty seconds before the other
// person's launcher even looked, and Dion noticed. 5 s is about a million
// requests a month across five people, which the server absorbs; real push
// (a pub/sub service, polling as the safety net) is the answer if this is
// ever not enough. The open-but-unfocused rate matches: it made no sense for a
// window somewhere behind a portal to check LESS often than no window at all.
const POLL_FOCUSED_MS = 3 * 1000;
const POLL_OPEN_MS = 5 * 1000;
const POLL_BACKGROUND_MS = 5 * 1000;
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
//   - Nothing at all while the chat window is focused — whichever conversation
//     a message is for. Dion, 2026-09-25: "if chat window is actually open and
//     active on pc then it shouldn't also do notifications because i'm writing
//     in it". A message for another conversation shows as unread in the list
//     on screen. (Until then only the conversation on screen was skipped.)
//     Open-but-unfocused still notifies: the window being somewhere behind a
//     portal is not the same as having read it.
//
// There is deliberately NO mute and NO quiet-hours input here. Dion, 2026-09-21:
// chat is not opt-in — "if you have the launcher installed then you are
// available to chat", and nobody can turn its notifications off inside the app.
// A message from a person is not a badge to be tuned out. (The operating
// system's own Do Not Disturb still applies; that is not ours to override.)
function decideMessageToasts({
  incoming = [],
  handledIds = new Set(),
  windowFocused = false
} = {}) {
  const fresh = incoming.filter((m) => m && m.id && !handledIds.has(m.id));
  const handled = fresh.map((m) => m.id);

  const toast = windowFocused ? [] : fresh;
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
