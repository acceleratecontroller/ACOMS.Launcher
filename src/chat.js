'use strict';

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
// Person-to-person chat between people who run the launcher. The launcher has
// no server of its own, so the conversations live in ACOMS.Controller and this
// module is the client: it polls one route, keeps what the chat window shows,
// and raises a notification when someone writes to you.
//
// Same trick as notifications.js: requests go out through the app's own
// session, so the Controller login cookie rides along and the launcher never
// handles a credential. That is also how chat knows WHO you are — the server
// says so in every answer. The launcher has never known that before.
//
// Chat is NOT opt-in (Dion, 2026-09-21): having the launcher makes you
// reachable. So this module never consults the mute list or quiet hours that
// govern portal notifications, and there is no setting that switches it off.
//
// What is deliberately NOT here: message text on disk. Conversations are held
// in memory and re-read from the server; nothing of what people say to each
// other is written to launcher-state.json.

const { net } = require('electron');
const popup = require('./popup');
const { jobLinkBaseFor } = require('./chat-links');
const {
  pollIntervalMs,
  decideMessageToasts,
  messageToastText,
  firstPollToastText,
  mergeMessages
} = require('./chat-rules');

const FIRST_POLL_DELAY_MS = 5 * 1000; // let the picker paint first
const REQUEST_TIMEOUT_MS = 15 * 1000;
// Bound the in-memory "already handled" set; ids only matter for the few
// seconds of overlap the server re-sends.
const HANDLED_MAX = 500;

// status:
//   idle        — not polled yet
//   ok          — answered
//   signIn      — Controller session expired; the person needs to sign in
//   unavailable — this Controller has no chat routes (launcher shipped first)
//   error       — unreachable or a bad response
//   off         — portals.json has no chat block
let status = 'idle';
let errorMessage = '';

let baseUrl = null;
let syncPath = '/api/chat/sync';
let jobLinkBase = null; // where an A-number in a message links to (chat-links.js)
let openChatWindow = null; // injected by main.js: (conversationId) => void

let me = null;
let people = [];
let conversations = [];
let cursor = null;
let firstPollDone = false;

// What the chat window is showing. `active` is either an existing conversation
// or a person not yet written to (the conversation is created by the first
// message, so there is nothing to select until then).
let active = null; // { conversationId } | { toIdentityId }
let activeMessages = [];
let activeLoading = false;
let sendError = '';

let windowOpen = false;
let windowFocused = false;

let timer = null;
let polling = false;
let listeners = [];
const handledIds = new Set();

function snapshot() {
  return {
    status,
    errorMessage,
    me,
    people,
    conversations,
    unreadTotal: unreadTotal(),
    active,
    activeMessages,
    activeLoading,
    sendError,
    jobLinkBase
  };
}

function emit() {
  const snap = snapshot();
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch (err) {
      console.error('chat listener failed:', err.message);
    }
  }
}

function onChanged(fn) {
  listeners.push(fn);
  fn(snapshot());
  return () => {
    listeners = listeners.filter((f) => f !== fn);
  };
}

function unreadTotal() {
  return conversations.reduce((n, c) => n + (c.unread || 0), 0);
}

// ── Requests ───────────────────────────────────────────────────────────────

// Returns { ok: true, data } or { ok: false, state, message }.
async function request(path, { method = 'GET', body } = {}) {
  if (!baseUrl) return { ok: false, state: 'off', message: '' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await net.fetch(new URL(path, baseUrl).toString(), {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // A login redirect must stay visible as a redirect — see notifications.js
      // for why this arrives as an opaque redirect with status 0.
      redirect: 'manual',
      signal: controller.signal
    });

    const isRedirect =
      res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400);
    if (isRedirect || res.status === 401) return { ok: false, state: 'signIn', message: '' };

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        state: 'error',
        httpStatus: res.status,
        message: (data && data.error) || `HTTP ${res.status}`
      };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, state: 'error', message: (err && err.message) || 'unreachable' };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Notifications ──────────────────────────────────────────────────────────

// The launcher's own pop-up card, not an OS notification — see popup.js.
function toast(text) {
  if (!text) return;
  popup.show({
    kind: 'chat',
    label: 'ACOMS Chat',
    title: text.title,
    body: text.body,
    // One card per conversation: a second message from the same person
    // replaces their card rather than stacking another under it.
    key: `chat:${text.conversationId}`,
    // Stays until clicked or dismissed. It used to fade after 9 seconds, so a
    // message that arrived while you looked elsewhere was a beep and nothing
    // (Dion, 2026-09-25: "i can hear it but the pop up isn't working ... it's
    // supposed to pop up and not go away till you click").
    sticky: true,
    onClick: () => {
      if (openChatWindow) openChatWindow(text.conversationId);
    }
  });
}

function rememberHandled(ids) {
  for (const id of ids) handledIds.add(id);
  // Sets keep insertion order, so the oldest ids are the first ones out.
  while (handledIds.size > HANDLED_MAX) handledIds.delete(handledIds.values().next().value);
}

// ── Polling ────────────────────────────────────────────────────────────────

function schedule(delay) {
  clearTimeout(timer);
  if (status === 'off') return;
  timer = setTimeout(poll, delay ?? pollIntervalMs({ windowOpen, windowFocused, status }));
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const res = await request(syncPath, { method: 'POST', body: { since: cursor } });

    if (!res.ok) {
      // A Controller without the chat routes answers 404 (or 405). That is "not
      // switched on yet", which is worth telling apart from "broken".
      status =
        res.state === 'error' && (res.httpStatus === 404 || res.httpStatus === 405)
          ? 'unavailable'
          : res.state;
      errorMessage = res.message || '';
      emit();
      return;
    }

    const data = res.data || {};
    status = 'ok';
    errorMessage = '';
    me = data.me || me;
    people = Array.isArray(data.people) ? data.people : [];
    conversations = Array.isArray(data.conversations) ? data.conversations : [];
    if (typeof data.cursor === 'string') cursor = data.cursor;

    const incoming = Array.isArray(data.incoming) ? data.incoming : [];
    const activeId = active && active.conversationId ? active.conversationId : null;

    if (!firstPollDone) {
      firstPollDone = true;
      if (!(windowOpen && windowFocused)) toast(firstPollToastText(conversations));
    } else {
      const decision = decideMessageToasts({
        incoming,
        handledIds,
        activeConversationId: activeId,
        windowFocused: windowOpen && windowFocused
      });
      rememberHandled(decision.handled);
      toast(messageToastText(decision.toast));
    }

    // Anything that arrived for the conversation on screen goes straight in.
    if (activeId) {
      const forActive = incoming.filter((m) => m.conversationId === activeId);
      if (forActive.length > 0) {
        activeMessages = mergeMessages(activeMessages, forActive);
        if (windowOpen && windowFocused) markRead(activeId);
      }
    }

    emit();
  } finally {
    polling = false;
    schedule();
  }
}

function pollNow() {
  schedule(0);
}

// ── What the chat window asks for ──────────────────────────────────────────

async function markRead(conversationId) {
  const conv = conversations.find((c) => c.id === conversationId);
  if (conv && conv.unread > 0) {
    conv.unread = 0; // optimistic; the next poll is the truth
    emit();
  }
  await request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/read`, {
    method: 'POST',
    body: {}
  });
}

async function selectConversation(conversationId) {
  if (typeof conversationId !== 'string' || !conversationId) return;
  active = { conversationId };
  activeMessages = [];
  activeLoading = true;
  sendError = '';
  emit();

  const res = await request(
    `/api/chat/conversations/${encodeURIComponent(conversationId)}/messages`
  );
  // The person may have clicked elsewhere while this was in flight.
  if (!active || active.conversationId !== conversationId) return;

  activeLoading = false;
  if (res.ok) {
    activeMessages = mergeMessages(activeMessages, res.data.messages || []);
    markRead(conversationId);
  } else {
    sendError = res.message || 'Could not load this conversation';
  }
  emit();
}

// Picking a PERSON: open the conversation with them if there is one, otherwise
// a blank thread that the first message will create.
function selectPerson(identityId) {
  if (typeof identityId !== 'string' || !identityId) return;
  const existing = conversations.find(
    (c) => c.kind === 'dm' && (c.with || []).some((p) => p.identityId === identityId)
  );
  if (existing) {
    selectConversation(existing.id);
    return;
  }
  active = { toIdentityId: identityId };
  activeMessages = [];
  activeLoading = false;
  sendError = '';
  emit();
}

async function send(text) {
  const body = String(text || '').trim();
  if (!body || !active) return { ok: false };

  const target = active;
  sendError = '';
  const res = await request('/api/chat/messages', {
    method: 'POST',
    body: target.conversationId
      ? { conversationId: target.conversationId, body }
      : { toIdentityId: target.toIdentityId, body }
  });

  if (!res.ok) {
    sendError = res.state === 'signIn' ? 'Sign in to ACOMS.Controller to send' : res.message;
    emit();
    return { ok: false };
  }

  const message = res.data;
  rememberHandled([message.id]);
  if (active === target) {
    // A first message has just created the conversation — it has an id now.
    active = { conversationId: message.conversationId };
    activeMessages = mergeMessages(activeMessages, [message]);
  }
  emit();
  pollNow(); // pick the new conversation / ordering up straight away
  return { ok: true };
}

function setWindowState({ open, focused }) {
  const wasWatching = windowOpen && windowFocused;
  windowOpen = Boolean(open);
  windowFocused = Boolean(open && focused);

  // Coming back to the window IS reading what is on screen.
  if (!wasWatching && windowOpen && windowFocused && active && active.conversationId) {
    markRead(active.conversationId);
  }
  // The interval depends on these, so don't sit out the old, slower one.
  if (status === 'ok' || status === 'idle') pollNow();
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

function init({ portals, config, openChat }) {
  openChatWindow = openChat;

  const portal = config && portals.find((p) => p.id === config.portal);
  if (!portal) {
    status = 'off';
    emit();
    return;
  }
  baseUrl = portal.url;
  jobLinkBase = jobLinkBaseFor(config.jobs, portals);
  if (typeof config.sync === 'string') syncPath = config.sync;

  schedule(FIRST_POLL_DELAY_MS);
}

function dispose() {
  clearTimeout(timer);
  timer = null;
  listeners = [];
}

module.exports = {
  init,
  dispose,
  snapshot,
  onChanged,
  unreadTotal,
  pollNow,
  selectConversation,
  selectPerson,
  send,
  setWindowState
};
