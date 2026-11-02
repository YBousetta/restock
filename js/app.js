import * as S from './store.js';
import { store } from './store.js';
import { icons } from './icons.js';
import { DAY, formatDays, formatInterval } from './predict.js';
import { CATEGORY_ICONS, CATEGORY_RHYTHM, ICON_CHOICES, guessItemIcon, guessCategory } from './knowledge.js';
import { esc, $, toast, openSheet, sheetHeader, actionSheet, confirmAction } from './ui.js';
import { syncState, onSyncChange, startSync, syncNow, connect, disconnect, inviteCode, parseInvite } from './sync.js';

const VERSION = '1.2.0';

const ui = {
  tab: localGet('restock.tab') || 'list',
  query: '',
  filter: 'all',
  adding: false,
  addQuery: '',
  addedNow: new Set(), // items added during the current add session (stay visible as "added")
  scroll: {},
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
const meterColor = (l) => (l > 0.5 ? 'var(--green)' : l > 0.2 ? 'var(--orange)' : 'var(--red)');

function groupByCategory(entries) {
  const groups = new Map(S.categories().map((c) => [c.id, []]));
  for (const e of entries) {
    const key = groups.has(e.item.cat) ? e.item.cat : 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.entries()].filter(([, list]) => list.length);
}

function sectionHeader(cat, extra = '') {
  return `<div class="section-header"><span class="cat-head"><span class="cat-icon">${catIcon(cat)}</span>${esc(catName(cat))}</span>${extra}</div>`;
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
  if (st.interval == null || st.dueAt == null) return null;
  return Math.min(1, Math.max(0, (st.dueAt - Date.now()) / (st.interval * DAY)));
}

function computeList() {
  const all = S.items().map((item) => ({ item, st: S.status(item) }));
  const toBuy = all.filter((e) => onListKind(e.st.kind));
  const coming = all.filter((e) => e.st.kind === 'soon').sort((a, b) => a.st.daysLeft - b.st.daysLeft || byName(a, b));
  const seen = new Set();
  const bought = [];
  for (const p of S.boughtToday().sort((a, b) => b.at - a.at)) {
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
    html += `<div class="section-header">Your staples</div><div class="chip-wrap">${staples.map((e) => chip(e.item)).join('')}</div>
      <p class="section-footer">Tap to add. Type to search all ${S.items().length} items or create a new one.</p>`;
    return html;
  }

  const results = searchItems(q);
  let html = `<div class="group suggestions">`;
  for (const item of results) {
    const st = S.status(item);
    const isAdded = added(item.id);
    html += `<button class="row tappable" data-act="quick" data-id="${item.id}" data-keepfocus>
      <span class="item-icon">${itemIcon(item)}</span>
      <div class="body"><div class="title">${esc(item.name)}</div><div class="sub">${catIcon(item.cat)} ${esc(catName(item.cat))} · ${freqShort(st, item)}</div></div>
      <span class="sug-add ${isAdded ? 'on' : ''}">${isAdded ? icons.checkCircle : icons.plusCircle}</span></button>`;
  }
  if (!S.findItemByName(q)) {
    const gc = guessCategory(q, S.items()) || 'other';
    html += `<button class="row tappable create-row" data-act="createitem" data-keepfocus>
      <span class="item-icon new">${icons.plus}</span>
      <div class="body"><div class="title">Create “${esc(q)}”</div><div class="sub">New item · ${catIcon(gc)} ${esc(catName(gc))}</div></div></button>`;
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
  return `<div class="row has-check ${compact ? 'compact' : ''}">
    <button class="check-hit" data-act="buy" data-id="${item.id}" aria-label="Bought ${esc(item.name)}"><span class="check">${icons.check}</span></button>
    ${compact ? '' : `<span class="item-icon">${itemIcon(item)}</span>`}
    <button class="body" data-act="detail" data-id="${item.id}">
      <div class="title">${esc(item.name)}</div>
      ${compact ? '' : `<div class="sub">${freqShort(st, item)}${st.kind === 'due' ? ' · ' + dueLabel(st) : ''}</div>`}
    </button>
    ${compact ? `<span class="detail small">${freqShort(st, item)}</span>` : ''}</div>`;
}

function a2hsCard() {
  if (!isIOS() || isStandalone() || localGet('restock.a2hsDismissed')) return '';
  const b = browserName();
  const where = b === 'Safari' ? 'in Safari' : `in ${b}'s address bar`;
  return `<div class="card a2hs"><h4>Open Restock full screen</h4>
    <ol class="steps"><li>Tap <b>Share</b> ${icons.share.replace('<svg', '<svg width="15" height="15" style="vertical-align:-2px"')} ${where}</li>
    <li>Tap <b>Add to Home Screen</b>, keep <b>Open as Web App</b> on</li>
    <li>Open <b>Restock</b> from your Home Screen</li></ol>
    <p>The Home Screen app keeps its own data, so set up sync there.</p>
    <button class="link-btn" data-act="dismissa2hs">Dismiss</button></div>`;
}

function listView() {
  const { toBuy, coming, bought } = computeList();
  const mode = listMode();
  const compact = mode === 'compact';
  let html = `<h1 class="large-title">Shopping List</h1>
    <p class="subtitle">${toBuy.length ? `${toBuy.length} to buy` : 'Nothing due'}${syncState.status !== 'off' ? ' · ' + syncBadge() : ''}</p>
    ${ui.adding ? '' : a2hsCard()}
    <div class="addbar-wrap ${ui.adding ? 'active' : ''}">
      <label class="search addbar">${icons.search}<input id="quickadd" type="text" placeholder="Add an item" value="${esc(ui.addQuery)}" autocomplete="off" autocorrect="off" enterkeyhint="done"></label>
      ${ui.adding ? `<button class="addbar-done" data-act="adddone">Done</button>` : ''}
    </div>`;

  if (ui.adding) return html + `<div id="addpanel">${addPanel()}</div>`;

  if (!toBuy.length && !bought.length) {
    const next = S.items()
      .map((item) => ({ item, st: S.status(item) }))
      .filter((e) => e.st.daysLeft != null)
      .sort((a, b) => a.st.daysLeft - b.st.daysLeft)[0];
    html += `<div class="empty"><div class="big">🧺</div><h3>All stocked up</h3>
      <p>${next ? `Next up: <b>${esc(next.item.name)}</b>, ${formatDays(next.st.daysLeft)}.` : 'Tap “Add an item” to start.'}</p></div>`;
  }

  if (mode === 'grid' && toBuy.length) {
    const tiles = groupByCategory(toBuy).flatMap(([, list]) => list.sort(byName));
    html += `<div class="grid">${tiles.map((e) => buyTile(e.item, e.st)).join('')}</div>
      <p class="section-footer center">Tap when it's in the cart · hold for details</p>`;
  } else {
    for (const [cat, list] of groupByCategory(toBuy)) {
      html += sectionHeader(cat, `<span class="count">${list.length}</span>`);
      html += `<div class="group">${list.sort(byName).map((e) => buyRow(e.item, e.st, compact)).join('')}</div>`;
    }
  }

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
    html += `<div class="section-header">In the cart today</div><div class="group">`;
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

// ---------- items ----------

function itemsResults() {
  const q = norm(ui.query.trim());
  let entries = S.items().map((item) => ({ item, st: S.status(item) }));
  if (ui.filter === 'regular') entries = entries.filter((e) => e.item.mode !== 'none');
  if (ui.filter === 'asneeded') entries = entries.filter((e) => e.item.mode === 'none');
  if (q) entries = entries.filter((e) => norm(e.item.name).includes(q) || norm(catName(e.item.cat)).includes(q));

  if (!entries.length) {
    return `<div class="empty"><h3>No items</h3><p>${q ? `Nothing matches “${esc(ui.query)}”.` : ''}</p>
      ${q ? `<button class="btn secondary" data-act="newitem" data-name="${esc(ui.query)}">Create “${esc(ui.query)}”</button>` : ''}</div>`;
  }
  let html = '';
  for (const [cat, list] of groupByCategory(entries)) {
    html += sectionHeader(cat, `<span class="count">${list.length}</span>`) + `<div class="group">`;
    for (const { item, st } of list.sort(byName)) {
      const on = onListKind(st.kind);
      const lvl = stockLevel(st);
      html += `<div class="row">
        <span class="item-icon">${itemIcon(item)}</span>
        <button class="body" data-act="detail" data-id="${item.id}">
          <div class="title">${esc(item.name)}</div>
          <div class="sub">${freqShort(st, item)}${st.daysLeft != null && st.kind !== 'needed' ? ' · ' + dueLabel(st) : ''}</div>
          ${lvl != null && !on ? `<div class="mini-meter"><div style="width:${Math.round(lvl * 100)}%;background:${meterColor(lvl)}"></div></div>` : ''}
        </button>
        <button class="icon-btn ${on ? 'on' : ''}" data-act="${on ? 'unneed' : 'need'}" data-id="${item.id}" aria-label="${on ? 'On list' : 'Add to list'}">${on ? icons.checkCircle : icons.plusCircle}</button>
      </div>`;
    }
    html += `</div>`;
  }
  return html + `<p class="section-footer center">${entries.length} items</p>`;
}

function itemsView() {
  return `<h1 class="large-title">Items</h1>
    <label class="search">${icons.search}<input id="itemsearch" type="text" placeholder="Search items" value="${esc(ui.query)}" autocomplete="off" autocorrect="off"></label>
    <div class="segmented" style="margin:10px 0 0">
      ${[
        ['all', 'All'],
        ['regular', 'Regular'],
        ['asneeded', 'As needed'],
      ]
        .map(([k, l]) => `<button class="${ui.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${l}</button>`)
        .join('')}
    </div>
    <div id="itemsresults">${itemsResults()}</div>`;
}

// ---------- meals ----------

function mealsView() {
  const meals = S.live(store.data.meals).sort((a, b) => a.name.localeCompare(b.name));
  let html = `<h1 class="large-title">Meals</h1><p class="subtitle">Planning a meal? Add what's missing in one tap.</p>`;
  if (!meals.length) return html + `<div class="empty"><div class="big">🍽️</div><h3>No meals yet</h3><p>Tap + to add your usual meals.</p></div>`;
  html += `<div class="meal-list">`;
  for (const m of meals) {
    const ings = m.items.map((id) => store.data.items[id]).filter((i) => i && !i.deleted);
    const missing = ings.filter((i) => ['needed', 'due', 'soon'].includes(S.status(i).kind)).length;
    html += `<button class="meal-card" data-act="meal" data-id="${m.id}">
      <div class="meal-icons">${ings
        .slice(0, 6)
        .map((i) => `<span>${itemIcon(i)}</span>`)
        .join('')}</div>
      <div class="meal-name">${esc(m.name)}</div>
      <div class="meal-sub">${ings.length} ingredients${missing ? ` · <span class="soon">${missing} running low</span>` : ''}</div>
    </button>`;
  }
  return html + `</div>`;
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
  return `<h1 class="large-title">Settings</h1>
    <div class="profile-card">
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
  const right =
    ui.tab === 'list'
      ? `<button class="nav-btn" data-act="viewmenu" aria-label="List style">${viewIcon}</button>`
      : ui.tab === 'items'
        ? `<button class="nav-btn" data-act="newitem" aria-label="New item">${icons.plus}</button>`
        : ui.tab === 'meals'
          ? `<button class="nav-btn" data-act="newmeal" aria-label="New meal">${icons.plus}</button>`
          : '';
  const badge = computeList().toBuy.length;
  const tabs = [
    ['list', 'Shopping list', icons.cart],
    ['items', 'Items', icons.noteList],
    ['meals', 'Meals', icons.meals],
    ['settings', 'Settings', icons.gear],
  ];
  app.innerHTML = `
    <header class="navbar ${window.scrollY > 30 ? 'scrolled' : ''}"><div class="left"></div><div class="small-title">${TITLES[ui.tab]}</div><div class="right">${right}</div></header>
    <main class="view">${view}</main>
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
const scheduleRender = () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(render);
};

window.addEventListener('scroll', () => $('.navbar')?.classList.toggle('scrolled', window.scrollY > 30), { passive: true });

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

function rhythmControls(mode, interval, hint) {
  const presets = [2, 3, 5, 7, 14, 30];
  return `<div class="segmented">
      ${[
        ['auto', 'Learn'],
        ['fixed', 'Fixed'],
        ['none', 'As needed'],
      ]
        .map(([k, l]) => `<button class="${mode === k ? 'on' : ''}" data-s="mode" data-m="${k}">${l}</button>`)
        .join('')}
    </div>
    ${
      mode === 'none'
        ? ''
        : `<div class="group rhythm">
      <div class="row"><div class="body"><div class="title">${mode === 'auto' ? 'Starting guess' : 'Every'}</div><div class="sub">${hint}</div></div>
        <span class="detail big">${interval} day${interval === 1 ? '' : 's'}</span>
        <div class="stepper"><button data-s="int" data-d="-1" aria-label="Fewer days">−</button><button data-s="int" data-d="1" aria-label="More days">+</button></div></div>
      <div class="chips">${presets.map((n) => `<button class="chip ${interval === n ? 'on' : ''}" data-s="setint" data-n="${n}">${formatInterval(n)}</button>`).join('')}</div>
    </div>`
    }`;
}

function iconPicker(current, withAuto) {
  return `<div class="picker icon-grid">
    ${withAuto ? `<button class="auto ${current ? '' : 'on'}" data-s="pickicon" data-ic="">Auto</button>` : ''}
    ${ICON_CHOICES.map((ic) => `<button class="${ic === current ? 'on' : ''}" data-s="pickicon" data-ic="${ic}">${ic}</button>`).join('')}</div>`;
}

// Bring the selected category pill into view inside its horizontal scroller.
function centerSelectedPill(root) {
  const row = root.querySelector('.cat-scroll');
  const on = row?.querySelector('.cat-pill.on');
  if (on) row.scrollLeft = on.offsetLeft - row.clientWidth / 2 + on.clientWidth / 2;
}

function catPicker(current) {
  return `<div class="cat-scroll" data-nodrag>${S.categories()
    .map((c) => `<button class="cat-pill ${c.id === current ? 'on' : ''}" data-s="pickcat" data-c="${c.id}">${catIcon(c.id)} ${esc(c.name)}</button>`)
    .join('')}</div>`;
}

// ---------- item detail ----------

function itemDetail(id) {
  const local = { icon: false, cat: false };
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

      let insight = '';
      if (item.mode === 'auto')
        insight = st.samples
          ? `🧠 Learned from ${st.purchases} buys: you buy this about <b>${formatInterval(st.interval)}</b>. Your starting guess was ${item.interval} days.`
          : `🧠 Restock learns your real rhythm once you've bought it twice.`;
      if (item.mode === 'fixed') insight = `Always due ${formatInterval(item.interval)} after you buy it.`;
      if (item.mode === 'none') insight = `Never predicted. It only shows up when you add it.`;

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
          <div class="hero">
            <button class="hero-icon" data-s="icon" aria-label="Change icon">${itemIcon(item)}<span class="hero-edit">${icons.pencil}</span></button>
            <input class="hero-name" id="dname" value="${esc(item.name)}" autocomplete="off" enterkeyhint="done" aria-label="Name">
            <button class="cat-chip" data-s="cat">${catIcon(item.cat)} ${esc(catName(item.cat))} <span class="caret">▾</span></button>
          </div>
          ${local.icon ? iconPicker(item.icon || null, true) : ''}
          ${local.cat ? catPicker(item.cat) : ''}

          <div class="status-card ${st.kind}">
            <div class="status-title">${statusTitle}</div>
            <div class="status-sub">${statusSub}</div>
            ${lvl != null ? `<div class="meter"><div style="width:${Math.round(lvl * 100)}%;background:${meterColor(lvl)}"></div></div><div class="meter-cap"><span>Empty</span><span>~${Math.round(lvl * 100)}% left</span><span>Full</span></div>` : ''}
          </div>

          <div class="action-row">
            <button class="action-tile ${on ? 'on' : ''}" data-s="toggle">${on ? icons.checkCircle : icons.cart}<span>${on ? 'On list' : 'Add to list'}</span></button>
            <button class="action-tile" data-s="buy">${icons.bag}<span>Bought now</span></button>
            <button class="action-tile" data-s="snooze" ${item.mode === 'none' ? 'disabled' : ''}>${icons.hourglass}<span>Still have</span></button>
          </div>

          <div class="section-header">How often</div>
          ${rhythmControls(item.mode, item.interval || 7, item.mode === 'auto' ? 'Adjusts as you buy it' : 'Never changes')}
          <p class="insight">${insight}</p>

          <div class="section-header"><span>History</span>${hist.length ? `<span class="count">${hist.length} buy${hist.length > 1 ? 's' : ''}</span>` : ''}</div>
          ${hist.length ? `<div class="group timeline">${timeline}</div>` : `<p class="insight">No purchases yet.</p>`}

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
    if (s === 'mode') S.updateItem(id, { mode: b.dataset.m, interval: item.interval || 7 });
    if (s === 'int') S.updateItem(id, { interval: Math.min(180, Math.max(1, Math.round(item.interval) + +b.dataset.d)) });
    if (s === 'setint') S.updateItem(id, { interval: +b.dataset.n });
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
  [3, 'Every few days', 'Fresh food'],
  [7, 'Weekly', 'Most groceries'],
  [14, 'Every 2 weeks', 'Pantry'],
  [30, 'Monthly', 'Cleaning, care'],
  [null, 'As needed', 'Never predicted'],
  ['custom', 'Custom', 'Pick the days'],
];

function createSheet(presetName = '', { needed = true } = {}) {
  const d = { name: presetName, cat: null, icon: null, rhythm: undefined, needed, pickIcon: false };
  const cat = () => d.cat || guessCategory(d.name, S.items()) || 'other';
  const rhythm = () => (d.rhythm !== undefined ? d.rhythm : (CATEGORY_RHYTHM[cat()] ?? null));
  const isPreset = (r) => RHYTHM_OPTIONS.some(([k]) => k === r);

  let ctx;
  ctx = openSheet(
    (c) => {
      ctx = c;
      ctx.body.innerHTML = `${sheetHeader('New item')}
        <div class="sheet-body">
          <div class="create-hero">
            <button class="hero-icon" data-s="icon" id="cicon" aria-label="Change icon"></button>
            <input class="hero-name" id="cname" placeholder="Item name" value="${esc(d.name)}" autocomplete="off" enterkeyhint="done">
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
    const selected = (k) => (k === 'custom' ? r !== null && !isPreset(r) : k === r);
    body.querySelector('#cdyn').innerHTML = `
      ${d.pickIcon ? iconPicker(d.icon, true) : ''}
      ${
        dup
          ? `<div class="card dup"><h4>${itemIcon(dup)} ${esc(dup.name)} is already in your items</h4>
          <button class="btn secondary" data-s="adddup">Add it to the list instead</button></div>`
          : ''
      }
      <div class="section-header"><span>Category</span>${!d.cat && name && guessCategory(name, S.items()) ? '<span class="auto-tag">✨ Guessed</span>' : ''}</div>
      ${catPicker(c)}
      <div class="section-header"><span>How often do you buy it?</span>${d.rhythm === undefined && name ? '<span class="auto-tag">✨ Suggested</span>' : ''}</div>
      <div class="rhythm-grid">${RHYTHM_OPTIONS.map(
        ([k, l, sub]) =>
          `<button class="rhythm-card ${selected(k) ? 'on' : ''}" data-s="rhythm" data-k="${k}"><b>${l}</b><span>${k === 'custom' && selected(k) ? `every ${r} days` : sub}</span></button>`,
      ).join('')}</div>
      ${
        r !== null && !isPreset(r)
          ? `<div class="group" style="margin-top:10px"><div class="row"><div class="body"><div class="title">Every</div></div>
        <span class="detail big">${r} days</span>
        <div class="stepper"><button data-s="custom" data-d="-1" aria-label="Fewer days">−</button><button data-s="custom" data-d="1" aria-label="More days">+</button></div></div></div>`
          : ''
      }
      ${r !== null ? `<p class="insight">🧠 Just a starting point. Restock learns your real rhythm as you buy it.</p>` : ''}
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
    if (s === 'pickcat') d.cat = b.dataset.c;
    if (s === 'rhythm') {
      const k = b.dataset.k;
      const r = rhythm();
      d.rhythm = k === 'null' ? null : k === 'custom' ? (r !== null && !isPreset(r) ? r : 10) : +k;
    }
    if (s === 'custom') d.rhythm = Math.min(180, Math.max(1, rhythm() + +b.dataset.d));
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
          <p class="sheet-intro">Drag ≡ to match the way you walk through your supermarket. Your list follows this order.</p>
          <div class="group aisle-list">${S.categories()
            .map(
              (c) => `<div class="row arow" data-id="${c.id}">
              <span class="cat-icon lg">${catIcon(c.id)}</span>
              <button class="body" data-s="edit" data-id="${c.id}"><div class="title">${esc(c.name)}</div></button>
              <span class="drag-handle" data-nodrag aria-label="Drag to reorder">${icons.grip}</span></div>`,
            )
            .join('')}</div>
          <button class="btn secondary" data-s="add" style="margin-top:16px">Add category</button>
          <p class="section-footer">Tap a category to rename it or change its icon.</p>
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
  const d = { name: cat?.name || '', icon: id ? catIcon(id) : '📦' };
  const ctx = openSheet((ctx) => {
    ctx.body.innerHTML = `${sheetHeader(id ? 'Category' : 'New category')}
      <div class="sheet-body">
        <div class="cat-preview" id="catprev">${d.icon}</div>
        <div class="group"><label class="row"><input type="text" id="catname" value="${esc(d.name)}" placeholder="Category name" autocomplete="off"></label></div>
        <div class="section-header">Icon</div>
        ${iconPicker(d.icon, false)}
      </div>
      <div class="sheet-footer"><button class="btn" data-s="save">${id ? 'Save' : 'Add category'}</button></div>`;
  });
  ctx.body.addEventListener('input', (e) => {
    if (e.target.id === 'catname') d.name = e.target.value;
  });
  ctx.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    if (b.dataset.s === 'pickicon') {
      d.icon = b.dataset.ic;
      ctx.body.querySelector('#catprev').textContent = d.icon;
      ctx.body.querySelectorAll('.icon-grid button').forEach((x) => x.classList.toggle('on', x === b));
    }
    if (b.dataset.s === 'save') {
      const name = d.name.trim();
      if (!name) return ctx.body.querySelector('#catname').focus();
      if (id) S.updateCategory(id, { name, icon: d.icon });
      else S.updateCategory(S.addCategory(name), { icon: d.icon });
      ctx.close();
      done?.();
    }
  });
}

function syncSheet() {
  const ctx = openSheet((ctx) => {
    const c = store.device.sync;
    if (!c) {
      ctx.body.innerHTML = `${sheetHeader('Partner sync')}
        <div class="sheet-body">
          <div class="feature-hero"><div class="fh-icon">👫</div><h3>Share one list</h3>
            <p>Both phones see the same list. Check something off in the store and it's gone on your partner's phone too.</p></div>
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
        <p class="sheet-intro">Paste the invite code from your partner's phone (Settings → Partner sync → Invite partner).</p>
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
        <p class="sheet-intro">Your list is saved as a file in your private GitHub repo. Do this once, then invite your partner.</p>
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
        <p class="sheet-intro">Save a copy of your items, meals and purchase history, or bring one back.</p>
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
        <p class="sheet-intro">Pick what you need. Items running low are already selected.</p>
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
      return mealEditor(id);
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

function mealEditor(id) {
  const meal = id ? store.data.meals[id] : { name: '', items: [] };
  const d = { name: meal.name, items: new Set(meal.items), q: '' };
  let ctx;
  ctx = openSheet(
    (c) => {
      ctx = c;
      ctx.body.innerHTML = `${sheetHeader(id ? 'Edit meal' : 'New meal')}
      <div class="sheet-body">
        <div class="group"><label class="row"><input type="text" id="mealname" value="${esc(d.name)}" placeholder="Meal name, e.g. Tuna bowl" autocomplete="off"></label></div>
        <div class="section-header" id="mealcount">Ingredients · ${d.items.size}</div>
        <label class="search">${icons.search}<input id="mealq" type="text" placeholder="Search items" autocomplete="off" autocorrect="off"></label>
        <div class="group" id="meallist" style="margin-top:8px"></div>
        ${id ? `<button class="delete-btn" data-s="delete">Delete meal</button>` : ''}
      </div>
      <div class="sheet-footer"><button class="btn" data-s="save">Save meal</button></div>`;
      paint();
    },
    { large: true },
  );
  function paint() {
    const q = norm(d.q.trim());
    const all = S.items()
      .filter((i) => !q || norm(i.name).includes(q))
      .sort((a, b) => d.items.has(b.id) - d.items.has(a.id) || a.name.localeCompare(b.name))
      .slice(0, 60);
    ctx.body.querySelector('#meallist').innerHTML = all
      .map(
        (i) => `<button class="row has-check ${d.items.has(i.id) ? 'checked keep' : ''}" data-s="toggle" data-id="${i.id}">
        <span class="check">${icons.check}</span><span class="item-icon sm">${itemIcon(i)}</span><div class="body"><div class="title">${esc(i.name)}</div></div></button>`,
      )
      .join('');
    ctx.body.querySelector('#mealcount').textContent = `Ingredients · ${d.items.size}`;
  }
  ctx.body.addEventListener('input', (e) => {
    if (e.target.id === 'mealname') d.name = e.target.value;
    if (e.target.id === 'mealq') {
      d.q = e.target.value;
      paint();
    }
  });
  ctx.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const s = b.dataset.s;
    if (s === 'toggle') {
      d.items.has(b.dataset.id) ? d.items.delete(b.dataset.id) : d.items.add(b.dataset.id);
      return paint();
    }
    if (s === 'save') {
      if (!d.name.trim()) return ctx.body.querySelector('#mealname').focus();
      S.saveMeal({ id, name: d.name.trim(), items: [...d.items] });
      toast(`${d.name.trim()} saved`);
      return ctx.close();
    }
    if (s === 'delete')
      confirmAction(`Delete ${meal.name}?`, 'Delete meal', () => {
        S.deleteMeal(id);
        ctx.close();
      });
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
    case 'newmeal':
      return mealEditor(null);
    case 'viewmenu':
      return viewMenu();
    case 'look':
      return S.saveDevice({ lookahead: Math.min(7, Math.max(1, store.device.lookahead + +b.dataset.d)) });
    case 'aisles':
      return aislesSheet();
    case 'sync':
      return syncSheet();
    case 'data':
      return dataSheet();
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
