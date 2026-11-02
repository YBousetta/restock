import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeState, sameState } from '../js/merge.js';
import { buildSeed } from '../js/seed.js';

test('two independently seeded phones produce identical data', () => {
  assert.ok(sameState(buildSeed(), buildSeed()));
  assert.ok(sameState(mergeState(buildSeed(), buildSeed()), buildSeed()));
});

test('seed has no duplicate ids and meals point at real items', () => {
  const s = buildSeed();
  for (const m of Object.values(s.meals)) for (const id of m.items) assert.ok(s.items[id], `${m.name}: missing ${id}`);
  for (const i of Object.values(s.items)) assert.ok(s.categories[i.cat], `${i.name}: bad category ${i.cat}`);
});

test('concurrent edits on different records both survive', () => {
  const a = buildSeed();
  const b = buildSeed();
  a.purchases.p1 = { id: 'p1', itemId: 'i_milk', at: 1000, updatedAt: 1000 };
  b.purchases.p2 = { id: 'p2', itemId: 'i_bread', at: 1001, updatedAt: 1001 };
  b.items.i_eggs = { ...b.items.i_eggs, needed: true, updatedAt: 1002 };
  const m = mergeState(a, b);
  assert.ok(m.purchases.p1 && m.purchases.p2);
  assert.equal(m.items.i_eggs.needed, true);
  assert.ok(sameState(m, mergeState(b, a)), 'merge is order independent');
});

test('newer edit of the same record wins, deletes propagate', () => {
  const a = buildSeed();
  const b = buildSeed();
  a.items.i_milk = { ...a.items.i_milk, interval: 4, updatedAt: 2000 };
  b.items.i_milk = { ...b.items.i_milk, deleted: true, updatedAt: 3000 };
  assert.equal(mergeState(a, b).items.i_milk.deleted, true);
});
