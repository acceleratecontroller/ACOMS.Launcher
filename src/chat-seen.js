'use strict';

// Pure: has the other person seen this message of mine? Loaded by chat.html as
// a plain script (window.acomsChatSeen) and by the tests through require.
//
// Dion, 2026-09-25: "i send a msg..and if someone else reads it on my card it
// shows a green tick next to the time". ACOMS.Controller's /api/chat/sync gives
// each conversation's other person a `lastReadAt` (null until they have read
// anything); every message of mine sent at or before it has been seen.

(function (root) {
  // When the other person in the conversation on screen last read it, or null.
  function otherReadAt(conversations, active) {
    if (!active || !active.conversationId) return null;
    const c = (conversations || []).find((x) => x.id === active.conversationId);
    const other = c && Array.isArray(c.with) ? c.with[0] : null;
    return other && typeof other.lastReadAt === 'string' ? other.lastReadAt : null;
  }

  function isSeen(message, readAt) {
    if (!readAt || !message) return false;
    const read = Date.parse(readAt);
    const sent = Date.parse(message.createdAt);
    return Number.isFinite(read) && Number.isFinite(sent) && sent <= read;
  }

  const api = { otherReadAt, isSeen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.acomsChatSeen = api;
})(typeof window !== 'undefined' ? window : this);
