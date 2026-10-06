'use strict';

// ---------------------------------------------------------------------------
// Portal notifications
// ---------------------------------------------------------------------------
// The launcher asks each portal that offers one for a small summary of what is
// waiting on the signed-in person, and raises a native notification when
// something NEW turns up.
//
// Why this can work without any credential handling here: the request goes out
// through the app's own session, the same one the portal windows use, so the
// portal's normal login cookie rides along. The launcher never sees a token.
//
// Two rules this module exists to enforce, both learned the hard way in the
// design conversation:
//
//   1. A 401 IS VISIBLE. If a session has expired, the portal's card says
//      "Sign in to ACOMS.WIP" rather than the launcher quietly going dark and
//      pretending nothing is waiting. Silent failure is worse than no feature.
//   2. Nothing is announced twice. Item ids are remembered across restarts, so
//      the same approval doesn't toast every time the app starts.

const { net } = require('electron');
const store = require('./store');
const popup = require('./popup');
const { decideAnnouncements } = require('./announce-rules');
const {
  planDay,
  dueSlots,
  planIsStale,
  nextFireAt
} = require('./reminder-schedule');
const { buildTaskReminder } = require('./task-reminder');
const companyTasks = require('./company-task-rules');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const FIRST_POLL_DELAY_MS = 8 * 1000; // let the picker paint first
const REQUEST_TIMEOUT_MS = 15 * 1000;

// Per-portal state the picker renders:
//   ok       — answered, `badge` and `items` are current
//   signIn   — 401/redirect to login; the person needs to open that portal
//   error    — unreachable or a bad response; shown quietly, not shouted about
//   off      — this portal doesn't offer a summary endpoint
const results = new Map();

let portals = [];
let timer = null;
let listeners = [];
let openPortalAt = null; // injected by main.js: (portalId, url) => void

function snapshot() {
  const out = {};
  for (const [id, r] of results) out[id] = { ...r };
  return out;
}

function emit() {
  const snap = snapshot();
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch (err) {
      console.error('notification listener failed:', err.message);
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

// Total across every portal that answered — what the tray badge shows.
function totalBadge() {
  let total = 0;
  for (const r of results.values()) {
    if (r.state === 'ok' && !store.isMuted(r.portalId)) total += r.badge || 0;
  }
  return total;
}

function summaryUrl(portal) {
  if (!portal.summary) return null;
  try {
    return new URL(portal.summary, portal.url).toString();
  } catch {
    return null;
  }
}

// One session-aware JSON read. The request goes out through the app's own
// session, so the portal's login cookie rides along; the launcher never
// sees a token. Resolves, never throws:
//   { status, data }          — answered (404 with a JSON body = "not found")
//   { error: 'signIn' }       — a login redirect, 401 or 403: the session
//                               has expired or the person lacks the role
//   { error: '<reason>' }     — unreachable, 5xx, non-JSON (e.g. a portal
//                               build without this route answers an HTML 404)
// Used for the summary poll and for the company-task click check, so there
// is exactly one place that knows how an ACOMS portal says "sign in".
async function fetchJson(portal, relativePath, timeoutMs = REQUEST_TIMEOUT_MS) {
  let url;
  try {
    url = new URL(relativePath, portal.url).toString();
  } catch {
    return { error: 'bad url' };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await net.fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      // A login redirect must be visible as a redirect, not followed into an
      // HTML page that then fails to parse as JSON.
      redirect: 'manual',
      signal: controller.signal
    });
    // With redirect:'manual' the Fetch spec hands back an OPAQUE redirect —
    // type 'opaqueredirect', status 0 — not the 3xx itself.
    const isRedirect =
      res.type === 'opaqueredirect' || res.status === 0 || (res.status >= 300 && res.status < 400);
    if (isRedirect || res.status === 401 || res.status === 403) return { error: 'signIn' };
    if (res.status === 404) {
      // A JSON 404 is the route saying "no such thing"; an HTML 404 is a
      // portal that does not have the route at all — a failure, not an answer.
      try {
        const body = await res.json();
        return { status: 404, data: null, body };
      } catch {
        return { error: 'HTTP 404 (no such route)' };
      }
    }
    if (!res.ok) return { error: `HTTP ${res.status}` };
    try {
      return { status: res.status, data: await res.json() };
    } catch {
      return { error: 'not JSON' };
    }
  } catch (err) {
    return { error: (err && err.message) || 'unreachable' };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSummary(portal) {
  if (!summaryUrl(portal)) return { state: 'off' };
  const r = await fetchJson(portal, portal.summary);
  if (r.error === 'signIn') return { state: 'signIn' };
  if (r.error) return { state: 'error', message: r.error };
  const data = r.data && typeof r.data === 'object' ? r.data : {};
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    state: 'ok',
    badge: Number.isFinite(data.badge) ? data.badge : items.length,
    summary: typeof data.summary === 'string' ? data.summary : '',
    items,
    // Optional per-kind totals. `items` is capped, so without these a
    // reminder can only ever count what it can see — it says "at least"
    // rather than stating a number that is wrong.
    counts: data.counts && typeof data.counts === 'object' ? data.counts : null,
    at: Date.now()
  };
}

// ---------------------------------------------------------------------------
// ACOMS Tasks — company-task cards
// ---------------------------------------------------------------------------
// A card is on screen WHILE a company task is unclaimed. The rules (what is a
// company task, what each poll should change, what a click does) live in
// company-task-rules.js. This is the Electron side: the sticky cards, the
// live check on click, the swap-to-note when someone else takes it.
//
// Per portal:
//   shown     — taskId → generation of the individual card that is up
//   dismissed — taskId → generation the person closed with ×; the card stays
//               down for that generation and returns on the next (≤ 4 h)
//   summary   — signature of the summary card if one is up
const companyState = new Map(); // portalId → { shown, dismissed, summary, items }

// The click check should feel like a click, not a page load.
const CLICK_CHECK_TIMEOUT_MS = 5 * 1000;

function companyStateFor(portal) {
  let st = companyState.get(portal.id);
  if (!st) {
    st = { shown: {}, dismissed: {}, summary: null, items: new Map() };
    companyState.set(portal.id, st);
  }
  return st;
}

function showCompanyCard(portal, item) {
  const st = companyStateFor(portal);
  st.shown[item.taskId] = item.generation;
  st.items.set(item.taskId, item);
  popup.show({
    kind: 'reminder',
    label: 'ACOMS task — unclaimed',
    badge: 'A',
    title: item.title,
    body: item.subtitle || 'Click to take it',
    // Stays until clicked, or until someone else takes it (decision 1).
    sticky: true,
    // Keyed by TASK: the 4-hourly re-pop replaces this card (and beeps
    // again) rather than stacking a second one.
    key: companyTasks.cardKey(item.taskId),
    onClick: () => {
      // Clicked = seen, like ×: the card stays down for this generation while
      // the person is in the queue deciding; still unclaimed in four hours,
      // it is back.
      delete st.shown[item.taskId];
      st.dismissed[item.taskId] = item.generation;
      handleCompanyClick(portal, item).catch((err) => {
        console.error('company task click failed:', err && err.message);
      });
    },
    // × — the person has seen it. Down until the next generation, not forever.
    onDismiss: () => {
      delete st.shown[item.taskId];
      st.dismissed[item.taskId] = item.generation;
    }
  });
}

function showCompanySummary(portal, summary) {
  const st = companyStateFor(portal);
  st.summary = summary.signature;
  const target = new URL('/tasks?tab=acoms', portal.url).toString();
  popup.show({
    kind: 'reminder',
    label: 'ACOMS tasks — unclaimed',
    badge: String(summary.count).slice(0, 2),
    title: `${summary.count} ACOMS tasks need someone`,
    body: 'Click to open the queue and take one',
    sticky: true,
    key: companyTasks.cardKey(companyTasks.SUMMARY_KEY),
    onClick: () => {
      st.summary = null;
      if (openPortalAt) openPortalAt(portal.id, target);
    },
    onDismiss: () => {
      // Closed with ×: leave it down until the set changes.
    }
  });
}

// Swap a card for a short, non-sticky note and let it fade — or just take it
// down when there is nothing to say.
function retireCompanyCard(portal, taskId, message) {
  const st = companyStateFor(portal);
  const item = st.items.get(taskId);
  delete st.shown[taskId];
  st.items.delete(taskId);
  const key = companyTasks.cardKey(taskId);
  if (!message) {
    popup.dismissKey(key);
    return;
  }
  popup.show({
    kind: 'reminder',
    label: 'ACOMS task',
    badge: 'A',
    title: item ? item.title : 'ACOMS task',
    body: message,
    sticky: false,
    key
  });
}

async function handleCompanyClick(portal, item) {
  const res = await fetchJson(
    portal,
    `/api/launcher/tasks/${encodeURIComponent(item.taskId)}`,
    CLICK_CHECK_TIMEOUT_MS
  );
  const outcome = companyTasks.clickOutcome({
    state: res.data || null,
    error: Boolean(res.error)
  });
  if (outcome.action === 'open') {
    if (openPortalAt) openPortalAt(portal.id, resolveItemUrl(portal, item));
    return;
  }
  // The card itself is already gone (popup dismisses on click); say why the
  // app did not open, briefly.
  popup.show({
    kind: 'reminder',
    label: 'ACOMS task',
    badge: 'A',
    title: item.title,
    body: outcome.message,
    sticky: false,
    key: companyTasks.cardKey(item.taskId)
  });
}

// After a poll that ANSWERED: make the cards match the feed. Runs off the
// poll's critical path (pollOne does not await it) so a slow Controller
// never holds up the badge or the reminders.
async function reconcileCompanyCards(portal, result) {
  if (result.state !== 'ok') return;
  const st = companyStateFor(portal);
  const feedItems = companyTasks.companyTaskItems(result.items);
  const plan = companyTasks.planCompanyCards({
    feedItems,
    shown: st.shown,
    dismissed: st.dismissed,
    summary: st.summary,
    quiet: store.isMuted(portal.id) || store.inQuietHours()
  });

  // Cards folded into a summary come down without a note.
  for (const taskId of plan.fold) retireCompanyCard(portal, taskId, null);
  if (plan.dropSummary) {
    st.summary = null;
    popup.dismissKey(companyTasks.cardKey(companyTasks.SUMMARY_KEY));
  }

  // Cards whose task left the feed: find out why, in parallel, then swap.
  await Promise.all(
    plan.retire.map(async (taskId) => {
      const res = await fetchJson(
        portal,
        `/api/launcher/tasks/${encodeURIComponent(taskId)}`,
        CLICK_CHECK_TIMEOUT_MS
      );
      retireCompanyCard(portal, taskId, companyTasks.retiredMessage(res.data || null));
    })
  );

  for (const item of plan.show) showCompanyCard(portal, item);
  if (plan.summary) showCompanySummary(portal, plan.summary);

  // Forget × dismissals for tasks that are gone.
  const live = new Set(feedItems.map((i) => i.taskId));
  for (const taskId of Object.keys(st.dismissed)) {
    if (!live.has(taskId)) delete st.dismissed[taskId];
  }
}

// The launcher's own pop-up card, not an OS notification — see popup.js.
function notify(portal, title, body, targetUrl) {
  popup.show({
    kind: 'portal',
    label: 'Waiting on you',
    title,
    body,
    // Every portal is "ACOMS.something", so the badge takes the something.
    name: String(portal.name || '').replace(/^ACOMS\./i, ''),
    onClick: () => {
      if (openPortalAt) openPortalAt(portal.id, targetUrl);
    }
  });
}

// Decide what, if anything, to say about one portal's new items.
// One new thing gets named. Several get counted — a burst of six separate
// toasts is how a person learns to ignore them.
//
// The rules for WHICH ids count as new live in announce-rules.js, free of
// Electron and unit-tested: the first poll of a portal is a silent baseline,
// and anything still open is refreshed rather than re-announced.
function announce(portal, result) {
  if (result.state !== 'ok') return;

  const actionItems = result.items.filter((i) => i && i.severity === 'action' && i.id);

  const decision = decideAnnouncements({
    actionIds: actionItems.map((i) => i.id),
    seen: store.seenMap(),
    primed: store.isPrimed(portal.id),
    // A muted portal is treated as permanently quiet: its items are still
    // recorded, so un-muting shows what happens NEXT rather than replaying
    // everything that piled up while it was off.
    quiet: store.isMuted(portal.id) || store.inQuietHours(),
    now: Date.now()
  });

  store.recordSeen(decision);
  if (decision.baseline) store.markPrimed(portal.id);

  if (decision.announce.length === 0) return;

  const freshSet = new Set(decision.announce);
  // Company tasks are a STATE, reconciled every poll (reconcileCompanyCards),
  // not an event announced once — they are left out of this path entirely.
  const newItems = actionItems.filter((i) => freshSet.has(i.id) && i.kind !== companyTasks.KIND);
  if (newItems.length === 0) return;

  if (newItems.length === 1) {
    const item = newItems[0];
    const url = resolveItemUrl(portal, item);
    notify(portal, portal.name, [item.title, item.subtitle].filter(Boolean).join(' — '), url);
  } else {
    notify(
      portal,
      portal.name,
      `${newItems.length} things need you${result.summary ? ` — ${result.summary}` : ''}`,
      portal.url
    );
  }
}

// Items carry a RELATIVE path, so the portal's own base URL resolves it. That
// keeps the portal free to move (preview deployments included) without the
// launcher knowing its hostname.
function resolveItemUrl(portal, item) {
  const p = item && (item.path || item.url);
  if (!p) return portal.url;
  try {
    return new URL(p, portal.url).toString();
  } catch {
    return portal.url;
  }
}

async function pollOne(portal) {
  const result = await fetchSummary(portal);
  result.portalId = portal.id;
  results.set(portal.id, result);
  announce(portal, result);
  reconcileCompanyCards(portal, result).catch((err) => {
    console.error('company task cards failed:', err && err.message);
  });
}

// ---------------------------------------------------------------------------
// Task reminders
// ---------------------------------------------------------------------------
// Approvals are events: they arrive, you are told once. Tasks are a STATE —
// due today is still due tomorrow — so they get reminded on a clock instead,
// twice a day, until the list is dealt with. Dion: "I want it to be annoying
// and force me to keep these things up to date."
//
// The times move within a window each day rather than sitting at 08:00
// forever, because a toast that arrives at exactly the same moment every day
// becomes furniture. The schedule maths lives in reminder-schedule.js.

let reminderTimer = null;

// A portal's items are capped for payload size. If we got exactly the cap,
// the real number may be higher — say "at least" rather than state a figure
// that is only the part we can see.
const ITEM_CAP_HINT = 10;

function taskItemsFor(result) {
  if (!result || result.state !== 'ok' || !Array.isArray(result.items)) return [];
  return result.items.filter((i) => i && i.severity === 'action' && i.kind === 'task');
}

function fireTaskReminder(portal, result) {
  const items = taskItemsFor(result);
  if (items.length === 0) return false;

  const counts = result.counts && typeof result.counts === 'object' ? result.counts : null;
  const trueCount = counts && Number.isFinite(counts.task) ? counts.task : null;

  const reminder = buildTaskReminder({
    items,
    trueCount,
    capped: trueCount === null && items.length >= ITEM_CAP_HINT,
    now: new Date()
  });
  if (!reminder) return false;

  const target = new URL('/tasks', portal.url).toString();
  popup.show({
    kind: 'reminder',
    label: 'Task reminder',
    badge: '!',
    title: reminder.title,
    body: reminder.body,
    // Stays on screen until it is dealt with, on every platform — what the
    // Windows-only "reminder scenario" toast used to be for.
    sticky: true,
    // A later reminder replaces an undealt-with one rather than stacking.
    key: `reminder:${portal.id}`,
    onClick: () => {
      if (openPortalAt) openPortalAt(portal.id, target);
    }
  });
  return true;
}

// Run any reminder slot that is now owed, then arm the next one.
async function runDueReminders() {
  const now = new Date();
  let plan = store.getReminderPlan();

  if (planIsStale(plan, now)) {
    plan = planDay(now);
    store.setReminderPlan(plan);
  }

  // Quiet hours defer a reminder rather than cancelling it — otherwise the
  // one notification meant to be unmissable is the one most easily silenced.
  const quietUntil = store.inQuietHours(now) ? now.getTime() + 60 * 1000 : null;
  const owed = dueSlots(plan, now, { quietUntil });

  if (owed.length > 0) {
    // Reminders must speak for the CURRENT state, not whatever the last poll
    // happened to leave behind.
    await pollAll();

    for (const portal of portals.filter((p) => p.summary)) {
      if (store.isMuted(portal.id)) continue;
      fireTaskReminder(portal, results.get(portal.id));
    }

    for (const slot of owed) slot.fired = true;
    store.setReminderPlan(plan);
  }

  armReminderTimer();
}

function armReminderTimer() {
  if (reminderTimer) clearTimeout(reminderTimer);
  const now = new Date();
  const plan = store.getReminderPlan();

  const at = nextFireAt(plan, now);
  // Nothing left today: look again just after midnight to roll a fresh day.
  const midnight = new Date(now.getTime());
  midnight.setHours(24, 0, 30, 0);
  const wake = at || midnight.getTime();

  // setTimeout overflows past ~24.8 days; nothing here is close, but clamp
  // anyway so a bad clock cannot turn the delay negative and spin.
  const delay = Math.max(1000, Math.min(wake - now.getTime(), 24 * 60 * 60 * 1000));
  reminderTimer = setTimeout(() => {
    runDueReminders().catch(() => armReminderTimer());
  }, delay);
}

async function pollAll() {
  const withSummary = portals.filter((p) => p.summary);
  if (withSummary.length === 0) return;
  await Promise.all(withSummary.map((p) => pollOne(p).catch(() => {})));
  emit();
}

function init({ portals: list, intervalMs, openPortalAt: opener }) {
  portals = Array.isArray(list) ? list : [];
  openPortalAt = opener || null;

  for (const p of portals) {
    results.set(p.id, { portalId: p.id, state: p.summary ? 'idle' : 'off', badge: 0, items: [] });
  }

  const every = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
  setTimeout(() => pollAll(), FIRST_POLL_DELAY_MS);
  timer = setInterval(() => pollAll(), every);

  // Catches up any slot missed while the machine was off, then arms the next.
  setTimeout(() => runDueReminders().catch(() => {}), FIRST_POLL_DELAY_MS + 5000);

  emit();
}

function dispose() {
  if (timer) clearInterval(timer);
  if (reminderTimer) clearTimeout(reminderTimer);
  timer = null;
  reminderTimer = null;
  listeners = [];
}

module.exports = {
  init,
  dispose,
  pollAll,
  onChanged,
  snapshot,
  totalBadge,
  resolveItemUrl,
  runDueReminders
};
