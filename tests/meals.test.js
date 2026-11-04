import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, itemStatus } from '../js/predict.js';
import { mealReadiness, lowNames } from '../js/meals.js';

const t0 = new Date('2026-03-01T10:00:00').getTime();
const at = (d) => t0 + d * DAY;
// daysLeft = cycle - ago
const mk = (id, cycle, ago, extra = {}) => ({ id, name: id, mode: 'fixed', interval: cycle, baselineAt: at(-100), ...extra });
const buys = (...defs) => Object.fromEntries(defs.map(([id, ago]) => [`p-${id}`, { id: `p-${id}`, itemId: id, at: at(-ago) }]));

function setup(defs, bought) {
  const items = Object.fromEntries(defs.map((i) => [i.id, i]));
  const purchases = buys(...bought);
  return { items, statusOf: (it) => itemStatus(it, purchases, at(0), 2) };
}

test('ready when no ingredient is low', () => {
  const { items, statusOf } = setup([mk('a', 10, 1), mk('b', 10, 2)], [['a', 1], ['b', 2]]);
  const r = mealReadiness({ items: ['a', 'b'] }, items, statusOf);
  assert.equal(r.ready, true);
  assert.equal(r.total, 2);
  assert.equal(r.low.length, 0);
});

test('low counts running low (within the window) and on-list items, not items with time left', () => {
  const { items, statusOf } = setup(
    [mk('ok', 10, 1), mk('soon', 10, 8), mk('out', 10, 12), mk('flag', 10, 1, { needed: true })],
    [['ok', 1], ['soon', 8], ['out', 12], ['flag', 1]],
  );
  const r = mealReadiness({ items: ['ok', 'soon', 'out', 'flag'] }, items, statusOf);
  assert.deepEqual(r.low.map((i) => i.item.id), ['soon', 'out', 'flag']);
  assert.equal(r.ready, false);
});

test('Add N counts only low ingredients that are not on the list yet', () => {
  const { items, statusOf } = setup(
    [mk('soon1', 10, 8), mk('soon2', 10, 9), mk('out', 10, 12), mk('flag', 10, 1, { needed: true })],
    [['soon1', 8], ['soon2', 9], ['out', 12], ['flag', 1]],
  );
  const r = mealReadiness({ items: ['soon1', 'soon2', 'out', 'flag'] }, items, statusOf);
  assert.equal(r.low.length, 4);
  assert.deepEqual(r.addable.map((i) => i.item.id), ['soon1', 'soon2']); // out + flag are already listed
  assert.equal(r.allListed, false);
});

test('when every low ingredient is already on the list, there is nothing to add', () => {
  const { items, statusOf } = setup([mk('out', 10, 12), mk('flag', 10, 1, { needed: true }), mk('ok', 10, 1)], [['out', 12], ['flag', 1], ['ok', 1]]);
  const r = mealReadiness({ items: ['out', 'flag', 'ok'] }, items, statusOf);
  assert.equal(r.addable.length, 0);
  assert.equal(r.allListed, true);
  assert.equal(r.ready, false);
});

test('as-needed ingredients are never low, deleted and missing ones are ignored', () => {
  const { items, statusOf } = setup([{ id: 'n', name: 'n', mode: 'none', baselineAt: at(-100) }, mk('gone', 10, 12, { deleted: true })], [['gone', 12]]);
  const r = mealReadiness({ items: ['n', 'gone', 'missing-id'] }, items, statusOf);
  assert.equal(r.total, 1);
  assert.equal(r.ready, true);
});

test('a meal with no ingredients is not "ready"', () => {
  const r = mealReadiness({ items: [] }, {}, () => ({}));
  assert.equal(r.ready, false);
  assert.equal(r.total, 0);
});

test('adding twice cannot list an item twice: addable shrinks to zero after the first add', () => {
  const { items, statusOf } = setup([mk('soon', 10, 8)], [['soon', 8]]);
  assert.equal(mealReadiness({ items: ['soon'] }, items, statusOf).addable.length, 1);
  items.soon.needed = true; // what the Add button does
  const after = mealReadiness({ items: ['soon'] }, items, statusOf);
  assert.equal(after.addable.length, 0);
  assert.equal(after.allListed, true);
});

test('lowNames shows three names then +N', () => {
  const low = ['Bread', 'Cream cheese', 'Coffee', 'Eggs', 'Milk'].map((name) => ({ item: { name } }));
  assert.equal(lowNames(low), 'Bread, Cream cheese, Coffee +2');
  assert.equal(lowNames(low.slice(0, 2)), 'Bread, Cream cheese');
  assert.equal(lowNames(low.slice(0, 3)), 'Bread, Cream cheese, Coffee');
});
