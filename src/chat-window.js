'use strict';

// Renderer for the chat window. It draws the state the main process holds and
// reports what the person did; it makes no requests and keeps no messages of
// its own. Everything people type is put on the page with textContent — never
// innerHTML — so a message can't become markup.

const meEl = document.getElementById('me');
const peopleEl = document.getElementById('people');
const headerEl = document.getElementById('thread-header');
const noticeEl = document.getElementById('notice');
const messagesEl = document.getElementById('messages');
const composerEl = document.getElementById('composer');
const inputEl = document.getElementById('input');
const sendEl = document.getElementById('send');
const sendErrorEl = document.getElementById('send-error');

let state = null;
// What the thread last drew, so a poll that changed nothing doesn't rebuild it
// (and doesn't yank the scroll position out from under someone reading back).
let drawnThreadKey = '';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function activeKey(active) {
  if (!active) return '';
  return active.conversationId ? `c:${active.conversationId}` : `p:${active.toIdentityId}`;
}

function timeOf(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function dayOf(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}

// ── The list on the left ───────────────────────────────────────────────────
// One row per person. Someone you have a conversation with carries its last
// line and unread count; everyone else is simply someone you could write to.

function rows() {
  const byPerson = new Map();
  for (const c of state.conversations) {
    if (c.kind !== 'dm' || !c.with || !c.with[0]) continue;
    byPerson.set(c.with[0].identityId, c);
  }

  const known = new Map(state.people.map((p) => [p.identityId, p]));
  // A conversation partner should always be in `people`; if not, still show them.
  for (const c of byPerson.values()) {
    const other = c.with[0];
    if (!known.has(other.identityId)) known.set(other.identityId, { ...other, online: false });
  }

  return [...known.values()]
    .map((person) => ({ person, conversation: byPerson.get(person.identityId) || null }))
    .sort((a, b) => {
      const at = a.conversation ? a.conversation.lastMessageAt : '';
      const bt = b.conversation ? b.conversation.lastMessageAt : '';
      if (at !== bt) return bt.localeCompare(at);
      if (a.person.online !== b.person.online) return a.person.online ? -1 : 1;
      return a.person.name.localeCompare(b.person.name);
    });
}

function isActiveRow(row) {
  const a = state.active;
  if (!a) return false;
  if (a.conversationId) return Boolean(row.conversation && row.conversation.id === a.conversationId);
  return a.toIdentityId === row.person.identityId;
}

function renderPeople() {
  peopleEl.replaceChildren();
  const list = rows();

  if (list.length === 0) {
    peopleEl.append(
      el(
        'p',
        'people__empty',
        'Nobody else is on chat yet. People appear here once they open the launcher.'
      )
    );
    return;
  }

  for (const row of list) {
    const btn = el('button', `person${isActiveRow(row) ? ' person--active' : ''}`);
    btn.type = 'button';

    const dot = el('span', `presence${row.person.online ? ' presence--online' : ''}`);
    dot.title = row.person.online ? 'Online' : 'Offline';

    const text = el('span', 'person__text');
    text.append(el('span', 'person__name', row.person.name));
    const last = row.conversation && row.conversation.lastMessage;
    if (last) {
      const mine = state.me && last.senderId === state.me.identityId;
      text.append(el('span', 'person__last', `${mine ? 'You: ' : ''}${last.body}`));
    }

    btn.append(dot, text);
    if (row.conversation && row.conversation.unread > 0) {
      btn.append(el('span', 'unread', String(row.conversation.unread)));
    }

    btn.addEventListener('click', () => {
      if (row.conversation) window.acomsChat.selectConversation(row.conversation.id);
      else window.acomsChat.selectPerson(row.person.identityId);
      inputEl.focus();
    });
    peopleEl.append(btn);
  }
}

// ── The thread on the right ────────────────────────────────────────────────

function activePerson() {
  const a = state.active;
  if (!a) return null;
  if (a.toIdentityId) return state.people.find((p) => p.identityId === a.toIdentityId) || null;
  const conv = state.conversations.find((c) => c.id === a.conversationId);
  const other = conv && conv.with && conv.with[0];
  if (!other) return null;
  return state.people.find((p) => p.identityId === other.identityId) || { ...other, online: false };
}

function renderHeader() {
  headerEl.replaceChildren();
  const person = activePerson();
  if (!person) return;
  headerEl.append(
    el('span', `presence${person.online ? ' presence--online' : ''}`),
    el('h2', 'thread__name', person.name),
    el('span', 'thread__status', person.online ? 'online' : 'offline')
  );
}

// Turn the http(s) links in a message into real links. They open through the
// launcher's own link handling: a portal link lands in that portal's window,
// anything else goes to the browser.
function appendLinked(parent, text) {
  const parts = String(text).split(/(https?:\/\/[^\s<>"]+)/g);
  for (const part of parts) {
    if (/^https?:\/\//.test(part)) {
      const a = el('a', 'link', part);
      a.href = part;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      parent.append(a);
    } else if (part) {
      parent.append(document.createTextNode(part));
    }
  }
}

function renderMessages() {
  const msgs = state.activeMessages;
  const key = `${activeKey(state.active)}|${state.activeLoading}|${msgs.length}|${
    msgs.length ? msgs[msgs.length - 1].id : ''
  }`;
  if (key === drawnThreadKey) return;

  const switched = key.split('|')[0] !== drawnThreadKey.split('|')[0];
  const nearBottom =
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  drawnThreadKey = key;

  messagesEl.replaceChildren();

  if (!state.active) {
    messagesEl.append(el('p', 'messages__empty', 'Pick someone on the left to start.'));
    return;
  }
  if (state.activeLoading) {
    messagesEl.append(el('p', 'messages__empty', 'Loading…'));
    return;
  }
  if (msgs.length === 0) {
    messagesEl.append(el('p', 'messages__empty', 'No messages yet. Say hello.'));
    return;
  }

  let lastDay = '';
  for (const m of msgs) {
    const day = dayOf(m.createdAt);
    if (day !== lastDay) {
      messagesEl.append(el('div', 'day', day));
      lastDay = day;
    }
    const mine = state.me && m.senderId === state.me.identityId;
    const bubble = el('div', `msg${mine ? ' msg--mine' : ''}`);
    const body = el('div', 'msg__body');
    appendLinked(body, m.body);
    bubble.append(body, el('div', 'msg__time', timeOf(m.createdAt)));
    messagesEl.append(bubble);
  }

  if (switched || nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Anything standing in the way ───────────────────────────────────────────

function renderNotice() {
  noticeEl.replaceChildren();
  let text = '';
  let action = null;

  if (state.status === 'signIn') {
    text = 'Sign in to ACOMS.Controller to use chat.';
    action = { label: 'Sign in', run: () => window.acomsChat.signIn() };
  } else if (state.status === 'unavailable') {
    text = 'Chat isn’t switched on in ACOMS.Controller yet.';
    action = { label: 'Check again', run: () => window.acomsChat.retry() };
  } else if (state.status === 'error') {
    text = `Can’t reach chat${state.errorMessage ? ` (${state.errorMessage})` : ''}.`;
    action = { label: 'Try again', run: () => window.acomsChat.retry() };
  } else if (state.status === 'off') {
    text = 'Chat isn’t set up in this launcher.';
  } else if (state.status === 'idle') {
    text = 'Connecting…';
  }

  noticeEl.hidden = !text;
  if (!text) return;
  noticeEl.append(el('span', null, text));
  if (action) {
    const btn = el('button', 'notice__action', action.label);
    btn.type = 'button';
    btn.addEventListener('click', action.run);
    noticeEl.append(btn);
  }
}

function render() {
  if (!state) return;
  meEl.textContent = state.me ? `Signed in as ${state.me.name}` : '';
  renderNotice();
  renderPeople();
  renderHeader();
  renderMessages();

  composerEl.hidden = !state.active || state.status !== 'ok';
  sendErrorEl.hidden = !state.sendError;
  sendErrorEl.textContent = state.sendError || '';
}

// ── Composer ───────────────────────────────────────────────────────────────

function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 140)}px`;
  inputEl.classList.toggle('composer__input--tall', inputEl.scrollHeight > 140);
}

async function submit() {
  const text = inputEl.value.trim();
  if (!text || sendEl.disabled) return;
  sendEl.disabled = true;
  try {
    const result = await window.acomsChat.send(text);
    // Only clear what was typed once the server has it.
    if (result && result.ok) {
      inputEl.value = '';
      autoGrow();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } finally {
    sendEl.disabled = false;
    inputEl.focus();
  }
}

composerEl.addEventListener('submit', (event) => {
  event.preventDefault();
  submit();
});

inputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    submit();
  }
});

inputEl.addEventListener('input', autoGrow);

async function init() {
  state = await window.acomsChat.getState();
  render();
  window.acomsChat.onState((next) => {
    state = next;
    render();
  });
}

init();
