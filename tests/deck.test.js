import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, itemStatus } from '../js/predict.js';
import {
  DECK_SIZE, LOOKAHEAD_DAYS, SNOOZE_DAYS, MIN_PURCHASES_AS_NEEDED,
  deckCandidates, newDeck, deckAnswer, deckUndo, deckSkip, deckSummary, deckDone, deckCurrent, suggestedCycle,
} from '../js/deck.js';

// The store reads and writes localStorage; give it an in-memory one under Node.
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const S = await import('../js/store.js');

const t0 = new Date('2026-03-01T10:00:00').getTime();
const at = (d) => t0 + d * DAY;
const NOW = at(0);

// A regular item bought `ago` days ago with a cycle of `cycle` days -> daysLeft = cycle - ago.
function regular(id, cycle, ago, extra = {}) {
  return { item: { id, name: id, mode: 'fixed', interval: cycle, baselineAt: at(-100), ...extra }, p: { [`${id}-p`]: { id: `${id}-p`, itemId: id, at: at(-ago) } } };
}
function asNeeded(id, buys, extra = {}) {
  const p = {};
  buys.forEach((d, i) => (p[`${id}-${i}`] = { id: `${id}-${i}`, itemId: id, at: at(-d) }));
  return { item: { id, name: id, mode: 'none', interval: 7, baselineAt: at(-100), ...extra }, p };
}
function entries(...defs) {
  const purchases = Object.assign({}, ...defs.map((d) => d.p));
  return defs.map((d) => ({ item: d.item, st: itemStatus(d.item, purchases, NOW, 2) }));
}
const ids = (list) => list.map((e) => e.item.id);

test('constants', () => {
  assert.deepEqual([DECK_SIZE, LOOKAHEAD_DAYS, SNOOZE_DAYS, MIN_PURCHASES_AS_NEEDED], [8, 7, 3, 3]);
});

test('regular items running out within the lookahead, soonest first', () => {
  const e = entries(regular('c', 10, 3), regular('a', 10, 6), regular('b', 10, 5)); // 7, 4, 5 days left
  assert.deepEqual(ids(deckCandidates(e).deck), ['a', 'b', 'c']);
});

test('excludes items further out than the lookahead, in the list, in Coming up and snoozed', () => {
  const e = entries(
    regular('far', 20, 1), //                       19 days left
    regular('edge', 10, 3), //                      7 days left: included
    regular('over', 10, 2), //                      8 days left: excluded
    regular('listed', 10, 5, { needed: true }), //  already on the list
    regular('runout', 10, 10), //                   ran out: on the list
    regular('coming', 10, 8), //                    2 days left: shown in Coming up
    regular('snoozed', 10, 6, { snoozedUntil: at(1) }),
    regular('oldsnooze', 10, 6, { snoozeUntil: at(1) }),
  );
  assert.deepEqual(ids(deckCandidates(e).deck), ['edge']);
});

test('a snooze that has expired lets the item back in', () => {
  const e = entries(regular('x', 10, 6, { snoozedUntil: at(0) })); // expires exactly now
  assert.deepEqual(ids(deckCandidates(e).deck), ['x']);
});

test('as-needed items need enough purchases, longest since last bought first, after regular ones', () => {
  const e = entries(
    asNeeded('few', [30, 60]), //          2 purchases: excluded
    asNeeded('recent', [5, 40, 70]), //     5 days
    asNeeded('old', [60, 90, 120]), //      60 days
    asNeeded('inlist', [60, 90, 120], { needed: true }),
    asNeeded('snoozed', [60, 90, 120], { snoozedUntil: at(2) }),
    regular('reg', 10, 5),
  );
  assert.deepEqual(ids(deckCandidates(e).deck), ['reg', 'old', 'recent']);
});

test('taps in the same trip count once toward the purchase minimum', () => {
  const p = { a: { id: 'a', itemId: 'n', at: at(-9) }, b: { id: 'b', itemId: 'n', at: at(-9) + 60000 }, c: { id: 'c', itemId: 'n', at: at(-30) } };
  const item = { id: 'n', name: 'n', mode: 'none', baselineAt: at(-100) };
  assert.equal(itemStatus(item, p, NOW).purchaseCount, 2);
  assert.deepEqual(ids(deckCandidates([{ item, st: itemStatus(item, p, NOW) }]).deck), []);
});

test('capped at DECK_SIZE, regular items first', () => {
  const regs = Array.from({ length: 6 }, (_, i) => regular(`r${i}`, 10, 4 + (i % 3)));
  const needs = Array.from({ length: 5 }, (_, i) => asNeeded(`n${i}`, [10 + i, 50, 90]));
  const { deck, regular: r, asNeeded: n } = deckCandidates(entries(...regs, ...needs));
  assert.equal(r.length, 6);
  assert.equal(n.length, 5);
  assert.equal(deck.length, DECK_SIZE);
  assert.deepEqual(ids(deck).slice(0, 6), ids(r));
});

test('no candidates gives an empty deck', () => {
  assert.deepEqual(deckCandidates(entries(regular('a', 30, 1))).deck, []);
});

test('deck session: answers, counter, undo, summary', () => {
  let d = newDeck(['a', 'b', 'c']);
  assert.equal(deckCurrent(d), 'a');
  d = deckAnswer(d, 'need', { x: 1 });
  d = deckAnswer(d, 'have', { y: 2 });
  assert.equal(d.idx, 2);
  assert.equal(deckCurrent(d), 'c');
  assert.deepEqual(deckSummary(d), { added: ['a'], have: ['b'] });
  const u = deckUndo(d);
  assert.equal(u.deck.idx, 1);
  assert.deepEqual(u.entry, { id: 'b', type: 'have', undo: { y: 2 }, at: 1 });
  assert.deepEqual(deckSummary(u.deck), { added: ['a'], have: [] });
  d = deckAnswer(u.deck, 'need', null);
  d = deckAnswer(d, 'need', null);
  assert.equal(deckDone(d), true);
  assert.equal(deckAnswer(d, 'need', null), d); // no answers past the end
  assert.equal(deckUndo(newDeck(['a'])).entry, null);
});

test('skipping a deleted card moves on without logging; undo still returns to the right card', () => {
  let d = newDeck(['a', 'b', 'c']);
  d = deckAnswer(d, 'need', null); //  a
  d = deckSkip(d); //                  b was deleted
  d = deckAnswer(d, 'have', null); //  c
  assert.equal(deckDone(d), true);
  const u = deckUndo(d); //            takes back c
  assert.equal(deckCurrent(u.deck), 'c');
  assert.equal(u.deck.log.length, 1);
});

test('suggested cycle is about 50 percent longer, rounded', () => {
  assert.equal(suggestedCycle(3), 5);
  assert.equal(suggestedCycle(7), 11);
  assert.equal(suggestedCycle(1), 2);
  assert.equal(suggestedCycle(2), 3);
});

// ---- store: adding is idempotent, undo restores ----
test('adding the same item twice never lists it twice', () => {
  const id = S.addItem({ name: 'Dupe test item', cat: 'other', mode: 'auto', interval: 9 });
  const count = () => S.items().filter((i) => i.id === id && i.needed).length;
  S.deckNeed(id);
  S.deckNeed(id);
  S.setNeeded(id, true);
  assert.equal(count(), 1);
  assert.equal(S.items().filter((i) => i.name === 'Dupe test item').length, 1);
  assert.equal(S.findItemByName('dupe test ITEM').id, id);
});

test('deck answers set the right fields and undo puts them back', () => {
  const id = S.addItem({ name: 'Undo test item', cat: 'other', mode: 'auto', interval: 9 });
  const before = { ...S.store.data.items[id] };
  const prevHave = S.deckHave(id, SNOOZE_DAYS);
  const it = S.store.data.items[id];
  assert.equal(it.haveStreak, 1);
  assert.ok(it.snoozedUntil > Date.now() + (SNOOZE_DAYS - 0.1) * DAY && it.snoozedUntil < Date.now() + (SNOOZE_DAYS + 0.1) * DAY);
  assert.equal(it.needed, false);
  S.undoDeckAnswer(id, prevHave);
  assert.equal(S.store.data.items[id].snoozedUntil, null);
  assert.equal(S.store.data.items[id].haveStreak, 0);
  const prevNeed = S.deckNeed(id);
  assert.equal(S.store.data.items[id].needed, true);
  S.undoDeckAnswer(id, prevNeed);
  assert.equal(S.store.data.items[id].needed, before.needed);
});

test('buying or adding by hand resets the still-have streak', () => {
  const id = S.addItem({ name: 'Streak test item', cat: 'other', mode: 'auto', interval: 9 });
  S.deckHave(id, SNOOZE_DAYS);
  S.deckHave(id, SNOOZE_DAYS);
  assert.equal(S.store.data.items[id].haveStreak, 2);
  S.setNeeded(id, true);
  assert.equal(S.store.data.items[id].haveStreak, 0);
  S.deckHave(id, SNOOZE_DAYS);
  S.markBought(id);
  assert.equal(S.store.data.items[id].haveStreak, 0);
  assert.equal(S.store.data.items[id].snoozedUntil, null);
});
