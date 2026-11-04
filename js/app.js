import * as S from './store.js';
import { store } from './store.js';
import { icons } from './icons.js';
import { DAY, formatDays, formatInterval, formatAgo, formatUsually } from './predict.js';
import {
  SNOOZE_DAYS, STREAK_FOR_SUGGESTION, deckCandidates, newDeck, deckAnswer, deckUndo, deckSkip, deckDone, deckCurrent, deckSummary, suggestedCycle,
} from './deck.js';
import { CATEGORY_ICONS, CATEGORY_RHYTHM, ICON_CHOICES, MEAL_CATEGORIES, MEAL_IDEAS, NON_FOOD, guessItemIcon, guessCategory } from './knowledge.js';
import { esc, $, toast, openSheet, sheetHeader, actionSheet, confirmAction, enableSwipe, passcodeSheet } from './ui.js';
import { syncState, onSyncChange, startSync, syncNow, connect, disconnect, inviteCode, parseInvite } from './sync.js';

const VERSION = '1.8.0';
// SHA-256 of the backup passcode. This only keeps casual taps out: the app's code is public.
const BACKUP_HASH = 'bfbe56885d33f05b961223170f34a0af243bd62f2d0d9d3dfdf4e3fa4058c968';

const ui = {
  tab: localGet('restock.tab') || 'list',
  query: '',
  filter: 'all',
  adding: false,
  addQuery: '',
  addedNow: new Set(), // items added during the current add session (stay visible as "added")
  scroll: {},
  backupUnlocked: false,
  mealFilter: 'all',
  deck: null, //        the open "Forgot anything?" session
  autoDeckOff: false, // set by "View list" so an empty list does not reopen a deck at once
  dragging: false,
};

function localGet(k) {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localSet(k, v) {
  try {
    localStorage.setItem(k, v);
  } catch {}
}

const TITLES = { list: 'Shopping List', items: 'Items', meals: 'Meals', settings: 'Settings' };

// ---------- helpers ----------

const catName = (id) => store.data.categories[id]?.name || 'Other';
const catIcon = (id) => store.data.categories[id]?.icon || CATEGORY_ICONS[id] || '📦';
const itemIcon = (item) => item.icon || guessItemIcon(item.name) || catIcon(item.cat);
const byName = (a, b) => a.item.name.localeCompare(b.item.name);
const onListKind = (k) => k === 'needed' || k === 'due';
const listMode = () => store.device.listView || 'grid';
const itemsMode = () => store.device.itemsView || 'list';
const mealsMode = () => store.device.mealsView || 'list';

function groupByCategory(entries) {
  const groups = new Map(S.categories().map((c) => [c.id, []]));
  for (const e of entries) {
    const key = groups.has(e.item.cat) ? e.item.cat : 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.entries()].filter(([, list]) => list.length);
}

// ---------- collapsible category sections ----------
const DEFAULT_COLLAPSED = { itemsC: true }; // Items starts with every category folded
function collapsed(scope) {
  const saved = (store.device.collapsed || {})[scope];
  if (saved === undefined && DEFAULT_COLLAPSED[scope]) return new Set(S.categories().map((c) => c.id));
  return new Set(saved || []);
}
function setCollapsed(scope, ids) {
  S.saveDevice({ collapsed: { ...(store.device.collapsed || {}), [scope]: [...ids] } });
}
function catSection(scope, cat, count, body, open = false, due = 0) {
  const closed = !open && collapsed(scope).has(cat);
  return `<button class="section-header collapsible ${closed ? 'closed' : ''}" aria-expanded="${!closed}" data-act="togglecat" data-scope="${scope}" data-c="${cat}">
      <span class="cat-head"><span class="caret-icon">${icons.chevron}</span>${esc(catName(cat))}</span>
      ${due > 0 ? `<span class="due-badge">${due} due</span>` : ''}<span class="count">${count}</span></button>
    ${closed ? '' : body}`;
}
function collapseBar(scope, cats, label) {
  const c = collapsed(scope);
  const allClosed = cats.length && cats.every((id) => c.has(id));
  return `<div class="collapse-bar"><span>${label}</span><button data-act="collapseall" data-scope="${scope}" data-cats="${cats.join(',')}">${allClosed ? 'Expand all' : 'Collapse all'}</button></div>`;
}

function chipRow(list, current, act, style = '') {
  return `<div class="filter-tabs" ${style ? `style="${style}"` : ''}>${list
    .map(([k, l]) => `<button aria-pressed="${current === k}" class="${current === k ? 'on' : ''}" data-act="${act}" data-f="${k}"><span>${l}</span></button>`)
    .join('')}</div>`;
}

function swipeRow(inner, act, id, label, cls = '') {
  return `<div class="swipe-row ${cls}"><button class="swipe-action ${act === 'removeitem' ? 'orange' : ''}" data-act="${act}" data-id="${id}">${label}</button>${inner}</div>`;
}

function freqShort(st, item) {
  if (item.mode === 'none' || st.interval == null) return 'as needed';
  const d = st.interval;
  if (d === 1) return 'daily';
  if (d === 7) return 'weekly';
  if (d === 14) return 'every 2 weeks';
  if (d >= 28 && d <= 31) return 'monthly';
  if (d % 7 === 0 && d > 7) return `every ${d / 7} weeks`;
  return `every ${d}d`;
}

function dueLabel(st) {
  if (st.daysLeft == null) return 'as needed';
  if (st.daysLeft < 0) return `<span class="due">Due ${formatDays(st.daysLeft)}</span>`;
  if (st.daysLeft === 0) return `<span class="due">Due today</span>`;
  return `<span class="${st.daysLeft <= store.device.lookahead ? 'soon' : ''}">Runs out ${formatDays(st.daysLeft)}</span>`;
}

const fmtDate = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
function fmtAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(t);
}

// Fraction of stock estimated left (1 = just bought, 0 = should be out).
function stockLevel(st) {
  if (st.cycleDays == null || st.daysLeft == null) return null;
  return Math.min(1, Math.max(0, st.daysLeft / st.cycleDays));
}
// Amber at 1 day or less, green otherwise (the text beside it says the same in words).
const barColor = (st) => (st.daysLeft != null && st.daysLeft <= 1 ? 'var(--orange)' : 'var(--green)');
const barLabel = (st) => `${st.daysLeft} day${st.daysLeft === 1 ? '' : 's'} left of ${Math.round(st.cycleDays)}`;

function computeList() {
  const all = S.items().map((item) => ({ item, st: S.status(item) }));
  const toBuy = all.filter((e) => onListKind(e.st.kind));
  const coming = all.filter((e) => e.st.kind === 'soon').sort((a, b) => a.st.daysLeft - b.st.daysLeft || byName(a, b));
  const seen = new Set();
  const bought = [];
  const since = Math.max(Date.now() - DAY, store.device.cartClearedAt || 0);
  for (const p of S.boughtSince(since).sort((a, b) => b.at - a.at)) {
    const item = store.data.items[p.itemId];
    if (!item || item.deleted || seen.has(p.itemId)) continue;
    seen.add(p.itemId);
    if (toBuy.some((e) => e.item.id === p.itemId)) continue;
    bought.push({ item, p });
  }
  return { all, toBuy, coming, bought };
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Catalog search: name starts with query > a word starts with it > contains it.
function searchItems(q, limit = 8) {
  const n = norm(q.trim());
  if (!n) return [];
  const scored = [];
  for (const item of S.items()) {
    const name = norm(item.name);
    let score = -1;
    if (name.startsWith(n)) score = 0;
    else if (name.split(/[^a-z0-9]+/).some((w) => w.startsWith(n))) score = 1;
    else if (name.includes(n)) score = 2;
    if (score >= 0) scored.push({ item, score });
  }
  scored.sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map((x) => x.item);
}

const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function browserName() {
  const ua = navigator.userAgent;
  if (/CriOS/.test(ua)) return 'Chrome';
  if (/FxiOS/.test(ua)) return 'Firefox';
  if (/EdgiOS/.test(ua)) return 'Edge';
  return 'Safari';
}

function syncBadge() {
  const map = { ok: ['ok', 'Synced'], syncing: ['soon', 'Syncing'], offline: ['none', 'Offline'], error: ['due', 'Sync error'] };
  const [cls, label] = map[syncState.status] || ['none', 'Off'];
  return `<span class="sync-badge"><span class="dot ${cls}"></span>${label}</span>`;
}

// ---------- shopping list ----------

function addPanel() {
  const q = ui.addQuery.trim();
  const added = (id) => ui.addedNow.has(id) || onListKind(S.status(store.data.items[id]).kind);
  const chip = (item) =>
    `<button class="chip-item ${added(item.id) ? 'added' : ''}" data-act="quick" data-id="${item.id}" data-keepfocus>
      <span>${itemIcon(item)}</span>${esc(item.name)}${added(item.id) ? '<b>✓</b>' : ''}</button>`;

  if (!q) {
    const all = S.items().map((item) => ({ item, st: S.status(item) }));
    const low = all
      .filter((e) => e.st.kind === 'soon' || (ui.addedNow.has(e.item.id) && e.st.daysLeft != null && e.st.daysLeft <= store.device.lookahead))
      .sort((a, b) => (a.st.daysLeft ?? 99) - (b.st.daysLeft ?? 99));
    const lowIds = new Set(low.map((e) => e.item.id));
    const counts = S.purchaseCounts();
    const staples = all
      .filter((e) => e.item.mode !== 'none' && !lowIds.has(e.item.id) && (!onListKind(e.st.kind) || ui.addedNow.has(e.item.id)))
      .sort((a, b) => (counts[b.item.id] || 0) - (counts[a.item.id] || 0) || a.st.interval - b.st.interval || byName(a, b))
      .slice(0, 14);
    let html = '';
    if (low.length) html += `<div class="section-header">Running low</div><div class="chip-wrap">${low.map((e) => chip(e.item)).join('')}</div>`;
    html += `<div class="section-header">Your staples</div><div class="chip-wrap">${staples.map((e) => chip(e.item)).join('')}</div>`;
    return html;
  }

  const results = searchItems(q);
  let html = `<div class="group suggestions">`;
  for (const item of results) {
    const st = S.status(item);
    const isAdded = added(item.id);
    html += `<button class="row tappable" data-act="quick" data-id="${item.id}" data-keepfocus>
      <span class="item-icon">${itemIcon(item)}</span>
      <div class="body"><div class="title">${esc(item.name)}</div><div class="sub">${esc(catName(item.cat))} · ${freqShort(st, item)}</div></div>
      <span class="sug-add ${isAdded ? 'on' : ''}">${isAdded ? icons.checkCircle : icons.plusCircle}</span></button>`;
  }
  if (!S.findItemByName(q)) {
    const gc = guessCategory(q, S.items()) || 'other';
    html += `<button class="row tappable create-row" data-act="createitem" data-keepfocus>
      <span class="item-icon new">${icons.plus}</span>
      <div class="body"><div class="title">Create “${esc(q)}”</div><div class="sub">New item · ${esc(catName(gc))}</div></div></button>`;
  }
  return html + `</div>`;
}

function buyTile(item, st) {
  const late = st.daysLeft != null && st.daysLeft <= 0;
  return `<button class="tile ${late ? 'late' : ''}" data-act="tilebuy" data-long="detail" data-id="${item.id}">
    ${late ? '<span class="tile-dot"></span>' : ''}
    <span class="tile-icon">${itemIcon(item)}</span>
    <span class="tile-name">${esc(item.name)}</span>
    <span class="tile-freq">${freqShort(st, item)}</span>
    <span class="tile-done">${icons.check}</span>
  </button>`;
}

function buyRow(item, st, compact) {
  const row = `<div class="row has-check swipe-content ${compact ? 'compact' : ''}">
    <button class="check-hit" data-act="buy" data-id="${item.id}" aria-label="Bought ${esc(item.name)}"><span class="check">${icons.check}</span></button>
    ${compact ? '' : `<span class="item-icon">${itemIcon(item)}</span>`}
    <button class="body" data-act="detail" data-id="${item.id}">
      <div class="title">${esc(item.name)}</div>
      ${compact ? '' : `<div class="sub">${freqShort(st, item)}${st.kind === 'due' ? ' · ' + dueLabel(st) : ''}</div>`}
    </button>
    ${compact ? `<span class="detail small">${freqShort(st, item)}</span>` : ''}</div>`;
  return swipeRow(row, 'removeitem', item.id, 'Remove');
}

function a2hsCard() {
  if (!isIOS() || isStandalone() || localGet('restock.a2hsDismissed')) return '';
  const b = browserName();
  const where = b === 'Safari' ? 'in Safari' : `in ${b}'s address bar`;
  return `<div class="card a2hs"><h4>Open Restock full screen</h4>
    <ol class="steps"><li>Tap <b>Share</b> ${icons.share.replace('<svg', '<svg width="15" height="15" style="vertical-align:-2px"')} ${where}</li>
    <li>Tap <b>Add to Home Screen</b>, keep <b>Open as Web App</b> on</li>
    <li>Open <b>Restock</b> from your Home Screen</li></ol>
    <button class="link-btn" data-act="dismissa2hs">Dismiss</button></div>`;
}

function listView() {
  const { toBuy, coming, bought } = computeList();
  const mode = listMode();
  const compact = mode === 'compact';
  let html = `<p class="subtitle">${toBuy.length ? `${toBuy.length} to buy` : 'Nothing due'}${syncState.status !== 'off' ? ' · ' + syncBadge() : ''}</p>
    ${ui.adding ? '' : a2hsCard()}
    <div class="addbar-wrap ${ui.adding ? 'active' : ''}">
      <label class="search addbar">${icons.search}<input id="quickadd" type="text" placeholder="Add an item" value="${esc(ui.addQuery)}" autocomplete="off" autocorrect="off" enterkeyhint="done"></label>
      ${ui.adding ? `<button class="addbar-done" data-act="adddone">Done</button>` : ''}
    </div>`;

  if (ui.adding) return html + `<div id="addpanel">${addPanel()}</div>`;

  // The "Forgot anything?" deck: opens by itself when the list is empty, and stays open until finished.
  const cands = deckCandidates(computeList().all);
  if (toBuy.length) ui.autoDeckOff = false;
  if (!ui.deck && !toBuy.length && !ui.autoDeckOff && cands.deck.length) ui.deck = newDeck(cands.deck.map((e) => e.item.id));

  if (!toBuy.length && !bought.length && !ui.deck) {
    const next = S.items()
      .map((item) => ({ item, st: S.status(item) }))
      .filter((e) => e.st.daysLeft != null)
      .sort((a, b) => a.st.daysLeft - b.st.daysLeft)[0];
    html += `<div class="empty"><div class="big">🧺</div><h3>All stocked up</h3>
      <p>${next ? `Next up: <b>${esc(next.item.name)}</b>, ${formatDays(next.st.daysLeft)}.` : 'Tap “Add an item” to start.'}</p></div>`;
  }

  if (mode === 'grid' && toBuy.length) {
    const tiles = groupByCategory(toBuy).flatMap(([, list]) => list.sort(byName));
    html += `<div class="grid">${tiles.map((e) => buyTile(e.item, e.st)).join('')}</div>`;
  } else {
    const groups = groupByCategory(toBuy);
    if (groups.length > 1) html += collapseBar('list', groups.map(([c]) => c), '');
    for (const [cat, list] of groups) {
      html += catSection('list', cat, list.length, `<div class="group">${list.sort(byName).map((e) => buyRow(e.item, e.st, compact)).join('')}</div>`);
    }
  }

  if (ui.deck) html += deckBlock();
  else if (cands.deck.length) html += forgotRow(cands.deck.length);

  if (coming.length) {
    html += `<div class="section-header"><span>Coming up · ${store.device.lookahead} day${store.device.lookahead > 1 ? 's' : ''}</span>
      <button data-act="addcoming">Add all</button></div><div class="group">`;
    for (const { item, st } of coming) {
      html += `<div class="row ${compact ? 'compact' : ''}">
        <span class="item-icon ${compact ? 'sm' : ''}">${itemIcon(item)}</span>
        <button class="body" data-act="detail" data-id="${item.id}"><div class="title">${esc(item.name)}</div>
          ${compact ? '' : `<div class="sub">${freqShort(st, item)}</div>`}</button>
        <span class="detail small">${formatDays(st.daysLeft)}</span>
        <button class="icon-btn" data-act="need" data-id="${item.id}" aria-label="Add to list">${icons.plusCircle}</button></div>`;
    }
    html += `</div>`;
  }

  if (bought.length) {
    html += `<div class="section-header"><span>Just bought</span><button data-act="clearcart">Clear</button></div><div class="group">`;
    for (const { item, p } of bought) {
      const time = new Date(p.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      html += `<div class="row has-check checked compact">
        <button class="check-hit" data-act="undo" data-id="${p.id}" aria-label="Undo"><span class="check">${icons.check}</span></button>
        <div class="body"><div class="title">${itemIcon(item)} ${esc(item.name)}</div></div>
        <span class="detail small">${p.by ? esc(p.by) + ' · ' : ''}${time}</span></div>`;
    }
    html += `</div>`;
  }
  return html;
}

// ---------- "Forgot anything?" deck ----------

function forgotRow(n) {
  return `<button class="forgot-row" data-act="deckopen">
    <span class="forgot-icon">${icons.bag}</span>
    <span class="forgot-text"><b>Forgot anything?</b><span>Check ${n} item${n === 1 ? '' : 's'} you might need</span></span>
    <span class="chev">${icons.chevron}</span></button>`;
}

function deckBlock() {
  let d = ui.deck;
  while (!deckDone(d) && (!store.data.items[deckCurrent(d)] || store.data.items[deckCurrent(d)].deleted)) d = ui.deck = deckSkip(d); // deleted meanwhile
  return deckDone(d) ? deckFinished(d) : deckCard(d);
}

function deckCard(d) {
  const item = store.data.items[deckCurrent(d)];
  const st = S.status(item);
  const left = d.ids.length - d.idx;
  const last = st.daysSinceBought == null ? 'Not bought yet' : `Last bought ${formatAgo(st.daysSinceBought)}`;
  const usually = item.mode === 'none' || st.cycleDays == null ? '' : `Usually ${formatUsually(Math.round(st.cycleDays))}`;
  return `<section class="deck" aria-label="Forgot anything?">
    <div class="deck-head"><h2>Forgot anything?</h2><div class="deck-meta">
      ${d.log.length ? `<button class="deck-undo" data-act="deckundo">Undo</button>` : ''}
      <span aria-live="polite">${d.idx + 1} of ${d.ids.length}</span></div></div>
    <div class="deck-stage" tabindex="0" aria-label="${esc(item.name)}. Swipe right if you need it, left if you still have it. Arrow keys also work.">
      ${left > 2 ? '<div class="deck-back b2"></div>' : ''}${left > 1 ? '<div class="deck-back b1"></div>' : ''}
      <div class="deck-card" data-deckcard>
        <span class="stamp need" aria-hidden="true">NEED IT</span><span class="stamp have" aria-hidden="true">HAVE IT</span>
        <div class="deck-icon">${itemIcon(item)}</div>
        <div class="deck-name">${esc(item.name)}</div>
        <div class="deck-last">${last}</div>
        ${usually ? `<div class="deck-usually">${usually}</div>` : ''}
      </div>
    </div>
    <div class="deck-actions">
      <button class="deck-btn have" data-act="deckhave">${icons.arrowLeft}Still have it</button>
      <button class="deck-btn need" data-act="deckneed">Need it${icons.arrowRight}</button>
    </div></section>`;
}

function deckFinished(d) {
  const { added, have } = deckSummary(d);
  const names = added.map((id) => store.data.items[id]?.name).filter(Boolean);
  const title = added.length ? `${added.length} added to your list` : 'Nothing added to your list';
  // 3 "still have it" in a row on a regular item: offer a longer cycle (one at a time)
  const sug = have
    .map((id) => store.data.items[id])
    .find((it) => it && !it.deleted && it.mode !== 'none' && (it.haveStreak || 0) >= STREAK_FOR_SUGGESTION);
  let suggest = '';
  if (sug) {
    const cur = Math.max(1, Math.round(S.status(sug).cycleDays || sug.interval));
    suggest = `<section class="card deck-suggest"><div><b>${esc(sug.name)} lasts longer than ${cur} day${cur === 1 ? '' : 's'}</b>
      <span>You still had it ${sug.haveStreak} times in a row.</span></div>
      <div class="deck-suggest-btns"><button class="btn-outline" data-act="cyclechange" data-id="${sug.id}" data-n="${suggestedCycle(cur)}">Change to ${suggestedCycle(cur)} days</button>
      <button class="btn-plain" data-act="cyclekeep" data-id="${sug.id}">Keep ${cur} day${cur === 1 ? '' : 's'}</button></div></section>`;
  }
  return `<section class="deck-done" aria-live="polite">
      <div class="done-check">${icons.check}</div>
      <h2>${title}</h2>
      <p>${have.length} marked as still have</p>
      ${names.length ? `<div class="done-chips">${names.map((n) => `<span>${esc(n)}</span>`).join('')}</div>` : ''}
      <button class="btn" data-act="deckview">View list</button>
      ${d.log.length ? `<button class="deck-undo center" data-act="deckundo">Undo last answer</button>` : ''}
    </section>${suggest}`;
}

// Answer the current card. `type` is 'need' (swipe right) or 'have' (swipe left).
function answerDeck(type) {
  const d = ui.deck;
  if (!d || deckDone(d)) return;
  const id = deckCurrent(d);
  const item = store.data.items[id];
  if (!item || item.deleted) return render();
  const undo = type === 'need' ? S.deckNeed(id) : S.deckHave(id, SNOOZE_DAYS);
  ui.deck = deckAnswer(d, type, undo);
  render();
}

function undoDeck() {
  if (!ui.deck) return;
  const { deck, entry } = deckUndo(ui.deck);
  if (!entry) return;
  S.undoDeckAnswer(entry.id, entry.undo);
  ui.deck = deck;
  render();
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
let flying = false;

// Fly the card off to one side, then record the answer.
function flyCard(type) {
  const card = $('[data-deckcard]');
  if (!card || flying) return;
  if (reducedMotion()) return answerDeck(type);
  flying = true;
  const dir = type === 'need' ? 1 : -1;
  card.style.transition = 'transform 0.24s ease-in, opacity 0.24s';
  card.style.transform = `translateX(${dir * (card.offsetWidth + 80)}px) rotate(${dir * 16}deg)`;
  card.style.opacity = '0';
  card.querySelector(dir > 0 ? '.stamp.need' : '.stamp.have').style.opacity = '1';
  setTimeout(() => {
    flying = false;
    answerDeck(type);
  }, 240);
}

function setupDeckGestures() {
  const THRESHOLD = 90;
  let drag = null;
  app.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('[data-deckcard]');
    if (!card || flying || e.button > 0) return;
    drag = { card, x: e.clientX, dx: 0, t: Date.now() };
    ui.dragging = true;
    card.style.transition = 'none';
    card.setPointerCapture(e.pointerId);
  });
  app.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    const tilt = Math.max(-12, Math.min(12, drag.dx / 14));
    drag.card.style.transform = `translateX(${drag.dx}px) rotate(${tilt}deg)`;
    const need = drag.card.querySelector('.stamp.need');
    const have = drag.card.querySelector('.stamp.have');
    need.style.opacity = String(Math.max(0, Math.min(1, drag.dx / THRESHOLD)));
    have.style.opacity = String(Math.max(0, Math.min(1, -drag.dx / THRESHOLD)));
    drag.card.classList.toggle('lean-need', drag.dx > 8);
    drag.card.classList.toggle('lean-have', drag.dx < -8);
  });
  const end = (e) => {
    if (!drag) return;
    const { card, dx, t } = drag;
    drag = null;
    ui.dragging = false;
    const fast = Math.abs(dx) / Math.max(1, Date.now() - t) > 0.6 && Math.abs(dx) > 40;
    if (e.type !== 'pointercancel' && (Math.abs(dx) > THRESHOLD || fast)) {
      card.style.transition = '';
      return flyCard(dx > 0 ? 'need' : 'have');
    }
    card.style.transition = 'transform 0.2s var(--spring)';
    card.style.transform = '';
    card.classList.remove('lean-need', 'lean-have');
    card.querySelectorAll('.stamp').forEach((s) => (s.style.opacity = ''));
    if (renderPending) {
      renderPending = false;
      scheduleRender();
    }
  };
  app.addEventListener('pointerup', end);
  app.addEventListener('pointercancel', end);
  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || !ui.deck || deckDone(ui.deck) || ui.tab !== 'list') return;
    if (document.body.classList.contains('sheet-open') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      flyCard('need');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      flyCard('have');
    }
  });
}

// ---------- items ----------

const ITEM_FILTERS = [['all', 'All'], ['regular', 'Regular'], ['asneeded', 'As needed'], ['due', 'Due soon'], ['inlist', 'In list']];

function itemRow(item, st) {
  const inList = st.state === 'in_list';
  const asNeeded = st.state === 'as_needed' || item.mode === 'none';
  // The right-hand control: add button, or a green check with "In list". Never both.
  const action = inList
    ? `<button class="inlist" data-act="unneed" data-id="${item.id}" aria-label="${esc(item.name)} is in your list. Tap to remove it.">${icons.check}In list</button>`
    : `<button class="icon-btn" data-act="need" data-id="${item.id}" aria-label="Add ${esc(item.name)} to list">${icons.plusCircle}</button>`;

  if (itemsMode() === 'compact') {
    const due = inList || asNeeded || st.daysLeft == null ? '' : `${st.daysLeft}d`;
    return swipeRow(`<div class="row compact swipe-content">
      <button class="body" data-act="detail" data-id="${item.id}"><div class="title">${esc(item.name)}</div></button>
      <span class="detail small">${due}</span>${action}</div>`, 'delitem', item.id, 'Delete');
  }
  let sub;
  if (asNeeded) sub = `as needed · ${st.daysSinceBought == null ? 'Not bought yet' : 'Last bought ' + formatAgo(st.daysSinceBought)}`;
  else if (inList) sub = freqShort(st, item);
  else sub = `${freqShort(st, item)} · ${dueLabel(st)}`;
  const lvl = asNeeded || inList ? null : stockLevel(st);
  return swipeRow(`<div class="row swipe-content">
    <span class="item-icon">${itemIcon(item)}</span>
    <button class="body" data-act="detail" data-id="${item.id}">
      <div class="title">${esc(item.name)}</div>
      <div class="sub">${sub}</div>
      ${lvl != null ? `<div class="mini-meter" role="img" aria-label="${barLabel(st)}"><div style="width:${Math.round(lvl * 100)}%;background:${barColor(st)}"></div></div>` : ''}
    </button>${action}</div>`, 'delitem', item.id, 'Delete');
}

function reviewStrip(n) {
  return `<div class="review-strip">
    <span class="review-icon">${icons.clock}</span>
    <div class="review-text"><b>${n} item${n === 1 ? '' : 's'} due this week</b><span>Check before your next trip</span></div>
    <button class="review-btn" data-act="review">Review</button></div>`;
}

function itemsResults() {
  const q = norm(ui.query.trim());
  const all = S.items().map((item) => ({ item, st: S.status(item) }));
  let entries = all;
  if (ui.filter === 'regular') entries = entries.filter((e) => e.item.mode !== 'none');
  if (ui.filter === 'asneeded') entries = entries.filter((e) => e.item.mode === 'none');
  if (ui.filter === 'due') entries = entries.filter((e) => e.st.state === 'due_soon');
  if (ui.filter === 'inlist') entries = entries.filter((e) => e.st.state === 'in_list');
  if (q) entries = entries.filter((e) => norm(e.item.name).includes(q) || norm(catName(e.item.cat)).includes(q));

  if (!entries.length) {
    return `<div class="empty"><h3>No items</h3><p>${q ? `Nothing matches “${esc(ui.query)}”.` : ''}</p>
      ${q ? `<button class="btn secondary" data-act="newitem" data-name="${esc(ui.query)}">Create “${esc(ui.query)}”</button>` : ''}</div>`;
  }
  const groups = groupByCategory(entries);
  let html = q ? '' : collapseBar('itemsC', groups.map(([c]) => c), `${entries.length} items`);
  const due = deckCandidates(all).regular.length; // the same items the Review deck will ask about
  if (due > 0 && ui.filter !== 'asneeded') html += reviewStrip(due);
  for (const [cat, list] of groups) {
    const body = `<div class="group">${list.sort(byName).map((e) => itemRow(e.item, e.st)).join('')}</div>`;
    html += catSection('itemsC', cat, list.length, body, !!q, list.filter((e) => e.st.state === 'due_soon').length);
  }
  return html;
}

function itemsView() {
  return `<label class="search">${icons.search}<input id="itemsearch" type="text" placeholder="Search items" value="${esc(ui.query)}" autocomplete="off" autocorrect="off"></label>
    ${chipRow(ITEM_FILTERS, ui.filter, 'filter', 'margin-top:6px')}
    <div id="itemsresults">${itemsResults()}</div>`;
}

// ---------- meals ----------

function mealsView() {
  const meals = S.live(store.data.meals);
  const names = new Set(meals.map((m) => m.name.toLowerCase()));
  const f = ui.mealFilter;
  const tabs = [['all', 'All'], ...MEAL_CATEGORIES.map(([k, l]) => [k, l])];
  let html = `<div class="filter-tabs">${tabs
    .map(([k, l]) => `<button class="${f === k ? 'on' : ''}" data-act="mealfilter" data-f="${k}">${l}</button>`)
    .join('')}</div>`;
  const cats = f === 'all' ? [...MEAL_CATEGORIES, ['other', 'Other']] : MEAL_CATEGORIES.filter(([k]) => k === f);
  let any = false;
  for (const [k, label] of cats) {
    const mine = meals.filter((m) => mealCatOf(m) === k).sort((a, b) => a.name.localeCompare(b.name));
    if (mine.length) {
      any = true;
      if (f === 'all') html += `<div class="section-header">${label}</div>`;
      else html += `<div style="height:14px"></div>`;
      html += `<div class="group">${mine.map(mealRow).join('')}</div>`;
    }
    if (f !== 'all') {
      const ideas = (MEAL_IDEAS[k] || []).map((x, i) => [x[0], i]).filter(([n]) => !names.has(n.toLowerCase()));
      if (ideas.length) {
        any = true;
        html += `<div class="section-header">Ideas</div><div class="group">${ideas
          .map(([n, i]) => `<button class="row tappable action" data-act="mealidea" data-cat="${k}" data-i="${i}"><span class="plus-dot">${icons.plus}</span><div class="body">${esc(n)}</div></button>`)
          .join('')}</div>`;
      }
    }
  }
  if (!any) html += `<div class="empty"><h3>No meals yet</h3><button class="btn secondary" data-act="newmeal" data-cat="${f}" style="margin-top:12px">New meal</button></div>`;
  return html;
}

const mealCatOf = (m) => (MEAL_CATEGORIES.some(([k]) => k === m.category) ? m.category : 'other');
const mealIcon = (cat) => MEAL_CATEGORIES.find(([k]) => k === cat)?.[2] || '🍽️';

function mealRow(m) {
  const ings = (m.items || []).map((id) => store.data.items[id]).filter((i) => i && !i.deleted);
  const low = ings.filter((i) => ['needed', 'due', 'soon'].includes(S.status(i).kind)).length;
  if (mealsMode() === 'compact') {
    const r = `<button class="row tappable compact swipe-content" data-act="meal" data-id="${m.id}">
      <div class="body"><div class="title">${esc(m.name)}</div></div>
      <span class="detail small">${low ? `<span class="soon">${low} low</span> · ` : ''}${ings.length}</span><span class="chev">${icons.chevron}</span></button>`;
    return swipeRow(r, 'delmeal', m.id, 'Delete');
  }
  const row = `<button class="row tappable swipe-content" data-act="meal" data-id="${m.id}">
    <div class="body"><div class="title">${esc(m.name)}</div>
    <div class="sub">${ings.length} ingredient${ings.length === 1 ? '' : 's'}${low ? ` · <span class="soon">${low} low</span>` : ''}</div></div>
    <span class="chev">${icons.chevron}</span></button>`;
  return swipeRow(row, 'delmeal', m.id, 'Delete');
}




// ---------- settings ----------

function sRow(icon, color, title, detail, act) {
  return `<button class="row tappable srow" data-act="${act}">
    <span class="sicon" style="background:${color}">${icon}</span>
    <div class="body"><div class="title">${title}</div></div>
    ${detail ? `<span class="detail">${detail}</span>` : ''}
    <span class="chev">${icons.chevron}</span></button>`;
}

function settingsView() {
  const d = store.device;
  const viewLabel = { grid: 'Grid', list: 'List', compact: 'Compact' }[listMode()];
  const purchases = S.live(store.data.purchases).length;
  return `<div class="profile-card">
      <div class="avatar">${d.name ? esc(d.name.trim()[0].toUpperCase()) : '🙂'}</div>
      <div class="pc-body"><input id="devname" type="text" placeholder="Your name" value="${esc(d.name)}" autocomplete="off" enterkeyhint="done">
        <div class="sub">Shown on items you check off</div></div>
    </div>

    <div class="section-header">Shopping</div>
    <div class="group">
      ${sRow(icons.viewGrid, '#5e5ce6', 'List style', viewLabel, 'viewmenu')}
      <div class="row srow"><span class="sicon" style="background:#ff9f0a">${icons.clock}</span>
        <div class="body"><div class="title">Look ahead</div></div>
        <span class="detail">${d.lookahead} day${d.lookahead > 1 ? 's' : ''}</span>
        <div class="stepper"><button data-act="look" data-d="-1" aria-label="Less">−</button><button data-act="look" data-d="1" aria-label="More">+</button></div></div>
      ${sRow(icons.aisle, '#0a84ff', 'Aisle order', `${S.categories().length} categories`, 'aisles')}
      <label class="row srow"><span class="sicon" style="background:#64d2ff">${icons.viewCompact}</span>
        <div class="body"><div class="title">Simple view</div></div>
        <input type="checkbox" class="switch" id="simpleview" ${d.simple ? 'checked' : ''}></label>
    </div>

    <div class="section-header">Household</div>
    <div class="group">${sRow(icons.people, '#30d158', 'Partner sync', d.sync ? syncBadge() : 'Off', 'sync')}</div>

    <div class="section-header">Data</div>
    <div class="group">${sRow(icons.archive, '#8e8e93', 'Backup & restore', '', 'data')}</div>

    <p class="footer-meta">Restock ${VERSION}<br>${S.items().length} items · ${purchases} purchase${purchases === 1 ? '' : 's'} logged</p>`;
}

// ---------- render ----------

const app = document.getElementById('app');
const tabbar = document.getElementById('tabbar');

function render() {
  // Keep a focused text field alive across re-renders (no keyboard flicker).
  const active = document.activeElement;
  const keep = active && active.id && app.contains(active) && active.tagName === 'INPUT' ? active : null;

  const view = { list: listView, items: itemsView, meals: mealsView, settings: settingsView }[ui.tab]();
  const viewIcon = { list: icons.viewList, grid: icons.viewGrid, compact: icons.viewCompact }[listMode()];
  document.body.classList.toggle('simple', !!store.device.simple);
  const simpleIcon = (m) => (m === 'compact' ? icons.viewCompact : icons.viewList);
  const right =
    ui.tab === 'list'
      ? `<button class="nav-btn" data-act="viewmenu" aria-label="List style">${viewIcon}</button>`
      : ui.tab === 'items'
        ? `<button class="nav-btn" data-act="pagestyle" data-page="items" aria-label="List style">${simpleIcon(itemsMode())}</button>`
        : ui.tab === 'meals'
          ? `<button class="nav-btn" data-act="pagestyle" data-page="meals" aria-label="List style">${simpleIcon(mealsMode())}</button>`
          : '';
  const fab =
    ui.tab === 'items'
      ? `<button class="fab" data-act="newitem" aria-label="New item">${icons.plus}</button>`
      : ui.tab === 'meals'
        ? `<button class="fab" data-act="newmeal" aria-label="New meal">${icons.plus}</button>`
        : '';
  const badge = computeList().toBuy.length;
  const tabs = [
    ['list', 'Shopping list', icons.cart],
    ['items', 'Items', icons.noteList],
    ['meals', 'Meals', icons.meals],
    ['settings', 'Settings', icons.gear],
  ];
  app.innerHTML = `
    <header class="navbar ${window.scrollY > 4 ? 'scrolled' : ''}"><h1 class="nav-title">${TITLES[ui.tab]}</h1><div class="right">${right}</div></header>
    <main class="view">${view}</main>${fab}
    `;
  tabbar.innerHTML = tabs
    .map(
      ([k, l, ic]) =>
        `<button class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}" aria-label="${l}">${ic}${k === 'list' && badge ? `<span class="badge">${badge}</span>` : ''}</button>`,
    )
    .join('');

  if (keep) {
    const fresh = document.getElementById(keep.id);
    if (fresh) {
      fresh.replaceWith(keep);
      keep.focus({ preventScroll: true });
    }
  }
}

let raf = 0;
let renderPending = false;
const scheduleRender = () => {
  if (ui.dragging) {
    renderPending = true; // never rebuild the page under a finger
    return;
  }
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(render);
};

window.addEventListener('scroll', () => $('.navbar')?.classList.toggle('scrolled', window.scrollY > 4), { passive: true });

function switchTab(tab) {
  ui.scroll[ui.tab] = window.scrollY;
  if (tab !== 'list') exitAdding(false);
  ui.tab = tab;
  localSet('restock.tab', tab);
  render();
  window.scrollTo(0, ui.scroll[tab] || 0);
}

function refreshAddPanel() {
  const panel = $('#addpanel');
  if (panel) panel.innerHTML = addPanel();
  else render();
}

function exitAdding(rerender = true) {
  if (!ui.adding) return;
  const n = [...ui.addedNow].filter((id) => onListKind(S.status(store.data.items[id]).kind)).length;
  ui.adding = false;
  ui.addQuery = '';
  ui.addedNow.clear();
  document.activeElement?.blur();
  if (rerender) {
    render();
    if (n) toast(`${n} item${n > 1 ? 's' : ''} added to your list`);
  }
}

// ---------- actions ----------

function buy(id) {
  const pid = S.markBought(id);
  toast(`${store.data.items[id].name} is in the cart`, { undo: () => S.undoPurchase(pid) });
}

function toggleQuick(id) {
  const st = S.status(store.data.items[id]);
  if (onListKind(st.kind)) {
    if (st.kind === 'needed') S.setNeeded(id, false);
    else S.snooze(id);
    ui.addedNow.delete(id);
  } else {
    S.setNeeded(id, true);
    ui.addedNow.add(id);
  }
}

// ---------- shared sheet parts ----------

function rhythmBlock(r, editing = false) {
  const isPreset = RHYTHM_OPTIONS.some(([k]) => k === r);
  const custom = editing || (r !== null && !isPreset);
  const sel = (k) => (k === 'custom' ? custom : !editing && k === r);
  return `<div class="rhythm-grid">${RHYTHM_OPTIONS.map(([k, l]) =>
    k === 'custom' && custom
      ? `<label class="rhythm-card on custom"><input id="customdays" class="days-input" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2" value="${editing ? '' : r}" placeholder="--" aria-label="Days" enterkeyhint="done" autocomplete="off"><span>days</span></label>`
      : `<button class="rhythm-card ${sel(k) ? 'on' : ''}" data-s="rhythm" data-k="${k}"><b>${l}</b></button>`,
  ).join('')}</div>`;
}

// Focus the day box right away so the keyboard opens in the same tap.
function focusDays(root) {
  const el = root.querySelector('#customdays');
  if (el) el.focus();
}

function iconPicker(current, withAuto) {
  return `<div class="picker icon-grid">
    ${withAuto ? `<button class="auto ${current ? '' : 'on'}" data-s="pickicon" data-ic="">Auto</button>` : ''}
    ${ICON_CHOICES.map((ic) => `<button class="${ic === current ? 'on' : ''}" data-s="pickicon" data-ic="${ic}">${ic}</button>`).join('')}</div>`;
}

// Bring the selected category pill into view inside its horizontal scroller.
function centerSelectedPill() {}

function catPicker(current) {
  return `<div class="cat-grid">${S.categories()
    .map((c) => `<button class="cat-tile ${c.id === current ? 'on' : ''}" data-s="pickcat" data-c="${c.id}">${esc(c.name)}</button>`)
    .join('')}</div>`;
}

// ---------- item detail ----------

function itemDetail(id) {
  const local = { icon: false, cat: false, customEdit: false };
  const ctx = openSheet(
    (ctx) => {
      const item = store.data.items[id];
      if (!item || item.deleted) return ctx.close();
      const st = S.status(item);
      const hist = S.history(id);
      const on = onListKind(st.kind);
      const lvl = stockLevel(st);
      const last = hist[0];

      let statusTitle;
      if (st.kind === 'needed') statusTitle = 'On your list';
      else if (st.kind === 'due') statusTitle = st.daysLeft === 0 ? 'Due today' : `Due ${formatDays(st.daysLeft)}`;
      else if (st.daysLeft == null) statusTitle = 'Buy when needed';
      else statusTitle = `Runs out ${formatDays(st.daysLeft)}`;
      const statusSub = last
        ? `Last bought ${fmtDate(last.at)}${last.by ? ' by ' + esc(last.by) : ''}`
        : item.mode === 'none'
          ? 'Not bought yet'
          : `Assumed stocked since ${fmtDate(item.baselineAt)}`;

      const r = item.mode === 'none' ? null : item.interval || 7;

      const timeline = hist
        .slice(0, 8)
        .map((p, i) => {
          const prev = hist[i + 1];
          const gap = prev ? Math.round((p.at - prev.at) / DAY) : null;
          return `<div class="row compact"><span class="tl-dot"></span><div class="body"><div class="title">${fmtDate(p.at)}</div></div>
            <span class="detail small">${p.by ? esc(p.by) : ''}</span>${gap != null ? `<span class="pill">+${gap}d</span>` : ''}</div>`;
        })
        .join('');

      ctx.body.innerHTML = `${sheetHeader('')}
        <div class="sheet-body">
          <div class="hero-row detail">
            <button class="hero-icon" data-s="icon" aria-label="Change icon">${itemIcon(item)}<span class="hero-edit">${icons.pencil}</span></button>
            <div class="hero-text">
              <input class="hero-name" id="dname" value="${esc(item.name)}" autocomplete="off" enterkeyhint="done" aria-label="Name">
              <button class="cat-chip" data-s="cat">${esc(catName(item.cat))} <span class="caret">▾</span></button>
            </div>
          </div>
          ${local.icon ? iconPicker(item.icon || null, true) : ''}
          ${local.cat ? catPicker(item.cat) : ''}

          <div class="status-card ${st.kind}">
            <div class="status-title">${statusTitle}</div>
            <div class="status-sub">${statusSub}</div>
            ${lvl != null ? `<div class="meter"><div style="width:${Math.round(lvl * 100)}%;background:${barColor(st)}"></div></div><div class="meter-cap"><span>Empty</span><span>~${Math.round(lvl * 100)}% left</span><span>Full</span></div>` : ''}
          </div>

          <div class="action-row">
            <button class="action-tile ${on ? 'on' : ''}" data-s="toggle">${on ? icons.checkCircle : icons.cart}<span>${on ? 'On list' : 'Add to list'}</span></button>
            <button class="action-tile" data-s="buy">${icons.bag}<span>Bought now</span></button>
            <button class="action-tile" data-s="snooze" ${item.mode === 'none' ? 'disabled' : ''}>${icons.hourglass}<span>Still have</span></button>
          </div>

          <div class="section-header">How often</div>
          ${rhythmBlock(r, local.customEdit)}
          ${
            r !== null
              ? `<div class="group" style="margin-top:10px"><label class="row switch-row"><div class="body"><div class="title">Learn from my buying</div>
            ${item.mode === 'auto' && st.samples ? `<div class="sub">Learned: ${formatInterval(st.interval)}</div>` : ''}</div>
            <input type="checkbox" class="switch" data-s="learn" ${item.mode === 'auto' ? 'checked' : ''}></label></div>`
              : ''
          }

          <div class="section-header"><span>History</span>${hist.length ? `<span class="count">${hist.length} buy${hist.length > 1 ? 's' : ''}</span>` : ''}</div>
          ${hist.length ? `<div class="group timeline">${timeline}</div>` : `<p class="section-footer">No purchases yet</p>`}

          <button class="delete-btn" data-s="delete">${icons.trash} Delete item</button>
        </div>`;
      if (local.cat) centerSelectedPill(ctx.body);
    },
    { large: true },
  );

  ctx.body.addEventListener('change', (e) => {
    if (e.target.id !== 'dname') return;
    const name = e.target.value.trim();
    if (name && name !== store.data.items[id].name) {
      S.updateItem(id, { name });
      toast('Name saved');
    } else e.target.value = store.data.items[id].name;
  });
  ctx.body.addEventListener('keydown', (e) => {
    if (e.target.id === 'dname' && e.key === 'Enter') e.target.blur();
  });
  ctx.body.addEventListener('focusout', (e) => {
    if (e.target.id === 'customdays' && !e.target.value && local.customEdit)
      setTimeout(() => {
        if (local.customEdit && !ctx.body.querySelector('#customdays')?.value) {
          local.customEdit = false;
          ctx.rerender();
        }
      }, 200);
  });
  ctx.body.addEventListener('change', (e) => {
    if (e.target.id === 'customdays') {
      const v = parseInt(e.target.value, 10);
      const it = store.data.items[id];
      if (v >= 1 && v <= 99) S.updateItem(id, { interval: v, mode: it.mode === 'none' ? 'auto' : it.mode });
      local.customEdit = false;
      return ctx.rerender();
    }
    if (e.target.dataset.s === 'learn') {
      S.updateItem(id, { mode: e.target.checked ? 'auto' : 'fixed' });
      ctx.rerender();
    }
  });
  ctx.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.disabled) return;
    const item = store.data.items[id];
    const s = b.dataset.s;
    if (s === 'icon') local.icon = !local.icon;
    if (s === 'cat') local.cat = !local.cat;
    if (s === 'pickicon') {
      S.updateItem(id, { icon: b.dataset.ic || null });
      local.icon = false;
    }
    if (s === 'pickcat') {
      S.updateItem(id, { cat: b.dataset.c });
      local.cat = false;
    }
    if (s === 'toggle') {
      const st = S.status(item);
      if (st.kind === 'needed') S.setNeeded(id, false);
      else if (st.kind === 'due') S.snooze(id);
      else S.setNeeded(id, true);
    }
    if (s === 'buy') {
      buy(id);
      return ctx.close();
    }
    if (s === 'snooze') {
      const days = S.snooze(id);
      toast(`Hidden for ${days} day${days > 1 ? 's' : ''}`, { icon: '⏳' });
    }
    if (s === 'learn') return;
    if (s === 'rhythm') {
      const k = b.dataset.k;
      const mode = item.mode === 'none' ? 'auto' : item.mode;
      const cur = item.mode === 'none' ? null : item.interval;
      const preset = RHYTHM_OPTIONS.some(([x]) => x === cur);
      if (k === 'null') S.updateItem(id, { mode: 'none' });
      else if (k === 'custom') {
        local.customEdit = true;
        ctx.rerender();
        return focusDays(ctx.body);
      } else S.updateItem(id, { mode, interval: +k });
      local.customEdit = false;
    }
    if (s === 'custom') S.updateItem(id, { interval: Math.min(99, Math.max(1, Math.round(item.interval) + +b.dataset.d)) });
    if (s === 'delete') {
      return confirmAction(`Delete ${item.name}? Its history goes too.`, 'Delete item', () => {
        S.deleteItem(id);
        ctx.close();
        toast(`${item.name} deleted`, { icon: '🗑️' });
      });
    }
    ctx.rerender();
  });
}

// ---------- create item ----------

const RHYTHM_OPTIONS = [
  [3, 'Every few days'],
  [7, 'Weekly'],
  [14, 'Every 2 weeks'],
  [30, 'Monthly'],
  [null, 'As needed'],
  ['custom', 'Custom'],
];

function createSheet(presetName = '', { needed = true } = {}) {
  const d = { name: presetName, cat: null, icon: null, rhythm: undefined, needed, pickIcon: false, pickCat: false, customEdit: false };
  const cat = () => d.cat || guessCategory(d.name, S.items()) || 'other';
  const rhythm = () => (d.rhythm !== undefined ? d.rhythm : (CATEGORY_RHYTHM[cat()] ?? null));
  const isPreset = (r) => RHYTHM_OPTIONS.some(([k]) => k === r);

  let ctx;
  ctx = openSheet(
    (c) => {
      ctx = c;
      ctx.body.innerHTML = `${sheetHeader('New item')}
        <div class="sheet-body">
          <div class="hero-row">
            <button class="hero-icon" data-s="icon" id="cicon" aria-label="Change icon"></button>
            <div class="hero-text"><input class="hero-name" id="cname" placeholder="Item name" value="${esc(d.name)}" autocomplete="off" enterkeyhint="done"></div>
          </div>
          <div id="cdyn"></div>
        </div>
        <div class="sheet-footer"><button class="btn" data-s="save" id="csave"></button></div>`;
      paint();
    },
    { large: true },
  );

  // Only the parts below the name field re-render while typing, so the keyboard never flickers.
  function paint() {
    const body = ctx.body;
    const c = cat();
    const r = rhythm();
    const name = d.name.trim();
    const dup = name && S.findItemByName(name);
    body.querySelector('#cicon').innerHTML = `${d.icon || guessItemIcon(name) || catIcon(c)}<span class="hero-edit">${icons.pencil}</span>`;
    body.querySelector('#cdyn').innerHTML = `
      ${d.pickIcon ? iconPicker(d.icon, true) : ''}
      ${
        dup
          ? `<div class="card dup"><h4>${itemIcon(dup)} ${esc(dup.name)} is already in your items</h4>
          <button class="btn secondary" data-s="adddup">Add it to the list instead</button></div>`
          : ''
      }
      <div class="section-header"><span>Category</span>${!d.cat && name && guessCategory(name, S.items()) ? '<span class="auto-tag">✨ Guessed</span>' : ''}</div>
      <button class="cat-select" data-s="togglecat"><b>${esc(catName(c))}</b><span class="cat-change">${d.pickCat ? 'Close' : 'Change'}</span></button>
      ${d.pickCat ? catPicker(c) : ''}
      <div class="section-header"><span>How often</span>${d.rhythm === undefined && name ? '<span class="auto-tag">✨ Suggested</span>' : ''}</div>
      ${rhythmBlock(r, d.customEdit)}
      <div class="group" style="margin-top:16px"><label class="row switch-row"><div class="body"><div class="title">Add to shopping list now</div></div>
        <input type="checkbox" class="switch" data-s="needed" ${d.needed ? 'checked' : ''}></label></div>`;
    centerSelectedPill(body);
    const btn = body.querySelector('#csave');
    btn.textContent = name ? `Add ${name}` : 'Add item';
    btn.disabled = !name || !!dup;
  }

  ctx.body.addEventListener('input', (e) => {
    if (e.target.id === 'cname') {
      d.name = e.target.value;
      paint();
    }
  });
  ctx.body.addEventListener('change', (e) => {
    if (e.target.dataset.s === 'needed') d.needed = e.target.checked;
    if (e.target.id === 'customdays') {
      const v = parseInt(e.target.value, 10);
      if (v >= 1 && v <= 99) d.rhythm = v;
      d.customEdit = false;
      paint();
    }
  });
  ctx.body.addEventListener('focusout', (e) => {
    if (e.target.id === 'customdays' && !e.target.value && d.customEdit)
      setTimeout(() => {
        if (d.customEdit && !ctx.body.querySelector('#customdays')?.value) {
          d.customEdit = false;
          paint();
        }
      }, 200);
  });
  ctx.body.addEventListener('keydown', (e) => {
    if (e.target.id === 'cname' && e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
  });
  ctx.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.disabled || b.dataset.s === 'needed') return;
    const s = b.dataset.s;
    if (s === 'icon') d.pickIcon = !d.pickIcon;
    if (s === 'pickicon') {
      d.icon = b.dataset.ic || null;
      d.pickIcon = false;
    }
    if (s === 'togglecat') d.pickCat = !d.pickCat;
    if (s === 'pickcat') {
      d.cat = b.dataset.c;
      d.pickCat = false;
    }
    if (s === 'rhythm') {
      const k = b.dataset.k;
      const r = rhythm();
      if (k === 'custom') {
        d.customEdit = true;
        paint();
        return focusDays(ctx.body);
      }
      d.customEdit = false;
      d.rhythm = k === 'null' ? null : +k;
    }
    if (s === 'custom') d.rhythm = Math.min(99, Math.max(1, rhythm() + +b.dataset.d));
    if (s === 'adddup') {
      const dup = S.findItemByName(d.name);
      S.setNeeded(dup.id, true);
      toast(`${dup.name} added to your list`);
      return ctx.close();
    }
    if (s === 'save') {
      const r = rhythm();
      const name = d.name.trim();
      const newId = S.addItem({ name, cat: cat(), mode: r === null ? 'none' : 'auto', interval: r ?? 7, needed: d.needed });
      if (d.icon) S.updateItem(newId, { icon: d.icon });
      toast(d.needed ? `${name} created and added to your list` : `${name} created`);
      return ctx.close();
    }
    paint();
  });
  if (!presetName) setTimeout(() => ctx.body.querySelector('#cname')?.focus(), 350);
}

// ---------- settings sheets ----------

function aislesSheet() {
  const ctx = openSheet(
    (ctx) => {
      ctx.body.innerHTML = `${sheetHeader('Aisle order')}
        <div class="sheet-body">
          <div class="group aisle-list">${S.categories()
            .map(
              (c) => `<div class="row arow" data-id="${c.id}">
              <button class="body" data-s="edit" data-id="${c.id}"><div class="title">${esc(c.name)}</div></button>
              <span class="drag-handle" data-nodrag aria-label="Drag to reorder">${icons.grip}</span></div>`,
            )
            .join('')}</div>
          <button class="btn secondary" data-s="add" style="margin-top:16px">Add category</button>
        </div>`;
    },
    { large: true },
  );

  ctx.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'edit') categorySheet(b.dataset.id, () => ctx.rerender());
    if (b.dataset.s === 'add') categorySheet(null, () => ctx.rerender());
  });

  // drag to reorder
  ctx.body.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.drag-handle');
    if (!handle) return;
    e.preventDefault();
    const rows = [...ctx.body.querySelector('.aisle-list').children];
    const row = handle.closest('.arow');
    const from = rows.indexOf(row);
    const H = row.offsetHeight;
    const startY = e.clientY;
    let to = from;
    handle.setPointerCapture(e.pointerId);
    row.classList.add('dragging');
    const move = (ev) => {
      const dy = ev.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;
      to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / H)));
      rows.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -H;
        if (from > to && i < from && i >= to) shift = H;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      rows.forEach((r) => (r.style.transform = ''));
      row.classList.remove('dragging');
      if (to !== from) {
        const ids = rows.map((r) => r.dataset.id);
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        S.setCategoryOrder(ids);
        ctx.rerender();
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}

function categorySheet(id, done) {
  const cat = id ? store.data.categories[id] : null;
  const ctx = openSheet((ctx) => {
    ctx.body.innerHTML = `${sheetHeader(id ? 'Category' : 'New category')}
      <div class="sheet-body">
        <div class="group" style="margin-top:8px"><label class="row"><input type="text" id="catname" value="${esc(cat?.name || '')}" placeholder="Category name" autocomplete="off" enterkeyhint="done"></label></div>
      </div>
      <div class="sheet-footer"><button class="btn" data-s="save">${id ? 'Save' : 'Add category'}</button></div>`;
  });
  setTimeout(() => ctx.body.querySelector('#catname')?.focus(), 350);
  ctx.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s="save"]');
    if (!b) return;
    const name = ctx.body.querySelector('#catname').value.trim();
    if (!name) return ctx.body.querySelector('#catname').focus();
    if (id) S.updateCategory(id, { name });
    else S.addCategory(name);
    ctx.close();
    done?.();
  });
}

function syncSheet() {
  const ctx = openSheet((ctx) => {
    const c = store.device.sync;
    if (!c) {
      ctx.body.innerHTML = `${sheetHeader('Partner sync')}
        <div class="sheet-body">
          <div class="feature-hero"><div class="fh-icon">👫</div><h3>Share one list</h3></div>
          <div class="choice-list">
            <button class="choice" data-s="setup"><span class="sicon" style="background:#30d158">${icons.people}</span>
              <div><b>Set up on this phone</b><span>First time. Needs a GitHub token (2 min).</span></div><span class="chev">${icons.chevron}</span></button>
            <button class="choice" data-s="join"><span class="sicon" style="background:#0a84ff">${icons.share}</span>
              <div><b>Join my partner's list</b><span>Paste the invite code they sent you.</span></div><span class="chev">${icons.chevron}</span></button>
          </div>
        </div>`;
    } else {
      ctx.body.innerHTML = `${sheetHeader('Partner sync')}
        <div class="sheet-body">
          <div class="feature-hero compact"><div class="fh-icon">👫</div><h3>${syncBadge()}</h3>
            <p>${syncState.lastSync ? `Last synced ${fmtAgo(syncState.lastSync)}` : 'Not synced yet'}</p>
            ${syncState.error ? `<p class="err">${esc(syncState.error)}</p>` : ''}</div>
          <div class="group">
            <button class="row tappable action" data-s="invite"><div class="body">Invite partner</div><span class="chev">${icons.chevron}</span></button>
            <button class="row tappable action" data-s="now"><div class="body">Sync now</div></button>
            <div class="row"><div class="body"><div class="title">Repository</div></div><span class="detail small">${esc(c.owner)}/${esc(c.repo)}</span></div>
          </div>
          <button class="delete-btn" data-s="disconnect">Disconnect this phone</button>
        </div>`;
    }
  });
  const off = onSyncChange(() => ctx.rerender());
  ctx.onClose = off;
  ctx.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const s = b.dataset.s;
    if (s === 'setup') setupSheet(() => ctx.rerender());
    if (s === 'join') joinSheet('', () => ctx.rerender());
    if (s === 'invite') inviteSheet();
    if (s === 'now') syncNow();
    if (s === 'disconnect')
      confirmAction('Stop syncing on this phone? Your data stays here.', 'Disconnect', () => {
        disconnect();
        ctx.rerender();
      });
  });
}

function joinSheet(prefill = '', done) {
  const ctx = openSheet((ctx) => {
    ctx.body.innerHTML = `${sheetHeader('Join list')}
      <div class="sheet-body">
        <p class="sheet-intro">Paste your partner's invite code.</p>
        <textarea class="code" id="joincode" placeholder="RS1.…" autocapitalize="off" autocorrect="off" spellcheck="false">${esc(prefill)}</textarea>
        <div class="err" id="joinerr"></div>
      </div>
      <div class="sheet-footer two"><button class="btn secondary" data-s="paste">Paste</button><button class="btn" data-s="go">Join</button></div>`;
  });
  ctx.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const ta = ctx.body.querySelector('#joincode');
    if (b.dataset.s === 'paste') {
      try {
        ta.value = await navigator.clipboard.readText();
      } catch {
        ta.focus();
      }
    }
    if (b.dataset.s === 'go') {
      b.disabled = true;
      b.textContent = 'Joining…';
      try {
        await connect(parseInvite(ta.value));
        ctx.close();
        done?.();
        toast('Connected. Your lists are now shared.', { icon: '👫' });
      } catch (x) {
        ctx.body.querySelector('#joinerr').textContent = x.message;
        b.disabled = false;
        b.textContent = 'Join';
      }
    }
  });
}

function setupSheet(done) {
  const d = { owner: 'YBousetta', repo: 'restock-data', token: '' };
  const ctx = openSheet(
    (ctx) => {
      ctx.body.innerHTML = `${sheetHeader('Set up sync')}
      <div class="sheet-body">
        <ol class="steps">
          <li>Open <b>github.com/settings/personal-access-tokens/new</b></li>
          <li>Repository access: <b>only ${esc(d.repo)}</b></li>
          <li>Permissions → <b>Contents: Read and write</b></li>
          <li>Generate, copy the token, paste it below</li>
        </ol>
        <div class="group">
          <label class="row"><span class="label">Owner</span><input type="text" data-f="owner" value="${esc(d.owner)}" style="text-align:right" autocapitalize="off" autocorrect="off"></label>
          <label class="row"><span class="label">Repo</span><input type="text" data-f="repo" value="${esc(d.repo)}" style="text-align:right" autocapitalize="off" autocorrect="off"></label>
          <label class="row"><span class="label">Token</span><input type="text" data-f="token" placeholder="github_pat_…" style="text-align:right" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        </div>
        <div class="err" id="seterr"></div>
      </div>
      <div class="sheet-footer"><button class="btn" data-s="go">Connect</button></div>`;
    },
    { large: true },
  );
  ctx.body.addEventListener('input', (e) => {
    if (e.target.dataset.f) d[e.target.dataset.f] = e.target.value.trim();
  });
  ctx.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.dataset.s !== 'go') return;
    const err = ctx.body.querySelector('#seterr');
    if (!d.owner || !d.repo || !d.token) return (err.textContent = 'Fill in all three fields.');
    b.disabled = true;
    b.textContent = 'Connecting…';
    try {
      await connect({ owner: d.owner, repo: d.repo, token: d.token });
      ctx.close();
      done?.();
      toast('Sync is on', { icon: '👫' });
      inviteSheet();
    } catch (x) {
      err.textContent = x.message;
      b.disabled = false;
      b.textContent = 'Connect';
    }
  });
}

function inviteSheet() {
  const code = inviteCode();
  const link = `${location.origin}${location.pathname}#join=${code}`;
  const ctx = openSheet((ctx) => {
    ctx.body.innerHTML = `${sheetHeader('Invite partner')}
      <div class="sheet-body">
        <div class="feature-hero compact"><div class="fh-icon">💌</div><h3>Send this privately</h3><p>The link contains the access key to your list.</p></div>
        <ol class="steps">
          <li>Your partner opens the link on their iPhone</li>
          <li><b>Share → Add to Home Screen</b></li>
          <li>Opens Restock from the Home Screen → Settings → Partner sync → <b>Join</b> → paste the code</li>
        </ol>
        <textarea class="code" readonly>${esc(code)}</textarea>
      </div>
      <div class="sheet-footer two"><button class="btn secondary" data-s="copy">Copy code</button><button class="btn" data-s="share">Share link</button></div>`;
  });
  ctx.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'copy') {
      try {
        await navigator.clipboard.writeText(code);
        toast('Code copied');
      } catch {
        toast('Copy failed. Select the text instead.', { icon: '⚠️' });
      }
    }
    if (b.dataset.s === 'share') {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Join our Restock list', text: `Our shared grocery list. Invite code:\n${code}`, url: link });
        } catch {}
      } else {
        await navigator.clipboard.writeText(link);
        toast('Link copied');
      }
    }
  });
}

function dataSheet() {
  const ctx = openSheet((ctx) => {
    ctx.body.innerHTML = `${sheetHeader('Backup & restore')}
      <div class="sheet-body">
        <div class="group">
          <button class="row tappable action" data-s="export"><div class="body">Export backup</div></button>
          <label class="row tappable action"><div class="body">Import backup</div><input type="file" accept="application/json,.json" id="importfile" hidden></label>
        </div>
        <button class="delete-btn" data-s="reset">Reset to starting list</button>
      </div>`;
  });
  ctx.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'export') exportData();
    if (b.dataset.s === 'reset')
      confirmAction('Replace items, meals and history on this phone with the starting list?', 'Reset', () => {
        S.resetData();
        ctx.close();
      });
  });
  ctx.body.addEventListener('change', async (e) => {
    if (e.target.id !== 'importfile') return;
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.items) throw new Error();
      S.importData(data);
      toast('Backup imported');
      ctx.close();
    } catch {
      toast('That file is not a Restock backup', { icon: '⚠️' });
    }
  });
}

async function exportData() {
  const json = JSON.stringify(store.data, null, 1);
  const name = `restock-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch {}
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function pageStyleMenu(page) {
  const key = page === 'items' ? 'itemsView' : 'mealsView';
  const cur = store.device[key] || 'list';
  const opt = (k, l, ic) => ({ label: l, icon: ic, on: cur === k, run: () => S.saveDevice({ [key]: k }) });
  actionSheet(`${page === 'items' ? 'Items' : 'Meals'} style`, [opt('list', 'List', icons.viewList), opt('compact', 'Compact', icons.viewCompact)]);
}

function viewMenu() {
  const cur = listMode();
  const opt = (k, l, ic) => ({ label: l, icon: ic, on: cur === k, run: () => S.saveDevice({ listView: k }) });
  actionSheet('Shopping list style', [opt('grid', 'Grid', icons.viewGrid), opt('list', 'List', icons.viewList), opt('compact', 'Compact', icons.viewCompact)]);
}

// ---------- meal sheets ----------

function mealSheet(id) {
  const meal = store.data.meals[id];
  const picked = new Set();
  for (const iid of meal.items) {
    const it = store.data.items[iid];
    if (it && !it.deleted && ['due', 'soon'].includes(S.status(it).kind)) picked.add(iid);
  }
  const ctx = openSheet((ctx) => {
    const ings = meal.items.map((iid) => store.data.items[iid]).filter((i) => i && !i.deleted);
    ctx.body.innerHTML = `${sheetHeader(meal.name, `<button class="nav-btn" data-s="edit">Edit</button>`)}
      <div class="sheet-body">
        <div class="grid">${ings
          .map((i) => {
            const st = S.status(i);
            const already = st.kind === 'needed';
            const sel = already || picked.has(i.id);
            return `<button class="tile pick ${sel ? 'sel' : ''}" data-s="pick" data-id="${i.id}" ${already ? 'disabled' : ''}>
              <span class="tile-icon">${itemIcon(i)}</span><span class="tile-name">${esc(i.name)}</span>
              <span class="tile-freq">${already ? 'on list' : st.daysLeft == null ? 'as needed' : st.daysLeft <= 0 ? 'due' : formatDays(st.daysLeft)}</span>
              <span class="tile-sel">${icons.check}</span></button>`;
          })
          .join('')}</div>
      </div>
      <div class="sheet-footer"><button class="btn" data-s="add" ${picked.size ? '' : 'disabled'}>${picked.size ? `Add ${picked.size} to list` : 'Nothing selected'}</button></div>`;
  });
  ctx.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.disabled) return;
    const s = b.dataset.s;
    if (s === 'edit') {
      ctx.close();
      return mealWizard({ id });
    }
    if (s === 'pick') {
      picked.has(b.dataset.id) ? picked.delete(b.dataset.id) : picked.add(b.dataset.id);
      return ctx.rerender();
    }
    if (s === 'add') {
      for (const iid of picked) S.setNeeded(iid, true);
      toast(`${picked.size} item${picked.size > 1 ? 's' : ''} added for ${meal.name}`);
      ctx.close();
    }
  });
}

// Three steps: 1 name + type, 2 ingredients (food only, new ones allowed), 3 pick what to buy, then save.
function mealWizard({ id = null, cat = null, name = '', ingredientNames = null, step = 1 } = {}) {
  const meal = id ? store.data.meals[id] : null;
  const d = {
    step,
    name: meal ? meal.name : name,
    cat: meal ? meal.category || null : cat,
    items: new Set(meal ? meal.items.filter((i) => store.data.items[i] && !store.data.items[i].deleted) : []),
    fresh: [], // new ingredient names, created when the meal is saved
    q: '',
    shop: null, // what to add to the shopping list (item ids, or "new:<name>")
  };
  const useIdea = (names) => {
    d.items.clear();
    d.fresh = [];
    for (const n of names) {
      const ex = S.findItemByName(n);
      if (ex) d.items.add(ex.id);
      else if (!d.fresh.includes(n)) d.fresh.push(n);
    }
  };
  if (ingredientNames) useIdea(ingredientNames);
  if (!d.name.trim() || !d.cat) d.step = 1;

  const STEPS = ['Meal', 'Ingredients', 'Shopping'];
  const total = () => d.items.size + d.fresh.length;
  const isFood = (i) => !NON_FOOD.has(i.cat);

  let ctx;
  ctx = openSheet(
    (c) => {
      ctx = c;
      build();
    },
    { large: true },
  );

  function header() {
    const back = d.step > 1 ? `<button class="nav-btn back-btn" data-s="back">‹ Back</button>` : '';
    return `${sheetHeader(id ? 'Edit meal' : 'New meal', back)}
      <div class="steps-bar">${STEPS.map((t, i) => `<div class="${i + 1 <= d.step ? 'on' : ''} ${i + 1 === d.step ? 'cur' : ''}"><i></i><span>${t}</span></div>`).join('')}</div>`;
  }

  function build() {
    if (d.step === 1) {
      const ideas = !id && d.cat ? MEAL_IDEAS[d.cat] || [] : [];
      ctx.body.innerHTML = `${header()}
        <div class="sheet-body">
          <div class="hero-row">
            <div class="hero-icon static">${d.cat ? mealIcon(d.cat) : '🍽️'}</div>
            <div class="hero-text"><input class="hero-name" id="wname" placeholder="Name your meal" value="${esc(d.name)}" autocomplete="off" enterkeyhint="done"></div>
          </div>
          <div class="section-header">What kind of meal?</div>
          <div class="mealcat-grid">${MEAL_CATEGORIES.map(
            ([k, l, ic]) => `<button class="mealcat ${d.cat === k ? 'on' : ''}" data-s="cat" data-c="${k}"><span>${ic}</span>${l}</button>`,
          ).join('')}</div>
          ${
            ideas.length
              ? `<div class="section-header">Or start from an idea</div>
            <div class="chip-wrap">${ideas.map(([n], i) => `<button class="chip-item" data-s="idea" data-i="${i}"><span>✨</span>${esc(n)}</button>`).join('')}</div>`
              : ''
          }
        </div>
        <div class="sheet-footer"><button class="btn" data-s="next" id="wnext">Next: ingredients</button></div>`;
      syncNext();
      if (!d.name) setTimeout(() => ctx.body.querySelector('#wname')?.focus(), 350);
    }

    if (d.step === 2) {
      ctx.body.innerHTML = `${header()}
        <div class="sheet-body">
          <div class="wiz-title"><span>${mealIcon(d.cat)}</span>${esc(d.name)}</div>
          <div class="section-header"><span id="wcount"></span></div>
          <div class="ing-chips" id="ingchips"></div>
          <label class="search" style="margin-top:12px">${icons.search}<input id="wq" type="text" placeholder="Search or add an ingredient" autocomplete="off" autocorrect="off" enterkeyhint="done"></label>
          <div id="wresults"></div>
        </div>
        <div class="sheet-footer"><button class="btn" data-s="next" id="wnext">Next: shopping</button></div>`;
      paintIngredients();
    }

    if (d.step === 3) {
      if (!d.shop) {
        d.shop = new Set(d.fresh.map((n) => 'new:' + n));
        for (const iid of d.items) if (['due', 'soon'].includes(S.status(store.data.items[iid]).kind)) d.shop.add(iid);
      }
      const tiles = [
        ...[...d.items].map((iid) => {
          const it = store.data.items[iid];
          const st = S.status(it);
          const on = onListKind(st.kind);
          const sel = on || d.shop.has(iid);
          const sub = on ? 'on list' : st.daysLeft == null ? 'as needed' : st.daysLeft <= 0 ? 'due' : formatDays(st.daysLeft);
          return `<button class="tile pick ${sel ? 'sel' : ''}" data-s="shop" data-k="${iid}" ${on ? 'disabled' : ''}>
            <span class="tile-icon">${itemIcon(it)}</span><span class="tile-name">${esc(it.name)}</span><span class="tile-freq">${sub}</span><span class="tile-sel">${icons.check}</span></button>`;
        }),
        ...d.fresh.map((n) => {
          const k = 'new:' + n;
          return `<button class="tile pick ${d.shop.has(k) ? 'sel' : ''}" data-s="shop" data-k="${esc(k)}">
            <span class="tile-icon">${guessItemIcon(n) || '🛒'}</span><span class="tile-name">${esc(n)}</span><span class="tile-freq new-tag">new item</span><span class="tile-sel">${icons.check}</span></button>`;
        }),
      ];
      const n = [...d.shop].length;
      ctx.body.innerHTML = `${header()}
        <div class="sheet-body">
          <div class="feature-hero compact"><div class="fh-icon">🛒</div><h3>Need anything for it?</h3></div>
          <div class="grid">${tiles.join('')}</div>
        </div>
        <div class="sheet-footer"><button class="btn" data-s="save">${n ? `Save & add ${n} to list` : 'Save meal'}</button></div>`;
    }
  }

  function syncNext() {
    const btn = ctx.body.querySelector('#wnext');
    if (!btn) return;
    if (d.step === 1) btn.disabled = !d.name.trim() || !d.cat;
    if (d.step === 2) {
      btn.disabled = total() === 0;
      btn.textContent = total() ? `Next: shopping (${total()})` : 'Add at least one ingredient';
    }
  }

  function paintIngredients() {
    const body = ctx.body;
    body.querySelector('#wcount').textContent = `Ingredients · ${total()}`;
    const chips = [
      ...[...d.items].map((iid) => {
        const it = store.data.items[iid];
        return `<button class="ing-chip" data-s="rm" data-k="${iid}"><span>${itemIcon(it)}</span>${esc(it.name)}<b>×</b></button>`;
      }),
      ...d.fresh.map((n) => `<button class="ing-chip new" data-s="rmfresh" data-n="${esc(n)}"><span>${guessItemIcon(n) || '🛒'}</span>${esc(n)}<i>new</i><b>×</b></button>`),
    ];
    body.querySelector('#ingchips').innerHTML = chips.length ? chips.join('') : `<p class="ing-empty">Nothing yet. Search below or tap a suggestion.</p>`;

    const q = d.q.trim();
    let html = '';
    if (q) {
      const results = searchItems(q, 20).filter(isFood).slice(0, 8);
      html += `<div class="group suggestions">`;
      for (const it of results) {
        const on = d.items.has(it.id);
        html += `<button class="row tappable" data-s="toggle" data-k="${it.id}" data-keepfocus>
          <span class="item-icon">${itemIcon(it)}</span><div class="body"><div class="title">${esc(it.name)}</div><div class="sub">${esc(catName(it.cat))}</div></div>
          <span class="sug-add ${on ? 'on' : ''}">${on ? icons.checkCircle : icons.plusCircle}</span></button>`;
      }
      const exists = S.findItemByName(q);
      if (!exists && !d.fresh.some((n) => n.toLowerCase() === q.toLowerCase())) {
        const gc = guessCategory(q, S.items());
        const fc = gc && !NON_FOOD.has(gc) ? gc : 'pantry';
        html += `<button class="row tappable create-row" data-s="addfresh" data-keepfocus>
          <span class="item-icon new">${icons.plus}</span><div class="body"><div class="title">Add “${esc(q)}”</div>
          <div class="sub">New ingredient · also added to your items as ${esc(catName(fc))}</div></div></button>`;
      } else if (exists && !isFood(exists)) {
        html += `<p class="section-footer">${esc(exists.name)} isn't food, so it can't be an ingredient.</p>`;
      }
      html += `</div>`;
    } else {
      const counts = S.purchaseCounts();
      const popular = S.items()
        .filter((i) => isFood(i) && i.mode !== 'none' && !d.items.has(i.id))
        .sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0) || a.interval - b.interval || a.name.localeCompare(b.name))
        .slice(0, 18);
      html += `<div class="section-header">Popular ingredients</div>
        <div class="chip-wrap">${popular.map((i) => `<button class="chip-item" data-s="toggle" data-k="${i.id}"><span>${itemIcon(i)}</span>${esc(i.name)}</button>`).join('')}</div>`;
    }
    body.querySelector('#wresults').innerHTML = html;
    syncNext();
  }

  ctx.body.addEventListener('input', (e) => {
    if (e.target.id === 'wname') {
      d.name = e.target.value;
      syncNext();
    }
    if (e.target.id === 'wq') {
      d.q = e.target.value;
      paintIngredients();
    }
  });
  ctx.body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'wname') e.target.blur();
    if (e.target.id === 'wq') {
      e.preventDefault();
      const q = d.q.trim();
      if (!q) return e.target.blur();
      const top = searchItems(q, 20).find((i) => isFood(i) && !d.items.has(i.id));
      if (top && top.name.toLowerCase().startsWith(q.toLowerCase())) d.items.add(top.id);
      else if (!S.findItemByName(q) && !d.fresh.some((n) => n.toLowerCase() === q.toLowerCase())) d.fresh.push(q);
      d.q = '';
      e.target.value = '';
      paintIngredients();
    }
  });
  ctx.body.addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-keepfocus]')) e.preventDefault();
  });
  ctx.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b || b.disabled) return;
    const s = b.dataset.s;
    if (s === 'back') {
      d.step--;
      return build();
    }
    if (s === 'cat') {
      d.cat = b.dataset.c;
      return build();
    }
    if (s === 'idea') {
      const [n, ings] = MEAL_IDEAS[d.cat][+b.dataset.i];
      d.name = n;
      useIdea(ings);
      d.step = 2;
      return build();
    }
    if (s === 'next') {
      d.step++;
      if (d.step === 3) d.shop = null;
      return build();
    }
    if (s === 'toggle') d.items.has(b.dataset.k) ? d.items.delete(b.dataset.k) : d.items.add(b.dataset.k);
    if (s === 'rm') d.items.delete(b.dataset.k);
    if (s === 'rmfresh') d.fresh = d.fresh.filter((n) => n !== b.dataset.n);
    if (s === 'addfresh') {
      d.fresh.push(d.q.trim());
      d.q = '';
      const inp = ctx.body.querySelector('#wq');
      if (inp) inp.value = '';
    }
    if (['toggle', 'rm', 'rmfresh', 'addfresh'].includes(s)) return paintIngredients();
    if (s === 'shop') {
      d.shop.has(b.dataset.k) ? d.shop.delete(b.dataset.k) : d.shop.add(b.dataset.k);
      return build();
    }
    if (s === 'save') {
      const ids = [...d.items];
      for (const n of d.fresh) {
        const existing = S.findItemByName(n);
        if (existing) {
          ids.push(existing.id);
          if (d.shop.has('new:' + n)) S.setNeeded(existing.id, true);
          continue;
        }
        const g = guessCategory(n, S.items());
        const c = g && !NON_FOOD.has(g) ? g : 'pantry';
        const r = CATEGORY_RHYTHM[c] ?? null;
        ids.push(S.addItem({ name: n, cat: c, mode: r === null ? 'none' : 'auto', interval: r ?? 7, needed: d.shop.has('new:' + n) }));
      }
      for (const iid of d.items) if (d.shop.has(iid)) S.setNeeded(iid, true);
      S.saveMeal({ id, name: d.name.trim(), category: d.cat, items: ids });
      const n = d.shop.size;
      toast(`${d.name.trim()} saved${n ? ` · ${n} added to your list` : ''}`, { icon: mealIcon(d.cat) });
      ctx.close();
    }
  });
}

// ---------- events ----------

function onAction(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  switch (act) {
    case 'tab':
      return switchTab(b.dataset.tab);
    case 'buy':
      return buy(id);
    case 'tilebuy':
      b.classList.add('done');
      return setTimeout(() => buy(id), 260);
    case 'undo':
      return S.undoPurchase(id);
    case 'detail':
      return itemDetail(id);
    case 'need':
      S.setNeeded(id, true);
      return toast(`${store.data.items[id].name} added to your list`);
    case 'unneed': {
      const st = S.status(store.data.items[id]);
      if (st.kind === 'needed') S.setNeeded(id, false);
      else S.snooze(id);
      return toast(`${store.data.items[id].name} removed from list`, { icon: '−' });
    }
    case 'addcoming': {
      const { coming } = computeList();
      coming.forEach((c) => S.setNeeded(c.item.id, true));
      return toast(`${coming.length} item${coming.length > 1 ? 's' : ''} added`);
    }
    case 'quick':
      toggleQuick(id);
      return refreshAddPanel();
    case 'adddone':
      return exitAdding();
    case 'createitem': {
      const name = ui.addQuery.trim();
      ui.addQuery = '';
      if ($('#quickadd')) $('#quickadd').value = '';
      refreshAddPanel();
      document.activeElement?.blur();
      return createSheet(name, { needed: true });
    }
    case 'newitem':
      return createSheet(b.dataset.name || '', { needed: false });
    case 'filter':
      ui.filter = b.dataset.f;
      return render();
    case 'meal':
      return mealSheet(id);
    case 'newmeal': {
      const c = b.dataset.cat || (ui.mealFilter !== 'all' ? ui.mealFilter : null);
      return mealWizard({ cat: c && c !== 'all' && c !== 'other' ? c : null });
    }
    case 'togglecat': {
      const set = collapsed(b.dataset.scope);
      set.has(b.dataset.c) ? set.delete(b.dataset.c) : set.add(b.dataset.c);
      return setCollapsed(b.dataset.scope, set);
    }
    case 'collapseall': {
      const cats = b.dataset.cats.split(',').filter(Boolean);
      const set = collapsed(b.dataset.scope);
      const allClosed = cats.every((c) => set.has(c));
      return setCollapsed(b.dataset.scope, allClosed ? [] : cats);
    }
    case 'deckopen': {
      const c = deckCandidates(computeList().all).deck;
      if (!c.length) return;
      ui.deck = newDeck(c.map((e) => e.item.id));
      render();
      return $('.deck')?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    case 'review': {
      const c = deckCandidates(computeList().all).deck;
      if (!c.length) return;
      ui.deck = newDeck(c.map((e) => e.item.id));
      ui.autoDeckOff = false;
      switchTab('list');
      return $('.deck')?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
    case 'deckneed':
      return flyCard('need');
    case 'deckhave':
      return flyCard('have');
    case 'deckundo':
      return undoDeck();
    case 'deckview':
      ui.deck = null;
      ui.autoDeckOff = true;
      render();
      return window.scrollTo(0, 0);
    case 'cyclechange': {
      const it = store.data.items[id];
      // A learned item would drift back toward its history, so pin the number you chose.
      S.updateItem(id, { interval: +b.dataset.n, ...(S.status(it).samples ? { mode: 'fixed' } : {}) });
      S.resetHaveStreak(id);
      return toast(`${it.name}: every ${b.dataset.n} days`);
    }
    case 'cyclekeep':
      return S.resetHaveStreak(id);
    case 'clearcart':
      return S.saveDevice({ cartClearedAt: Date.now() });
    case 'mealfilter':
      ui.mealFilter = b.dataset.f;
      return render();
    case 'mealidea': {
      const [name, ings] = MEAL_IDEAS[b.dataset.cat][+b.dataset.i];
      return mealWizard({ cat: b.dataset.cat, name, ingredientNames: ings, step: 2 });
    }
    case 'delitem': {
      const item = store.data.items[id];
      S.deleteItem(id);
      return toast(`${item.name} deleted`, { icon: '🗑️', undo: () => S.updateItem(id, { deleted: false }) });
    }
    case 'removeitem': {
      const st = S.status(store.data.items[id]);
      if (st.kind === 'needed') S.setNeeded(id, false);
      else S.snooze(id);
      return toast(`${store.data.items[id].name} removed from list`, { icon: '−', undo: () => S.setNeeded(id, true) });
    }
    case 'delmeal': {
      const meal = store.data.meals[id];
      S.deleteMeal(id);
      return toast(`${meal.name} deleted`, { icon: '🗑️', undo: () => S.saveMeal({ ...meal, deleted: false }) });
    }
    case 'pagestyle':
      return pageStyleMenu(b.dataset.page);
    case 'viewmenu':
      return viewMenu();
    case 'look':
      return S.saveDevice({ lookahead: Math.min(7, Math.max(1, store.device.lookahead + +b.dataset.d)) });
    case 'aisles':
      return aislesSheet();
    case 'sync':
      return syncSheet();
    case 'data':
      if (ui.backupUnlocked) return dataSheet();
      return passcodeSheet('Enter passcode', BACKUP_HASH, () => {
        ui.backupUnlocked = true;
        dataSheet();
      });
    case 'dismissa2hs':
      localSet('restock.a2hsDismissed', '1');
      return render();
  }
}
app.addEventListener('click', onAction);
tabbar.addEventListener('click', onAction);

app.addEventListener('focusin', (e) => {
  if (e.target.id === 'quickadd' && !ui.adding) {
    ui.adding = true;
    render();
    window.scrollTo({ top: 0 });
  }
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'itemsearch') {
    ui.query = e.target.value;
    $('#itemsresults').innerHTML = itemsResults();
  }
  if (e.target.id === 'quickadd') {
    ui.addQuery = e.target.value;
    refreshAddPanel();
  }
});

app.addEventListener('keydown', (e) => {
  if (e.target.id === 'quickadd' && e.key === 'Enter') {
    e.preventDefault();
    const q = ui.addQuery.trim();
    if (!q) return exitAdding();
    const top = searchItems(q).find((i) => !onListKind(S.status(i).kind));
    if (top) {
      toggleQuick(top.id);
      ui.addQuery = '';
      e.target.value = '';
      refreshAddPanel();
      toast(`${top.name} added`);
    } else if (!S.findItemByName(q)) {
      ui.addQuery = '';
      e.target.value = '';
      e.target.blur();
      createSheet(q, { needed: true });
    }
  }
  if (e.target.id === 'devname' && e.key === 'Enter') e.target.blur();
});

app.addEventListener('change', (e) => {
  if (e.target.id === 'devname') S.saveDevice({ name: e.target.value.trim() });
  if (e.target.id === 'simpleview') S.saveDevice({ simple: e.target.checked });
});

// Keep the keyboard up while tapping suggestions.
app.addEventListener('mousedown', (e) => {
  if (e.target.closest('[data-keepfocus]')) e.preventDefault();
});

// Long press on grid tiles opens details instead of checking off.
let press = null;
app.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-long]');
  if (!el) return;
  press = { el, x: e.clientX, y: e.clientY, fired: false };
  press.timer = setTimeout(() => {
    press.fired = true;
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 200);
    itemDetail(el.dataset.id);
  }, 420);
});
app.addEventListener('pointermove', (e) => {
  if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) clearTimeout(press.timer);
});
['pointerup', 'pointercancel'].forEach((t) => app.addEventListener(t, () => press && clearTimeout(press.timer)));
app.addEventListener('contextmenu', (e) => {
  if (e.target.closest('[data-long]')) e.preventDefault();
});
app.addEventListener(
  'click',
  (e) => {
    if (press?.fired && press.el.contains(e.target)) {
      e.stopPropagation();
      e.preventDefault();
    }
    press = null;
  },
  true,
);

// ---------- boot ----------

enableSwipe(app);
setupDeckGestures();
S.subscribe(scheduleRender);
onSyncChange(scheduleRender);
render();
startSync();
setInterval(scheduleRender, 60000);

function checkInviteLink() {
  const m = location.hash.match(/join=(RS1\.[A-Za-z0-9+/_-]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  if (!store.device.sync) joinSheet(m[1]);
}
checkInviteLink();
window.addEventListener('hashchange', checkInviteLink);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js');

window.__restock = { store, S, ui };
