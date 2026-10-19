'use strict';

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------
// The Task Manager as a local window (Dion, 2026-10-19: "like how chat is
// where the whole thing functions on my computer locally like a real proper
// app ... the main point is speed"). Same shape as chat.js: the window's page
// ships inside the Launcher, so it opens instantly; this module keeps the lists
// in memory, polls ONE Controller route for them (GET /api/tasks/sync), and
// sends each change through the route the /tasks page itself uses. The tasks
// stay in Controller, so the page and the window always agree.
//
// A change shows at once (tasks-rules.applyOptimistic) and the next sync is the
// truth: a refused write puts the list back the way the server has it and says
// why in the window.
//
// Requests ride the app's own session, so the Controller login cookie goes
// along and the launcher never handles a credential (as chat and
// notifications do). Nothing of the tasks is written to disk.
//
// Admins first (Dion, 2026-10-19): Quick Tasks and Quick Notes are ADMIN-only
// in Controller, so the tray icon only appears once sync says the person is an
// ADMIN; everyone else never sees it.

const { net } = require('electron');
const rules = require('./tasks-rules');
const { jobLinkBaseFor } = require('./chat-links');

const FIRST_POLL_DELAY_MS = 4 * 1000; // let the picker paint first
const REQUEST_TIMEOUT_MS = 15 * 1000;
const ASSIGNEES_EVERY_MS = 30 * 60 * 1000; // from ACOMS.OS, rarely changes

// status:
//   idle        — not polled yet
//   ok          — answered
//   signIn      — Controller session expired; the person needs to sign in
//   unavailable — this Controller has no /api/tasks/sync (launcher shipped first)
//   error       — unreachable or a bad response
//   off         — portals.json has no tasks block
let status = 'idle';
let errorMessage = '';
let actionError = '';

let baseUrl = null;
let syncPath = '/api/tasks/sync';
let jobLinkBase = null;
let emailBase = null;
let etag = null;

// What the server last said (data), and what the window shows (view): the
// same, plus any change still on its way.
let data = { me: null, quick: [], recurring: [], company: [], dismissed: [], notes: null };
let view = data;
let pending = 0;
let assignees = [];
let assigneesAt = 0;
// Opened on demand (the "Archived" toggle), not polled.
let archived = { quick: null, notes: null };

let windowOpen = false;
let windowFocused = false;
let timer = null;
let polling = false;
let pollAgain = false; // asked for while one was running: run again straight after
let listeners = [];

function isAdmin() {
  return Boolean(data.me && data.me.role === 'ADMIN');
}

function snapshot() {
  return {
    status,
    errorMessage,
    actionError,
    me: view.me,
    isAdmin: isAdmin(),
    quick: view.quick,
    notes: view.notes,
    recurring: view.recurring,
    company: view.company,
    dismissed: view.dismissed,
    archivedQuick: archived.quick,
    archivedNotes: archived.notes,
    assignees,
    myEmployeeId: rules.myEmployeeId(assignees, view.me),
    jobLinkBase,
    emailBase
  };
}

function emit() {
  const snap = snapshot();
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch (err) {
      console.error('tasks listener failed:', err.message);
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

// Open Quick Tasks of mine that are overdue — the tray icon's red dot.
function overdueCount() {
  const mine = rules.myEmployeeId(assignees, data.me);
  const list = (data.quick || []).filter((t) => !mine || t.assigneeId === mine);
  return rules.taskBadges(list).overdue;
}

// ── Requests ───────────────────────────────────────────────────────────────

// Returns { ok: true, data, status, etag } or { ok: false, state, message, httpStatus }.
async function request(path, { method = 'GET', body, headers = {} } = {}) {
  if (!baseUrl) return { ok: false, state: 'off', message: '' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await net.fetch(new URL(path, baseUrl).toString(), {
      method,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      // A login redirect must stay visible as a redirect (see notifications.js).
      redirect: 'manual',
      signal: controller.signal
    });

    const isRedirect =
      res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400 && res.status !== 304);
    if (isRedirect || res.status === 401) return { ok: false, state: 'signIn', message: '' };
    if (res.status === 304) return { ok: true, status: 304, data: null, etag: res.headers.get('etag') };

    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        state: 'error',
        httpStatus: res.status,
        message: (json && json.error) || `HTTP ${res.status}`
      };
    }
    return { ok: true, status: res.status, data: json, etag: res.headers.get('etag') };
  } catch (err) {
    return { ok: false, state: 'error', message: (err && err.message) || 'unreachable' };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Polling ────────────────────────────────────────────────────────────────

function schedule(delay) {
  clearTimeout(timer);
  if (status === 'off') return;
  timer = setTimeout(poll, delay ?? rules.pollIntervalMs({ windowOpen, windowFocused, status }));
}

async function loadAssignees() {
  const res = await request('/api/assignees');
  if (res.ok && Array.isArray(res.data)) {
    assignees = res.data;
    assigneesAt = Date.now();
  }
}

async function poll() {
  if (polling) {
    pollAgain = true;
    return;
  }
  polling = true;
  try {
    const res = await request(syncPath, { headers: etag ? { 'If-None-Match': etag } : {} });

    if (!res.ok) {
      // No sync route on this Controller yet: "not switched on", not "broken".
      status =
        res.state === 'error' && (res.httpStatus === 404 || res.httpStatus === 405) ? 'unavailable' : res.state;
      errorMessage = res.message || '';
      emit();
      return;
    }

    const firstOk = status !== 'ok';
    status = 'ok';
    errorMessage = '';
    // Nothing changed (304) and nothing to catch up on: say nothing, so an
    // idle window isn't redrawn every few seconds.
    if (res.status === 304 && !firstOk && pending === 0 && Date.now() - assigneesAt <= ASSIGNEES_EVERY_MS) return;
    if (res.status !== 304 && res.data) {
      data = {
        me: res.data.me || null,
        quick: Array.isArray(res.data.quick) ? res.data.quick : [],
        recurring: Array.isArray(res.data.recurring) ? res.data.recurring : [],
        company: Array.isArray(res.data.company) ? res.data.company : [],
        dismissed: Array.isArray(res.data.dismissed) ? res.data.dismissed : [],
        notes: Array.isArray(res.data.notes) ? res.data.notes : null
      };
      etag = res.etag || null;
    }
    // While a change is on its way, the screen keeps showing it; the sync
    // after it lands brings the server's version in.
    if (pending === 0) view = data;
    if (firstOk || Date.now() - assigneesAt > ASSIGNEES_EVERY_MS) await loadAssignees();
    emit();
  } finally {
    polling = false;
    const again = pollAgain;
    pollAgain = false;
    schedule(again ? 0 : undefined);
  }
}

function pollNow() {
  schedule(0);
}

// ── What the window asks for ───────────────────────────────────────────────

const id = (v) => encodeURIComponent(String(v || ''));

// Each action: how it shows at once (optimistic, see tasks-rules) and the
// request that makes it so. Returns { ok, data?, error? } to the window.
const ACTIONS = {
  'task:create': (a) => ({ path: '/api/tasks', method: 'POST', body: a.fields }),
  'task:update': (a) => ({ path: `/api/tasks/${id(a.id)}`, method: 'PUT', body: a.fields }),
  'task:complete': (a) => ({ path: `/api/tasks/${id(a.id)}/complete`, method: 'POST' }),
  'task:archive': (a) => ({ path: `/api/tasks/${id(a.id)}`, method: 'DELETE' }),
  'task:restore': (a) => ({ path: `/api/tasks/${id(a.id)}/restore`, method: 'POST' }),
  'note:create': () => ({ path: '/api/notes', method: 'POST' }),
  'note:update': (a) => ({ path: `/api/notes/${id(a.id)}`, method: 'PUT', body: { content: String(a.content ?? '') } }),
  // A note closed while still empty is thrown away, not kept blank (the page's rule).
  'note:discard': (a) => ({ path: `/api/notes/${id(a.id)}?purgeIfEmpty=true`, method: 'DELETE' }),
  'note:pin': (a) => ({ path: `/api/notes/${id(a.id)}/pin`, method: 'PUT' }),
  'note:archive': (a) => ({ path: `/api/notes/${id(a.id)}`, method: 'DELETE' }),
  'note:restore': (a) => ({ path: `/api/notes/${id(a.id)}/restore`, method: 'POST' }),
  'note:delete': (a) => ({ path: `/api/notes/${id(a.id)}?hard=true`, method: 'DELETE' })
};

async function act(action) {
  const make = action && ACTIONS[action.type];
  if (!make) return { ok: false, error: 'Unknown action' };

  pending += 1;
  actionError = '';
  view = rules.applyOptimistic(view, action);
  emit();

  let res = await request(...toArgs(make(action)));
  // A note turned into a task: the task first, then the note marked converted
  // (and archived) — the page's two calls, in its order.
  if (res.ok && action.type === 'task:create' && action.fromNoteId && res.data && res.data.id) {
    const conv = await request(`/api/notes/${id(action.fromNoteId)}/convert`, {
      method: 'POST',
      body: { taskId: res.data.id }
    });
    if (!conv.ok) res = { ...conv, message: `Task made, but the note wasn't marked converted: ${conv.message}` };
  }

  pending -= 1;
  if (!res.ok) {
    if (res.state === 'signIn') status = 'signIn';
    actionError = res.message || 'That did not save';
    if (pending === 0) view = data; // back to what the server has
  }
  // Whatever happened, re-read: the server is the truth. A change to an
  // archived item refreshes that list too.
  etag = null;
  if (/restore|delete/.test(action.type) || archived.quick || archived.notes) refreshArchived();
  pollNow();
  emit();
  return res.ok ? { ok: true, data: res.data } : { ok: false, error: actionError };
}

function toArgs({ path, method, body }) {
  return [path, { method, body }];
}

// "Archived" toggles: kind 'quick' | 'notes'; null closes it.
async function loadArchived(kind, open = true) {
  if (!['quick', 'notes'].includes(kind)) return;
  if (!open) {
    archived = { ...archived, [kind]: null };
    emit();
    return;
  }
  const res = await request(kind === 'quick' ? '/api/tasks?archived=true' : '/api/notes?archived=true');
  archived = { ...archived, [kind]: res.ok && Array.isArray(res.data) ? res.data : [] };
  if (!res.ok) actionError = res.message || 'Could not load the archive';
  emit();
}

function refreshArchived() {
  if (archived.quick) loadArchived('quick');
  if (archived.notes) loadArchived('notes');
}

// The Project (WIP job) field's search — the page's own route.
async function searchJobs(q) {
  const text = String(q || '').trim();
  if (!text) return [];
  const res = await request(`/api/tasks/wip-projects?search=${encodeURIComponent(text)}`);
  if (!res.ok || !Array.isArray(res.data)) return [];
  return res.data.map((j) => ({
    value: rules.wipJobRef(j),
    sublabel: [j.stage ? String(j.stage).replace(/_/g, ' ') : '', j.clientName, j.siteAddress].filter(Boolean).join(' — ')
  }));
}

function clearError() {
  actionError = '';
  emit();
}

function setWindowState({ open, focused }) {
  const was = `${windowOpen}${windowFocused}`;
  windowOpen = Boolean(open);
  windowFocused = Boolean(open && focused);
  // Coming to the window is when it should be freshest.
  if (was !== `${windowOpen}${windowFocused}` && windowOpen && (status === 'ok' || status === 'idle')) pollNow();
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

function init({ portals, config }) {
  const portal = config && portals.find((p) => p.id === config.portal);
  if (!portal) {
    status = 'off';
    emit();
    return;
  }
  baseUrl = portal.url;
  if (typeof config.sync === 'string') syncPath = config.sync;
  jobLinkBase = jobLinkBaseFor(config.jobs, portals);
  const email = config.email && portals.find((p) => p.id === config.email);
  emailBase = email ? email.url : null;
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
  isAdmin,
  overdueCount,
  pollNow,
  act,
  loadArchived,
  searchJobs,
  clearError,
  setWindowState,
  status: () => status
};
