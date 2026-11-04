// Restock prediction: learns how often each item is bought and when it will run out.
// Pure functions only, so they can be unit tested in Node.

export const DAY = 86400000;

// Purchases closer together than this count as one trip (e.g. both partners tapping).
const SAME_TRIP = 0.5 * DAY;

export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Whole calendar days from `from` to `to` (negative when `to` is earlier).
export function dayDiff(from, to) {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY);
}

export function purchaseTimes(purchases, itemId) {
  const times = [];
  for (const p of Object.values(purchases || {})) {
    if (p.itemId === itemId && !p.deleted) times.push(p.at);
  }
  times.sort((a, b) => a - b);
  // collapse taps from the same trip
  const out = [];
  for (const t of times) {
    if (!out.length || t - out[out.length - 1] >= SAME_TRIP) out.push(t);
  }
  return out;
}

// Exponentially weighted estimate of the buying interval, in days.
// Starts from `prior` (the user's guess) and moves toward observed gaps.
// Each gap is clamped to [est/3, est*3] so a vacation or a forgotten tap
// can't wreck the estimate, but repeated evidence still moves it.
export function learnInterval(prior, times) {
  let est = prior;
  let samples = 0;
  for (let i = 1; i < times.length; i++) {
    const gap = (times[i] - times[i - 1]) / DAY;
    const g = Math.min(Math.max(gap, est / 3), est * 3);
    const alpha = samples === 0 ? 0.5 : samples === 1 ? 0.4 : 0.3;
    est += alpha * (g - est);
    samples++;
  }
  return { interval: Math.max(0.5, Math.round(est * 2) / 2), samples };
}

// The one status function every screen uses, so numbers always agree.
//
// Input: the item, all purchases, `now`, and the "Coming up" window in days.
// (The shopping list is the items flagged `needed`, plus regular items that ran
// out. There is no separate list record, so an item can only be on it once.)
//
// Output:
//   state          'in_list' | 'due_soon' | 'ok' | 'as_needed'
//   daysLeft       whole days until it runs out (null for as needed)
//   daysSinceBought whole days since the last purchase (null if never bought)
//   lastBought, cycleDays, purchaseCount, snoozed, snoozedUntil
//   kind           legacy name for the same thing: needed|due|soon|ok|none
//
// Rules (unchanged): flagged `needed` is on the list; a regular item is on the
// list once its countdown reaches 0; due_soon is within `lookahead` days.
export function itemStatus(item, purchases, now, lookahead = 2) {
  const times = purchaseTimes(purchases, item.id);
  const lastBought = times.length ? times[times.length - 1] : null;
  const base = Math.max(lastBought || 0, item.baselineAt || 0) || null;

  let interval = null;
  let samples = 0;
  if (item.mode === 'fixed') {
    interval = item.interval;
  } else if (item.mode === 'auto') {
    ({ interval, samples } = learnInterval(item.interval, times));
  }

  let dueAt = null;
  let daysLeft = null;
  if (interval != null && base != null) {
    dueAt = base + interval * DAY;
    if (item.snoozeUntil && item.snoozeUntil > dueAt) dueAt = item.snoozeUntil;
    daysLeft = dayDiff(now, dueAt);
  }

  let kind;
  if (item.needed) kind = 'needed';
  else if (daysLeft == null) kind = 'none';
  else if (daysLeft <= 0) kind = 'due';
  else if (daysLeft <= lookahead) kind = 'soon';
  else kind = 'ok';

  const state = { needed: 'in_list', due: 'in_list', soon: 'due_soon', ok: 'ok', none: 'as_needed' }[kind];

  // Hidden from the "Forgot anything?" deck. `snoozedUntil` is the deck's own
  // snooze (it never moves the countdown); the older `snoozeUntil` ("Still have
  // some" on the list) also counts, so you are not asked again straight away.
  const snoozedUntil = item.snoozedUntil || null;
  const snoozed = (snoozedUntil != null && snoozedUntil > now) || (item.snoozeUntil != null && item.snoozeUntil > now);

  return {
    state,
    kind,
    interval,
    cycleDays: interval,
    samples,
    lastBought,
    dueAt,
    daysLeft,
    daysSinceBought: lastBought == null ? null : Math.max(0, dayDiff(lastBought, now)),
    purchases: times.length,
    purchaseCount: times.length,
    snoozed,
    snoozedUntil,
  };
}

export function formatDays(n) {
  if (n == null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 1) return `in ${n} days`;
  return `${-n} days ago`;
}

export function formatInterval(d) {
  if (d == null) return 'as needed';
  if (d === 1) return 'daily';
  if (d === 7) return 'weekly';
  if (d === 14) return 'every 2 weeks';
  if (d >= 28 && d <= 31) return 'monthly';
  if (d % 7 === 0 && d > 7) return `every ${d / 7} weeks`;
  return `every ${d} days`;
}

// "today", "yesterday", "5 days ago", "3 weeks ago", "2 months ago".
export function formatAgo(days) {
  if (days == null) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

// "every week", "every 2 weeks", "every 3 days" (used as "Usually ...").
export function formatUsually(d) {
  if (d == null) return '';
  if (d === 1) return 'every day';
  if (d === 7) return 'every week';
  if (d >= 28 && d <= 31) return 'every month';
  if (d % 7 === 0 && d > 7) return `every ${d / 7} weeks`;
  return `every ${d} days`;
}
