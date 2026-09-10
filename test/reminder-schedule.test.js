'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_SLOTS,
  localDayKey,
  planDay,
  dueSlots,
  planIsStale,
  nextFireAt
} = require('../src/reminder-schedule');

// A fixed local moment to build days around.
function local(y, m, d, hh = 0, mm = 0) {
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

function minuteOf(epochMs) {
  const d = new Date(epochMs);
  return d.getHours() * 60 + d.getMinutes();
}

// ── Rolling the day ────────────────────────────────────────────────────────

test('a day gets two slots, morning and afternoon', () => {
  const plan = planDay(local(2026, 9, 10), { rng: () => 0.5 });

  assert.strictEqual(plan.day, '2026-09-10');
  assert.deepStrictEqual(plan.slots.map((s) => s.id), ['morning', 'afternoon']);
  assert.ok(plan.slots.every((s) => s.fired === false));
});

test('each slot lands inside its own window', () => {
  for (const r of [0, 0.25, 0.5, 0.75, 1]) {
    const plan = planDay(local(2026, 9, 10), { rng: () => r });
    for (const [i, slot] of plan.slots.entries()) {
      const m = minuteOf(slot.at);
      assert.ok(
        m >= DEFAULT_SLOTS[i].fromMinute && m <= DEFAULT_SLOTS[i].toMinute,
        `rng=${r} slot=${slot.id} minute=${m} outside window`
      );
    }
  }
});

// The whole point of the randomness: 08:00 every day becomes furniture.
test('the time actually moves from day to day', () => {
  const seeds = [0.05, 0.31, 0.62, 0.87, 0.99];
  let i = 0;
  const times = seeds.map(() => {
    const plan = planDay(local(2026, 9, 10), { rng: () => seeds[i++] });
    return minuteOf(plan.slots[0].at);
  });

  assert.ok(new Set(times).size > 1, `expected varied times, got ${times}`);
});

test('a zero-width window still produces a valid time', () => {
  const plan = planDay(local(2026, 9, 10), {
    slots: [{ id: 'fixed', fromMinute: 9 * 60, toMinute: 9 * 60 }],
    rng: () => 0.9
  });

  assert.strictEqual(minuteOf(plan.slots[0].at), 9 * 60);
});

// ── What is due ────────────────────────────────────────────────────────────

test('nothing is due before its moment', () => {
  const plan = planDay(local(2026, 9, 10), { rng: () => 0.5 });

  assert.deepStrictEqual(dueSlots(plan, local(2026, 9, 10, 5, 0)), []);
});

test('a slot is due once its moment has passed', () => {
  const plan = planDay(local(2026, 9, 10), { rng: () => 0.5 });
  const due = dueSlots(plan, local(2026, 9, 10, 9, 0));

  assert.deepStrictEqual(due.map((s) => s.id), ['morning']);
});

test('both are due by the evening if neither fired', () => {
  const plan = planDay(local(2026, 9, 10), { rng: () => 0.5 });
  const due = dueSlots(plan, local(2026, 9, 10, 18, 0));

  assert.deepStrictEqual(due.map((s) => s.id), ['morning', 'afternoon']);
});

test('a slot that already fired is not due again', () => {
  const plan = planDay(local(2026, 9, 10), { rng: () => 0.5 });
  plan.slots[0].fired = true;

  assert.deepStrictEqual(dueSlots(plan, local(2026, 9, 10, 18, 0)).map((s) => s.id), [
    'afternoon'
  ]);
});

// A laptop opened at 9am must still hear about the 7am reminder.
test('a slot missed while the machine was off still fires on return', () => {
  const plan = planDay(local(2026, 9, 10), { rng: () => 0 });
  const due = dueSlots(plan, local(2026, 9, 10, 9, 30));

  assert.deepStrictEqual(due.map((s) => s.id), ['morning']);
});

// ── Quiet hours defer, never cancel ────────────────────────────────────────

test('quiet hours hold a slot back rather than dropping it', () => {
  const plan = planDay(local(2026, 9, 10), { rng: () => 0.5 });
  const quietUntil = local(2026, 9, 10, 9, 0).getTime();

  // Inside quiet hours: held.
  assert.deepStrictEqual(dueSlots(plan, local(2026, 9, 10, 8, 0), { quietUntil }), []);
  // Once they end: still owed, and delivered.
  assert.deepStrictEqual(
    dueSlots(plan, local(2026, 9, 10, 9, 1), { quietUntil }).map((s) => s.id),
    ['morning']
  );
});

// ── Rollover ───────────────────────────────────────────────────────────────

test('a plan is stale on the next local day', () => {
  const plan = planDay(local(2026, 9, 10), { rng: () => 0.5 });

  assert.strictEqual(planIsStale(plan, local(2026, 9, 10, 23, 59)), false);
  assert.strictEqual(planIsStale(plan, local(2026, 9, 11, 0, 1)), true);
  assert.strictEqual(planIsStale(null, local(2026, 9, 10)), true);
});

test('local day keys follow the person, not UTC', () => {
  assert.strictEqual(localDayKey(local(2026, 9, 10, 0, 30)), '2026-09-10');
  assert.strictEqual(localDayKey(local(2026, 9, 10, 23, 30)), '2026-09-10');
});

// ── Arming the timer ───────────────────────────────────────────────────────

test('the next fire time is the earliest slot still ahead', () => {
  const plan = planDay(local(2026, 9, 10), { rng: () => 0.5 });

  assert.strictEqual(nextFireAt(plan, local(2026, 9, 10, 0, 0)), plan.slots[0].at);
  assert.strictEqual(nextFireAt(plan, local(2026, 9, 10, 9, 0)), plan.slots[1].at);
  assert.strictEqual(nextFireAt(plan, local(2026, 9, 10, 20, 0)), null);
});

test('a fired slot is not something to wake up for', () => {
  const plan = planDay(local(2026, 9, 10), { rng: () => 0.5 });
  plan.slots[0].fired = true;

  assert.strictEqual(nextFireAt(plan, local(2026, 9, 10, 0, 0)), plan.slots[1].at);
});
