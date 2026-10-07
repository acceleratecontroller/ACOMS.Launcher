'use strict';

// Pure: the important questions still waiting for an answer, and when to nag
// about them. Loaded by chat.html as a plain script (window.acomsChatQuestions)
// and by the main process and tests through require.
//
// Dion, 2026-10-07: an important question "needs to have a specific response
// to it" — "yes should show both ways" (waiting on me, and waiting on them) —
// and "important questions should nag with a pop up like everything else
// that's persistent every hour".

(function (root) {
  const NAG_EVERY_MS = 60 * 60 * 1000;

  // Split sync's openQuestions into the ones I must answer and the ones I asked.
  function split(openQuestions, meId) {
    const list = Array.isArray(openQuestions) ? openQuestions : [];
    return {
      forMe: list.filter((q) => q && q.senderId !== meId),
      byMe: list.filter((q) => q && q.senderId === meId)
    };
  }

  function inConversation(list, conversationId) {
    return (list || []).filter((q) => q.conversationId === conversationId);
  }

  // Whole hours a question has waited (0 in its first hour).
  function hoursWaiting(q, nowMs) {
    const at = Date.parse(q && q.createdAt);
    if (!Number.isFinite(at) || nowMs <= at) return 0;
    return Math.floor((nowMs - at) / NAG_EVERY_MS);
  }

  function preview(text, max = 90) {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  }

  // The hourly nag. `shown` maps question id -> the hour it was last nagged
  // for. Each question asked OF me nags once it has waited an hour, then again
  // every hour; all of them share ONE card so a pile of questions can't push
  // every other pop-up off the screen.
  //   -> { show: card text | null, clear: boolean, shown: next map }
  function decideNag({ openQuestions, meId, nowMs, shown }) {
    const { forMe } = split(openQuestions, meId);
    const next = {};
    let due = false;
    for (const q of forMe) {
      const hours = hoursWaiting(q, nowMs);
      const last = shown && Number.isInteger(shown[q.id]) ? shown[q.id] : 0;
      next[q.id] = Math.max(last, hours);
      if (hours >= 1 && hours > last) due = true;
    }
    if (forMe.length === 0) return { show: null, clear: true, shown: next };
    if (!due) return { show: null, clear: false, shown: next };

    const oldest = forMe[0]; // the server sends them oldest first
    const more = forMe.length - 1;
    return {
      show: {
        title:
          forMe.length === 1
            ? `❓ ${oldest.senderName || 'Someone'} is waiting on an answer`
            : `❓ ${forMe.length} important questions waiting on you`,
        body: `${oldest.senderName || 'Someone'}: ${preview(oldest.body)}${more > 0 ? ` (+${more} more)` : ''}`,
        conversationId: oldest.conversationId,
        message: { id: oldest.id, createdAt: oldest.createdAt }
      },
      clear: false,
      shown: next
    };
  }

  const api = { NAG_EVERY_MS, split, inConversation, hoursWaiting, decideNag };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.acomsChatQuestions = api;
})(typeof window !== 'undefined' ? window : this);
