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
