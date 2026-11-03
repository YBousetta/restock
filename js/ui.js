// UI building blocks: iOS-style sheets (swipe down to close), top toasts, action menus.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const $ = (sel, el = document) => el.querySelector(sel);

const closeIcon = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

// ---------- toast (top, full width) ----------

let toastTimer;
export function toast(msg, { undo, icon = '✓' } = {}) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-msg">${esc(msg)}</span>${undo ? '<button class="toast-undo">Undo</button>' : ''}`;
  el.onclick = (e) => {
    if (e.target.closest('.toast-undo')) undo();
    el.classList.remove('show');
  };
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 4500 : 2200);
}

// ---------- sheets ----------

let depth = 0;

function setStacked() {
  const app = document.getElementById('app');
  if (depth > 0 && !document.body.classList.contains('sheet-open')) app.style.transformOrigin = `50% ${window.scrollY}px`;
  document.body.classList.toggle('sheet-open', depth > 0);
}

// build(ctx) fills ctx.body. Options: title, left ({label, run}), large (full height).
export function openSheet(build, { large = false } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet' + (large ? ' large' : '');
  sheet.innerHTML = `<div class="grabber"></div><div class="sheet-scroll"></div>`;
  const scroller = sheet.querySelector('.sheet-scroll');
  document.querySelector('.toast')?.classList.remove('show');
  backdrop.style.zIndex = 40 + depth * 2;
  sheet.style.zIndex = 41 + depth * 2;
  document.body.append(backdrop, sheet);
  depth++;
  setStacked();

  let closed = false;
  const ctx = {
    sheet,
    body: scroller,
    onClose: null,
    close() {
      if (closed) return;
      closed = true;
      sheet.style.transition = '';
      sheet.classList.remove('open');
      backdrop.classList.remove('open');
      depth--;
      setStacked();
      ctx.onClose?.();
      setTimeout(() => {
        sheet.remove();
        backdrop.remove();
      }, 380);
    },
    rerender() {
      const top = scroller.scrollTop;
      const a = document.activeElement;
      const focus = a && a.id && sheet.contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
      build(ctx);
      scroller.scrollTop = top;
      if (focus) {
        const el = sheet.querySelector('#' + CSS.escape(focus.id));
        if (el) {
          el.focus({ preventScroll: true });
          try {
            el.setSelectionRange(focus.s, focus.e);
          } catch {}
        }
      }
    },
  };
  backdrop.onclick = () => ctx.close();
  sheet.addEventListener('input', (e) => {
    if (e.target.classList?.contains('days-input')) e.target.value = e.target.value.replace(/\D/g, '').slice(0, 2);
  });
  sheet.addEventListener('keydown', (e) => {
    if (e.target.classList?.contains('days-input') && e.key === 'Enter') e.target.blur();
  });
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) ctx.close();
  });
  build(ctx);
  enableSwipeToClose(sheet, scroller, backdrop, ctx);
  requestAnimationFrame(() => {
    sheet.classList.add('open');
    backdrop.classList.add('open');
  });
  return ctx;
}

// Header markup shared by sheets: optional left button, centered title, round close button.
export function sheetHeader(title, left = '') {
  return `<div class="sheet-head"><div class="sh-left">${left}</div><h2>${esc(title)}</h2>
    <div class="sh-right"><button class="close-btn" data-close aria-label="Close">${closeIcon}</button></div></div>`;
}

function enableSwipeToClose(sheet, scroller, backdrop, ctx) {
  let startY = null;
  let dy = 0;
  let t0 = 0;
  let dragging = false;
  sheet.addEventListener(
    'touchstart',
    (e) => {
      const onHandle = e.target.closest('.grabber, .sheet-head');
      if (!onHandle && scroller.scrollTop > 0) return;
      if (e.target.closest('input, textarea, select, [data-nodrag]')) return;
      startY = e.touches[0].clientY;
      t0 = Date.now();
      dy = 0;
      dragging = false;
    },
    { passive: true },
  );
  sheet.addEventListener(
    'touchmove',
    (e) => {
      if (startY == null) return;
      dy = e.touches[0].clientY - startY;
      if (!dragging && dy > 8) {
        dragging = true;
        sheet.style.transition = 'none';
      }
      if (!dragging) return;
      if (dy < 0) dy = 0;
      e.preventDefault();
      sheet.style.transform = `translateY(${dy}px)`;
      backdrop.style.opacity = String(Math.max(0, 1 - dy / 400));
    },
    { passive: false },
  );
  sheet.addEventListener('touchend', () => {
    if (startY == null) return;
    const v = dy / Math.max(1, Date.now() - t0);
    startY = null;
    sheet.style.transition = '';
    backdrop.style.opacity = '';
    sheet.style.transform = '';
    if (dragging && (dy > 120 || v > 0.6)) ctx.close();
    dragging = false;
  });
}

// ---------- action menu ----------

export function actionSheet(title, actions) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const el = document.createElement('div');
  el.className = 'actions';
  backdrop.style.zIndex = 90;
  el.style.zIndex = 91;
  el.innerHTML = `<div class="act-group">${title ? `<div class="act-head">${esc(title)}</div>` : ''}
    ${actions
      .map(
        (a, i) =>
          `<button class="act ${a.red ? 'red' : ''} ${a.on ? 'on' : ''}" data-i="${i}">${a.icon ? `<span class="act-icon">${a.icon}</span>` : ''}<span>${esc(a.label)}</span>${a.on ? '<span class="act-check">✓</span>' : ''}</button>`,
      )
      .join('')}</div>
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

export function confirmAction(title, label, run) {
  actionSheet(title, [{ label, red: true, run }]);
}

// ---------- swipe left on rows ----------
// Markup: <div class="swipe-row"><button class="swipe-action" data-act=...>Delete</button><div class="swipe-content">…</div></div>
// Swipe a little to reveal the button, swipe far to trigger it.
export function enableSwipe(root) {
  const W = 88;
  let cur = null;
  let openRow = null;
  const closeRow = (row) => {
    const c = row.querySelector('.swipe-content');
    if (c) c.style.transform = '';
    row.classList.remove('open', 'full');
    setTimeout(() => !row.classList.contains('open') && row.classList.remove('swiping'), 320);
    if (openRow === row) openRow = null;
  };
  root.addEventListener(
    'touchstart',
    (e) => {
      const content = e.target.closest('.swipe-content');
      if (openRow && !e.target.closest('.swipe-action') && (!content || content.parentElement !== openRow)) closeRow(openRow);
      if (!content) return;
      const row = content.parentElement;
      cur = { row, content, x: e.touches[0].clientX, y: e.touches[0].clientY, dx: 0, dir: null, base: row.classList.contains('open') ? -W : 0 };
    },
    { passive: true },
  );
  root.addEventListener(
    'touchmove',
    (e) => {
      if (!cur) return;
      const dx = e.touches[0].clientX - cur.x;
      const dy = e.touches[0].clientY - cur.y;
      if (!cur.dir) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        cur.dir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
        if (cur.dir === 'h') {
          cur.content.style.transition = 'none';
          cur.row.classList.add('swiping');
        }
      }
      if (cur.dir !== 'h') return;
      e.preventDefault();
      cur.dx = Math.min(0, cur.base + dx);
      cur.content.style.transform = `translateX(${cur.dx}px)`;
      cur.row.classList.toggle('full', cur.dx < -cur.row.offsetWidth * 0.5);
    },
    { passive: false },
  );
  root.addEventListener('touchend', () => {
    if (!cur) return;
    const c = cur;
    cur = null;
    if (c.dir !== 'h') return;
    c.content.style.transition = '';
    c.row.dataset.swiped = '1';
    setTimeout(() => delete c.row.dataset.swiped, 80);
    if (c.dx < -c.row.offsetWidth * 0.5) {
      c.content.style.transform = 'translateX(-100%)';
      setTimeout(() => c.row.querySelector('.swipe-action').click(), 180);
    } else if (c.dx < -W / 2) {
      c.content.style.transform = `translateX(${-W}px)`;
      c.row.classList.add('open');
      if (openRow && openRow !== c.row) closeRow(openRow);
      openRow = c.row;
    } else closeRow(c.row);
  });
  // a swipe must not count as a tap on the row
  root.addEventListener(
    'click',
    (e) => {
      const r = e.target.closest('.swipe-row');
      if (r?.dataset.swiped && !e.target.closest('.swipe-action')) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
}

// ---------- passcode ----------

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Six-digit keypad. Calls onSuccess when the code's hash matches.
export function passcodeSheet(title, hash, onSuccess) {
  let code = '';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  const ctx = openSheet((ctx) => {
    ctx.body.innerHTML = `${sheetHeader('')}
      <div class="sheet-body passcode">
        <div class="pc-lock">🔒</div>
        <h3>${esc(title)}</h3>
        <div class="pc-dots">${[0, 1, 2, 3, 4, 5].map((i) => `<span class="${i < code.length ? 'on' : ''}"></span>`).join('')}</div>
        <div class="pc-pad">${keys.map((k) => (k ? `<button data-k="${k}" aria-label="${k === '⌫' ? 'Delete' : k}">${k}</button>` : '<span></span>')).join('')}</div>
      </div>`;
  });
  const paint = () => ctx.body.querySelectorAll('.pc-dots span').forEach((s, i) => s.classList.toggle('on', i < code.length));
  ctx.body.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-k]');
    if (!b || code.length >= 6) return;
    const k = b.dataset.k;
    code = k === '⌫' ? code.slice(0, -1) : code + k;
    paint();
    if (code.length < 6) return;
    if ((await sha256(code)) === hash) {
      ctx.close();
      onSuccess();
    } else {
      const dots = ctx.body.querySelector('.pc-dots');
      dots.classList.add('shake');
      setTimeout(() => {
        dots.classList.remove('shake');
        code = '';
        paint();
      }, 450);
    }
  });
}
