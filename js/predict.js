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

// Status of one item at time `now`.
// kind: 'needed' (flagged), 'due', 'soon', 'ok', 'none' (as-needed item, not flagged)
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

  return { kind, interval, samples, lastBought, dueAt, daysLeft, purchases: times.length };
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
