// Aster data layer.
// - Connects to the artifact's cloud `db` (realtime, shared by every device)
//   or falls back to an in-browser MemoryDB with the same interface.
// - Keeps one live subscription per collection and exposes the data through
//   React hooks (useCollection / useDoc / useStore).
// - All writes go through put/patch/remove, which update the local cache
//   optimistically, serialize writes per document, and record an audit row.
import { useSyncExternalStore, useMemo } from "react";
import { MemoryDB } from "./memdb.js";

export const COLLECTIONS = [
  "patients", "encounters", "beds", "tasks", "reviews", "threads",
  "referrals", "staff", "shifts", "clinics", "appointments", "meta",
];
// audit is subscribed separately (ordered + limited)

const state = {
  ready: false,
  backend: null, // { kind: 'cloud' | 'local', db }
  user: null, // { id, isOwner, canWrite }
  cache: Object.fromEntries([...COLLECTIONS, "audit"].map((c) => [c, new Map()])),
  arrays: {}, // memoized arrays per collection
  version: 0,
  loaded: new Set(),
  error: null,
};
const subs = new Set();
let notifyQueued = false;
function emit() {
  state.version++;
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => { notifyQueued = false; subs.forEach((f) => f()); });
}
function subscribe(f) { subs.add(f); return () => subs.delete(f); }
function getVersion() { return state.version; }

/** Re-render when any data changes. Returns a version number. */
export function useStoreVersion() { return useSyncExternalStore(subscribe, getVersion, getVersion); }

function arrayOf(col) {
  const memo = state.arrays[col];
  if (memo && memo.v === state.cacheV?.[col]) return memo.a;
  const a = [...state.cache[col].values()];
  state.arrays[col] = { v: state.cacheV?.[col], a };
  return a;
}
state.cacheV = Object.fromEntries([...COLLECTIONS, "audit"].map((c) => [c, 0]));
function touch(col) { state.cacheV[col]++; }

/** Live array of all documents in a collection (each has `id`). */
export function useCollection(col) {
  useStoreVersion();
  return arrayOf(col);
}
/** Live single document (or undefined). */
export function useDoc(col, id) {
  useStoreVersion();
  return id ? state.cache[col].get(id) : undefined;
}
/** Non-hook accessors (for actions, AI tools, etc.) */
export const get = (col, id) => state.cache[col].get(id);
export const all = (col) => arrayOf(col);
export const backendKind = () => state.backend?.kind;
export const currentUser = () => state.user;
export const isReady = () => state.ready;

/* ------------------------------------------------------------------ */
/* Connection                                                          */
/* ------------------------------------------------------------------ */
async function useCap(name) {
  try {
    if (window.claude && typeof window.claude.use === "function") {
      return await Promise.race([window.claude.use(name), new Promise((r) => setTimeout(() => r(null), 10000))]);
    }
  } catch (e) { /* unavailable */ }
  return null;
}

export async function connect() {
  let db = await useCap("db");
  let kind = "cloud";
  if (!db) { db = new MemoryDB({ persistKey: "aster.localdb.v2" }); kind = "local"; }
  state.backend = { kind, db };
  const user = await useCap("user");
  let uid = null, isOwner = kind === "local", canWrite = true;
  if (user) {
    try { uid = await user.id(); } catch (e) {}
    try { isOwner = !!(await user.isOwner()); } catch (e) {}
    try { const c = await user.can("data.write"); canWrite = c === null ? true : !!c; } catch (e) {}
  }
  // Viewers who can't write the shared database (e.g. someone opening a shared
  // link) get a private, fully working sandbox in their own browser instead of
  // a read-only demo.
  if (kind === "cloud" && !canWrite) {
    db = new MemoryDB({ persistKey: "aster.sandbox.v2" }); kind = "sandbox";
    state.backend = { kind, db };
    canWrite = true;
  }
  state.user = { id: uid || "local-user", isOwner, canWrite };

  // one live subscription per collection
  await Promise.all(COLLECTIONS.map((col) => new Promise((resolve) => {
    let first = true;
    db.collection(col).onSnapshot((snap) => {
      const m = new Map();
      snap.docs.forEach((d) => { if (d.exists) m.set(d.id, { id: d.id, ...d.data() }); });
      // keep optimistic local rows that the server hasn't confirmed yet
      for (const [id, row] of state.cache[col]) if (row.__pending && !m.has(id)) m.set(id, row);
      state.cache[col] = m; touch(col); emit();
      if (first) { first = false; state.loaded.add(col); resolve(); }
    }, (err) => { console.warn("subscription error", col, err); state.error = err; if (first) { first = false; resolve(); } });
  })));
  db.collection("audit").orderBy("t", "desc").limit(400).onSnapshot((snap) => {
    const m = new Map(); snap.docs.forEach((d) => m.set(d.id, { id: d.id, ...d.data() }));
    state.cache.audit = m; touch("audit"); emit();
  }, () => {});
  state.ready = true; emit();
  return state.backend;
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */
const queues = new Map(); // path -> promise chain
function enqueue(path, fn) {
  const prev = queues.get(path) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  queues.set(path, next);
  next.finally(() => { if (queues.get(path) === next) queues.delete(path); });
  return next;
}
const strip = (o) => { const { id, __pending, ...rest } = o; return JSON.parse(JSON.stringify(rest)); };

async function withRetry(fn) {
  try { return await fn(); }
  catch (e) {
    if (e && e.code === "unavailable") { await new Promise((r) => setTimeout(r, 400 + Math.random() * 600)); return fn(); }
    throw e;
  }
}
function reportWriteError(e) {
  console.error("write failed", e);
  writeErrorListeners.forEach((f) => f(e));
}
const writeErrorListeners = new Set();
export function onWriteError(f) { writeErrorListeners.add(f); return () => writeErrorListeners.delete(f); }

export function newId(prefix = "") {
  const t = Date.now().toString(36).slice(-5);
  const r = Math.random().toString(36).slice(2, 7);
  return (prefix ? prefix + "-" : "") + t + r;
}

/** Create or fully replace a document. Returns the stored row. */
export function put(col, id, data) {
  const row = { ...data, id, updatedAt: Date.now() };
  state.cache[col].set(id, { ...row, __pending: true }); touch(col); emit();
  const path = `${col}/${id}`;
  enqueue(path, () => withRetry(() => state.backend.db.doc(path).set(strip(row)))).catch(reportWriteError);
  return row;
}
/** Merge fields into a document (top-level shallow merge in cache; arrays replace). */
export function patch(col, id, partial) {
  const cur = state.cache[col].get(id);
  if (!cur) return put(col, id, partial);
  const merged = { ...cur, ...partial, updatedAt: Date.now() };
  state.cache[col].set(id, merged); touch(col); emit();
  const path = `${col}/${id}`;
  // write the full merged doc: avoids deep-merge surprises and keeps one shape
  enqueue(path, () => withRetry(() => state.backend.db.doc(path).set(strip(merged)))).catch(reportWriteError);
  return merged;
}
/** Functional update: fn(current) => partial */
export function mutate(col, id, fn) {
  const cur = state.cache[col].get(id);
  if (!cur) return null;
  return patch(col, id, fn(cur));
}
export function remove(col, id) {
  state.cache[col].delete(id); touch(col); emit();
  const path = `${col}/${id}`;
  enqueue(path, () => withRetry(() => state.backend.db.doc(path).delete())).catch(reportWriteError);
}

/** Append an audit-log row. actor: 'user' | 'agent:<Name>' | 'system' | 'patient' */
export function audit(actor, action, detail = "", refs = {}) {
  const id = newId("a");
  const row = { t: Date.now(), actor, action, detail, refs };
  state.cache.audit.set(id, { id, ...row }); touch("audit"); emit();
  enqueue(`audit/${id}`, () => withRetry(() => state.backend.db.doc(`audit/${id}`).set(row))).catch(reportWriteError);
}

/** Wait until all queued writes have reached the backend. */
export async function flush() {
  while (queues.size) await Promise.allSettled([...queues.values()]);
}

/* ------------------------------------------------------------------ */
/* Bulk helpers (seeding, reset, time rebase)                          */
/* ------------------------------------------------------------------ */
export async function bulkWrite(rows, onProgress, concurrency = 8) {
  // rows: [{col, id, data}]
  let done = 0, i = 0;
  const db = state.backend.db;
  async function worker() {
    while (i < rows.length) {
      const { col, id, data } = rows[i++];
      const row = { ...data, id };
      state.cache[col].set(id, row); touch(col);
      try { await withRetry(() => db.doc(`${col}/${id}`).set(strip(row))); }
      catch (e) { if (e && e.code === "quota_exceeded") throw e; console.warn("seed write failed", col, id, e); }
      done++; if (done % 5 === 0 || done === rows.length) { onProgress && onProgress(done / rows.length); emit(); }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  emit();
}
export async function bulkDelete(onProgress) {
  const rows = [];
  for (const col of [...COLLECTIONS, "audit"]) for (const id of state.cache[col].keys()) rows.push({ col, id });
  let done = 0, i = 0;
  const db = state.backend.db;
  async function worker() {
    while (i < rows.length) {
      const { col, id } = rows[i++];
      state.cache[col].delete(id); touch(col);
      try { await withRetry(() => db.doc(`${col}/${id}`).delete()); } catch (e) { console.warn("delete failed", e); }
      done++; if (done % 10 === 0) { onProgress && onProgress(done / rows.length); emit(); }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  emit();
}
/** Raw db access for leases etc. */
export const rawDb = () => state.backend.db;

/** Hook: derive memoized value from collections. deps are collection names. */
export function useDerived(fn, cols, extraDeps = []) {
  useStoreVersion();
  const key = cols.map((c) => state.cacheV[c]).join(":");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(fn, [key, ...extraDeps]);
}
