'use strict';

// ---------------------------------------------------------------------------
// ACOMS Tasks — company-task pop-ups
// ---------------------------------------------------------------------------
// Controller's summary carries UNCLAIMED company tasks for admins and
// managers (kind "company-task"). Dion, 2026-10-06, on what they should do:
//
//   "if there is a new task it pops up for everyone who has the app ... then
//    when someone goes in they claim the task, if the task stays unclaimed
//    for 4 hours it pops up again and keeps doing that until someone claims
//    it. and the notification stays on the screen until its clicked ... if
//    you click it and someone else has taken the task ... the notification
//    goes away with a little note first and says JD has claimed this, and
//    then it fades out."
//
// The requirement is a STATE, not an event: "while this task is unclaimed, a
// card is on screen". So every poll that answers is reconciled against what
// is on screen (planCompanyCards):
//
//   task in feed, no card         → show a sticky card (also after a restart
//                                    or a reboot — the task is still there)
//   task in feed, card up,
//     feed generation moved on    → show it again (same card, beeps again):
//                                    the 4-hour re-pop. Controller rolls the
//                                    generation in the feed id; no timer here
//   card up, task left the feed   → someone claimed / finished it: swap the
//                                    card for a note and let it fade
//   person closed the card (×)    → leave it down until the NEXT generation,
//                                    not forever: the nag was asked for
//   more than a few unclaimed     → ONE sticky summary card for the lot,
//                                    never a stack that evicts itself
//
// Kept free of Electron, like announce-rules.js, so it can be unit-tested.

const KIND = 'company-task';

// Above this many unclaimed tasks, one summary card instead of one each. The
// pop-up stack holds four cards; four sticky company cards would evict each
// other every generation and chat would have nowhere to land.
const MAX_INDIVIDUAL = 3;
const SUMMARY_KEY = 'all';

// The feed items that are company tasks, with the fields the cards need.
function companyTaskItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i && i.kind === KIND && i.severity === 'action' && i.id)
    .map((i) => ({
      id: String(i.id),
      taskId: String(i.taskId || taskIdFromFeedId(i.id) || ''),
      generation: generationFromFeedId(i.id),
      title: String(i.title || ''),
      subtitle: i.subtitle ? String(i.subtitle) : '',
      path: i.path ? String(i.path) : '',
      category: i.category ? String(i.category) : ''
    }))
    .filter((i) => i.taskId);
}

// company:<taskId>:<generation>
function taskIdFromFeedId(id) {
  const m = /^company:([^:]+):\d+$/.exec(String(id || ''));
  return m ? m[1] : null;
}

function generationFromFeedId(id) {
  const m = /^company:[^:]+:(\d+)$/.exec(String(id || ''));
  return m ? Number(m[1]) : 0;
}

// The stable key a card is shown under. The feed id carries the nag
// generation and changes every four hours; the card must not.
function cardKey(taskId) {
  return `company-task:${taskId}`;
}

// What to do with the cards after a poll that ANSWERED (a 401 or an outage
// says nothing about the tasks and must not touch them).
//
//   feedItems — companyTaskItems(result.items)
//   shown     — { taskId: generation } for every individual card up now
//   dismissed — { taskId: generation } cards the person closed with ×
//   summary   — the signature of the summary card if one is up, else null
//   quiet     — quiet hours / muted: raise nothing new, still retire
//
// Returns:
//   mode      — 'individual' | 'summary'
//   show      — items to show (new, or re-popped: generation moved on)
//   retire    — taskIds whose card should become a note and fade
//   summary   — { count, signature } to show, or null
//   dropSummary — true when the summary card should come down
function planCompanyCards({ feedItems, shown, dismissed, summary, quiet }) {
  const feed = Array.isArray(feedItems) ? feedItems : [];
  const up = shown && typeof shown === 'object' ? shown : {};
  const closed = dismissed && typeof dismissed === 'object' ? dismissed : {};
  const live = new Map(feed.map((i) => [i.taskId, i]));

  // Cards up for tasks that are no longer unclaimed.
  const retire = Object.keys(up).filter((taskId) => !live.has(taskId));

  if (feed.length > MAX_INDIVIDUAL) {
    // Summary mode: every individual card comes down (silently — they are
    // folded into the one card, nobody claimed them), one card for the lot.
    const signature = feed
      .map((i) => `${i.taskId}:${i.generation}`)
      .sort()
      .join(',');
    const changed = signature !== summary;
    return {
      mode: 'summary',
      show: [],
      retire,
      fold: Object.keys(up).filter((taskId) => live.has(taskId)),
      summary: !quiet && changed ? { count: feed.length, signature } : null,
      dropSummary: false
    };
  }

  const show = quiet
    ? []
    : feed.filter((i) => {
        if (closed[i.taskId] !== undefined && closed[i.taskId] >= i.generation) return false;
        return up[i.taskId] === undefined || up[i.taskId] < i.generation;
      });

  return {
    mode: 'individual',
    show,
    retire,
    fold: [],
    summary: null,
    dropSummary: summary !== null && summary !== undefined
  };
}

// What to do when a company-task card is clicked, given Controller's live
// answer for that task (GET /api/launcher/tasks/<id>), or the failure to get
// one.
//
//   state  — { open, claimed, claimedByName, mine } | null (404: task gone)
//   error  — true when the request itself failed (network, 5xx, a Controller
//            without the route)
//
// Returns { action: 'open' | 'note', message? }:
//   open — go to the queue with this task rung (unclaimed, or already mine;
//          ALSO on error — an unreachable Controller must not turn a click
//          into nothing, the app is still the right place to go)
//   note — do not open; show `message` briefly instead
function clickOutcome({ state, error } = {}) {
  if (error || !state) {
    return error
      ? { action: 'open' }
      : { action: 'note', message: 'This task is no longer in the queue' };
  }
  if (state.open === false) {
    return { action: 'note', message: 'This task is already done' };
  }
  if (state.claimed && !state.mine) {
    const who = state.claimedByName || 'Someone';
    return { action: 'note', message: `${who} has claimed this` };
  }
  return { action: 'open' };
}

// The note shown when a task leaves the feed between polls. `null` means
// take the card down with no note — the task is still open and unclaimed
// (the feed was inconsistent: a rollback, a role change), nothing to report.
function retiredMessage(state) {
  if (state && state.open === false) return 'This task is done';
  if (state && state.claimed) return `${state.claimedByName || 'Someone'} has claimed this`;
  if (state && state.open === true && !state.claimed) return null;
  return 'This task is no longer in the queue';
}

module.exports = {
  KIND,
  MAX_INDIVIDUAL,
  SUMMARY_KEY,
  companyTaskItems,
  taskIdFromFeedId,
  generationFromFeedId,
  cardKey,
  planCompanyCards,
  clickOutcome,
  retiredMessage
};
