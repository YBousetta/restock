// Conflict-free merge of two copies of the shared data.
// Every record carries `updatedAt`; per record, the newer copy wins.
// Deletions are tombstones (`deleted: true`), so they merge like edits.

export const COLLECTIONS = ['categories', 'items', 'purchases', 'meals'];

export function mergeMaps(a = {}, b = {}) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    if (!cur || (v.updatedAt || 0) > (cur.updatedAt || 0)) out[k] = v;
  }
  return out;
}

export function mergeState(a, b) {
  if (!b) return a;
  if (!a) return b;
  const out = { schema: 1 };
  for (const c of COLLECTIONS) out[c] = mergeMaps(a[c], b[c]);
  return out;
}

// JSON with sorted keys, so equal data always serialises identically.
export function stableStringify(v, indent) {
  const sort = (x) => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') {
      const o = {};
      for (const k of Object.keys(x).sort()) if (x[k] !== undefined) o[k] = sort(x[k]);
      return o;
    }
    return x;
  };
  return JSON.stringify(sort(v), null, indent);
}

export function sameState(a, b) {
  return stableStringify(a) === stableStringify(b);
}
