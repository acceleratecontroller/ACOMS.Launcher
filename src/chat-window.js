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
  headerEl.append(
    el('span', `presence${person.online ? ' presence--online' : ''}`),
    el('h2', 'thread__name', person.name),
    el('span', 'thread__status', person.online ? 'online' : 'offline')
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

function renderMessages() {
  const msgs = state.activeMessages;
  // Their read time is part of the key: a tick appearing IS a change to draw.
  const readAt = window.acomsChatSeen.otherReadAt(state.conversations, state.active);
  const key = `${activeKey(state.active)}|${state.activeLoading}|${msgs.length}|${
    msgs.length ? msgs[msgs.length - 1].id : ''
  }|${readAt || ''}`;
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
    const files = Files.attachmentsOf(m);
    if (files.length > 0) {
      bubble.classList.add('msg--files');
      bubble.append(renderAttachments(files, mine));
    }
    const body = el('div', 'msg__body');
    if (m.body) appendLinked(body, m.body);
    const time = el('div', 'msg__time');
    time.append(el('span', 'msg__clock', timeOf(m.createdAt)));
    // My message, and they have read it: a green tick by the time.
    if (mine && window.acomsChatSeen.isSeen(m, readAt)) {
      const tick = el('span', 'msg__seen', '✓');
      tick.title = 'Seen';
      time.append(tick);
    }
    if (m.body) bubble.append(body);
    bubble.append(time);
    messagesEl.append(bubble);
  }

  const stick = switched || nearBottom;
  if (stick) messagesEl.scrollTop = messagesEl.scrollHeight;
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
