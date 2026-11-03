// App state: shared data (synced) + device settings (this phone only).
import { buildSeed, upgradeSeed } from './seed.js';
import { mergeState } from './merge.js';
import { DAY, itemStatus } from './predict.js';

const DATA_KEY = 'restock.data.v1';
const DEVICE_KEY = 'restock.device.v1';

const listeners = new Set();

function safeGet(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function safeSet(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.warn('save failed', e);
  }
}

export const store = {
  data: upgradeSeed(safeGet(DATA_KEY) || buildSeed()),
  device: {
    name: '',
    lookahead: 2,
    sync: null, // { owner, repo, path, token }
    ...(safeGet(DEVICE_KEY) || {}),
  },
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let localChangeHook = null;
export function onLocalChange(fn) {
  localChangeHook = fn;
}

function emit(local) {
  safeSet(DATA_KEY, store.data);
  listeners.forEach((fn) => fn());
  if (local && localChangeHook) localChangeHook();
}

export function saveDevice(patch) {
  Object.assign(store.device, patch);
  safeSet(DEVICE_KEY, store.device);
  listeners.forEach((fn) => fn());
}

// Called by sync with the merged result.
export function replaceData(data) {
  store.data = data;
  emit(false);
}

export function importData(data) {
  store.data = mergeState(store.data, data);
  emit(true);
}

export function resetData() {
  store.data = buildSeed();
  emit(true);
}

const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function touch(rec) {
  rec.updatedAt = Date.now();
  rec.updatedBy = store.device.name || undefined;
  return rec;
}

function putItem(id, patch) {
  const cur = store.data.items[id];
  store.data.items[id] = touch({ ...cur, ...patch });
}

// ---------- queries ----------

export const live = (map) => Object.values(map || {}).filter((r) => !r.deleted);

export function categories() {
  return live(store.data.categories).sort((a, b) => a.order - b.order);
}

export function items() {
  return live(store.data.items).filter((i) => !i.archived);
}

export function status(item, now = Date.now()) {
  return itemStatus(item, store.data.purchases, now, store.device.lookahead);
}

export function history(itemId) {
  return live(store.data.purchases)
    .filter((p) => p.itemId === itemId)
    .sort((a, b) => b.at - a.at);
}

export function boughtSince(t) {
  return live(store.data.purchases).filter((p) => p.at >= t);
}

export function boughtToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return live(store.data.purchases).filter((p) => p.at >= start.getTime());
}

// ---------- mutations ----------

export function markBought(id) {
  const item = store.data.items[id];
  const pid = uid('p_');
  store.data.purchases[pid] = touch({
    id: pid,
    itemId: id,
    at: Date.now(),
    by: store.device.name || undefined,
    prevNeeded: !!item.needed,
    prevSnooze: item.snoozeUntil || null,
  });
  putItem(id, { needed: false, snoozeUntil: null });
  emit(true);
  return pid;
}

export function undoPurchase(pid) {
  const p = store.data.purchases[pid];
  if (!p) return;
  store.data.purchases[pid] = touch({ ...p, deleted: true });
  putItem(p.itemId, { needed: p.prevNeeded, snoozeUntil: p.prevSnooze || null });
  emit(true);
}

export function setNeeded(id, needed) {
  putItem(id, { needed, snoozeUntil: needed ? null : store.data.items[id].snoozeUntil });
  emit(true);
}

// "Still have it": hide from the list for a while without recording a purchase.
export function snooze(id) {
  const st = status(store.data.items[id]);
  const days = Math.max(1, Math.round((st.interval || 2) / 3));
  putItem(id, { needed: false, snoozeUntil: Date.now() + days * DAY });
  emit(true);
  return days;
}

export function updateItem(id, patch) {
  putItem(id, patch);
  emit(true);
}

export function addItem({ name, cat, mode = 'auto', interval = 7, needed = false }) {
  const id = uid('i_');
  store.data.items[id] = touch({ id, name, cat, mode, interval, needed, baselineAt: Date.now() });
  emit(true);
  return id;
}

export function deleteItem(id) {
  putItem(id, { deleted: true });
  emit(true);
}

export function findItemByName(name) {
  const n = name.trim().toLowerCase();
  return live(store.data.items).find((i) => i.name.toLowerCase() === n);
}

export function saveMeal(meal) {
  const id = meal.id || uid('m_');
  store.data.meals[id] = touch({ ...store.data.meals[id], ...meal, id });
  emit(true);
  return id;
}

export function deleteMeal(id) {
  store.data.meals[id] = touch({ ...store.data.meals[id], deleted: true });
  emit(true);
}

export function moveCategory(id, dir) {
  const cats = categories();
  const i = cats.findIndex((c) => c.id === id);
  const j = i + dir;
  if (j < 0 || j >= cats.length) return;
  [cats[i], cats[j]] = [cats[j], cats[i]];
  cats.forEach((c, k) => {
    if (c.order !== k) store.data.categories[c.id] = touch({ ...c, order: k });
  });
  emit(true);
}

export function updateCategory(id, patch) {
  store.data.categories[id] = touch({ ...store.data.categories[id], ...patch });
  emit(true);
}

export function renameCategory(id, name) {
  store.data.categories[id] = touch({ ...store.data.categories[id], name });
  emit(true);
}

export function addCategory(name) {
  const id = uid('c_');
  store.data.categories[id] = touch({ id, name, order: categories().length });
  emit(true);
  return id;
}

export function setCategoryOrder(ids) {
  ids.forEach((id, k) => {
    const c = store.data.categories[id];
    if (c && c.order !== k) store.data.categories[id] = touch({ ...c, order: k });
  });
  emit(true);
}

// How many times each item was bought (for "frequently bought" suggestions).
export function purchaseCounts() {
  const counts = {};
  for (const p of live(store.data.purchases)) counts[p.itemId] = (counts[p.itemId] || 0) + 1;
  return counts;
}
