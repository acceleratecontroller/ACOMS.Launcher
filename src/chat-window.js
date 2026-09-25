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
const pendingEl = document.getElementById('pending');
const attachEl = document.getElementById('attach');
const fileInputEl = document.getElementById('file-input');
const dropEl = document.getElementById('drop');
const searchEl = document.getElementById('search');
const searchClearEl = document.getElementById('search-clear');
const Files = window.acomsChatFiles;

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

// Is the other person in this conversation typing right now? (sync says.)
function isTypingIn(conversation) {
  return Boolean(conversation && (conversation.with || []).some((p) => p.typing));
}

function renderPeople() {
  peopleEl.replaceChildren();
  if (searchQuery) {
    renderSearchResults();
    return;
  }
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
    if (isTypingIn(row.conversation)) {
      text.append(el('span', 'person__last person__last--typing', 'typing…'));
    } else if (last) {
      const mine = state.me && last.senderId === state.me.identityId;
      text.append(el('span', 'person__last', `${mine ? 'You: ' : ''}${Files.previewText(last)}`));
    }

    btn.append(dot, text);
    if (row.conversation && row.conversation.unread > 0) {
      btn.append(el('span', 'unread', String(row.conversation.unread)));
    }

    btn.addEventListener('click', () => {
      // Files waiting to go belong to the conversation they were added in.
      if (!isActiveRow(row)) clearPending();
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
  const conv = state.active.conversationId
    ? state.conversations.find((c) => c.id === state.active.conversationId)
    : null;
  const typing = isTypingIn(conv);
  headerEl.append(
    el('span', `presence${person.online ? ' presence--online' : ''}`),
    el('h2', 'thread__name', person.name),
    el(
      'span',
      `thread__status${typing ? ' thread__status--typing' : ''}`,
      typing ? 'typing…' : person.online ? 'online' : 'offline'
    )
  );
}

// Turn the http(s) links and ACOMS job numbers (A1174, A1016B) in a message
// into real links (chat-links.js decides which). They open through the
// launcher's own link handling: a portal link — a job number goes to WIP —
// opens in a new window of that portal, anything else goes to the browser.
function appendLinked(parent, text) {
  for (const part of window.acomsChatLinks.splitMessage(text, state.jobLinkBase)) {
    if (part.href) {
      const a = el('a', 'link', part.text);
      a.href = part.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      if (part.href !== part.text) a.title = `Open ${part.text.toUpperCase()} in ACOMS.WIP`;
      parent.append(a);
    } else {
      parent.append(document.createTextNode(part.text));
    }
  }
}

// ── Files in a message ─────────────────────────────────────────────────────
// Pictures show as thumbnails that open the viewer; anything else is a card
// that opens the file in the computer's own app, with a save button beside it.

function fileUrl(file) {
  return `acoms-file://attachment/${encodeURIComponent(file.id)}`;
}

function renderAttachments(files, mine) {
  const wrap = el('div', 'files');
  const images = files.filter((f) => Files.isImage(f.contentType));
  const others = files.filter((f) => !Files.isImage(f.contentType));

  if (images.length > 0) {
    const grid = el('div', `thumbs${images.length === 1 ? ' thumbs--one' : ''}`);
    for (const f of images) {
      const btn = el('button', 'thumb');
      btn.type = 'button';
      btn.title = `${f.name} — click to expand`;
      const img = el('img');
      img.alt = f.name;
      img.src = fileUrl(f);
      img.addEventListener('error', () => {
        btn.classList.add('thumb--broken');
        btn.replaceChildren(el('span', 'thumb__broken', 'Picture unavailable'));
      });
      btn.append(img);
      // Opens in a window of its own, nearly full screen on the chat's monitor,
      // so a small chat window doesn't mean a small picture (Dion, 2026-09-25).
      btn.addEventListener('click', () => window.acomsChat.viewImage({ id: f.id, name: f.name }));
      grid.append(btn);
    }
    wrap.append(grid);
  }

  for (const f of others) {
    const card = el('div', `file${mine ? ' file--mine' : ''}`);
    const open = el('button', 'file__main');
    open.type = 'button';
    open.title = `Open ${f.name}`;
    const text = el('span', 'file__text');
    text.append(el('span', 'file__name', f.name), el('span', 'file__size', Files.formatSize(f.size)));
    open.append(el('span', 'file__icon', '📄'), text);
    open.addEventListener('click', () => fileAction('openFile', f));
    const save = el('button', 'file__save', '⤓');
    save.type = 'button';
    save.title = 'Save as…';
    save.setAttribute('aria-label', `Save ${f.name}`);
    save.addEventListener('click', () => fileAction('saveFile', f));
    card.append(open, save);
    wrap.append(card);
  }
  return wrap;
}

// Opening or saving happens in the main process; if it fails, say so where
// send errors go rather than silently doing nothing.
async function fileAction(kind, file) {
  const result = await window.acomsChat[kind]({ id: file.id, name: file.name });
  if (result && !result.ok) showLocalError(result.error || 'That did not work');
}

let localError = '';
let localErrorTimer = null;
function showLocalError(text) {
  localError = text;
  clearTimeout(localErrorTimer);
  localErrorTimer = setTimeout(() => {
    localError = '';
    render();
  }, 6000);
  render();
}

// ── One message ────────────────────────────────────────────────────────────
// Mine get Edit and Delete on hover. Editing happens in the bubble; deleting
// asks once, in the bubble too (no pop-up dialog).

let editingId = null;
let editingDraft = '';
let confirmDeleteId = null;
let flashedId = null;

function renderMessage(m, readAt) {
  const mine = state.me && m.senderId === state.me.identityId;
  const bubble = el('div', `msg${mine ? ' msg--mine' : ''}`);
  bubble.dataset.id = m.id;

  const time = el('div', 'msg__time');
  if (m.editedAt && !m.deletedAt) {
    const edited = el('span', 'msg__edited', 'edited');
    edited.title = `Edited ${timeOf(m.editedAt)}`;
    time.append(edited);
  }
  time.append(el('span', 'msg__clock', timeOf(m.createdAt)));
  // My message, and they have read it: a green tick by the time.
  if (mine && !m.deletedAt && window.acomsChatSeen.isSeen(m, readAt)) {
    const tick = el('span', 'msg__seen', '✓');
    tick.title = 'Seen';
    time.append(tick);
  }

  if (m.deletedAt) {
    bubble.classList.add('msg--deleted');
    bubble.append(el('div', 'msg__body', mine ? 'You deleted this message' : 'Message deleted'), time);
    return bubble;
  }

  const files = Files.attachmentsOf(m);
  if (files.length > 0) {
    bubble.classList.add('msg--files');
    bubble.append(renderAttachments(files, mine));
  }

  if (mine && editingId === m.id) {
    bubble.classList.add('msg--editing');
    bubble.append(renderEditBox(m), time);
    return bubble;
  }

  if (m.body) {
    const body = el('div', 'msg__body');
    appendLinked(body, m.body);
    bubble.append(body);
    const cards = renderJobCards(m.body);
    if (cards) bubble.append(cards);
  }
  bubble.append(time);

  if (mine) bubble.append(confirmDeleteId === m.id ? renderDeleteQuestion(m) : renderActions(m));
  return bubble;
}

function renderActions(m) {
  const bar = el('div', 'msg__actions');
  const edit = el('button', 'msg__action', '✎');
  edit.type = 'button';
  edit.title = 'Edit';
  edit.setAttribute('aria-label', 'Edit message');
  edit.addEventListener('click', () => startEdit(m));
  const del = el('button', 'msg__action', '🗑');
  del.type = 'button';
  del.title = 'Delete';
  del.setAttribute('aria-label', 'Delete message');
  del.addEventListener('click', () => {
    confirmDeleteId = m.id;
    editingId = null;
    render();
  });
  bar.append(edit, del);
  return bar;
}

function renderDeleteQuestion(m) {
  const bar = el('div', 'msg__confirm');
  bar.append(el('span', null, 'Delete for everyone?'));
  const yes = el('button', 'msg__confirm-yes', 'Delete');
  yes.type = 'button';
  yes.addEventListener('click', async () => {
    confirmDeleteId = null;
    const result = await window.acomsChat.deleteMessage(m.id);
    if (result && !result.ok) showLocalError(result.error || 'Could not delete it');
    else render();
  });
  const no = el('button', 'msg__confirm-no', 'Cancel');
  no.type = 'button';
  no.addEventListener('click', () => {
    confirmDeleteId = null;
    render();
  });
  bar.append(yes, no);
  return bar;
}

function startEdit(m) {
  editingId = m.id;
  editingDraft = m.body || '';
  confirmDeleteId = null;
  render();
}

function stopEdit() {
  editingId = null;
  editingDraft = '';
  render();
  inputEl.focus();
}

function renderEditBox(m) {
  const wrap = el('div', 'msg__edit');
  const box = el('textarea', 'msg__edit-input');
  box.value = editingDraft;
  box.rows = Math.min(8, Math.max(1, editingDraft.split('\n').length));
  box.maxLength = 4000;
  box.addEventListener('input', () => {
    editingDraft = box.value;
  });
  const save = async () => {
    const text = box.value.trim();
    if (text === (m.body || '').trim()) return stopEdit();
    const result = await window.acomsChat.editMessage(m.id, text);
    if (result && !result.ok) showLocalError(result.error || 'Could not save the change');
    else stopEdit();
  };
  box.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      stopEdit();
    }
  });
  const buttons = el('div', 'msg__edit-buttons');
  buttons.append(el('span', 'msg__edit-hint', 'Enter to save · Esc to cancel'));
  const cancel = el('button', 'msg__confirm-no', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', stopEdit);
  const ok = el('button', 'msg__confirm-yes', 'Save');
  ok.type = 'button';
  ok.addEventListener('click', save);
  buttons.append(cancel, ok);
  wrap.append(box, buttons);
  return wrap;
}

// ── Job cards ──────────────────────────────────────────────────────────────
// An A-number in a message gets a card under it: what the job is, for whom,
// where it's at. Drawn as a placeholder, filled when WIP answers (cached in the
// main process), and dropped if WIP has no such job. Clicking opens it in WIP.

const jobCardCache = new Map(); // number -> card | null — this window's copy

function stageLabel(stage) {
  const s = String(stage || '').replace(/_/g, ' ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function fillJobCard(slot, card) {
  if (!card || !card.found) {
    slot.remove();
    return;
  }
  const a = el('a', 'job');
  a.href = state.jobLinkBase + encodeURIComponent(card.number);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.title = `Open ${card.acomsNumber} in ACOMS.WIP`;
  const top = el('div', 'job__top');
  top.append(el('span', 'job__number', card.acomsNumber));
  if (card.stage) {
    top.append(
      el(
        'span',
        `job__stage${card.onHold ? ' job__stage--hold' : ''}`,
        card.onHold ? 'On hold' : stageLabel(card.stage)
      )
    );
  }
  a.append(top);
  if (card.name) a.append(el('div', 'job__name', card.name));
  const facts = [card.client, card.siteAddress].filter(Boolean).join(' · ');
  if (facts) a.append(el('div', 'job__facts', facts));
  a.append(el('div', `job__po${card.po ? '' : ' job__po--none'}`, card.po ? `PO ${card.po}` : 'No PO yet'));
  slot.replaceChildren(a);
}

function renderJobCards(text) {
  const numbers = window.acomsChatLinks.jobNumbersIn(text, state.jobLinkBase);
  if (numbers.length === 0) return null;
  const wrap = el('div', 'jobs');
  const toFetch = [];
  for (const n of numbers) {
    const slot = el('div', 'jobs__slot');
    wrap.append(slot);
    if (jobCardCache.has(n)) {
      fillJobCard(slot, jobCardCache.get(n));
    } else {
      slot.append(el('div', 'job job--loading', `${n} …`));
      toFetch.push({ n, slot });
    }
  }
  if (toFetch.length > 0) {
    window.acomsChat.jobCards(toFetch.map((x) => x.n)).then(
      (cards) => {
        for (const { n, slot } of toFetch) {
          const card = (cards || []).find((c) => c.number === n) || null;
          jobCardCache.set(n, card);
          fillJobCard(slot, card);
        }
      },
      () => toFetch.forEach(({ slot }) => slot.remove())
    );
  }
  return wrap;
}

// ── Search ─────────────────────────────────────────────────────────────────
// Typing in the box above the people list searches every conversation you are
// in; results replace the list until the box is cleared. Clicking one opens
// its conversation at that message. Ctrl+F jumps to the box.

let searchQuery = '';
let searchResults = [];
let searchState = 'idle'; // idle | searching | done | error
let searchTimer = null;
let searchSeq = 0;

function otherNameFor(conversationId) {
  const c = state.conversations.find((x) => x.id === conversationId);
  const other = c && c.with && c.with[0];
  return other ? other.name : 'Conversation';
}

// The text with every occurrence of the search wrapped in <mark>, built from
// text nodes so nothing in a message can become markup.
function appendHighlighted(parent, text, q) {
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  let i = 0;
  while (needle && i < text.length) {
    const at = lower.indexOf(needle, i);
    if (at === -1) break;
    if (at > i) parent.append(document.createTextNode(text.slice(i, at)));
    parent.append(el('mark', null, text.slice(at, at + needle.length)));
    i = at + needle.length;
  }
  if (i < text.length) parent.append(document.createTextNode(text.slice(i)));
}

// A window of the message around the first match, so it fits one line.
function snippet(text, q) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  const at = flat.toLowerCase().indexOf(q.toLowerCase());
  if (at <= 30) return flat.slice(0, 120);
  return `…${flat.slice(at - 25, at + 95)}`;
}

function renderSearchResults() {
  if (searchState === 'searching' && searchResults.length === 0) {
    peopleEl.append(el('p', 'people__empty', 'Searching…'));
    return;
  }
  if (searchState === 'error') {
    peopleEl.append(el('p', 'people__empty', 'Search didn’t work — try again.'));
    return;
  }
  if (searchResults.length === 0) {
    peopleEl.append(
      el(
        'p',
        'people__empty',
        searchQuery.length < 2 ? 'Keep typing…' : `Nothing found for “${searchQuery}”.`
      )
    );
    return;
  }
  for (const m of searchResults) {
    const btn = el('button', 'result');
    btn.type = 'button';
    const mine = state.me && m.senderId === state.me.identityId;
    const top = el('span', 'result__top');
    top.append(
      el('span', 'result__who', `${otherNameFor(m.conversationId)}${mine ? ' · you' : ''}`),
      el('span', 'result__when', `${dayOf(m.createdAt)} ${timeOf(m.createdAt)}`)
    );
    const text = el('span', 'result__text');
    appendHighlighted(text, snippet(m.body || Files.summary(m), searchQuery), searchQuery);
    btn.append(top, text);
    btn.addEventListener('click', () => {
      clearPending();
      flashedId = null;
      window.acomsChat.openAt(m.conversationId, { id: m.id, createdAt: m.createdAt });
    });
    peopleEl.append(btn);
  }
}

async function runSearch() {
  const q = searchQuery;
  const seq = ++searchSeq;
  if (q.length < 2) {
    searchResults = [];
    searchState = 'idle';
    render();
    return;
  }
  searchState = 'searching';
  render();
  const result = await window.acomsChat.search(q);
  if (seq !== searchSeq) return; // a newer search has started
  searchResults = (result && result.results) || [];
  searchState = result && result.ok ? 'done' : 'error';
  render();
}

function clearSearch() {
  searchEl.value = '';
  searchQuery = '';
  searchResults = [];
  searchState = 'idle';
  searchClearEl.hidden = true;
  render();
}

searchEl.addEventListener('input', () => {
  searchQuery = searchEl.value.trim();
  searchClearEl.hidden = !searchEl.value;
  clearTimeout(searchTimer);
  if (!searchQuery) {
    clearSearch();
    return;
  }
  searchTimer = setTimeout(runSearch, 250);
});

searchEl.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') clearSearch();
});

searchClearEl.addEventListener('click', () => {
  clearSearch();
  searchEl.focus();
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    searchEl.focus();
    searchEl.select();
  }
});

function renderMessages() {
  const msgs = state.activeMessages;
  // Their read time is part of the key: a tick appearing IS a change to draw.
  const readAt = window.acomsChatSeen.otherReadAt(state.conversations, state.active);
  // Edits and deletes change a message without changing the count, and the
  // edit box / delete question are drawn in the thread too.
  const changes = msgs
    .map((m) => (m.editedAt || m.deletedAt ? `${m.id}${m.editedAt}${m.deletedAt}` : ''))
    .join('');
  const key = `${activeKey(state.active)}|${state.activeLoading}|${msgs.length}|${
    msgs.length ? msgs[msgs.length - 1].id : ''
  }|${readAt || ''}|${changes}|${editingId || ''}|${confirmDeleteId || ''}|${state.highlightId || ''}`;
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
    messagesEl.append(renderMessage(m, readAt));
  }

  // A search result: scroll to it and flash it, once.
  const target =
    state.highlightId && state.highlightId !== flashedId
      ? messagesEl.querySelector(`[data-id="${CSS.escape(state.highlightId)}"]`)
      : null;
  const stick = !target && (switched || nearBottom) && !editingId;
  if (target) {
    flashedId = state.highlightId;
    target.scrollIntoView({ block: 'center' });
    target.classList.add('msg--flash');
  } else if (stick) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  const editBox = messagesEl.querySelector('.msg__edit-input');
  if (editBox && document.activeElement !== editBox) {
    editBox.focus();
    editBox.setSelectionRange(editBox.value.length, editBox.value.length);
  }
  // A thumbnail has no height until it loads; stay at the bottom as they do.
  for (const img of messagesEl.querySelectorAll('img')) {
    if (img.complete) continue;
    img.addEventListener(
      'load',
      () => {
        if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
      },
      { once: true }
    );
  }
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
  const note = state.sendError || localError || state.sending || '';
  sendErrorEl.hidden = !note;
  sendErrorEl.textContent = note;
  sendErrorEl.classList.toggle('send-error--progress', Boolean(note) && note === state.sending);
  renderPending();
}

// ── Composer ───────────────────────────────────────────────────────────────

function autoGrow() {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 140)}px`;
  inputEl.classList.toggle('composer__input--tall', inputEl.scrollHeight > 140);
}

// ── Files waiting to be sent ───────────────────────────────────────────────
// Dropped, pasted or picked files sit above the box until Send, each with an
// ✕, so a wrong screenshot can be taken back before anyone sees it.

let pending = []; // { key, file: File, url: string|null }
let pendingKey = 0;
let drawnPendingKey = '';

function canAttach() {
  return Boolean(state && state.active && state.status === 'ok');
}

function addFiles(list, { pasted = false } = {}) {
  if (!canAttach()) return;
  const { accepted, refused } = Files.checkFiles([...list], pending.length);
  for (const original of accepted) {
    const name = pasted ? Files.nameForPaste(original.name, original.type) : original.name;
    const file = name === original.name ? original : new File([original], name, { type: original.type });
    const type = file.type || Files.typeFromName(file.name);
    pending.push({ key: ++pendingKey, file, url: Files.isImage(type) ? URL.createObjectURL(file) : null });
  }
  if (refused.length > 0) showLocalError(refused.join(' · '));
  renderPending();
  inputEl.focus();
}

function removePending(key) {
  const item = pending.find((p) => p.key === key);
  if (item && item.url) URL.revokeObjectURL(item.url);
  pending = pending.filter((p) => p.key !== key);
  renderPending();
}

function clearPending() {
  for (const p of pending) if (p.url) URL.revokeObjectURL(p.url);
  pending = [];
  renderPending();
}

function renderPending() {
  const key = `${pending.map((p) => p.key).join(',')}|${composerEl.hidden}`;
  if (key === drawnPendingKey) return;
  drawnPendingKey = key;

  pendingEl.replaceChildren();
  pendingEl.hidden = pending.length === 0 || composerEl.hidden;
  for (const p of pending) {
    const chip = el('div', `pending__item${p.url ? ' pending__item--image' : ''}`);
    chip.title = `${p.file.name} (${Files.formatSize(p.file.size)})`;
    if (p.url) {
      const img = el('img');
      img.src = p.url;
      img.alt = p.file.name;
      chip.append(img);
    } else {
      chip.append(el('span', 'file__icon', '📄'), el('span', 'pending__name', p.file.name));
    }
    const x = el('button', 'pending__remove', '✕');
    x.type = 'button';
    x.title = 'Remove';
    x.setAttribute('aria-label', `Remove ${p.file.name}`);
    x.addEventListener('click', () => removePending(p.key));
    chip.append(x);
    pendingEl.append(chip);
  }
}

async function submit() {
  const text = inputEl.value.trim();
  if ((!text && pending.length === 0) || sendEl.disabled) return;
  sendEl.disabled = true;
  attachEl.disabled = true;
  try {
    const files = await Promise.all(
      pending.map(async (p) => ({
        name: p.file.name,
        type: p.file.type || Files.typeFromName(p.file.name),
        data: await p.file.arrayBuffer()
      }))
    );
    const result = await window.acomsChat.send(text, files);
    // Only clear what was typed — and the files — once the server has it.
    if (result && result.ok) {
      inputEl.value = '';
      clearPending();
      autoGrow();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  } finally {
    sendEl.disabled = false;
    attachEl.disabled = false;
    inputEl.focus();
  }
}

attachEl.addEventListener('click', () => fileInputEl.click());
fileInputEl.addEventListener('change', () => {
  addFiles(fileInputEl.files || []);
  fileInputEl.value = '';
});

// Ctrl+V: a snip or screenshot arrives as a file on the paste event. A file
// copied in Explorer often doesn't, so when the paste carries neither files
// nor text, ask the main process what the clipboard holds.
inputEl.addEventListener('paste', async (event) => {
  const data = event.clipboardData;
  const files = data ? [...data.files] : [];
  if (files.length > 0) {
    event.preventDefault();
    addFiles(files, { pasted: true });
    return;
  }
  if (!canAttach() || (data && data.getData('text/plain'))) return;

  const copied = await window.acomsChat.clipboardFiles();
  if (!copied || copied.length === 0) return;
  const { accepted, refused } = Files.checkFiles(copied, pending.length);
  if (refused.length > 0) showLocalError(refused.join(' · '));
  const read = [];
  for (const f of accepted) {
    try {
      const bytes = await window.acomsChat.readClipboardFile(f.path);
      if (bytes) read.push(new File([bytes], f.name, { type: Files.typeFromName(f.name) }));
    } catch {
      showLocalError(`Couldn’t read ${f.name}`);
    }
  }
  addFiles(read);
});

// Drag and drop anywhere in the window. Without preventDefault on dragover,
// Chromium would try to open the dropped file itself.
let dragDepth = 0;

function isFileDrag(event) {
  return Boolean(event.dataTransfer && [...event.dataTransfer.types].includes('Files'));
}

window.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth += 1;
  dropEl.hidden = !canAttach();
});
window.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = canAttach() ? 'copy' : 'none';
});
window.addEventListener('dragleave', (event) => {
  if (!isFileDrag(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropEl.hidden = true;
});
window.addEventListener('drop', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;
  addFiles(event.dataTransfer.files || []);
});

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

inputEl.addEventListener('input', () => {
  autoGrow();
  if (inputEl.value.trim()) window.acomsChat.typing();
});

// Up arrow in an empty box edits your last message, as in most chat apps.
inputEl.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowUp' || inputEl.value || !state || !state.me) return;
  const last = [...state.activeMessages]
    .reverse()
    .find((m) => m.senderId === state.me.identityId && !m.deletedAt && m.body);
  if (!last) return;
  event.preventDefault();
  startEdit(last);
});

async function init() {
  state = await window.acomsChat.getState();
  render();
  window.acomsChat.onState((next) => {
    state = next;
    render();
  });
}

init();
