'use strict';

// ---------------------------------------------------------------------------
// Tiny JSON store
// ---------------------------------------------------------------------------
// Two things need to outlive a restart: what the person has configured
// (muted portals, quiet hours) and which notification items they have already
// been told about. Without the second, every restart re-announces the same
// approvals — which is the fastest way to get notifications switched off.
//
// This is deliberately not a database. It is a few kilobytes of JSON in
// userData, written atomically, and every failure degrades to "use the
// defaults" rather than taking the app down.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { isValidTime, inQuietWindow } = require('./quiet-hours');
const { expiredSeenIds } = require('./announce-rules');

const FILE = path.join(app.getPath('userData'), 'launcher-state.json');

const DEFAULTS = {
  // Portal ids the person doesn't want notifications from.
  muted: [],
  // Quiet hours in local time, as "HH:MM". Null means never quiet.
  quietFrom: null,
  quietTo: null,
  // Item ids already announced: { "<id>": <epoch ms LAST SEEN in a payload }.
  // Refreshed every poll while the item is still open, so the TTL below
  // measures how long something has been GONE, not how long it has been known.
  seen: {},
  // Portal ids that have completed one successful poll. The first poll of a
  // portal establishes a baseline silently — see announce-rules.js.
  primed: [],
  // Today's rolled task-reminder times — see reminder-schedule.js. Persisted
  // so a restart doesn't re-roll the day and fire a reminder twice.
  reminderPlan: null
};

// Seen ids are pruned so the file can't grow forever. Because the timestamp is
// refreshed on every poll that still returns the item, this is "absent for 30
// days", not "known for 30 days" — a task overdue since July stays known, and
// so stays quiet, while something genuinely resolved is eventually forgotten
// (and would rightly be announced again if it ever came back).
const SEEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let state = null;

function load() {
  if (state) return state;
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    state = {
      muted: Array.isArray(parsed.muted) ? parsed.muted.filter((m) => typeof m === 'string') : [],
      quietFrom: typeof parsed.quietFrom === 'string' ? parsed.quietFrom : null,
      quietTo: typeof parsed.quietTo === 'string' ? parsed.quietTo : null,
      seen: parsed.seen && typeof parsed.seen === 'object' ? parsed.seen : {},
      primed: Array.isArray(parsed.primed) ? parsed.primed.filter((p) => typeof p === 'string') : [],
      reminderPlan:
        parsed.reminderPlan && typeof parsed.reminderPlan === 'object' ? parsed.reminderPlan : null
    };
    prune();
  } catch {
    // Missing or corrupt file — start clean rather than crash. The cost is
    // one duplicate round of notifications, not a broken app.
    state = { ...DEFAULTS, muted: [], seen: {}, primed: [], reminderPlan: null };
  }
  return state;
}

function prune() {
  for (const id of expiredSeenIds(state.seen, Date.now(), SEEN_TTL_MS)) {
    delete state.seen[id];
  }
}

function save() {
  if (!state) return;
  try {
    // Write-then-rename so a crash mid-write can't leave a truncated file
    // that would wipe the person's settings on next launch.
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, FILE);
  } catch (err) {
    console.error('Could not save launcher state:', err.message);
  }
}

function getSettings() {
  const s = load();
  return { muted: [...s.muted], quietFrom: s.quietFrom, quietTo: s.quietTo };
}

function setMuted(portalId, muted) {
  const s = load();
  const has = s.muted.includes(portalId);
  if (muted && !has) s.muted.push(portalId);
  if (!muted && has) s.muted = s.muted.filter((m) => m !== portalId);
  save();
  return getSettings();
}

function setQuietHours(from, to) {
  const s = load();
  // Both or neither — half a range is not a range.
  if (isValidTime(from) && isValidTime(to)) {
    s.quietFrom = from;
    s.quietTo = to;
  } else {
    s.quietFrom = null;
    s.quietTo = null;
  }
  save();
  return getSettings();
}

function isMuted(portalId) {
  return load().muted.includes(portalId);
}

// True when the current local time falls inside the configured quiet window.
// The maths (including the midnight-crossing case) lives in quiet-hours.js so
// it can be tested without Electron.
function inQuietHours(now = new Date()) {
  const s = load();
  return inQuietWindow(now, s.quietFrom, s.quietTo);
}

// Record ids as announced, and refresh any that are still open. `touch` is
// what stops a long-running item ageing out of the seen-set and coming back
// around as though it were new.
function recordSeen({ markSeen: mark = [], touch = [] } = {}) {
  const s = load();
  const now = Date.now();
  for (const id of mark) s.seen[id] = now;
  for (const id of touch) s.seen[id] = now;
  prune();
  save();
}

function isPrimed(portalId) {
  return load().primed.includes(portalId);
}

function markPrimed(portalId) {
  const s = load();
  if (!s.primed.includes(portalId)) {
    s.primed.push(portalId);
    save();
  }
}

function seenMap() {
  return load().seen;
}

function getReminderPlan() {
  return load().reminderPlan;
}

function setReminderPlan(plan) {
  const s = load();
  s.reminderPlan = plan;
  save();
}

module.exports = {
  getSettings,
  setMuted,
  setQuietHours,
  isMuted,
  inQuietHours,
  recordSeen,
  seenMap,
  isPrimed,
  markPrimed,
  getReminderPlan,
  setReminderPlan,
  FILE
};
