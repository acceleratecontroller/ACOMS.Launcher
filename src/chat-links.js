'use strict';

// Pure: which parts of a chat message become links. Loaded by chat.html as a
// plain script (window.acomsChatLinks) and by the tests through require.
//
// Two kinds of link:
//   - an http(s) URL, as typed;
//   - an ACOMS job number, A + four digits (A1174), optionally with one
//     letter after it (A1016B — a second GIS view of job A1016). Dion,
//     2026-09-25: "if i type into chat an A number ... it creates it as a
//     hyperlink so if the other person clicked it it'd open that job in
//     acoms.wip". It links to WIP's /jobs/<number> route, which finds the
//     job (the letter is ignored there) or says plainly that there is none —
//     the launcher cannot know which numbers exist, so every one is a link.
//
// A job number inside a URL stays part of the URL. Without a `jobLinkBase`
// (no "jobs" block in portals.json) job numbers are left as plain text.

(function (root) {
  const URL_RE = /(https?:\/\/[^\s<>"]+)/g;
  const JOB_RE = /\b([Aa]\d{4}[A-Za-z]?)\b/g;

  // "a1016b" -> "A1016B": what the link text keeps, and what the URL carries.
  function jobNumber(raw) {
    return raw.toUpperCase();
  }

  function splitJobs(text, jobLinkBase) {
    if (!jobLinkBase) return text ? [{ text }] : [];
    const out = [];
    let last = 0;
    for (const m of text.matchAll(JOB_RE)) {
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push({ text: m[0], href: jobLinkBase + encodeURIComponent(jobNumber(m[1])) });
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }

  // [{ text, href? }] in order; joining every `text` gives back the message.
  function splitMessage(text, jobLinkBase) {
    const out = [];
    for (const part of String(text).split(URL_RE)) {
      if (!part) continue;
      if (/^https?:\/\//.test(part)) out.push({ text: part, href: part });
      else out.push(...splitJobs(part, jobLinkBase));
    }
    return out;
  }

  // The base every job link starts with, from portals.json's chat.jobs
  // ({ portal, path }). Null when it isn't configured or names no portal.
  function jobLinkBaseFor(jobs, portals) {
    if (!jobs || typeof jobs.portal !== 'string') return null;
    const portal = (portals || []).find((p) => p.id === jobs.portal);
    if (!portal || typeof portal.url !== 'string') return null;
    const path = typeof jobs.path === 'string' && jobs.path.startsWith('/') ? jobs.path : '/jobs/';
    return portal.url.replace(/\/$/, '') + (path.endsWith('/') ? path : path + '/');
  }

  // The job numbers a message links to, in order, each once — what the job
  // cards under a message are drawn for. Same rule as the links: a number
  // inside a URL isn't one.
  function jobNumbersIn(text, jobLinkBase, max = 3) {
    if (!jobLinkBase) return [];
    const seen = [];
    for (const part of splitMessage(String(text || ''), jobLinkBase)) {
      if (!part.href || !part.href.startsWith(jobLinkBase)) continue;
      const n = jobNumber(part.text);
      if (!seen.includes(n)) seen.push(n);
      if (seen.length >= max) break;
    }
    return seen;
  }

  const api = { splitMessage, jobLinkBaseFor, jobNumbersIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.acomsChatLinks = api;
})(typeof window !== 'undefined' ? window : this);
