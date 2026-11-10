// In-browser implementation of the artifact `db` interface (doc/collection,
// get/set/update/delete, where/orderBy/limit, onSnapshot).
// Used when the cloud database is not available (local dev, tests) and as a
// test double for the cloud path. Optionally persists to localStorage.

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function deepMerge(target, src) {
  const out = { ...target };
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else out[k] = v;
  }
  return out;
}

export class MemoryDB {
  constructor({ persistKey = null, latency = 0 } = {}) {
    this.docs = new Map(); // path -> data
    this.listeners = new Set(); // {collection, query, cb}
    this.docListeners = new Set();
    this.persistKey = persistKey;
    this.latency = latency;
    if (persistKey) {
      try {
        const raw = localStorage.getItem(persistKey);
        if (raw) for (const [k, v] of Object.entries(JSON.parse(raw))) this.docs.set(k, v);
      } catch (e) { /* storage unavailable */ }
    }
    this._persistTimer = null;
  }
  _persist() {
    if (!this.persistKey) return;
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      try { localStorage.setItem(this.persistKey, JSON.stringify(Object.fromEntries(this.docs))); } catch (e) { /* quota */ }
    }, 250);
  }
  _wait() { return this.latency ? new Promise((r) => setTimeout(r, this.latency)) : Promise.resolve(); }
  _collOf(path) { const s = path.split("/"); return s.slice(0, -1).join("/"); }
  _notify(path) {
    const coll = this._collOf(path);
    for (const l of this.listeners) if (l.coll === coll) l.fire();
    for (const l of this.docListeners) if (l.path === path) l.fire();
  }
  _snapDoc(path) {
    const d = this.docs.get(path);
    const id = path.split("/").pop();
    return { id, exists: d !== undefined, data: () => clone(d), metadata: { fromCache: false, hasPendingWrites: false } };
  }
  doc(path) {
    const segs = path.split("/");
    if (segs.length % 2 !== 0) throw new TypeError("document path needs an even number of segments: " + path);
    const self = this;
    return {
      id: segs[segs.length - 1], path,
      async get() { await self._wait(); return self._snapDoc(path); },
      async set(data) { await self._wait(); self.docs.set(path, clone(data)); self._persist(); self._notify(path); },
      async update(data) {
        await self._wait();
        if (!self.docs.has(path)) { const e = new Error("document does not exist"); e.code = "invalid_argument"; throw e; }
        self.docs.set(path, deepMerge(self.docs.get(path), clone(data))); self._persist(); self._notify(path);
      },
      async delete() { await self._wait(); self.docs.delete(path); self._persist(); self._notify(path); },
      async acquire({ holder, ttlMs = 30000, data } = {}) {
        await self._wait();
        const cur = self.docs.get(path) || {};
        const lease = cur.__lease;
        if (lease && lease.exp > Date.now() && lease.holder !== holder) return { acquired: false, expiresAt: new Date(lease.exp).toISOString() };
        const exp = Date.now() + Math.min(600000, Math.max(1000, ttlMs));
        self.docs.set(path, { ...cur, ...(data || {}), __lease: { holder, exp } }); self._persist();
        return { acquired: true, holder, version: 1, expiresAt: new Date(exp).toISOString() };
      },
      onSnapshot(next) {
        const l = { path, fire: () => setTimeout(() => next(self._snapDoc(path)), 0) };
        self.docListeners.add(l); l.fire();
        return () => self.docListeners.delete(l);
      },
      collection(sub) { return self.collection(path + "/" + sub); },
    };
  }
  collection(path, q = { where: [], order: null, limit: null }) {
    const segs = path.split("/");
    if (segs.length % 2 !== 1) throw new TypeError("collection path needs an odd number of segments: " + path);
    const self = this;
    const run = () => {
      let rows = [];
      for (const [p, d] of self.docs) if (self._collOf(p) === path) rows.push({ p, d });
      for (const [f, op, v] of q.where) {
        rows = rows.filter(({ d }) => {
          const x = d[f];
          switch (op) {
            case "==": return x === v; case "!=": return x !== v; case "<": return x < v; case "<=": return x <= v;
            case ">": return x > v; case ">=": return x >= v; case "in": return v.includes(x); case "not-in": return !v.includes(x);
            case "array-contains": return Array.isArray(x) && x.includes(v); default: return true;
          }
        });
      }
      if (q.order) {
        const [f, dir] = q.order;
        rows.sort((a, b) => {
          const x = a.d[f], y = b.d[f];
          if (x === undefined) return 1; if (y === undefined) return -1;
          return (x < y ? -1 : x > y ? 1 : 0) * (dir === "desc" ? -1 : 1);
        });
      } else rows.sort((a, b) => (a.p < b.p ? -1 : 1));
      if (q.limit) rows = rows.slice(0, q.limit);
      const docs = rows.map(({ p }) => self._snapDoc(p));
      return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((doc, i) => ({ type: "added", doc, oldIndex: -1, newIndex: i })), metadata: { fromCache: false, hasPendingWrites: false } };
    };
    const api = {
      path,
      where(f, op, v) { return self.collection(path, { ...q, where: [...q.where, [f, op, v]] }); },
      orderBy(f, dir = "asc") { return self.collection(path, { ...q, order: [f, dir] }); },
      limit(n) { return self.collection(path, { ...q, limit: n }); },
      async get() { await self._wait(); return run(); },
      onSnapshot(next) {
        let pending = false;
        const l = { coll: path, fire: () => { if (pending) return; pending = true; setTimeout(() => { pending = false; next(run()); }, 0); } };
        self.listeners.add(l); l.fire();
        return () => self.listeners.delete(l);
      },
      doc(id) { return self.doc(path + "/" + (id || Math.random().toString(36).slice(2, 12))); },
      async add(data) { const r = api.doc(); await r.set(data); return r; },
    };
    return api;
  }
}
