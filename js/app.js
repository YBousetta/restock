import * as S from './store.js';
import { store } from './store.js';
import { icons } from './icons.js';
import { formatDays, formatInterval } from './predict.js';
import { CATEGORY_ICONS, ICON_CHOICES, guessItemIcon } from './emoji.js';
import { syncState, onSyncChange, startSync, syncNow, connect, disconnect, inviteCode, parseInvite } from './sync.js';

const VERSION = '1.1.0';
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (sel, el = document) => el.querySelector(sel);

const ui = {
  tab: localGet('restock.tab') || 'list',
  query: '',
  addQuery: '',
  filter: 'all',
  showComing: true,
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

function catName(id) {
  return store.data.categories[id]?.name || 'Other';
}

function groupByCategory(entries) {
  const order = S.categories();
  const groups = new Map(order.map((c) => [c.id, []]));
  for (const e of entries) {
    const key = groups.has(e.item.cat) ? e.item.cat : 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.entries()].filter(([, list]) => list.length);
}

const byName = (a, b) => a.item.name.localeCompare(b.item.name);

function catIcon(id) {
  return store.data.categories[id]?.icon || CATEGORY_ICONS[id] || '📦';
}
function itemIcon(item) {
  return item.icon || guessItemIcon(item.name) || catIcon(item.cat);
}
function sectionHeader(cat, extra = '') {
  return `<div class="section-header"><span class="cat-head"><span class="cat-icon">${catIcon(cat)}</span>${esc(catName(cat))}</span>${extra}</div>`;
}

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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

function shortDue(st) {
  if (st.kind === 'needed') return '';
  if (st.daysLeft == null) return '';
  if (st.daysLeft === 0) return 'today';
  if (st.daysLeft < 0) return `${-st.daysLeft}d late`;
  return `${st.daysLeft}d`;
}

function reasonText(st, item) {
  if (st.kind === 'needed') return item.mode === 'none' ? 'On list' : `On list · ${freqText(st, item)}`;
  return dueLabel(st);
}

function dueLabel(st) {
  if (st.daysLeft == null) return 'as needed';
  if (st.daysLeft < 0) return `<span class="due">Due ${formatDays(st.daysLeft)}</span>`;
  if (st.daysLeft === 0) return `<span class="due">Due today</span>`;
  return `<span class="${st.daysLeft <= store.device.lookahead ? 'soon' : ''}">Runs out ${formatDays(st.daysLeft)}</span>`;
}

function freqText(st, item) {
  if (item.mode === 'none') return 'as needed';
  if (item.mode === 'fixed') return formatInterval(st.interval);
  return st.samples ? `${formatInterval(st.interval)} · learned` : `${formatInterval(st.interval)} · guess`;
}

function fmtDate(t) {
  return new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}
function fmtAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(t);
}

function computeList() {
  const all = S.items().map((item) => ({ item, st: S.status(item) }));
  const toBuy = all.filter((e) => e.st.kind === 'needed' || e.st.kind === 'due');
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

// ---------- views ----------

function syncBadge() {
  const st = syncState.status;
  if (st === 'off') return '';
  const map = {
    ok: ['ok', 'Synced'],
    syncing: ['soon', 'Syncing'],
    offline: ['none', 'Offline'],
    error: ['due', 'Sync error'],
  };
  const [cls, label] = map[st] || ['none', st];
  return `<span class="sync-badge"><span class="dot ${cls}"></span>${label}</span>`;
}

function addBar() {
  const q = ui.addQuery;
  let html = `<form class="search addbar" data-form="quickadd">${icons.search}<input id="quickadd" type="text" placeholder="Add from your items" value="${esc(q)}" autocomplete="off" autocorrect="off" enterkeyhint="done">
    ${q ? `<button type="button" class="clear" data-act="clearadd" aria-label="Clear">✕</button>` : ''}</form>`;
  if (!q.trim()) return html;
  const results = searchItems(q);
  html += `<div class="group suggestions">`;
  for (const item of results) {
    const st = S.status(item);
    const onList = st.kind === 'needed' || st.kind === 'due';
    html += `<button class="row tappable" data-act="${onList ? 'noop' : 'addsug'}" data-id="${item.id}" data-keepfocus>
      <span class="item-icon">${itemIcon(item)}</span>
      <div class="body"><div class="title">${esc(item.name)}</div><div class="sub">${esc(catName(item.cat))} · ${onList ? 'already on list' : st.daysLeft == null ? 'as needed' : dueLabel(st)}</div></div>
      <span class="sug-add" style="color:${onList ? 'var(--tint)' : 'var(--label3)'}">${onList ? icons.checkCircle : icons.plusCircle}</span></button>`;
  }
  if (!results.length) {
    html += `<div class="row"><div class="body"><div class="title" style="color:var(--label2)">No item called “${esc(q.trim())}”</div></div></div>`;
  }
  html += `<button class="row tappable action" data-act="createitem" data-keepfocus><span class="item-icon">${icons.plus}</span><div class="body">Create “${esc(q.trim())}” as a new item</div></button></div>`;
  return html;
}

function buyRow(item, st, compact) {
  if (compact) {
    return `<div class="row has-check compact">
      <button class="check-hit" data-act="buy" data-id="${item.id}" aria-label="Bought ${esc(item.name)}"><span class="check">${icons.check}</span></button>
      <button class="body" data-act="rowmenu" data-id="${item.id}"><div class="title">${esc(item.name)}</div></button>
      <span class="detail small ${st.daysLeft != null && st.daysLeft <= 0 && st.kind !== 'needed' ? 'due' : ''}">${shortDue(st)}</span></div>`;
  }
  return `<div class="row has-check">
    <button class="check-hit" data-act="buy" data-id="${item.id}" aria-label="Bought ${esc(item.name)}"><span class="check">${icons.check}</span></button>
    <button class="body" data-act="rowmenu" data-id="${item.id}">
      <div class="title">${esc(item.name)}</div>
      <div class="sub">${reasonText(st, item)}</div>
    </button></div>`;
}

function buyTile(item, st) {
  const late = st.kind === 'due' && st.daysLeft < 0;
  return `<button class="tile" data-act="buy" data-long="rowmenu" data-id="${item.id}">
    <span class="tile-icon">${itemIcon(item)}</span>
    <span class="tile-name">${esc(item.name)}</span>
    <span class="tile-sub ${late || st.daysLeft === 0 ? 'due' : ''}">${st.kind === 'needed' ? 'on list' : st.daysLeft === 0 ? 'due today' : late ? `${-st.daysLeft}d late` : ''}</span>
  </button>`;
}

function listView() {
  const { toBuy, coming, bought } = computeList();
  const mode = store.device.listView || 'list';
  const compact = mode === 'compact';
  let html = `<h1 class="large-title">Shopping List</h1>
    <p class="subtitle">${toBuy.length ? `${toBuy.length} to buy` : 'Nothing due'} ${syncState.status !== 'off' ? ' · ' + syncBadge() : ''}</p>`;

  if (isIOS() && !isStandalone() && !localGet('restock.a2hsDismissed')) {
    html += `<div class="card a2hs"><h4>Open Restock full screen</h4>
      <ol class="steps"><li>Tap <b>Share</b> ${icons.share.replace('<svg', '<svg width="16" height="16" style="vertical-align:-2px"')} in Safari</li>
      <li>Tap <b>Add to Home Screen</b> and keep <b>Open as Web App</b> on</li>
      <li>Open <b>Restock</b> from your Home Screen</li></ol>
      <p style="margin:0;font-size:13px">Safari doesn't let websites hide its own bars, so the full-screen app lives on your Home Screen. Set up sync from there: it keeps its own data, separate from Safari.</p>
      <button class="nav-btn" data-act="dismissa2hs" style="margin:4px auto 0;display:flex;color:var(--label2);font-size:15px">Dismiss</button></div>`;
  }

  html += addBar();
  if (ui.addQuery.trim()) return html; // while searching, suggestions take over the screen

  if (!toBuy.length && !bought.length) {
    const next = S.items()
      .map((item) => ({ item, st: S.status(item) }))
      .filter((e) => e.st.daysLeft != null)
      .sort((a, b) => a.st.daysLeft - b.st.daysLeft)[0];
    html += `<div class="empty"><div class="big">✓</div><h3>All stocked up</h3>
      <p>${next ? `Next up: <b>${esc(next.item.name)}</b>, ${formatDays(next.st.daysLeft)}.` : 'Search above to add items.'}</p></div>`;
  }

  if (mode === 'grid' && toBuy.length) {
    // One continuous grid in aisle order: denser than splitting tiles per category.
    const tiles = groupByCategory(toBuy).flatMap(([, list]) => list.sort(byName));
    html += `<div class="grid" style="margin-top:14px">${tiles.map((e) => buyTile(e.item, e.st)).join('')}</div>
      <p class="section-footer">In aisle order · tap to check off · hold for options</p>`;
  } else {
    for (const [cat, list] of groupByCategory(toBuy)) {
      html += sectionHeader(cat, compact ? `<span class="count">${list.length}</span>` : '');
      html += `<div class="group">${list.sort(byName).map((e) => buyRow(e.item, e.st, compact)).join('')}</div>`;
    }
  }

  if (coming.length) {
    html += `<div class="section-header"><span>Coming up · next ${store.device.lookahead} day${store.device.lookahead > 1 ? 's' : ''}</span>
      <button data-act="addcoming">Add all</button></div><div class="group">`;
    for (const { item, st } of coming) {
      html += `<div class="row ${compact ? 'compact' : ''}">
        <span class="item-icon ${compact ? 'sm' : ''}">${itemIcon(item)}</span>
        <button class="body" data-act="rowmenu" data-id="${item.id}"><div class="title">${esc(item.name)}</div>
          ${compact ? '' : `<div class="sub">${freqText(st, item)}</div>`}</button>
        <span class="detail ${compact ? 'small' : ''}">${formatDays(st.daysLeft)}</span>
        <button class="nav-btn" data-act="need" data-id="${item.id}" aria-label="Add to list">${icons.plusCircle}</button></div>`;
    }
    html += `</div>${compact ? '' : '<p class="section-footer">Based on how often you buy them. Add them now to save a trip.</p>'}`;
  }

  if (bought.length) {
    html += `<div class="section-header">Bought today</div><div class="group">`;
    for (const { item, p } of bought) {
      const time = new Date(p.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      html += `<div class="row has-check checked ${compact ? 'compact' : ''}">
        <button class="check-hit" data-act="undo" data-id="${p.id}" aria-label="Undo"><span class="check">${icons.check}</span></button>
        <div class="body"><div class="title">${esc(item.name)}</div>
        ${compact ? '' : `<div class="sub">${p.by ? esc(p.by) + ' · ' : ''}${time}</div>`}</div>
        ${compact ? `<span class="detail small">${time}</span>` : ''}</div>`;
    }
    html += `</div>`;
  }

  if (syncState.status === 'off' && !store.device.dismissedSyncCard) {
    html += `<div class="card"><h4>Share with your partner</h4>
      <p>Connect sync so you both see the same list.</p>
      <div class="btn-row" style="margin-top:0"><button class="btn secondary" data-act="join">I have a code</button>
      <button class="btn secondary" data-act="tab" data-tab="settings">Set up</button></div>
      <button class="nav-btn" data-act="dismisssync" style="margin:6px auto 0;display:flex;color:var(--label2);font-size:15px">Not now</button></div>`;
  }
  return html;
}

function itemsView() {
  const q = ui.query.trim().toLowerCase();
  let entries = S.items().map((item) => ({ item, st: S.status(item) }));
  if (ui.filter === 'regular') entries = entries.filter((e) => e.item.mode !== 'none');
  if (ui.filter === 'asneeded') entries = entries.filter((e) => e.item.mode === 'none');
  if (q) entries = entries.filter((e) => e.item.name.toLowerCase().includes(q) || catName(e.item.cat).toLowerCase().includes(q));

  let html = `<h1 class="large-title">Items</h1>
    <div class="search">${icons.search}<input id="itemsearch" type="search" placeholder="Search" value="${esc(ui.query)}" autocomplete="off"></div>
    <div class="segmented" style="margin:10px 0 0">
      ${[
        ['all', 'All'],
        ['regular', 'Regular'],
        ['asneeded', 'As needed'],
      ]
        .map(([k, l]) => `<button class="${ui.filter === k ? 'on' : ''}" data-act="filter" data-f="${k}">${l}</button>`)
        .join('')}
    </div>`;

  if (!entries.length) {
    html += `<div class="empty"><h3>No items</h3><p>${q ? `Nothing matches “${esc(ui.query)}”.` : ''}</p>
      ${q ? `<button class="btn secondary" data-act="newitem" data-name="${esc(ui.query)}">Add “${esc(ui.query)}”</button>` : ''}</div>`;
  }

  for (const [cat, list] of groupByCategory(entries)) {
    html += sectionHeader(cat) + `<div class="group">`;
    for (const { item, st } of list.sort(byName)) {
      const onList = st.kind === 'needed' || st.kind === 'due';
      html += `<div class="row">
        <span class="dot ${st.kind}"></span>
        <button class="body" data-act="edit" data-id="${item.id}">
          <div class="title">${esc(item.name)}</div>
          <div class="sub">${freqText(st, item)}${st.daysLeft != null && st.kind !== 'needed' ? ' · ' + dueLabel(st) : ''}</div>
        </button>
        <button class="nav-btn" data-act="${onList ? 'unneed' : 'need'}" data-id="${item.id}" aria-label="${onList ? 'On list' : 'Add to list'}" style="color:${onList ? 'var(--tint)' : 'var(--label3)'}">${onList ? icons.checkCircle : icons.plusCircle}</button>
      </div>`;
    }
    html += `</div>`;
  }
  html += `<p class="section-footer" style="text-align:center;margin-top:20px">${entries.length} items · <span class="dot ok" style="display:inline-block;width:8px;height:8px"></span> stocked <span class="dot soon" style="display:inline-block;width:8px;height:8px"></span> soon <span class="dot due" style="display:inline-block;width:8px;height:8px"></span> buy</p>`;
  return html;
}

function mealsView() {
  const meals = S.live(store.data.meals).sort((a, b) => a.name.localeCompare(b.name));
  let html = `<h1 class="large-title">Meals</h1><p class="subtitle">Planning a meal? Add what's missing in one tap.</p>`;
  if (!meals.length) html += `<div class="empty"><h3>No meals yet</h3><p>Tap + to add your usual meals.</p></div>`;
  else {
    html += `<div class="group">`;
    for (const m of meals) {
      const ings = m.items.map((id) => store.data.items[id]).filter((i) => i && !i.deleted);
      const missing = ings.filter((i) => ['needed', 'due', 'soon'].includes(S.status(i).kind)).length;
      html += `<button class="row tappable" data-act="meal" data-id="${m.id}">
        <div class="body"><div class="title">${esc(m.name)}</div>
        <div class="sub">${ings.map((i) => esc(i.name)).join(', ')}</div></div>
        ${missing ? `<span class="pill orange">${missing}</span>` : ''}
        <span class="chev">${icons.chevron}</span></button>`;
    }
    html += `</div>`;
  }
  return html;
}

function settingsView() {
  const d = store.device;
  const cats = S.categories();
  let html = `<h1 class="large-title">Settings</h1>
    <div class="section-header">This phone</div>
    <div class="group">
      <label class="row"><span class="label">Your name</span><input id="devname" type="text" placeholder="e.g. Youssef" value="${esc(d.name)}" style="text-align:right" autocomplete="off"></label>
      <div class="row"><div class="body"><div class="title">Look ahead</div><div class="sub">“Coming up” shows items running out within ${d.lookahead} day${d.lookahead > 1 ? 's' : ''}</div></div>
        <div class="stepper"><button data-act="look" data-d="-1">−</button><button data-act="look" data-d="1">+</button></div></div>
    </div>
    <p class="section-footer">Your name shows next to items you check off.</p>

    <div class="section-header">Sync with partner</div>`;

  if (!d.sync) {
    html += `<div class="group">
      <button class="row tappable action" data-act="join"><div class="body">Join with invite code</div></button>
      <button class="row tappable action" data-act="setup"><div class="body">Set up sync (first phone)</div></button>
    </div><p class="section-footer">Not connected. Data stays on this phone only.</p>`;
  } else {
    html += `<div class="group">
      <div class="row"><div class="body"><div class="title">Status</div></div><span class="detail">${syncBadge()}</span></div>
      <div class="row"><div class="body"><div class="title">Last sync</div></div><span class="detail">${syncState.lastSync ? fmtAgo(syncState.lastSync) : '—'}</span></div>
      <div class="row"><div class="body"><div class="title">Repository</div></div><span class="detail">${esc(d.sync.owner)}/${esc(d.sync.repo)}</span></div>
      <button class="row tappable action" data-act="syncnow"><div class="body">Sync now</div></button>
      <button class="row tappable action" data-act="invite"><div class="body">Invite partner</div></button>
      <button class="row tappable" data-act="disconnect" style="color:var(--red)"><div class="body">Disconnect</div></button>
    </div>${syncState.error ? `<p class="section-footer" style="color:var(--red)">${esc(syncState.error)}</p>` : ''}`;
  }

  html += `<div class="section-header"><span>Aisle order</span><button data-act="addcat">Add</button></div><div class="group">`;
  cats.forEach((c, i) => {
    html += `<div class="row"><span class="cat-icon lg">${catIcon(c.id)}</span><button class="body" data-act="renamecat" data-id="${c.id}"><div class="title">${esc(c.name)}</div></button>
      <button class="nav-btn" data-act="catup" data-id="${c.id}" ${i === 0 ? 'disabled style="opacity:.25"' : ''} aria-label="Move up">${icons.up}</button>
      <button class="nav-btn" data-act="catdown" data-id="${c.id}" ${i === cats.length - 1 ? 'disabled style="opacity:.25"' : ''} aria-label="Move down">${icons.down}</button></div>`;
  });
  html += `</div><p class="section-footer">Order categories the way you walk through your supermarket. Tap a name to rename it or change its icon.</p>

    <div class="section-header">Data</div>
    <div class="group">
      <button class="row tappable action" data-act="export"><div class="body">Export backup</div></button>
      <label class="row tappable action"><div class="body">Import backup</div><input type="file" accept="application/json,.json" id="importfile" hidden></label>
      <button class="row tappable" data-act="reset" style="color:var(--red)"><div class="body">Reset to starting list</div></button>
    </div>
    <p class="section-footer" style="text-align:center;margin-top:24px">Restock ${VERSION}</p>`;
  return html;
}

// ---------- render ----------

const app = document.getElementById('app');

function render() {
  const active = document.activeElement;
  const focus = active && active.id && app.contains(active) ? { id: active.id, start: active.selectionStart, end: active.selectionEnd, value: active.value } : null;

  const view = { list: listView, items: itemsView, meals: mealsView, settings: settingsView }[ui.tab]();
  const viewIcon = { list: icons.viewList, grid: icons.viewGrid, compact: icons.viewCompact }[store.device.listView || 'list'];
  const right =
    ui.tab === 'list'
      ? `<button class="nav-btn" data-act="viewmenu" aria-label="Change view">${viewIcon}</button>`
      : ui.tab === 'items'
      ? `<button class="nav-btn" data-act="newitem" aria-label="New item">${icons.plus}</button>`
      : ui.tab === 'meals'
        ? `<button class="nav-btn" data-act="newmeal" aria-label="New meal">${icons.plus}</button>`
        : '';
  const badge = computeList().toBuy.length;
  app.innerHTML = `
    <header class="navbar ${window.scrollY > 30 ? 'scrolled' : ''}"><div class="left"></div><div class="small-title">${TITLES[ui.tab]}</div><div class="right">${right}</div></header>
    <main class="view">${view}</main>
    <nav class="tabbar">
      ${[
        ['list', 'List', icons.list],
        ['items', 'Items', icons.items],
        ['meals', 'Meals', icons.meals],
        ['settings', 'Settings', icons.gear],
      ]
        .map(
          ([k, l, ic]) =>
            `<button class="tab ${ui.tab === k ? 'on' : ''}" data-act="tab" data-tab="${k}">${ic}<span>${l}</span>${k === 'list' && badge ? `<span class="badge">${badge}</span>` : ''}</button>`,
        )
        .join('')}
    </nav>`;

  if (focus) {
    const el = document.getElementById(focus.id);
    if (el) {
      el.focus({ preventScroll: true });
      try {
        const len = el.value.length;
        if (el.value === focus.value) el.setSelectionRange(focus.start, focus.end);
        else el.setSelectionRange(len, len);
      } catch {}
    }
  }
}

let raf = 0;
function scheduleRender() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(render);
}

window.addEventListener(
  'scroll',
  () => {
    const nav = $('.navbar');
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 30);
  },
  { passive: true },
);

function switchTab(tab) {
  ui.scroll[ui.tab] = window.scrollY;
  ui.tab = tab;
  localSet('restock.tab', tab);
  render();
  window.scrollTo(0, ui.scroll[tab] || 0);
}

// ---------- toast / sheets ----------

let toastTimer;
function toast(msg, undo) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button>Undo</button>' : ''}`;
  if (undo)
    el.querySelector('button').onclick = () => {
      undo();
      el.classList.remove('show');
    };
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 4000 : 2200);
}

function openSheet(build) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  document.body.append(backdrop, sheet);
  document.body.style.overflow = 'hidden';
  const close = () => {
    sheet.classList.remove('open');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(() => {
      sheet.remove();
      backdrop.remove();
    }, 320);
  };
  backdrop.onclick = close;
  const ctx = { sheet, close, rerender: () => build(ctx) };
  build(ctx);
  requestAnimationFrame(() => {
    sheet.classList.add('open');
    backdrop.classList.add('open');
  });
  return ctx;
}

function actionSheet(title, actions) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const el = document.createElement('div');
  el.className = 'actions';
  el.innerHTML = `<div class="group">${title ? `<div class="head">${esc(title)}</div>` : ''}
    ${actions.map((a, i) => `<button class="act ${a.red ? 'red' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>
    <button class="act cancel">Cancel</button>`;
  document.body.append(backdrop, el);
  const close = () => {
    el.classList.remove('open');
    backdrop.classList.remove('open');
    setTimeout(() => {
      el.remove();
      backdrop.remove();
    }, 300);
  };
  backdrop.onclick = close;
  el.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    close();
    if (b.dataset.i != null) actions[+b.dataset.i].run();
  };
  requestAnimationFrame(() => {
    el.classList.add('open');
    backdrop.classList.add('open');
  });
}

// ---------- item actions ----------

function buy(id) {
  const pid = S.markBought(id);
  toast(`${store.data.items[id].name} bought`, () => S.undoPurchase(pid));
}

function rowMenu(id) {
  const item = store.data.items[id];
  const st = S.status(item);
  const onList = st.kind === 'needed' || st.kind === 'due';
  const acts = [{ label: 'Bought', run: () => buy(id) }];
  if (st.kind === 'needed' && item.mode === 'none') acts.push({ label: 'Remove from list', run: () => S.setNeeded(id, false) });
  else if (onList)
    acts.push({
      label: 'Still have some',
      run: () => {
        const days = S.snooze(id);
        toast(`Hidden for ${days} day${days > 1 ? 's' : ''}`);
      },
    });
  else acts.push({ label: 'Add to list', run: () => S.setNeeded(id, true) });
  acts.push({ label: 'Edit item', run: () => itemSheet(id) });
  actionSheet(`${item.name} · ${freqText(st, item)}`, acts);
}

function stepperRow(label, sub, value, act) {
  return `<div class="row"><div class="body"><div class="title">${label}</div><div class="sub">${sub}</div></div>
    <span class="detail" style="min-width:56px;text-align:right">${value} day${value === 1 ? '' : 's'}</span>
    <div class="stepper"><button data-s="${act}" data-d="-1">−</button><button data-s="${act}" data-d="1">+</button></div></div>`;
}

function itemSheet(id, presetName = '', presetNeeded = false) {
  const isNew = !id;
  const src = isNew ? { name: presetName, cat: 'other', mode: 'auto', interval: 7, needed: presetNeeded } : store.data.items[id];
  const draft = { name: src.name, cat: src.cat, mode: src.mode, interval: src.interval || 7, needed: !!src.needed };

  openSheet((ctx) => {
    const item = isNew ? null : store.data.items[id];
    const st = item ? S.status(item) : null;
    const hist = item ? S.history(id) : [];
    const cats = S.categories();
    ctx.sheet.innerHTML = `<div class="grabber"></div>
      <div class="sheet-head"><button class="nav-btn" data-s="cancel">Cancel</button><h2>${isNew ? 'New Item' : esc(draft.name)}</h2>
        <button class="nav-btn" data-s="save" style="font-weight:600">${isNew ? 'Add' : 'Done'}</button></div>
      <div class="sheet-body">
        <div class="group" style="margin-top:8px">
          <label class="row"><input type="text" data-f="name" value="${esc(draft.name)}" placeholder="Name" autocomplete="off"></label>
          <label class="row"><span class="label">Category</span><select data-f="cat">${cats
            .map((c) => `<option value="${c.id}" ${c.id === draft.cat ? 'selected' : ''}>${esc(c.name)}</option>`)
            .join('')}</select><span class="chev">${icons.chevron}</span></label>
        </div>

        <div class="section-header">How often</div>
        <div class="segmented">
          ${[
            ['auto', 'Learn'],
            ['fixed', 'Fixed'],
            ['none', 'As needed'],
          ]
            .map(([k, l]) => `<button class="${draft.mode === k ? 'on' : ''}" data-s="mode" data-m="${k}">${l}</button>`)
            .join('')}
        </div>
        ${
          draft.mode === 'none'
            ? `<p class="section-footer">Never predicted. Add it to the list when you need it.</p>`
            : `<div class="group" style="margin-top:10px">
            ${stepperRow(draft.mode === 'auto' ? 'Starting guess' : 'Every', draft.mode === 'auto' ? 'Adjusts as you check it off' : 'Always this interval', draft.interval, 'int')}
            <div class="chips">${[2, 3, 5, 7, 14, 30]
              .map((n) => `<button class="chip ${draft.interval === n ? 'on' : ''}" data-s="setint" data-n="${n}">${formatInterval(n)}</button>`)
              .join('')}</div></div>`
        }
        ${
          item
            ? `<div class="section-header">Status</div><div class="group">
            <div class="row"><div class="body">Next</div><span class="detail">${st.kind === 'needed' ? 'On list' : st.daysLeft == null ? '—' : dueLabel(st)}</span></div>
            <div class="row"><div class="body">Last bought</div><span class="detail">${st.lastBought ? fmtDate(st.lastBought) : 'Not yet'}</span></div>
            ${item.mode === 'auto' ? `<div class="row"><div class="body">Learned</div><span class="detail">${st.samples ? `${formatInterval(st.interval)} (${st.purchases} buys)` : 'Needs 2+ buys'}</span></div>` : ''}
          </div>
          <div class="group" style="margin-top:16px">
            <button class="row tappable action" data-s="toggle"><div class="body">${st.kind === 'needed' ? 'Remove from list' : 'Add to list'}</div></button>
            <button class="row tappable action" data-s="buy"><div class="body">Mark bought now</div></button>
          </div>
          ${
            hist.length
              ? `<div class="section-header">History</div><div class="group">${hist
                  .slice(0, 10)
                  .map((p) => `<div class="row"><div class="body">${fmtDate(p.at)}</div><span class="detail">${esc(p.by || '')}</span></div>`)
                  .join('')}</div>`
              : ''
          }
          <div class="group" style="margin-top:24px"><button class="row tappable danger" data-s="delete">Delete item</button></div>`
            : `<div class="group" style="margin-top:16px"><label class="row"><div class="body">Add to list now</div><input type="checkbox" data-f="needed" ${src.needed ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--tint)"></label></div>`
        }
      </div>`;

    ctx.sheet.oninput = ctx.sheet.onchange = (e) => {
      const f = e.target.dataset.f;
      if (f === 'name') draft.name = e.target.value;
      if (f === 'cat') draft.cat = e.target.value;
      if (f === 'needed') draft.needed = e.target.checked;
    };
    ctx.sheet.onclick = (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      const s = b.dataset.s;
      if (s === 'cancel') return ctx.close();
      if (s === 'save') {
        const name = draft.name.trim();
        if (!name) return;
        const patch = { name, cat: draft.cat, mode: draft.mode, interval: draft.interval };
        if (isNew) {
          const existing = S.findItemByName(name);
          if (existing) {
            S.updateItem(existing.id, { ...patch, needed: existing.needed || !!draft.needed });
          } else {
            S.addItem({ ...patch, needed: !!draft.needed });
          }
          toast(`${name} added`);
        } else S.updateItem(id, patch);
        return ctx.close();
      }
      if (s === 'mode') draft.mode = b.dataset.m;
      if (s === 'int') draft.interval = Math.min(180, Math.max(1, Math.round(draft.interval) + +b.dataset.d));
      if (s === 'setint') draft.interval = +b.dataset.n;
      if (s === 'toggle') S.setNeeded(id, S.status(store.data.items[id]).kind !== 'needed');
      if (s === 'buy') {
        buy(id);
        return ctx.close();
      }
      if (s === 'delete') {
        if (confirm(`Delete ${item.name}? Its history is removed too.`)) {
          S.deleteItem(id);
          ctx.close();
        }
        return;
      }
      ctx.rerender();
    };
  });
}

function categorySheet(id) {
  const cat = store.data.categories[id];
  const draft = { name: cat.name, icon: catIcon(id) };
  openSheet((ctx) => {
    ctx.sheet.innerHTML = `<div class="grabber"></div>
      <div class="sheet-head"><button class="nav-btn" data-s="cancel">Cancel</button><h2>Category</h2>
        <button class="nav-btn" data-s="save" style="font-weight:600">Done</button></div>
      <div class="sheet-body">
        <div class="cat-preview">${draft.icon}</div>
        <div class="group"><label class="row"><input type="text" id="catname" value="${esc(draft.name)}" placeholder="Name" autocomplete="off"></label></div>
        <div class="section-header">Icon</div>
        <div class="icon-grid">${ICON_CHOICES.map((ic) => `<button class="${ic === draft.icon ? 'on' : ''}" data-s="icon" data-ic="${ic}">${ic}</button>`).join('')}</div>
      </div>`;
    ctx.sheet.oninput = (e) => {
      if (e.target.id === 'catname') draft.name = e.target.value;
    };
    ctx.sheet.onclick = (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      if (b.dataset.s === 'cancel') return ctx.close();
      if (b.dataset.s === 'icon') {
        draft.icon = b.dataset.ic;
        return ctx.rerender();
      }
      if (b.dataset.s === 'save') {
        if (draft.name.trim()) S.updateCategory(id, { name: draft.name.trim(), icon: draft.icon });
        ctx.close();
      }
    };
  });
}

// ---------- meals ----------

function mealSheet(id) {
  const meal = store.data.meals[id];
  const picked = new Set();
  for (const iid of meal.items) {
    const it = store.data.items[iid];
    if (it && !it.deleted && ['due', 'soon'].includes(S.status(it).kind)) picked.add(iid);
  }
  openSheet((ctx) => {
    const ings = meal.items.map((iid) => store.data.items[iid]).filter((i) => i && !i.deleted);
    ctx.sheet.innerHTML = `<div class="grabber"></div>
      <div class="sheet-head"><button class="nav-btn" data-s="cancel">Close</button><h2>${esc(meal.name)}</h2>
        <button class="nav-btn" data-s="edit">Edit</button></div>
      <div class="sheet-body">
        <div class="section-header">Ingredients</div><div class="group">
        ${ings
          .map((i) => {
            const st = S.status(i);
            const onList = st.kind === 'needed';
            return `<button class="row has-check ${onList || picked.has(i.id) ? 'checked' : ''}" data-s="pick" data-id="${i.id}" ${onList ? 'disabled' : ''}>
              <span class="check">${icons.check}</span>
              <div class="body"><div class="title" style="text-decoration:none;color:var(--label)">${esc(i.name)}</div>
              <div class="sub">${onList ? 'Already on list' : st.daysLeft == null ? 'as needed' : dueLabel(st)}</div></div></button>`;
          })
          .join('')}
        </div>
        <p class="section-footer">Pre-selected: items that are due or running out soon.</p>
        <div class="btn-row"><button class="btn" data-s="add" ${picked.size ? '' : 'disabled'}>Add ${picked.size || ''} to list</button></div>
      </div>`;
    ctx.sheet.onclick = (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      const s = b.dataset.s;
      if (s === 'cancel') return ctx.close();
      if (s === 'edit') {
        ctx.close();
        return mealEditor(id);
      }
      if (s === 'pick') {
        const iid = b.dataset.id;
        picked.has(iid) ? picked.delete(iid) : picked.add(iid);
        return ctx.rerender();
      }
      if (s === 'add') {
        for (const iid of picked) S.setNeeded(iid, true);
        toast(`${picked.size} item${picked.size > 1 ? 's' : ''} added`);
        return ctx.close();
      }
    };
  });
}

function mealEditor(id) {
  const meal = id ? store.data.meals[id] : { name: '', items: [] };
  const draft = { name: meal.name, items: new Set(meal.items), q: '' };
  openSheet((ctx) => {
    const q = draft.q.trim().toLowerCase();
    const all = S.items()
      .filter((i) => !q || i.name.toLowerCase().includes(q))
      .sort((a, b) => (draft.items.has(b.id) - draft.items.has(a.id)) || a.name.localeCompare(b.name));
    ctx.sheet.innerHTML = `<div class="grabber"></div>
      <div class="sheet-head"><button class="nav-btn" data-s="cancel">Cancel</button><h2>${id ? 'Edit Meal' : 'New Meal'}</h2>
        <button class="nav-btn" data-s="save" style="font-weight:600">Save</button></div>
      <div class="sheet-body">
        <div class="group" style="margin-top:8px"><label class="row"><input type="text" id="mealname" value="${esc(draft.name)}" placeholder="Meal name" autocomplete="off"></label></div>
        <div class="section-header">Ingredients · ${draft.items.size}</div>
        <div class="search">${icons.search}<input id="mealq" type="search" placeholder="Search items" value="${esc(draft.q)}" autocomplete="off"></div>
        <div class="group" style="margin-top:8px">
        ${all
          .slice(0, 80)
          .map(
            (i) => `<button class="row has-check ${draft.items.has(i.id) ? 'checked' : ''}" data-s="toggle" data-id="${i.id}">
            <span class="check">${icons.check}</span><div class="body"><div class="title" style="text-decoration:none;color:var(--label)">${esc(i.name)}</div></div></button>`,
          )
          .join('')}
        </div>
        ${id ? `<div class="group" style="margin-top:24px"><button class="row tappable danger" data-s="delete">Delete meal</button></div>` : ''}
      </div>`;
    const qEl = ctx.sheet.querySelector('#mealq');
    if (draft.focusQ) {
      qEl.focus();
      qEl.setSelectionRange(qEl.value.length, qEl.value.length);
    }
    ctx.sheet.oninput = (e) => {
      if (e.target.id === 'mealname') draft.name = e.target.value;
      if (e.target.id === 'mealq') {
        draft.q = e.target.value;
        draft.focusQ = true;
        ctx.rerender();
      }
    };
    ctx.sheet.onclick = (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      const s = b.dataset.s;
      if (s === 'cancel') return ctx.close();
      if (s === 'toggle') {
        const iid = b.dataset.id;
        draft.items.has(iid) ? draft.items.delete(iid) : draft.items.add(iid);
        draft.focusQ = false;
        return ctx.rerender();
      }
      if (s === 'save') {
        if (!draft.name.trim()) return;
        S.saveMeal({ id, name: draft.name.trim(), items: [...draft.items] });
        return ctx.close();
      }
      if (s === 'delete' && confirm(`Delete ${meal.name}?`)) {
        S.deleteMeal(id);
        ctx.close();
      }
    };
  });
}

// ---------- sync sheets ----------

function joinSheet(prefill = '') {
  openSheet((ctx) => {
    ctx.sheet.innerHTML = `<div class="grabber"></div>
      <div class="sheet-head"><button class="nav-btn" data-s="cancel">Cancel</button><h2>Join</h2><span style="width:50px"></span></div>
      <div class="sheet-body">
        <p class="subtitle" style="margin:8px 0 12px">Paste the invite code from your partner's phone (Settings → Invite partner).</p>
        <textarea class="code" id="joincode" placeholder="RS1.…" autocapitalize="off" autocorrect="off" spellcheck="false">${esc(prefill)}</textarea>
        <div class="btn-row"><button class="btn secondary" data-s="paste">Paste</button><button class="btn" data-s="go">Join</button></div>
        <div class="err" id="joinerr"></div>
      </div>`;
    ctx.sheet.onclick = async (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      const ta = ctx.sheet.querySelector('#joincode');
      if (b.dataset.s === 'cancel') return ctx.close();
      if (b.dataset.s === 'paste') {
        try {
          ta.value = await navigator.clipboard.readText();
        } catch {
          ta.focus();
        }
      }
      if (b.dataset.s === 'go') {
        const err = ctx.sheet.querySelector('#joinerr');
        b.disabled = true;
        b.textContent = 'Joining…';
        try {
          await connect(parseInvite(ta.value));
          ctx.close();
          toast('Connected. Lists are now shared.');
        } catch (x) {
          err.textContent = x.message;
          b.disabled = false;
          b.textContent = 'Join';
        }
      }
    };
  });
}

function setupSheet() {
  const draft = { owner: 'YBousetta', repo: 'restock-data', token: '' };
  openSheet((ctx) => {
    ctx.sheet.innerHTML = `<div class="grabber"></div>
      <div class="sheet-head"><button class="nav-btn" data-s="cancel">Cancel</button><h2>Set up sync</h2><span style="width:50px"></span></div>
      <div class="sheet-body">
        <p class="subtitle" style="margin:8px 0 4px">Your list is saved as a file in a private GitHub repo. Do this once, then invite your partner.</p>
        <ol class="steps">
          <li>Create a <b>private</b> repo (e.g. <b>restock-data</b>).</li>
          <li>GitHub → Settings → Developer settings → <b>Fine-grained tokens</b> → Generate.</li>
          <li>Repository access: <b>only restock-data</b>. Permissions: <b>Contents: Read and write</b>.</li>
          <li>Copy the token and paste it below.</li>
        </ol>
        <div class="group">
          <label class="row"><span class="label">Owner</span><input type="text" data-f="owner" value="${esc(draft.owner)}" style="text-align:right" autocapitalize="off" autocorrect="off"></label>
          <label class="row"><span class="label">Repo</span><input type="text" data-f="repo" value="${esc(draft.repo)}" style="text-align:right" autocapitalize="off" autocorrect="off"></label>
          <label class="row"><span class="label">Token</span><input type="text" data-f="token" placeholder="github_pat_…" style="text-align:right" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        </div>
        <div class="btn-row"><button class="btn" data-s="go">Connect</button></div>
        <div class="err" id="seterr"></div>
      </div>`;
    ctx.sheet.oninput = (e) => {
      if (e.target.dataset.f) draft[e.target.dataset.f] = e.target.value.trim();
    };
    ctx.sheet.onclick = async (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      if (b.dataset.s === 'cancel') return ctx.close();
      if (b.dataset.s === 'go') {
        const err = ctx.sheet.querySelector('#seterr');
        if (!draft.owner || !draft.repo || !draft.token) return (err.textContent = 'Fill in all three fields.');
        b.disabled = true;
        b.textContent = 'Connecting…';
        try {
          await connect({ owner: draft.owner, repo: draft.repo, token: draft.token });
          ctx.close();
          toast('Sync is on');
          inviteSheet();
        } catch (x) {
          err.textContent = x.message;
          b.disabled = false;
          b.textContent = 'Connect';
        }
      }
    };
  });
}

function inviteSheet() {
  const code = inviteCode();
  const link = `${location.origin}${location.pathname}#join=${code}`;
  openSheet((ctx) => {
    ctx.sheet.innerHTML = `<div class="grabber"></div>
      <div class="sheet-head"><span style="width:50px"></span><h2>Invite partner</h2><button class="nav-btn" data-s="cancel" style="font-weight:600">Done</button></div>
      <div class="sheet-body">
        <ol class="steps" style="margin-top:10px">
          <li>Send your partner the link below (privately: it contains the access key).</li>
          <li>They open it in <b>Safari</b>, tap <b>Share → Add to Home Screen</b>.</li>
          <li>They open Restock from the home screen, tap <b>I have a code</b>, and paste the code.</li>
        </ol>
        <div class="section-header">Invite code</div>
        <textarea class="code" readonly>${esc(code)}</textarea>
        <div class="btn-row"><button class="btn secondary" data-s="copy">Copy code</button><button class="btn" data-s="share">${icons.share.replace('<svg', '<svg width="20" height="20"')} Share link</button></div>
      </div>`;
    ctx.sheet.onclick = async (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      if (b.dataset.s === 'cancel') return ctx.close();
      if (b.dataset.s === 'copy') {
        try {
          await navigator.clipboard.writeText(code);
          toast('Code copied');
        } catch {
          toast('Copy failed. Select the text instead.');
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
    };
  });
}

// ---------- events ----------

app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id } = b.dataset;
  switch (act) {
    case 'tab':
      return switchTab(b.dataset.tab);
    case 'buy':
      return buy(id);
    case 'undo':
      return S.undoPurchase(id);
    case 'rowmenu':
      return rowMenu(id);
    case 'need':
      S.setNeeded(id, true);
      return toast(`${store.data.items[id].name} added to list`);
    case 'unneed': {
      const st = S.status(store.data.items[id]);
      if (st.kind === 'needed') S.setNeeded(id, false);
      else {
        S.snooze(id);
        toast('Hidden from list for now');
      }
      return;
    }
    case 'addcoming': {
      const { coming } = computeList();
      coming.forEach((c) => S.setNeeded(c.item.id, true));
      return toast(`${coming.length} added`);
    }
    case 'edit':
      return itemSheet(id);
    case 'newitem':
      return itemSheet(null, b.dataset.name || '');
    case 'filter':
      ui.filter = b.dataset.f;
      return render();
    case 'meal':
      return mealSheet(id);
    case 'newmeal':
      return mealEditor(null);
    case 'look':
      return S.saveDevice({ lookahead: Math.min(7, Math.max(1, store.device.lookahead + +b.dataset.d)) });
    case 'viewmenu': {
      const cur = store.device.listView || 'list';
      const opt = (k, l) => ({ label: `${l}${cur === k ? '  ✓' : ''}`, run: () => S.saveDevice({ listView: k }) });
      return actionSheet('View shopping list as', [opt('list', 'List'), opt('grid', 'Grid'), opt('compact', 'Compact')]);
    }
    case 'addsug': {
      S.setNeeded(id, true);
      ui.addQuery = '';
      toast(`${store.data.items[id].name} added`);
      return render();
    }
    case 'clearadd':
      ui.addQuery = '';
      render();
      return $('#quickadd')?.focus();
    case 'createitem': {
      const name = ui.addQuery.trim();
      ui.addQuery = '';
      render();
      return itemSheet(null, name, true);
    }
    case 'noop':
      return;
    case 'dismissa2hs':
      localSet('restock.a2hsDismissed', '1');
      return render();
    case 'dismisssync':
      return S.saveDevice({ dismissedSyncCard: true });
    case 'join':
      return joinSheet();
    case 'setup':
      return setupSheet();
    case 'invite':
      return inviteSheet();
    case 'syncnow':
      return syncNow();
    case 'disconnect':
      if (confirm('Stop syncing on this phone? Your data stays here.')) disconnect();
      return;
    case 'catup':
      return S.moveCategory(id, -1);
    case 'catdown':
      return S.moveCategory(id, 1);
    case 'renamecat':
      return categorySheet(id);
    case 'addcat': {
      const name = prompt('New category');
      if (name && name.trim()) S.addCategory(name.trim());
      return;
    }
    case 'export':
      return exportData();
    case 'reset':
      if (confirm('Reset to the starting list? This replaces items, meals and history on this phone.')) S.resetData();
      return;
  }
});

app.addEventListener('submit', (e) => {
  e.preventDefault();
  if (e.target.dataset.form !== 'quickadd') return;
  const top = searchItems(ui.addQuery).find((i) => !['needed', 'due'].includes(S.status(i).kind));
  if (!top) return;
  S.setNeeded(top.id, true);
  ui.addQuery = '';
  toast(`${top.name} added`);
  render();
});

// Keep the keyboard up while tapping suggestions.
app.addEventListener('mousedown', (e) => {
  if (e.target.closest('[data-keepfocus]')) e.preventDefault();
});

// Long press (grid tiles): open the item menu instead of checking it off.
let press = null;
app.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('[data-long]');
  if (!el) return;
  press = { el, x: e.clientX, y: e.clientY, fired: false };
  press.timer = setTimeout(() => {
    press.fired = true;
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 200);
    rowMenu(el.dataset.id);
  }, 450);
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

app.addEventListener('input', (e) => {
  if (e.target.id === 'itemsearch') {
    ui.query = e.target.value;
    render();
  }
  if (e.target.id === 'quickadd') {
    ui.addQuery = e.target.value;
    render();
  }
});

app.addEventListener('change', async (e) => {
  if (e.target.id === 'devname') S.saveDevice({ name: e.target.value.trim() });
  if (e.target.id === 'importfile') {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.items) throw new Error();
      S.importData(data);
      toast('Backup imported');
    } catch {
      toast('That file is not a Restock backup');
    }
  }
});

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

// ---------- boot ----------

S.subscribe(scheduleRender);
onSyncChange(scheduleRender);
render();
startSync();

// Re-render at midnight-ish and every minute so "today/tomorrow" stays right.
setInterval(scheduleRender, 60000);

// Invite link: #join=RS1....
function checkInviteLink() {
  const m = location.hash.match(/join=(RS1\.[A-Za-z0-9+/_-]+)/);
  if (!m) return;
  history.replaceState(null, '', location.pathname);
  if (!store.device.sync) joinSheet(m[1]);
}
checkInviteLink();
window.addEventListener('hashchange', checkInviteLink);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js');
}

window.__restock = { store, S }; // handy for debugging
