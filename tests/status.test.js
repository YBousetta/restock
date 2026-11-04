import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, itemStatus, formatAgo, formatUsually } from '../js/predict.js';

const t0 = new Date('2026-03-01T10:00:00').getTime();
const at = (d) => t0 + d * DAY;
const buy = (itemId, ...days) => Object.fromEntries(days.map((d, i) => [`p${i}`, { id: `p${i}`, itemId, at: at(d) }]));
const reg = (o = {}) => ({ id: 'x', mode: 'fixed', interval: 5, baselineAt: at(-30), ...o });

test('daysLeft counts calendar days from the last purchase', () => {
  const st = itemStatus(reg(), buy('x', 0), at(2));
  assert.equal(st.daysLeft, 3);
  assert.equal(st.state, 'ok');
  assert.equal(st.daysSinceBought, 2);
  assert.equal(st.cycleDays, 5);
  assert.equal(st.purchaseCount, 1);
});

test('state: ok, due_soon (within the window), in_list when it runs out', () => {
  const p = buy('x', 0);
  assert.equal(itemStatus(reg(), p, at(2), 2).state, 'ok'); //   3 days left
  assert.equal(itemStatus(reg(), p, at(3), 2).state, 'due_soon'); // 2 days left
  assert.equal(itemStatus(reg(), p, at(4), 2).state, 'due_soon'); // 1 day left
  assert.equal(itemStatus(reg(), p, at(5), 2).state, 'in_list'); //  0 days left
  assert.equal(itemStatus(reg(), p, at(9), 2).state, 'in_list'); //  overdue
});

test('in_list takes precedence over everything else', () => {
  const flagged = reg({ needed: true });
  assert.equal(itemStatus(flagged, buy('x', 0), at(0)).state, 'in_list'); //   would be ok
  assert.equal(itemStatus(flagged, buy('x', 0), at(4)).state, 'in_list'); //   would be due_soon
  assert.equal(itemStatus({ id: 'n', mode: 'none', needed: true }, {}, at(0)).state, 'in_list');
});

test('as needed items are never predicted', () => {
  const st = itemStatus({ id: 'n', mode: 'none', interval: 7 }, buy('n', 0), at(40));
  assert.equal(st.state, 'as_needed');
  assert.equal(st.daysLeft, null);
  assert.equal(st.cycleDays, null);
  assert.equal(st.daysSinceBought, 40);
});

test('never bought: daysSinceBought is null, countdown starts at the baseline', () => {
  const st = itemStatus(reg({ baselineAt: at(0) }), {}, at(1));
  assert.equal(st.daysSinceBought, null);
  assert.equal(st.daysLeft, 4);
});

test('snooze expires: deck snooze and the older list snooze both count until their time', () => {
  const a = reg({ snoozedUntil: at(3) });
  assert.equal(itemStatus(a, buy('x', 0), at(2)).snoozed, true);
  assert.equal(itemStatus(a, buy('x', 0), at(3)).snoozed, false); // expired exactly at the time
  assert.equal(itemStatus(a, buy('x', 0), at(4)).snoozed, false);
  const b = reg({ snoozeUntil: at(3) });
  assert.equal(itemStatus(b, buy('x', 0), at(2)).snoozed, true);
  assert.equal(itemStatus(b, buy('x', 0), at(4)).snoozed, false);
});

test('the deck snooze never moves the countdown', () => {
  const plain = itemStatus(reg(), buy('x', 0), at(1));
  const snoozed = itemStatus(reg({ snoozedUntil: at(40) }), buy('x', 0), at(1));
  assert.equal(snoozed.daysLeft, plain.daysLeft);
  assert.equal(snoozed.state, plain.state);
});

test('legacy kind stays in step with state', () => {
  const map = { needed: 'in_list', due: 'in_list', soon: 'due_soon', ok: 'ok', none: 'as_needed' };
  for (const day of [0, 2, 3, 4, 5, 8]) {
    const st = itemStatus(reg(), buy('x', 0), at(day), 2);
    assert.equal(map[st.kind], st.state);
  }
});

test('formatAgo and formatUsually', () => {
  assert.deepEqual([0, 1, 5, 8, 14, 21, 59, 60, 400].map(formatAgo),
    ['today', 'yesterday', '5 days ago', '8 days ago', '2 weeks ago', '3 weeks ago', '8 weeks ago', '2 months ago', '13 months ago']);
  assert.deepEqual([3, 7, 14, 30, 21].map(formatUsually), ['every 3 days', 'every week', 'every 2 weeks', 'every month', 'every 3 weeks']);
});
