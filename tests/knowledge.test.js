import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guessCategory, guessItemIcon } from '../js/knowledge.js';
import { buildSeed } from '../js/seed.js';

test('guesses the right category for (almost) every starting item', () => {
  const items = Object.values(buildSeed().items);
  const wrong = items.filter((i) => {
    const g = guessCategory(i.name);
    return g && g !== i.cat;
  });
  assert.deepEqual(wrong.map((i) => `${i.name}: guessed ${guessCategory(i.name)}, is ${i.cat}`), []);
  const unknown = items.filter((i) => !guessCategory(i.name)).map((i) => i.name);
  assert.ok(unknown.length <= 6, `too many unknown: ${unknown.join(', ')}`);
});

test('common new items', () => {
  const cases = { Bananas: 'produce', 'Olive oil': 'pantry', 'Toilet cleaner': 'household', Shampoo: 'personal', 'Greek yogurt': 'dairy',
    Salmon: 'meat', 'Orange juice': 'drinks', 'Trash bags': 'household', 'Black pepper': 'spices', Lentils: 'pantry', Butter: 'dairy' };
  for (const [name, cat] of Object.entries(cases)) assert.equal(guessCategory(name), cat, name);
});

test('falls back to a catalog item sharing a word', () => {
  assert.equal(guessCategory('Melange bio', [{ name: 'Melange', cat: 'dairy' }]), 'dairy');
  assert.equal(guessCategory('xyz'), null);
});

test('icons', () => {
  assert.equal(guessItemIcon('Avocados'), '🥑');
  assert.equal(guessItemIcon('Toilet paper'), '🧻');
});

import { MEAL_IDEAS, NON_FOOD } from '../js/knowledge.js';
import { upgradeSeed, itemId } from '../js/seed.js';

test('every meal idea ingredient exists in the catalog and is food', () => {
  const items = buildSeed().items;
  for (const [cat, ideas] of Object.entries(MEAL_IDEAS)) {
    assert.equal(ideas.length, 3, cat);
    for (const [name, ings] of ideas)
      for (const n of ings) {
        const it = items[itemId(n)];
        assert.ok(it && !it.deleted, `${name}: missing ${n}`);
        assert.ok(!NON_FOOD.has(it.cat), `${name}: ${n} is not food`);
      }
  }
});

test('catalog upgrade removes vague untouched items but keeps edited or bought ones', () => {
  const s = buildSeed();
  assert.ok(s.items[itemId('Snacks')].deleted);
  assert.ok(s.items[itemId('Bananas')] && !s.items[itemId('Bananas')].deleted);
  // simulate an old phone: Snacks edited, USB cable bought
  const old = JSON.parse(JSON.stringify(s));
  old.items[itemId('Snacks')] = { ...old.items[itemId('Snacks')], deleted: false, updatedAt: 1000 };
  old.items[itemId('USB cable')] = { ...old.items[itemId('USB cable')], deleted: false, updatedAt: 1 };
  old.purchases.p1 = { id: 'p1', itemId: itemId('USB cable'), at: 5, updatedAt: 5 };
  upgradeSeed(old);
  assert.equal(old.items[itemId('Snacks')].deleted, false);
  assert.equal(old.items[itemId('USB cable')].deleted, false);
});

test('each category has at least 3 active items', () => {
  const items = Object.values(buildSeed().items).filter((i) => !i.deleted);
  for (const cat of ['produce', 'bakery', 'meat', 'dairy', 'breakfast', 'pantry', 'sauces', 'spices', 'snacks', 'drinks', 'household', 'personal', 'health'])
    assert.ok(items.filter((i) => i.cat === cat).length >= 3, cat);
});
