'use strict';

// Pure rules for chat rooms in the chat window (Dion 2026-10-07). Loaded by
// chat.html as a plain script (window.acomsChatRooms) and by the tests through
// require. The server (ACOMS.Controller modules/chat/rooms.ts) decides who is
// actually mentioned; this only helps the person type the name.

(function (root) {
  // Which send modes Tab cycles through here. A DM: all three. A room: never
  // a task (a task is for ONE person), and an important question only where
  // the room allows them. The Void allows neither.
  function allowedModes(conversation) {
    if (!conversation || !conversation.room) return ['text', 'question', 'task'];
    return conversation.room.allowCards ? ['text', 'question'] : ['text'];
  }

  // Is the caret just after "@something"? Then { start, query } — start is the
  // index of the "@" — else null. "@" must start a word (not an email address)
  // and the query can hold one space, for a surname ("@James De").
  function mentionQuery(text, caret) {
    const before = String(text || '').slice(0, caret);
    const m = /(^|[^\p{L}\p{N}])@([\p{L}\p{N}'-]*(?: [\p{L}\p{N}'-]*)?)$/u.exec(before);
    if (!m) return null;
    return { start: before.length - m[2].length - 1, query: m[2] };
  }

  // The members whose name starts with the query (first name or full name),
  // never me, best match first, at most five.
  function mentionMatches(members, query, meId) {
    const q = String(query || '').toLowerCase().trim();
    return (members || [])
      .filter((p) => p && p.name && p.identityId !== meId)
      .filter((p) => {
        const name = p.name.toLowerCase();
        return !q || name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 5);
  }

  // The text with "@quer" replaced by "@Full Name ", and where the caret goes.
  function insertMention(text, at, caret, name) {
    const value = String(text || '');
    const inserted = `@${name} `;
    return { text: value.slice(0, at.start) + inserted + value.slice(caret), caret: at.start + inserted.length };
  }

  // The wormhole's colour — the same rule as chat-rules.js roomState, which
  // the main process uses; this copy is for the window.
  function roomState(c) {
    if (c && (c.mentions || 0) > 0) return 'mentioned';
    if (c && (c.unread || 0) > 0) return 'unread';
    return 'quiet';
  }

  const api = { allowedModes, mentionQuery, mentionMatches, insertMention, roomState };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.acomsChatRooms = api;
})(typeof window !== 'undefined' ? window : this);
