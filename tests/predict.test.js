import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, learnInterval, itemStatus, purchaseTimes } from '../js/predict.js';

const t0 = new Date('2026-01-01T10:00:00').getTime();
const buys = (...days) => Object.fromEntries(days.map((d, i) => [`p${i}`, { itemId: 'x', at: t0 + d * DAY }]));

test('no history keeps the guess', () => {
  assert.deepEqual(learnInterval(7, []), { interval: 7, samples: 0 });
});

test('learns a real 4-day rhythm when guess was 3', () => {
  const times = [0, 4, 8, 12, 16, 20].map((d) => t0 + d * DAY);
  const { interval, samples } = learnInterval(3, times);
  assert.equal(samples, 5);
  assert.ok(interval >= 3.5 && interval <= 4, `got ${interval}`);
});

test('a single long gap (vacation) does not explode the estimate', () => {
  const times = [0, 3, 6, 36, 39].map((d) => t0 + d * DAY);
  const { interval } = learnInterval(3, times);
  assert.ok(interval < 8, `got ${interval}`);
});

test('a very wrong guess still converges with repeated evidence', () => {
  const times = Array.from({ length: 10 }, (_, i) => t0 + i * 14 * DAY);
  const { interval } = learnInterval(3, times);
  assert.ok(interval >= 11, `got ${interval}`);
});

test('taps in the same trip count once', () => {
  const p = { a: { itemId: 'x', at: t0 }, b: { itemId: 'x', at: t0 + 60000 }, c: { itemId: 'x', at: t0 + 2 * DAY } };
  assert.equal(purchaseTimes(p, 'x').length, 2);
});

test('deleted purchases are ignored', () => {
  const p = { a: { itemId: 'x', at: t0 }, b: { itemId: 'x', at: t0 + 2 * DAY, deleted: true } };
  assert.equal(purchaseTimes(p, 'x').length, 1);
});

test('status: due, soon, ok, needed, none', () => {
  const item = { id: 'x', mode: 'auto', interval: 3, baselineAt: 0 };
  const p = buys(0);
  assert.equal(itemStatus(item, p, t0 + 3 * DAY, 2).kind, 'due');
  assert.equal(itemStatus(item, p, t0 + 2 * DAY, 2).kind, 'soon');
  assert.equal(itemStatus({ ...item, interval: 14 }, p, t0 + 2 * DAY, 2).kind, 'ok');
  assert.equal(itemStatus({ ...item, needed: true }, p, t0, 2).kind, 'needed');
  assert.equal(itemStatus({ ...item, mode: 'none' }, p, t0 + 99 * DAY, 2).kind, 'none');
});

test('snooze pushes the due date', () => {
  const item = { id: 'x', mode: 'fixed', interval: 3, snoozeUntil: t0 + 5 * DAY };
  assert.equal(itemStatus(item, buys(0), t0 + 4 * DAY, 0).kind, 'ok');
  assert.equal(itemStatus(item, buys(0), t0 + 5 * DAY, 0).kind, 'due');
});

test('baseline counts as last stock date before any purchase', () => {
  const item = { id: 'x', mode: 'auto', interval: 7, baselineAt: t0 };
  const st = itemStatus(item, {}, t0 + 3 * DAY, 2);
  assert.equal(st.daysLeft, 4);
  assert.equal(st.kind, 'ok');
});
