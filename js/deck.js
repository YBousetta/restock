// "Forgot anything?" swipe deck: which items to ask about, and the session state.
// Pure functions only (no DOM, no storage), so they are easy to test.

export const DECK_SIZE = 8; //                max cards in one deck
export const LOOKAHEAD_DAYS = 7; //           regular items that run out within this many days are asked about
export const SNOOZE_DAYS = 3; //              "Still have it" hides an item for this long
export const MIN_PURCHASES_AS_NEEDED = 3; //  as-needed items need this many purchases before they are asked about
export const STREAK_FOR_SUGGESTION = 3; //    "still have it" this many times in a row suggests a longer cycle

// entries: [{ item, st }] where st comes from itemStatus (so numbers agree everywhere).
// Skips items already on the list, items shown in Coming up (due_soon) and snoozed items.
// Returns { regular, asNeeded, deck }: regular soonest first, then as-needed longest since
// last bought first, `deck` capped at DECK_SIZE.
export function deckCandidates(entries) {
  const open = entries.filter((e) => !e.st.snoozed);
  const regular = open
    .filter((e) => e.st.state === 'ok' && e.st.daysLeft != null && e.st.daysLeft <= LOOKAHEAD_DAYS)
    .sort((a, b) => a.st.daysLeft - b.st.daysLeft || a.item.name.localeCompare(b.item.name));
  const asNeeded = open
    .filter((e) => e.st.state === 'as_needed' && e.st.purchaseCount >= MIN_PURCHASES_AS_NEEDED)
    .sort((a, b) => (b.st.daysSinceBought ?? 0) - (a.st.daysSinceBought ?? 0) || a.item.name.localeCompare(b.item.name));
  return { regular, asNeeded, deck: [...regular, ...asNeeded].slice(0, DECK_SIZE) };
}

// ---- a deck session ----
// { ids: [item ids, fixed when the deck opens], idx, log: [{ id, type: 'need'|'have', undo }] }

export function newDeck(ids) {
  return { ids: [...ids], idx: 0, log: [] };
}

export const deckDone = (d) => d.idx >= d.ids.length;
export const deckCurrent = (d) => (deckDone(d) ? null : d.ids[d.idx]);

// Records one answer. `undo` is whatever the store needs to put the item back.
export function deckAnswer(d, type, undo) {
  if (deckDone(d)) return d;
  return { ...d, idx: d.idx + 1, log: [...d.log, { id: d.ids[d.idx], type, undo, at: d.idx }] };
}

// Moves past a card whose item no longer exists. Not an answer, so it is not logged.
export function deckSkip(d) {
  return deckDone(d) ? d : { ...d, idx: d.idx + 1 };
}

// Takes the last answer back. Returns { deck, entry } (entry is null if there was none).
export function deckUndo(d) {
  if (!d.log.length) return { deck: d, entry: null };
  const entry = d.log[d.log.length - 1];
  return { deck: { ...d, idx: entry.at, log: d.log.slice(0, -1) }, entry };
}

// What the finished screen shows.
export function deckSummary(d) {
  const added = d.log.filter((l) => l.type === 'need').map((l) => l.id);
  const have = d.log.filter((l) => l.type === 'have').map((l) => l.id);
  return { added, have };
}

// A longer cycle to suggest: about 50 percent longer, rounded (3 days -> 5 days).
export const suggestedCycle = (days) => Math.max(days + 1, Math.round(days * 1.5));

// Offer a longer cycle once a regular item got "still have it" this many times in a row.
export const needsCycleSuggestion = (item) =>
  !!item && !item.deleted && item.mode !== 'none' && (item.haveStreak || 0) >= STREAK_FOR_SUGGESTION;
