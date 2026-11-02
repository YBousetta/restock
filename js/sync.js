// Sync through a JSON file in a private GitHub repo.
// pull -> merge -> push with the file's sha; if the partner pushed in between,
// GitHub rejects the sha and we simply pull and merge again.
import { store, replaceData, saveDevice, onLocalChange } from './store.js';
import { mergeState, sameState, stableStringify } from './merge.js';

const POLL_MS = 15000;
const PUSH_DELAY_MS = 2500;

export const syncState = { status: 'off', lastSync: null, error: null };
const listeners = new Set();
export const onSyncChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
function set(patch) {
  Object.assign(syncState, patch);
  listeners.forEach((fn) => fn());
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function api(cfg, method = 'GET', body) {
  const path = cfg.path || 'data.json';
  return fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${encodeURIComponent(path)}`, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function pull(cfg) {
  const res = await api(cfg);
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw httpError(res);
  const json = await res.json();
  return { data: JSON.parse(b64decode(json.content)), sha: json.sha };
}

async function push(cfg, data, sha) {
  const who = store.device.name || 'phone';
  const res = await api(cfg, 'PUT', {
    message: `Update from ${who}`,
    content: b64encode(stableStringify(data, 1)),
    ...(sha ? { sha } : {}),
  });
  if (res.status === 409 || res.status === 422) return false; // someone else pushed first
  if (!res.ok) throw httpError(res);
  return true;
}

function httpError(res) {
  const msg =
    res.status === 401
      ? 'Token rejected (expired or wrong).'
      : res.status === 403
        ? 'Token lacks permission, or rate limited.'
        : res.status === 404
          ? 'Repository not found for this token.'
          : `GitHub error ${res.status}.`;
  return new Error(msg);
}

let running = null;
let again = false;

export function syncNow() {
  const cfg = store.device.sync;
  if (!cfg) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    set({ status: 'syncing' });
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await pull(cfg);
        const merged = mergeState(store.data, remote.data);
        if (!sameState(merged, store.data)) replaceData(merged);
        if (remote.data && sameState(merged, remote.data)) break;
        if (await push(cfg, merged, remote.sha)) break;
      }
      set({ status: 'ok', lastSync: Date.now(), error: null });
    } catch (e) {
      set({ status: navigator.onLine ? 'error' : 'offline', error: navigator.onLine ? e.message : null });
    } finally {
      running = null;
      if (again) {
        again = false;
        syncNow();
      }
    }
  })();
  return running;
}

let pushTimer = null;
let pollTimer = null;

export function startSync() {
  onLocalChange(() => {
    if (!store.device.sync) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, PUSH_DELAY_MS);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  window.addEventListener('online', syncNow);
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, POLL_MS);
  if (store.device.sync) syncNow();
  else set({ status: 'off' });
}

// Validate a config by talking to GitHub, then save and do a first sync.
export async function connect(cfg) {
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw httpError(res);
  saveDevice({ sync: { path: 'data.json', ...cfg } });
  await syncNow();
  if (syncState.status === 'error') throw new Error(syncState.error);
}

export function disconnect() {
  saveDevice({ sync: null });
  set({ status: 'off', error: null, lastSync: null });
}

// Invite code: everything the partner's phone needs, in one string.
export function inviteCode() {
  const c = store.device.sync;
  if (!c) return '';
  return 'RS1.' + btoa(JSON.stringify({ o: c.owner, r: c.repo, p: c.path, t: c.token })).replace(/=+$/, '');
}

export function parseInvite(code) {
  const m = String(code).trim().match(/RS1\.([A-Za-z0-9+/_-]+)/);
  if (!m) throw new Error('That does not look like an invite code.');
  const j = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
  return { owner: j.o, repo: j.r, path: j.p || 'data.json', token: j.t };
}
