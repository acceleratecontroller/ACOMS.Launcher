'use strict';

// Pure: the Task Manager's rules, for the Launcher's local Tasks window
// (Dion, 2026-10-19: "like how chat is ... a real proper app ... the main
// point is speed"). Loaded by tasks.html as a plain script
// (window.acomsTasksRules), by tasks.js in the main process, and by the tests
// through require.
//
// Every rule here is a copy of what ACOMS.Controller's /tasks page does
// (apps/todo/src/app/tasks/page.tsx + types.ts + TaskRow.tsx), so the window
// and the page show the same list in the same order. Change one, change both.

(function (root) {
  // ── Dates (local calendar days, as the page judges them) ───────────────────

  function dateOnly(value) {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function today(now) {
    return dateOnly(now === undefined ? Date.now() : now);
  }

  function isOverdue(value, now) {
    return Boolean(value) && dateOnly(value) < today(now);
  }

  function isDueToday(value, now) {
    return Boolean(value) && dateOnly(value).getTime() === today(now).getTime();
  }

  // Within the next 7 days, not counting today.
  function isDueSoon(value, now) {
    if (!value) return false;
    const d = dateOnly(value);
    const t = today(now);
    const week = new Date(t);
    week.setDate(week.getDate() + 7);
    return d > t && d <= week;
  }

  // "2026-10-19" for a date input, from a stored date or a Date.
  function isoDay(value) {
    if (!value) return '';
    const d = dateOnly(value);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function tomorrowIso(now) {
    const t = today(now);
    t.setDate(t.getDate() + 1);
    return isoDay(t);
  }

  // 19/10/26, as the page writes it.
  function shortDate(value) {
    if (!value) return '';
    return dateOnly(value).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: '2-digit' });
  }

  function groupLabel(value, now) {
    const d = dateOnly(value);
    const t = today(now);
    const diff = Math.round((d - t) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ── Quick Tasks ────────────────────────────────────────────────────────────

  const STATUS_OPTIONS = [
    { value: 'NOT_STARTED', label: 'Not Started' },
    { value: 'IN_PROGRESS', label: 'In Progress' },
    { value: 'STUCK', label: 'Stuck' },
    { value: 'AWAITING_RESPONSE', label: 'Awaiting Response' },
    { value: 'COMPLETED', label: 'Completed' }
  ];

  const PRIORITY_OPTIONS = [
    { value: 'LOW', label: 'Low' },
    { value: 'MEDIUM', label: 'Medium' },
    { value: 'HIGH', label: 'High' }
  ];

  function statusLabel(status) {
    const hit = STATUS_OPTIONS.find((o) => o.value === status);
    return hit ? hit.label : status;
  }

  const done = (t) => t.status === 'COMPLETED';

  // The page's filter chips: overdue / due-today / due-soon / pending /
  // completed / high, or "all" (open tasks; every task when showing archived).
  function filterTasks(tasks, { filter = 'all', owner = '', archived = false } = {}, now) {
    return tasks.filter((t) => {
      let match;
      switch (filter) {
        case 'pending': match = !done(t); break;
        case 'completed': match = done(t); break;
        case 'overdue': match = !done(t) && isOverdue(t.dueDate, now); break;
        case 'due-today': match = !done(t) && isDueToday(t.dueDate, now); break;
        case 'due-soon': match = !done(t) && isDueSoon(t.dueDate, now) && !isDueToday(t.dueDate, now); break;
        case 'high': match = t.priority === 'HIGH'; break;
        default: match = archived ? true : !done(t);
      }
      if (owner && t.assigneeId !== owner) match = false;
      return match;
    });
  }

  // Overdue first, then by due date, undated last; one group per day.
  function groupTasks(tasks, now) {
    const sorted = [...tasks].sort((a, b) => {
      const ao = !done(a) && isOverdue(a.dueDate, now);
      const bo = !done(b) && isOverdue(b.dueDate, now);
      if (ao !== bo) return ao ? -1 : 1;
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
    const groups = [];
    let lastKey = null;
    for (const t of sorted) {
      const key = t.dueDate ? isoDay(t.dueDate) : 'no-date';
      if (key !== lastKey) {
        groups.push({ label: key === 'no-date' ? 'No Due Date' : groupLabel(t.dueDate, now), tasks: [] });
        lastKey = key;
      }
      groups[groups.length - 1].tasks.push(t);
    }
    return groups;
  }

  // The single due pill on a row: { text, tone } with tone one of
  // done / none / overdue / today / soon / later.
  function duePill(task, now) {
    if (done(task)) return { text: 'Completed', tone: 'done' };
    if (!task.dueDate) return { text: 'No date', tone: 'none' };
    if (isOverdue(task.dueDate, now)) return { text: `Overdue · ${shortDate(task.dueDate)}`, tone: 'overdue' };
    if (isDueToday(task.dueDate, now)) return { text: 'Due Today', tone: 'today' };
    if (isDueSoon(task.dueDate, now)) return { text: `Due ${shortDate(task.dueDate)}`, tone: 'soon' };
    return { text: `Due ${shortDate(task.dueDate)}`, tone: 'later' };
  }

  // The tab's badges: open tasks overdue, due today, due in the week.
  function taskBadges(tasks, now) {
    const open = tasks.filter((t) => !t.isArchived && !done(t));
    return {
      overdue: open.filter((t) => isOverdue(t.dueDate, now)).length,
      dueToday: open.filter((t) => isDueToday(t.dueDate, now)).length,
      dueSoon: open.filter((t) => isDueSoon(t.dueDate, now) && !isDueToday(t.dueDate, now)).length
    };
  }

  // ── ACOMS Tasks (the company queue) ────────────────────────────────────────
  // CompanyTaskRow.tsx + the page's companyBadges / visibleCompanyTasks.

  // The assignee of an UNCLAIMED company task (Controller modules/tasks/constants.ts).
  const COMPANY_ASSIGNEE_ID = 'acoms-company';

  const CATEGORY_LABELS = {
    GENERAL: 'General',
    GIS_VIEW_REQUEST: 'GIS view needed',
    JOB_APPROVAL: 'Job approval',
    JOB_FINISH: 'Finish job',
    CERT_EXPIRY: 'Certificate expiring',
    ASSET_EXPIRY: 'Asset expiring',
    CONTRACT_EXPIRY: 'Contract expiring',
    MAIL_FOLLOWUP: 'Email follow-up',
    DIAL_LODGE: 'Dials to lodge',
    DIAL_EXPIRY: 'Dial expiring'
  };

  const SOURCE_LABELS = {
    'acoms-wip': 'WIP',
    'acoms-gis': 'GIS',
    'acoms-os': 'OS',
    'acoms-email': 'Email',
    'mail-intake': 'Requests inbox',
    'claude-terminal': 'Claude'
  };

  function isUnclaimed(task) {
    return task.assigneeId === COMPANY_ASSIGNEE_ID;
  }

  // As the Quick Tasks pill, with the queue's own wording ("Done", "Due today").
  function companyDuePill(task, now) {
    if (done(task)) return { text: 'Done', tone: 'done' };
    const p = duePill(task, now);
    return p.tone === 'today' ? { text: 'Due today', tone: 'today' } : p;
  }

  function companyBadges(company, myId) {
    const open = (company || []).filter((t) => !t.isArchived && !done(t));
    return {
      unclaimed: open.filter(isUnclaimed).length,
      mine: myId ? open.filter((t) => t.assigneeId === myId).length : 0
    };
  }

  // filter: all | unclaimed | mine | dismissed. Unclaimed first (newest on
  // top), then claimed, then done when shown; "Not needed" newest dismissed first.
  function visibleCompany(company, dismissed, { filter = 'all', showDone = false, myId = null } = {}) {
    if (filter === 'dismissed') {
      return [...(dismissed || [])].sort((a, b) => ((b.archivedAt || '') > (a.archivedAt || '') ? 1 : -1));
    }
    const rank = (t) => (done(t) ? 2 : isUnclaimed(t) ? 0 : 1);
    return (company || [])
      .filter((t) => showDone || !done(t))
      .filter((t) =>
        filter === 'unclaimed' ? isUnclaimed(t) : filter === 'mine' ? Boolean(myId) && t.assigneeId === myId : true
      )
      .sort((a, b) => rank(a) - rank(b) || (b.createdAt > a.createdAt ? 1 : -1));
  }

  // ── Recurring Tasks ────────────────────────────────────────────────────────
  // RecurringTaskRow.tsx + the page's filteredRecurring / groupedRecurring.

  const FREQUENCY_OPTIONS = [
    { value: 'DAILY', label: 'Daily (Mon–Fri)' },
    { value: 'WEEKLY', label: 'Weekly' },
    { value: 'FORTNIGHTLY', label: 'Fortnightly' },
    { value: 'MONTHLY', label: 'Monthly' },
    { value: 'QUARTERLY', label: 'Quarterly' },
    { value: 'YEARLY', label: 'Yearly' }
  ];

  const SCHEDULE_OPTIONS = [
    { value: 'FLOATING', label: 'Floating (from completion date)' },
    { value: 'FIXED', label: 'Fixed (anchored schedule)' }
  ];

  const RECURRING_CATEGORY_OPTIONS = ['Task', 'Meeting', 'Report', 'Inspection', 'Maintenance'].map((v) => ({
    value: v,
    label: v
  }));

  function frequencyLabel(type, value) {
    const hit = FREQUENCY_OPTIONS.find((o) => o.value === type);
    const label = hit ? hit.label : type;
    return value === 1 ? label : `Every ${value} ${label.toLowerCase()}`;
  }

  // filter: all | overdue | due-today | due-soon | on-track; owner '' = everyone.
  function filterRecurring(list, { filter = 'all', owner = '' } = {}, now) {
    const filtered = (list || []).filter((t) => {
      let match = true;
      switch (filter) {
        case 'overdue': match = isOverdue(t.nextDue, now); break;
        case 'due-today': match = isDueToday(t.nextDue, now); break;
        case 'due-soon': match = isDueSoon(t.nextDue, now) && !isDueToday(t.nextDue, now); break;
        case 'on-track':
          match = !isOverdue(t.nextDue, now) && !isDueToday(t.nextDue, now) && !isDueSoon(t.nextDue, now);
          break;
        default: break;
      }
      if (owner && t.assigneeId !== owner) match = false;
      return match;
    });
    return filtered.sort((a, b) => {
      const ao = isOverdue(a.nextDue, now);
      const bo = isOverdue(b.nextDue, now);
      if (ao !== bo) return ao ? -1 : 1;
      if (!a.nextDue && !b.nextDue) return 0;
      if (!a.nextDue) return 1;
      if (!b.nextDue) return -1;
      return new Date(a.nextDue) - new Date(b.nextDue);
    });
  }

  // Already sorted (filterRecurring): one group per next-due day.
  function groupRecurring(sorted, now) {
    const groups = [];
    let lastKey = null;
    for (const t of sorted) {
      const key = t.nextDue ? isoDay(t.nextDue) : 'no-date';
      if (key !== lastKey) {
        groups.push({ label: key === 'no-date' ? 'No Due Date' : groupLabel(t.nextDue, now), tasks: [] });
        lastKey = key;
      }
      groups[groups.length - 1].tasks.push(t);
    }
    return groups;
  }

  // The row's status pill: On Track / Overdue Nd / Due Today / Due Soon.
  function recurringStatus(task, now) {
    if (isOverdue(task.nextDue, now)) {
      const days = Math.round((today(now) - dateOnly(task.nextDue)) / 86400000);
      return { text: `Overdue ${days}d`, tone: 'overdue' };
    }
    if (isDueToday(task.nextDue, now)) return { text: 'Due Today', tone: 'today' };
    if (isDueSoon(task.nextDue, now)) return { text: 'Due Soon', tone: 'soon' };
    return { text: 'On Track', tone: 'done' };
  }

  function recurringBadges(list, now) {
    const active = (list || []).filter((t) => !t.isArchived);
    return {
      overdue: active.filter((t) => isOverdue(t.nextDue, now)).length,
      dueToday: active.filter((t) => isDueToday(t.nextDue, now)).length,
      dueSoon: active.filter((t) => isDueSoon(t.nextDue, now) && !isDueToday(t.nextDue, now)).length
    };
  }

  // The calendar view (RecurringCalendar.tsx): 6 weeks from the Sunday on or
  // before the 1st of `month`, each day with the tasks next due on it.
  function calendarDays(list, year, month, now) {
    const first = new Date(year, month, 1);
    const start = new Date(first);
    start.setDate(start.getDate() - first.getDay());
    const t = today(now).getTime();
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = isoDay(d);
      days.push({
        date: d,
        inMonth: d.getMonth() === month,
        isToday: d.getTime() === t,
        tasks: (list || []).filter((x) => x.nextDue && isoDay(x.nextDue) === key)
      });
    }
    return days;
  }

  // ── Quick Notes ────────────────────────────────────────────────────────────

  // Pinned first (most recently pinned on top), then most recently edited.
  function sortNotes(notes) {
    return [...notes].sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });
  }

  // ── People ─────────────────────────────────────────────────────────────────

  function assigneeName(a) {
    return a ? `${a.firstName} ${a.lastName}`.trim() : '';
  }

  // Me, as an OS employee: the assignee whose identity is mine (how the page
  // defaults its owner filter to "my tasks").
  function myEmployeeId(assignees, me) {
    if (!me || !me.identityId) return null;
    const hit = (assignees || []).find((a) => a.identityId === me.identityId);
    return hit ? hit.id : null;
  }

  // ── Instant writes ─────────────────────────────────────────────────────────
  // A click shows on screen at once; the server's answer (the next sync) is
  // the truth. Each returns a NEW state object, the old one untouched, so a
  // failed write can be rolled back by keeping the previous state.

  function patchList(list, id, change) {
    return (list || []).map((x) => (x.id === id ? { ...x, ...change } : x));
  }

  function applyOptimistic(state, action) {
    const s = { ...state };
    switch (action.type) {
      // A placeholder row until the server's answer brings the real one.
      case 'task:create':
        s.quick = [
          {
            id: `pending-${Date.now()}`,
            isArchived: false,
            createdAt: new Date().toISOString(),
            sourceEmailThreadId: null,
            ...(action.fields || {}),
            _pending: true
          },
          ...(s.quick || [])
        ];
        break;
      case 'task:complete': {
        const t = (s.quick || []).find((x) => x.id === action.id);
        if (t) s.quick = patchList(s.quick, action.id, { status: done(t) ? 'NOT_STARTED' : 'COMPLETED' });
        break;
      }
      case 'task:update':
        s.quick = patchList(s.quick, action.id, action.fields || {});
        break;
      case 'task:archive':
        s.quick = (s.quick || []).filter((x) => x.id !== action.id);
        break;
      case 'note:update':
        s.notes = patchList(s.notes, action.id, { content: action.content, updatedAt: new Date().toISOString() });
        break;
      case 'note:pin': {
        const n = (s.notes || []).find((x) => x.id === action.id);
        if (n) s.notes = patchList(s.notes, action.id, { isPinned: !n.isPinned, pinnedAt: n.isPinned ? null : new Date().toISOString() });
        break;
      }
      case 'note:archive':
      case 'note:discard':
        s.notes = (s.notes || []).filter((x) => x.id !== action.id);
        break;
      // Company tasks: `action.me` is my employee id (what a claim writes).
      case 'company:claim':
        s.company = patchList(s.company, action.id, {
          assigneeId: action.me || COMPANY_ASSIGNEE_ID,
          claimedAt: new Date().toISOString(),
          status: 'NOT_STARTED'
        });
        break;
      case 'company:release':
        s.company = patchList(s.company, action.id, { assigneeId: COMPANY_ASSIGNEE_ID, claimedAt: null });
        break;
      case 'company:done':
        s.company = patchList(s.company, action.id, { status: 'COMPLETED', completedAt: new Date().toISOString() });
        break;
      case 'company:dismiss': {
        const t = (s.company || []).find((x) => x.id === action.id);
        s.company = (s.company || []).filter((x) => x.id !== action.id);
        if (t) {
          s.dismissed = [
            { ...t, isArchived: true, archivedAt: new Date().toISOString(), archivedById: action.me || null, closedReason: action.reason || null },
            ...(s.dismissed || [])
          ];
        }
        break;
      }
      case 'recurring:create':
        s.recurring = [
          { id: `pending-${Date.now()}`, isArchived: false, nextDue: null, lastCompleted: null, ...(action.fields || {}), _pending: true },
          ...(s.recurring || [])
        ];
        break;
      case 'recurring:update':
        s.recurring = patchList(s.recurring, action.id, action.fields || {});
        break;
      // The next due date is the server's sum (recurrence.ts); only "done today" shows now.
      case 'recurring:complete':
        s.recurring = patchList(s.recurring, action.id, { lastCompleted: new Date().toISOString(), _pending: true });
        break;
      case 'recurring:archive':
        s.recurring = (s.recurring || []).filter((x) => x.id !== action.id);
        break;
      default:
        break;
    }
    return s;
  }

  // ── Polling ────────────────────────────────────────────────────────────────
  // Fast while the window is in front, slower while it is merely open, and a
  // gentle background pace otherwise (enough for the overdue badge). A failure
  // backs off so a dead network isn't hammered.
  function pollIntervalMs({ windowOpen, windowFocused, status }) {
    if (status === 'signIn') return 60 * 1000;
    if (status === 'error') return 30 * 1000;
    if (windowOpen && windowFocused) return 4 * 1000;
    if (windowOpen) return 10 * 1000;
    return 60 * 1000;
  }

  // ── Links ──────────────────────────────────────────────────────────────────

  // The ACOMS.Email thread a task was made from (TaskRow's "View source email").
  function sourceEmailUrl(task, emailBase) {
    if (!emailBase || !task || !task.sourceEmailThreadId) return null;
    return `${emailBase.replace(/\/$/, '')}/threads/${encodeURIComponent(task.sourceEmailThreadId)}`;
  }

  // "A1174 · 70256 · Smith St" -> "A1174": the job a task is tagged with.
  function jobNumberOf(projectRef) {
    const m = /\b([Aa]\d{4}[A-Za-z]?)\b/.exec(String(projectRef || ''));
    return m ? m[1].toUpperCase() : null;
  }

  // What the WIP job search returns, as the page stores it in Task.projectId:
  // ACOMS number, client ref (when different), job name.
  function wipJobRef(j) {
    const parts = [j.acomsNumberFormatted];
    const clientRef = j.clientReferenceNumber ? String(j.clientReferenceNumber).trim() : '';
    if (clientRef && clientRef.toUpperCase() !== String(j.acomsNumberFormatted).toUpperCase()) parts.push(clientRef);
    if (j.name) parts.push(j.name);
    return parts.join(' · ');
  }

  const api = {
    STATUS_OPTIONS,
    PRIORITY_OPTIONS,
    statusLabel,
    isOverdue,
    isDueToday,
    isDueSoon,
    isoDay,
    tomorrowIso,
    shortDate,
    groupLabel,
    filterTasks,
    groupTasks,
    duePill,
    taskBadges,
    COMPANY_ASSIGNEE_ID,
    CATEGORY_LABELS,
    SOURCE_LABELS,
    isUnclaimed,
    companyDuePill,
    companyBadges,
    visibleCompany,
    FREQUENCY_OPTIONS,
    SCHEDULE_OPTIONS,
    RECURRING_CATEGORY_OPTIONS,
    frequencyLabel,
    filterRecurring,
    groupRecurring,
    recurringStatus,
    recurringBadges,
    calendarDays,
    sortNotes,
    assigneeName,
    myEmployeeId,
    applyOptimistic,
    pollIntervalMs,
    sourceEmailUrl,
    jobNumberOf,
    wipJobRef
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.acomsTasksRules = api;
})(typeof window !== 'undefined' ? window : this);
