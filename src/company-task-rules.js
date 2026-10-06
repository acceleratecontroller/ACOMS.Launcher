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
// How each of those is met, and where:
//
//   pops up, stays until clicked  — a STICKY card, keyed by the task (not
//                                   the feed id), so a re-pop replaces the
//                                   card instead of stacking a second one.
//   again every 4 hours           — Controller rolls the feed id every four
//                                   hours (company:<task>:<generation>), so
//                                   announce-rules sees it as new. No timer
//                                   here; every machine agrees with the
//                                   server's clock.
//   click → someone else has it   — the click asks Controller for the task's
//                                   LIVE state first (clickOutcome below),
//                                   and only opens the app if it is still
//                                   up for grabs, or already yours.
//   taken while the card is up    — on each poll, a card whose task has left
//                                   the feed is swapped for the "<name> has
//                                   claimed this" note (cardsToRetire).
//
// Kept free of Electron, like announce-rules.js, so it can be unit-tested.

const KIND = 'company-task';

// The feed items that are company tasks, with the fields the cards need.
function companyTaskItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i && i.kind === KIND && i.severity === 'action' && i.id)
    .map((i) => ({
      id: String(i.id),
      taskId: String(i.taskId || taskIdFromFeedId(i.id) || ''),
      title: String(i.title || ''),
      subtitle: i.subtitle ? String(i.subtitle) : '',
      path: i.path ? String(i.path) : '',
      category: i.category ? String(i.category) : ''
    }))
    .filter((i) => i.taskId);
}

// company:<taskId>:<generation> → taskId. Defensive: an older Controller
// without `taskId` on the item still works.
function taskIdFromFeedId(id) {
  const m = /^company:([^:]+):\d+$/.exec(String(id || ''));
  return m ? m[1] : null;
}

// The stable key a card is shown under. The feed id carries the nag
// generation and changes every four hours; the card must not.
function cardKey(taskId) {
  return `company-task:${taskId}`;
}

// Cards currently on screen whose task is NO LONGER in the feed — somebody
// claimed it, finished it, or it was withdrawn. Those cards should be swapped
// for a short note and let fade. Only judged when the poll actually answered
// (a 401 or an outage says nothing about the tasks).
//
//   shownTaskIds — task ids with a card up right now
//   feedItems    — companyTaskItems(result.items) of a poll that answered
function cardsToRetire(shownTaskIds, feedItems) {
  const live = new Set((feedItems || []).map((i) => i.taskId));
  return (shownTaskIds || []).filter((id) => !live.has(id));
}

// What to do when a company-task card is clicked, given Controller's live
// answer for that task (GET /api/launcher/tasks/<id>), or the failure to get
// one.
//
//   state  — { open, claimed, claimedByName, mine } | null (404 / no answer)
//   error  — true when the request itself failed (network, 5xx)
//
// Returns { action: 'open' | 'note', message? }:
//   open — go to the queue with this task rung (unclaimed, or already mine;
//          ALSO on error — an unreachable Controller must not turn a click
//          into nothing, the app is still the right place to go)
//   note — do not open; replace the card with `message` and let it fade
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

// The note shown when a task leaves the feed between polls.
function retiredMessage(state) {
  if (state && state.open === false) return 'This task is done';
  if (state && state.claimed) return `${state.claimedByName || 'Someone'} has claimed this`;
  return 'This task is no longer in the queue';
}

module.exports = {
  KIND,
  companyTaskItems,
  taskIdFromFeedId,
  cardKey,
  cardsToRetire,
  clickOutcome,
  retiredMessage
};
