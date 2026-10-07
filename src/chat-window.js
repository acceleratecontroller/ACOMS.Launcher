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
const questionsEl = document.getElementById('questions');
const modeBarEl = document.getElementById('modebar');
const replyEl = document.getElementById('reply');
const taskPanelEl = document.getElementById('taskpanel');
const Files = window.acomsChatFiles;
const Questions = window.acomsChatQuestions;
const Presence = window.acomsChatPresence;
const Rooms = window.acomsChatRooms;
const roomsEl = document.getElementById('rooms');
const purposeEl = document.getElementById('room-purpose');
const mentionsEl = document.getElementById('mentions');
const roomMenuEl = document.getElementById('room-menu');
const roomDialogEl = document.getElementById('room-dialog');

// Green = online and active, orange = online but idle 5+ min, grey = offline.
function presenceDot(person) {
  const p = Presence.presenceOf(person);
  const dot = el(
    'span',
    `presence${p.state === 'active' ? ' presence--online' : p.state === 'idle' ? ' presence--idle' : ''}`
  );
  dot.title = p.state === 'active' ? 'Online' : p.label.charAt(0).toUpperCase() + p.label.slice(1);
  return dot;
}
const TaskParse = window.acomsChatTaskParse;

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

    const dot = presenceDot(row.person);

    const text = el('span', 'person__text');
    const nameEl = el('span', 'person__name', row.person.name);
    const presence = Presence.presenceOf(row.person);
    if (presence.state === 'idle') nameEl.append(el('span', 'person__idle', ` · ${presence.label}`));
    const latest = Presence.latestVersion(state.people, state.versions || []);
    const old = Presence.behindLabel(row.person, latest);
    if (old) {
      const tag = el('span', 'person__old', ` · ${old} old`);
      tag.title = `On Launcher ${row.person.appVersion} — the latest is ${latest}`;
      nameEl.append(tag);
    }
    text.append(nameEl);
    const last = row.conversation && row.conversation.lastMessage;
    if (isTypingIn(row.conversation)) {
      text.append(el('span', 'person__last person__last--typing', 'typing…'));
    } else if (last) {
      const mine = state.me && last.senderId === state.me.identityId;
      text.append(el('span', 'person__last', `${mine ? 'You: ' : ''}${Files.previewText(last)}`));
    }

    btn.append(dot, text);
    const waiting = row.conversation ? questionsFor(row.conversation.id).forMe.length : 0;
    if (waiting > 0) {
      const q = el('span', 'qbadge', `❓${waiting > 1 ? waiting : ''}`);
      q.title = `${waiting} important question${waiting === 1 ? '' : 's'} waiting on you`;
      btn.append(q);
    }
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
  // A room is a place, not a person: it has no one "other" to show.
  if (conv && conv.room) return null;
  const other = conv && conv.with && conv.with[0];
  if (!other) return null;
  return state.people.find((p) => p.identityId === other.identityId) || { ...other, online: false };
}

function renderHeader() {
  headerEl.replaceChildren();
  if (activeRoom()) {
    renderRoomHeader(activeRoom());
    return;
  }
  const person = activePerson();
  if (!person) return;
  const conv = state.active.conversationId
    ? state.conversations.find((c) => c.id === state.active.conversationId)
    : null;
  const typing = isTypingIn(conv);
  headerEl.append(
    presenceDot(person),
    el('h2', 'thread__name', person.name),
    el(
      'span',
      `thread__status${typing ? ' thread__status--typing' : ''}`,
      typing ? 'typing…' : Presence.presenceOf(person).label
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

  // In a room, other people's messages say who sent them.
  if (!mine && activeRoom()) bubble.append(el('div', 'msg__sender', m.senderName || 'Someone'));

  // Send modes: what kind it is, and what it is a reply to.
  const openQuestion = m.kind === 'question' && !m.answeredAt;
  if (m.kind === 'question') {
    bubble.classList.add('msg--question');
    if (m.answeredAt) bubble.classList.add('msg--answered');
    bubble.append(
      el('div', 'msg__kind', !m.answeredAt ? '❓ Important question' : m.answerId ? '✓ Answered' : '✓ Closed')
    );
  }
  const task = m.kind === 'task' && m.payload && m.payload.task;
  if (task) {
    bubble.classList.add('msg--task');
    bubble.append(el('div', 'msg__kind', taskWords(task, mine)));
  }
  // A task given in chat was completed or reopened: the server posts this
  // card back as a reply to the task (Dion 2026-10-07, close the loop).
  if (m.kind === 'taskStatus') {
    const reopened = m.payload && m.payload.taskStatus && m.payload.taskStatus.status === 'reopened';
    bubble.classList.add(reopened ? 'msg--task-reopened' : 'msg--task-done');
  }
  if (replyTo && replyTo.id === m.id) bubble.classList.add('msg--replying');
  const quote = m.payload && m.payload.replyTo;
  if (quote) bubble.append(renderQuote(quote));

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
  // An open question says what to do about it, right on the bubble: theirs
  // gets Answer, mine gets Close (Dion: "it just changes the question to a
  // tick and its done").
  if (openQuestion && !mine) {
    const answer = el('button', 'msg__answer', '↩ Answer');
    answer.type = 'button';
    answer.addEventListener('click', () => startReply(m));
    bubble.append(answer);
    // "click that bubble and respond" - the whole bubble answers it too.
    bubble.classList.add('msg--clickable');
    bubble.addEventListener('click', (event) => {
      if (event.target.closest('a, button, textarea')) return;
      startReply(m);
    });
  } else if (openQuestion && mine) {
    const close = el('button', 'msg__answer', '✓ Close');
    close.type = 'button';
    close.title = 'Mark it done — no answer needed in chat';
    close.addEventListener('click', () => closeQuestion(m.id));
    bubble.append(close);
  }
  bubble.append(time);

  if (mine && confirmDeleteId === m.id) bubble.append(renderDeleteQuestion(m));
  else bubble.append(renderActions(m, mine));
  return bubble;
}

function renderQuote(quote) {
  const q = el('button', 'msg__quote');
  q.type = 'button';
  q.title = 'Show the message this replies to';
  q.append(
    el('span', 'msg__quote-who', `${quote.kind === 'question' ? '❓ ' : ''}${quote.senderName || ''}`),
    el('span', 'msg__quote-text', quote.text || 'Message deleted')
  );
  q.addEventListener('click', () => jumpTo({ id: quote.id }));
  return q;
}

// "Task for JD - due Thu 8 Oct, 2:00 pm - A1234 - Admin"
function taskWords(task, mine) {
  const due = [TaskParse.dayWords(task.dueDate), TaskParse.timeWords(task.dueTime)].filter(Boolean).join(', ');
  const parts = [`📋 Task for ${mine ? task.assigneeName || 'them' : 'you'}`];
  if (due) parts.push(`due ${due}`);
  if (task.job) parts.push(task.job);
  if (task.label && task.label !== 'Task') parts.push(task.label);
  return parts.join(' · ');
}

function renderActions(m, mine) {
  const bar = el('div', 'msg__actions');
  const reply = el('button', 'msg__action', '↩');
  reply.type = 'button';
  reply.title = 'Reply to this message';
  reply.setAttribute('aria-label', 'Reply');
  reply.addEventListener('click', () => startReply(m));
  bar.append(reply);
  if (!mine) return bar;
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

// ── Quiet spells ───────────────────────────────────────────────────────────

function gapLine(text, extra) {
  const line = el('div', extra ? `gap ${extra}` : 'gap');
  line.append(el('span', 'gap__label', text));
  return line;
}

// "last msg 2 hours ago" under the newest message. It ages while the window
// sits open, so it is kept up to date on a timer rather than by a redraw.
function updateSinceLast() {
  const msgs = state.activeMessages || [];
  const old = messagesEl.querySelector('.gap--last');
  const last = state.active && !state.activeLoading ? msgs[msgs.length - 1] : null;
  const text = last ? window.acomsChatGaps.sinceLast(last.createdAt, Date.now()) : null;
  if (!text) {
    if (old) old.remove();
    return;
  }
  if (old && old === messagesEl.lastElementChild) {
    old.querySelector('.gap__label').textContent = text;
    return;
  }
  if (old) old.remove();
  const nearBottom =
    messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  messagesEl.append(gapLine(text, 'gap--last'));
  if (nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}
setInterval(updateSinceLast, 30 * 1000);

function renderMessages() {
  const msgs = state.activeMessages;
  // Their read time is part of the key: a tick appearing IS a change to draw.
  // No seen ticks in a room: "seen" by whom?
  const readAt = activeRoom() ? null : window.acomsChatSeen.otherReadAt(state.conversations, state.active);
  // Edits and deletes change a message without changing the count, and the
  // edit box / delete question are drawn in the thread too.
  const changes = msgs
    .map((m) =>
      m.editedAt || m.deletedAt || m.answeredAt ? `${m.id}${m.editedAt}${m.deletedAt}${m.answeredAt}` : ''
    )
    .join('');
  const key = `${activeKey(state.active)}|${state.activeLoading}|${msgs.length}|${
    msgs.length ? msgs[msgs.length - 1].id : ''
  }|${readAt || ''}|${changes}|${editingId || ''}|${confirmDeleteId || ''}|${state.highlightId || ''}|${
    replyTo ? replyTo.id : ''
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
    messagesEl.append(el('p', 'messages__empty', activeRoom() ? 'Nothing here yet.' : 'No messages yet. Say hello.'));
    return;
  }

  // A new day gets its heading; a quiet spell of 15+ minutes gets a faint line
  // with "2 hours later" in the middle (both on one line when they coincide).
  let lastDay = '';
  let prev = null;
  for (const m of msgs) {
    const day = dayOf(m.createdAt);
    const gap = prev ? window.acomsChatGaps.gapBetween(prev.createdAt, m.createdAt) : null;
    if (gap) {
      messagesEl.append(gapLine(day !== lastDay ? `${day} · ${gap}` : gap));
    } else if (day !== lastDay) {
      messagesEl.append(el('div', 'day', day));
    }
    lastDay = day;
    prev = m;
    messagesEl.append(renderMessage(m, readAt));
  }
  updateSinceLast();

  // A search result: scroll to it and flash it, once.
  const target =
    state.highlightId && state.highlightId !== flashedId
      ? messagesEl.querySelector(`[data-id="${CSS.escape(state.highlightId)}"]`)
      : null;
  const stick = !target && (switched || nearBottom) && !editingId;
  pinnedBottom = stick;
  jumpedToTarget = Boolean(target);
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

// Set by renderMessages when it pinned the thread to the bottom, or scrolled
// to a search result instead — render() re-pins after the bars below the
// thread (composer, reply, task fields) have changed its height.
let pinnedBottom = false;
let jumpedToTarget = false;

function render() {
  if (!state) return;
  const atBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  pinnedBottom = false;
  jumpedToTarget = false;
  meEl.textContent = state.me ? `Signed in as ${state.me.name}` : '';
  renderNotice();
  renderPeople();
  renderRooms();
  renderHeader();
  renderPurpose();
  renderQuestions();
  renderMessages();

  composerEl.hidden = !state.active || state.status !== 'ok';
  const note = state.sendError || localError || state.sending || '';
  sendErrorEl.hidden = !note;
  sendErrorEl.textContent = note;
  sendErrorEl.classList.toggle('send-error--progress', Boolean(note) && note === state.sending);
  renderPending();
  renderComposerMode();
  if ((pinnedBottom || atBottom) && !jumpedToTarget && !editingId) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

// ── Important questions waiting (Dion 2026-10-07) ─────────────────────────
// A strip under the header: how many are waiting on you and on them in this
// conversation. Click it for the list; pick one to answer it (yours: close it).

let questionsOpen = false;
let drawnQuestionsKey = '';

function questionsFor(conversationId) {
  const meId = state && state.me ? state.me.identityId : null;
  return Questions.split(Questions.inConversation(state.openQuestions || [], conversationId), meId);
}

function ageWords(iso) {
  const ms = Date.now() - Date.parse(iso);
  return Number.isFinite(ms) && ms >= 60 * 1000 ? `${window.acomsChatGaps.spanWords(ms)} ago` : 'just now';
}

function renderQuestions() {
  const convId = state.active && state.active.conversationId;
  const { forMe, byMe } = convId ? questionsFor(convId) : { forMe: [], byMe: [] };
  const key = `${convId}|${questionsOpen}|${forMe.map((q) => q.id)}|${byMe.map((q) => q.id)}|${
    replyTo ? replyTo.id : ''
  }`;
  if (key === drawnQuestionsKey) return;
  drawnQuestionsKey = key;

  questionsEl.replaceChildren();
  questionsEl.hidden = forMe.length + byMe.length === 0;
  if (questionsEl.hidden) {
    questionsOpen = false;
    return;
  }
  const person = activePerson();
  const name = person ? person.name.split(' ')[0] : 'them';

  const bar = el('button', `questions__bar${forMe.length > 0 ? ' questions__bar--mine' : ''}`);
  bar.type = 'button';
  const parts = [];
  if (forMe.length > 0) parts.push(`${forMe.length} waiting on you`);
  if (byMe.length > 0) parts.push(`${byMe.length} waiting on ${name}`);
  bar.append(
    el('span', null, `❓ Important questions: ${parts.join(' · ')}`),
    el('span', 'questions__chev', questionsOpen ? '▴' : '▾')
  );
  bar.addEventListener('click', () => {
    questionsOpen = !questionsOpen;
    render();
  });
  questionsEl.append(bar);
  if (!questionsOpen) return;

  const list = el('div', 'questions__list');
  const section = (title, items, mineSide) => {
    if (items.length === 0) return;
    list.append(el('div', 'questions__head', title));
    for (const q of items) {
      const row = el('div', `questions__item${replyTo && replyTo.id === q.id ? ' questions__item--on' : ''}`);
      const text = el('button', 'questions__text');
      text.type = 'button';
      text.title = 'Show it in the conversation';
      text.append(el('span', 'questions__body', q.body), el('span', 'questions__age', ageWords(q.createdAt)));
      text.addEventListener('click', () => jumpTo(q));
      const act = el('button', 'questions__act', mineSide ? '✓ Close' : '↩ Answer');
      act.type = 'button';
      act.addEventListener('click', () => (mineSide ? closeQuestion(q.id) : startReply(q)));
      row.append(text, act);
      list.append(row);
    }
  };
  section('Waiting on you', forMe, false);
  section(`Waiting on ${name}`, byMe, true);
  questionsEl.append(list);
}

// Scroll to a message and flash it; one not loaded yet opens the thread at it.
function jumpTo(target) {
  const node = messagesEl.querySelector(`[data-id="${CSS.escape(target.id)}"]`);
  if (node) {
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.remove('msg--flash');
    void node.offsetWidth; // restart the animation
    node.classList.add('msg--flash');
  } else if (target.createdAt && state.active && state.active.conversationId) {
    flashedId = null;
    window.acomsChat.openAt(state.active.conversationId, { id: target.id, createdAt: target.createdAt });
  }
}

async function closeQuestion(id) {
  const result = await window.acomsChat.closeQuestion(id);
  if (result && !result.ok) showLocalError(result.error || 'Could not close it');
}

// ── Send modes (Dion 2026-10-07) ──────────────────────────────────────────
// "no tab is just send, one tab is send important question needs answer,
// 2 tabs is a new task for that person in the task manager". Tab cycles,
// Shift+Tab goes back, Esc returns to a normal message; after a send it is
// always back to normal. Task mode reads the due date, time, job and category
// out of what's typed (chat-task-parse.js) into fields the person can see and
// change; the due date is required ("force us to give an answer").

const MODES = ['text', 'question', 'task'];
let mode = 'text';
let replyTo = null; // the message being replied to / answered
const emptyTask = () => ({ dueDate: '', dueTime: '', label: 'Task', job: '' });
let taskFields = emptyTask();
let taskTouched = {}; // fields set by hand — no longer filled from the text
let drawnModeKey = '';

function setMode(next) {
  mode = next;
  if (mode === 'task') {
    window.acomsChat.taskLabels();
    refillTask();
  }
  drawnModeKey = '';
  render();
  inputEl.focus();
}

function resetComposer() {
  mode = 'text';
  replyTo = null;
  taskFields = emptyTask();
  taskTouched = {};
  drawnModeKey = '';
  render();
}

function startReply(m) {
  replyTo = {
    id: m.id,
    createdAt: m.createdAt,
    senderName: m.senderName,
    body: m.body,
    answering: m.kind === 'question' && !m.answeredAt && !(state.me && m.senderId === state.me.identityId)
  };
  // An answer is an ordinary message.
  if (replyTo.answering) mode = 'text';
  drawnModeKey = '';
  render();
  inputEl.focus();
}

// Fill the task fields from the text, except the ones set by hand.
function refillTask() {
  const found = TaskParse.parseTask(inputEl.value, new Date(), state.taskLabels || []);
  if (!taskTouched.dueDate) taskFields.dueDate = found.dueDate || '';
  if (!taskTouched.dueTime) taskFields.dueTime = found.dueTime || '';
  if (!taskTouched.label) taskFields.label = found.label || 'Task';
  if (!taskTouched.job) taskFields.job = found.job || '';
  syncTaskInputs();
}

function syncTaskInputs() {
  const set = (cls, value) => {
    const input = taskPanelEl.querySelector(cls);
    if (input && input !== document.activeElement && input.value !== value) input.value = value;
  };
  set('.taskpanel__date', taskFields.dueDate);
  set('.taskpanel__time', taskFields.dueTime);
  set('.taskpanel__job', taskFields.job);
  const label = taskPanelEl.querySelector('.taskpanel__label');
  if (label && label !== document.activeElement) {
    if (![...label.options].some((o) => o.value === taskFields.label)) {
      label.append(new Option(taskFields.label, taskFields.label));
    }
    label.value = taskFields.label;
  }
  const read = taskPanelEl.querySelector('.taskpanel__read');
  if (read) {
    read.textContent = taskFields.dueDate
      ? [TaskParse.dayWords(taskFields.dueDate), TaskParse.timeWords(taskFields.dueTime)].filter(Boolean).join(', ')
      : 'pick a date';
    read.classList.toggle('taskpanel__read--missing', !taskFields.dueDate);
  }
}

function field(labelText, input) {
  const wrap = el('label', 'taskpanel__field');
  wrap.append(el('span', 'taskpanel__name', labelText), input);
  return wrap;
}

function buildTaskPanel() {
  taskPanelEl.replaceChildren();
  const date = el('input', 'taskpanel__date');
  date.type = 'date';
  date.required = true;
  const time = el('input', 'taskpanel__time');
  time.type = 'time';
  const label = el('select', 'taskpanel__label');
  for (const l of [...new Set(['Task', ...(state.taskLabels || [])])]) label.append(new Option(l, l));
  const job = el('input', 'taskpanel__job');
  job.placeholder = 'A1234';
  job.maxLength = 8;
  job.spellcheck = false;

  const watch = (input, key, read = () => input.value) =>
    input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
      taskFields[key] = read();
      taskTouched[key] = true;
      syncTaskInputs();
    });
  watch(date, 'dueDate');
  watch(time, 'dueTime');
  watch(label, 'label');
  watch(job, 'job', () => job.value.trim().toUpperCase());

  taskPanelEl.append(
    field('Due', date),
    el('span', 'taskpanel__read'),
    field('Time', time),
    field('Category', label),
    field('Job', job)
  );
  syncTaskInputs();
}

function renderComposerMode() {
  // Moved into a room that doesn't allow the mode in hand: back to plain text.
  if (!Rooms.allowedModes(activeConversation()).includes(mode)) mode = 'text';
  const person = activePerson();
  const name = person ? person.name.split(' ')[0] : 'them';
  const labelsKey = (state.taskLabels || []).join('|');
  const key = `${mode}|${replyTo ? replyTo.id : ''}|${name}|${composerEl.hidden}|${labelsKey}`;
  if (key === drawnModeKey) return;
  drawnModeKey = key;

  composerEl.classList.toggle('composer--question', mode === 'question');
  composerEl.classList.toggle('composer--task', mode === 'task');
  inputEl.placeholder =
    mode === 'question'
      ? 'This better be important'
      : mode === 'task'
        ? "Don't do it"
        : replyTo && replyTo.answering
          ? 'Be helpful'
          : 'Words go here stupid'; // Dion 2026-10-07: the long hint wrapped and he didn't like it
  sendEl.textContent = mode === 'question' ? 'Ask' : mode === 'task' ? 'Give task' : 'Send';

  modeBarEl.replaceChildren();
  modeBarEl.hidden = composerEl.hidden || mode === 'text';
  modeBarEl.className = `modebar${mode === 'task' ? ' modebar--task' : ''}`;
  if (!modeBarEl.hidden) {
    modeBarEl.append(
      el(
        'span',
        'modebar__what',
        mode === 'question'
          ? `❓ Important question — stays open until ${name} answers it`
          : `📋 Task for ${name} — goes into their Task Manager`
      ),
      el('span', 'modebar__hint', 'Tab: next · Esc: normal message')
    );
  }

  replyEl.replaceChildren();
  replyEl.hidden = composerEl.hidden || !replyTo;
  if (!replyEl.hidden) {
    const what = el('button', 'reply__what');
    what.type = 'button';
    what.title = 'Show it in the conversation';
    what.append(
      el(
        'span',
        'reply__label',
        replyTo.answering ? `↩ Answering ${replyTo.senderName}’s question` : `↩ Replying to ${replyTo.senderName}`
      ),
      el('span', 'reply__text', String(replyTo.body || '').replace(/\s+/g, ' ').trim())
    );
    what.addEventListener('click', () => jumpTo(replyTo));
    const x = el('button', 'reply__x', '✕');
    x.type = 'button';
    x.title = 'Cancel the reply';
    x.addEventListener('click', () => {
      replyTo = null;
      drawnModeKey = '';
      render();
      inputEl.focus();
    });
    replyEl.append(what, x);
  }

  taskPanelEl.hidden = composerEl.hidden || mode !== 'task';
  if (taskPanelEl.hidden) taskPanelEl.replaceChildren();
  else buildTaskPanel();
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
  if (mode !== 'text' && !text) {
    showLocalError(mode === 'task' ? 'Write what needs doing' : 'Write the question');
    return;
  }
  if (mode === 'task') {
    refillTask();
    if (!taskFields.dueDate) {
      showLocalError('Pick a due date for the task');
      const date = taskPanelEl.querySelector('.taskpanel__date');
      if (date) date.focus();
      return;
    }
  }
  const opts = {
    kind: mode,
    ...(replyTo ? { replyToId: replyTo.id } : {}),
    ...(mode === 'task' ? { task: { ...taskFields } } : {})
  };
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
    const result = await window.acomsChat.send(text, files, opts);
    // Only clear what was typed — and the files — once the server has it.
    if (result && result.ok) {
      inputEl.value = '';
      clearPending();
      resetComposer();
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
  } else if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey) {
    // Tab: normal -> important question -> task -> normal. Shift+Tab goes back.
    // A room cycles only the modes it allows (The Void: none).
    event.preventDefault();
    const modes = Rooms.allowedModes(activeConversation());
    if (modes.length === 1) return;
    const i = Math.max(0, modes.indexOf(mode));
    setMode(modes[(i + (event.shiftKey ? modes.length - 1 : 1)) % modes.length]);
  } else if (event.key === 'Escape' && (mode !== 'text' || replyTo)) {
    event.preventDefault();
    resetComposer();
  }
});

inputEl.addEventListener('input', () => {
  if (mode === 'task') refillTask();
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

// ── Rooms (Dion 2026-10-07) ────────────────────────────────────────────────
// A room is a place with a purpose, not a group chat. Each one is a soft,
// edgeless, slowly turning wormhole in the bottom-left corner — not a row in
// the list. It never shows a count: grey nothing new, blue unread, red
// someone @mentioned you (red wins until read). Inside: the purpose pinned at
// the top, sender names, @name suggestions, and a mute just for you. The room
// admin right-clicks a wormhole to make or manage rooms.

function activeConversation() {
  const a = state && state.active;
  if (!a || !a.conversationId) return null;
  return state.conversations.find((c) => c.id === a.conversationId) || null;
}

function activeRoom() {
  const c = activeConversation();
  return c && c.room ? c : null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const WORMHOLE_RINGS = [
  [50.0, 50.0, 46.0, 2.4, 0.2],
  [51.1, 49.6, 41.6, 2.2, 0.3],
  [52.2, 49.1, 37.2, 2.0, 0.4],
  [53.3, 48.7, 32.8, 1.9, 0.5],
  [54.4, 48.2, 28.4, 1.7, 0.6],
  [55.5, 47.8, 24.0, 1.5, 0.6],
  [56.6, 47.4, 19.6, 1.3, 0.7],
  [57.7, 46.9, 15.2, 1.1, 0.8],
  [58.8, 46.5, 10.8, 1.0, 0.9]
];
// Stroke icons for rooms that aren't The Void (24-unit paths).
const ROOM_ICON_PATHS = {
  wrench: 'M14.7 6.3a4 4 0 0 0 5 5L21 13l-8 8-3-3 8-8-1.7-1.3a4 4 0 0 1-5-5zM3 21l6-6',
  megaphone: 'M3 11v2l13 5V6zM16 9a3 3 0 0 1 0 6M7 14l1 5h3l-1-4',
  truck: 'M2 6h12v10H2zM14 10h4l3 3v3h-7zM6 18a2 2 0 1 0 0 .01M17 18a2 2 0 1 0 0 .01',
  coffee: 'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 10h1a3 3 0 0 1 0 6h-1M8 2v3M12 2v3'
};
let svgIds = 0;

function svg(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, String(v));
  return node;
}

// The room's mark, coloured by its state through CSS (currentColor).
function roomMark(icon, roomState, size) {
  if (icon && ROOM_ICON_PATHS[icon]) {
    const s = svg('svg', { viewBox: '0 0 24 24', width: size * 0.62, height: size * 0.62, 'aria-hidden': 'true' });
    s.classList.add('wormhole', `wormhole--${roomState}`);
    s.append(
      svg('path', {
        d: ROOM_ICON_PATHS[icon],
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round'
      })
    );
    return s;
  }
  const id = `wh${++svgIds}`;
  const s = svg('svg', { viewBox: '0 0 100 100', width: size, height: size, 'aria-hidden': 'true' });
  s.classList.add('wormhole', `wormhole--${roomState}`);
  const defs = svg('defs');
  const grad = svg('radialGradient', { id: `${id}f`, cx: '50%', cy: '50%', r: '50%' });
  grad.append(
    svg('stop', { offset: '0.45', 'stop-color': '#fff' }),
    svg('stop', { offset: '1', 'stop-color': '#fff', 'stop-opacity': '0' })
  );
  const mask = svg('mask', { id: `${id}m`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: 100, height: 100 });
  mask.append(svg('rect', { width: 100, height: 100, fill: `url(#${id}f)` }));
  defs.append(grad, mask);
  const outer = svg('g', { mask: `url(#${id}m)` });
  const spin = svg('g');
  for (const [cx, cy, r, w, o] of WORMHOLE_RINGS) {
    spin.append(svg('circle', { cx, cy, r, fill: 'none', stroke: 'currentColor', 'stroke-width': w, opacity: o }));
  }
  spin.append(
    svg('animateTransform', {
      attributeName: 'transform',
      type: 'rotate',
      from: '0 50 50',
      to: '360 50 50',
      dur: '7s',
      repeatCount: 'indefinite'
    })
  );
  outer.append(spin);
  s.append(defs, outer);
  return s;
}

const STATE_WORDS = { quiet: 'up to date', unread: 'new messages', mentioned: 'you were mentioned' };
let drawnRoomsKey = '';

function renderRooms() {
  const rooms = (state.conversations || []).filter((c) => c.room);
  const admin = Boolean(state.me && state.me.canManageRooms);
  const active = activeRoom();
  const key = rooms
    .map((c) => `${c.id}:${c.room.name}:${c.room.icon}:${Rooms.roomState(c)}:${c.muted}`)
    .join('|') + `|${active ? active.id : ''}|${admin}`;
  if (key === drawnRoomsKey) return;
  drawnRoomsKey = key;

  roomsEl.replaceChildren();
  // The admin always gets the corner, so there is somewhere to right-click
  // to make the first room.
  roomsEl.hidden = rooms.length === 0 && !admin;
  for (const c of rooms) {
    const st = Rooms.roomState(c);
    const btn = el('button', `room-door${active && active.id === c.id ? ' room-door--active' : ''}`);
    btn.type = 'button';
    btn.title = `${c.room.name} — ${STATE_WORDS[st]}${c.muted ? ' (muted)' : ''}`;
    btn.setAttribute('aria-label', btn.title);
    btn.append(roomMark(c.room.icon, st, 36));
    btn.addEventListener('click', () => {
      if (!active || active.id !== c.id) clearPending();
      window.acomsChat.selectConversation(c.id);
      inputEl.focus();
    });
    btn.addEventListener('contextmenu', (event) => {
      if (!admin) return;
      event.preventDefault();
      openRoomMenu(event.clientX, event.clientY, c);
    });
    roomsEl.append(btn);
  }
  if (rooms.length === 0 && admin) {
    const hint = el('button', 'room-door room-door--new', '+');
    hint.type = 'button';
    hint.title = 'Make a room';
    hint.setAttribute('aria-label', 'Make a room');
    hint.addEventListener('click', () => openRoomDialog(null));
    roomsEl.append(hint);
  }
}

function renderRoomHeader(c) {
  const members = ['You', ...(c.with || []).map((p) => p.name)];
  const title = el('div', 'thread__room');
  title.append(el('h2', 'thread__name', c.room.name), el('span', 'thread__status', `${members.length} members · ${members.join(', ')}`));

  const mute = el('button', `thread__tool${c.muted ? ' thread__tool--on' : ''}`, c.muted ? 'Muted' : 'Mute');
  mute.type = 'button';
  mute.title = c.muted ? 'Muted for you — no pop-ups from this room. Click to unmute.' : 'Mute this room for you';
  mute.setAttribute('aria-pressed', String(Boolean(c.muted)));
  mute.addEventListener('click', () => window.acomsChat.muteRoom(c.id, !c.muted));

  headerEl.append(roomMark(c.room.icon, 'quiet', 30), title, mute);
  if (state.me && state.me.canManageRooms) {
    const manage = el('button', 'thread__tool', 'Manage');
    manage.type = 'button';
    manage.title = 'Members and settings';
    manage.addEventListener('click', () => openRoomDialog(c.id));
    headerEl.append(manage);
  }
}

function renderPurpose() {
  const c = activeRoom();
  const purpose = c && c.room.purpose;
  purposeEl.hidden = !purpose;
  purposeEl.replaceChildren();
  if (purpose) purposeEl.append(el('b', null, 'What this room is for: '), el('span', null, purpose));
}

// ── @name suggestions ──────────────────────────────────────────────────────

let mentionAt = null; // { start, query } while the caret is on "@…" in a room
let mentionList = [];
let mentionPick = 0;

function roomMembers(c) {
  return (c.with || []).map((p) => ({ identityId: p.identityId, name: p.name }));
}

function updateMentions() {
  const c = activeRoom();
  mentionAt = c ? Rooms.mentionQuery(inputEl.value, inputEl.selectionStart) : null;
  mentionList = mentionAt ? Rooms.mentionMatches(roomMembers(c), mentionAt.query, state.me && state.me.identityId) : [];
  if (mentionList.length === 0) mentionAt = null;
  mentionPick = Math.min(mentionPick, Math.max(0, mentionList.length - 1));
  drawMentions();
}

function drawMentions() {
  mentionsEl.replaceChildren();
  mentionsEl.hidden = !mentionAt;
  if (!mentionAt) return;
  mentionList.forEach((p, i) => {
    const opt = el('button', `mentions__item${i === mentionPick ? ' mentions__item--on' : ''}`, p.name);
    opt.type = 'button';
    opt.setAttribute('role', 'option');
    opt.setAttribute('aria-selected', String(i === mentionPick));
    // mousedown, not click: keep the focus (and the caret) in the box.
    opt.addEventListener('mousedown', (event) => {
      event.preventDefault();
      pickMention(i);
    });
    mentionsEl.append(opt);
  });
}

function pickMention(i) {
  const p = mentionList[i];
  if (!p || !mentionAt) return;
  const r = Rooms.insertMention(inputEl.value, mentionAt, inputEl.selectionStart, p.name);
  inputEl.value = r.text;
  inputEl.setSelectionRange(r.caret, r.caret);
  mentionAt = null;
  drawMentions();
  autoGrow();
  inputEl.focus();
}

inputEl.addEventListener('input', updateMentions);
inputEl.addEventListener('click', updateMentions);
inputEl.addEventListener('blur', () => {
  mentionAt = null;
  drawMentions();
});
// While suggestions are up, the arrows, Enter, Tab and Esc are theirs — not
// send, not the Tab send modes. On the FORM in the capture phase: listeners on
// the box itself run in the order they were added, and send was added first.
composerEl.addEventListener(
  'keydown',
  (event) => {
    if (!mentionAt) return;
    const n = mentionList.length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      mentionPick = (mentionPick + (event.key === 'ArrowDown' ? 1 : n - 1)) % n;
      drawMentions();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      pickMention(mentionPick);
    } else if (event.key === 'Escape') {
      mentionAt = null;
      drawMentions();
    } else {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  },
  true
);

// ── The admin's menu and screens ───────────────────────────────────────────

function closeRoomMenu() {
  roomMenuEl.hidden = true;
  roomMenuEl.replaceChildren();
}

function openRoomMenu(x, y, c) {
  roomMenuEl.replaceChildren();
  const item = (text, run) => {
    const b = el('button', 'room-menu__item', text);
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.addEventListener('click', () => {
      closeRoomMenu();
      run();
    });
    roomMenuEl.append(b);
  };
  item(`Manage ${c.room.name}…`, () => openRoomDialog(c.id));
  item('New room…', () => openRoomDialog(null));
  roomMenuEl.hidden = false;
  roomMenuEl.style.left = `${x}px`;
  roomMenuEl.style.top = `${Math.max(8, y - roomMenuEl.offsetHeight)}px`;
  roomMenuEl.querySelector('button').focus();
}

document.addEventListener('mousedown', (event) => {
  if (!roomMenuEl.hidden && !roomMenuEl.contains(event.target)) closeRoomMenu();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!roomMenuEl.hidden) closeRoomMenu();
  else if (!roomDialogEl.hidden) closeRoomDialog();
});

function closeRoomDialog() {
  roomDialogEl.hidden = true;
  roomDialogEl.replaceChildren();
}

function dialogShell(titleText, subText) {
  roomDialogEl.replaceChildren();
  const box = el('div', 'room-dialog__box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', titleText);
  const head = el('header', 'room-dialog__head');
  head.append(el('div', 'room-dialog__title', titleText));
  if (subText) head.append(el('div', 'room-dialog__sub', subText));
  const body = el('div', 'room-dialog__body');
  const foot = el('footer', 'room-dialog__foot');
  const error = el('p', 'room-dialog__error');
  error.hidden = true;
  box.append(head, body, error, foot);
  roomDialogEl.append(box);
  roomDialogEl.hidden = false;
  roomDialogEl.onclick = (event) => {
    if (event.target === roomDialogEl) closeRoomDialog();
  };
  const fail = (text) => {
    error.textContent = text;
    error.hidden = !text;
  };
  return { body, foot, fail };
}

function button(text, cls, run) {
  const b = el('button', cls, text);
  b.type = 'button';
  b.addEventListener('click', run);
  return b;
}

function labelled(text, control) {
  const label = el('label', 'room-field');
  label.append(el('span', 'room-field__label', text), control);
  return label;
}

function settingsFields(room) {
  const name = document.createElement('input');
  name.className = 'room-input';
  name.maxLength = 40;
  name.value = room ? room.name : 'The Void';

  const purpose = document.createElement('input');
  purpose.className = 'room-input';
  purpose.maxLength = 200;
  purpose.value = room ? room.purpose : 'Non-work chat. Nothing in here is a job.';

  let icon = room ? room.icon : 'void';
  const icons = el('div', 'room-icons');
  const drawIcons = () => {
    icons.replaceChildren();
    for (const key of ['void', ...Object.keys(ROOM_ICON_PATHS)]) {
      const b = el('button', `room-icons__item${key === icon ? ' room-icons__item--on' : ''}`);
      b.type = 'button';
      b.setAttribute('aria-label', key);
      b.setAttribute('aria-pressed', String(key === icon));
      b.append(roomMark(key, key === icon ? 'unread' : 'quiet', 30));
      b.addEventListener('click', () => {
        icon = key;
        drawIcons();
      });
      icons.append(b);
    }
  };
  drawIcons();

  const notify = document.createElement('select');
  notify.className = 'room-input';
  for (const [value, text] of [
    ['count', 'Shows it has news — pops up only when you’re @mentioned'],
    ['every', 'Pops up on every message']
  ]) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    notify.append(o);
  }
  notify.value = room ? room.notifyMode : 'count';

  const cards = document.createElement('input');
  cards.type = 'checkbox';
  cards.checked = room ? room.allowCards : false;
  const cardsRow = el('label', 'room-check');
  cardsRow.append(cards, el('span', null, 'Allow important questions (Tab)'));

  const fields = [
    labelled('Name', name),
    labelled('Icon', icons),
    labelled('What this room is for — pinned at the top', purpose),
    labelled('How it notifies', notify),
    cardsRow
  ];
  const values = () => ({
    name: name.value,
    icon,
    purpose: purpose.value,
    notifyMode: notify.value,
    allowCards: cards.checked
  });
  return { fields, values, focus: () => name.focus() };
}

function openRoomDialog(roomId) {
  closeRoomMenu();
  if (roomId) manageRoom(roomId);
  else newRoom();
}

function newRoom() {
  const { body, foot, fail } = dialogShell('New room', 'Only you can make rooms. Only the people you add can see it.');
  const settings = settingsFields(null);
  const picks = new Set();
  const people = el('div', 'room-people');
  for (const p of state.people || []) {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.addEventListener('change', () => (box.checked ? picks.add(p.identityId) : picks.delete(p.identityId)));
    const row = el('label', 'room-check');
    row.append(box, el('span', null, p.name));
    people.append(row);
  }
  body.append(...settings.fields, labelled('Who’s in it — you’re always in', people));
  body.append(
    el(
      'p',
      'room-dialog__note',
      'People you add see messages from when they join, not before. They can’t leave — they stay until you remove them — but each can mute it for themselves.'
    )
  );
  const create = button('Create room', 'room-btn room-btn--primary', async () => {
    create.disabled = true;
    fail('');
    const res = await window.acomsChat.createRoom({ ...settings.values(), memberIds: [...picks] });
    create.disabled = false;
    if (!res.ok) return fail(res.error);
    closeRoomDialog();
    if (res.room && res.room.id) window.acomsChat.selectConversation(res.room.id);
  });
  foot.append(button('Cancel', 'room-btn', closeRoomDialog), create);
  settings.focus();
}

async function manageRoom(roomId) {
  const { body, foot, fail } = dialogShell('Manage room');
  body.append(el('p', 'room-dialog__note', 'Loading…'));
  const loaded = await window.acomsChat.getRoom(roomId);
  if (roomDialogEl.hidden) return;
  body.replaceChildren();
  if (!loaded.ok) {
    fail(loaded.error);
    foot.append(button('Close', 'room-btn', closeRoomDialog));
    return;
  }
  const room = loaded.room;
  const meId = state.me && state.me.identityId;

  const settings = settingsFields(room);
  body.append(...settings.fields);

  const list = el('div', 'room-members');
  const draw = (r) => {
    list.replaceChildren();
    for (const m of r.members) {
      const row = el('div', 'room-members__row');
      const who = el('span', 'room-members__who', m.name);
      if (m.identityId === meId) who.append(el('span', 'room-members__note', ' · you'));
      if (m.muted) who.append(el('span', 'room-members__note', ' · has it muted'));
      row.append(who);
      if (m.identityId !== meId) {
        row.append(
          button('Remove', 'room-btn room-btn--danger room-btn--small', async () => {
            fail('');
            const res = await window.acomsChat.removeRoomMember(room.id, m.identityId);
            if (!res.ok) return fail(res.error);
            draw(res.room);
          })
        );
      }
      list.append(row);
    }
    // Add someone not already in it.
    const outside = (state.people || []).filter((p) => !r.members.some((m) => m.identityId === p.identityId));
    if (outside.length > 0) {
      const pick = document.createElement('select');
      pick.className = 'room-input';
      for (const p of outside) {
        const o = document.createElement('option');
        o.value = p.identityId;
        o.textContent = p.name;
        pick.append(o);
      }
      const add = el('div', 'room-members__add');
      add.append(
        pick,
        button('Add', 'room-btn room-btn--small', async () => {
          fail('');
          const res = await window.acomsChat.addRoomMember(room.id, pick.value);
          if (!res.ok) return fail(res.error);
          draw(res.room);
        })
      );
      list.append(add);
    }
  };
  draw(room);
  body.append(labelled(`Members`, list));
  body.append(
    el(
      'p',
      'room-dialog__note',
      'Someone you remove loses the room and its history straight away. Added back, they see messages from when they rejoin.'
    )
  );

  const archive = button('Archive room', 'room-btn room-btn--danger', async () => {
    if (archive.dataset.sure !== 'yes') {
      archive.dataset.sure = 'yes';
      archive.textContent = 'Archive — sure?';
      return;
    }
    const res = await window.acomsChat.updateRoom(room.id, { archived: true });
    if (!res.ok) return fail(res.error);
    closeRoomDialog();
  });
  const save = button('Save', 'room-btn room-btn--primary', async () => {
    save.disabled = true;
    fail('');
    const res = await window.acomsChat.updateRoom(room.id, settings.values());
    save.disabled = false;
    if (!res.ok) return fail(res.error);
    closeRoomDialog();
  });
  foot.append(archive, el('span', 'room-dialog__spacer'), button('Close', 'room-btn', closeRoomDialog), save);
}

async function init() {
  state = await window.acomsChat.getState();
  render();
  window.acomsChat.onState((next) => {
    state = next;
    render();
  });
}

init();
