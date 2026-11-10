// Boot sequence: connect, seed the demo hospital on first run, bring stale
// demo data forward to the current time, and reset on request.
import * as S from "./store.js";
import { buildSeed, SEED_VERSION } from "./seed.js";

const HOUR = 3600000;
const TIME_KEYS = /At$|^t$|^since$|^due$/;
function shiftTimes(v, delta) {
  if (Array.isArray(v)) return v.map((x) => shiftTimes(x, delta));
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "number" && TIME_KEYS.test(k) && x > 1.5e12 && x < 2.6e12) o[k] = x + delta;
      else o[k] = shiftTimes(x, delta);
    }
    return o;
  }
  return v;
}

async function lease(name) {
  try {
    const r = await S.rawDb().doc(`meta/${name}`).acquire({ holder: S.currentUser().id + ":" + Math.random().toString(36).slice(2, 6), ttlMs: 120000 });
    return r.acquired;
  } catch (e) { return true; }
}

export async function seed(onProgress) {
  const { rows } = buildSeed(Date.now());
  await S.bulkWrite(rows, (f) => onProgress && onProgress(f * 0.97, "Setting up Hôpital St-Laurent"));
  await S.rawDb().doc("meta/seed").set({ seededAt: Date.now(), anchor: Date.now(), version: SEED_VERSION });
  S.audit("system", "Demo hospital created", `${rows.length} records`);
  onProgress && onProgress(1, "Ready");
}

export async function resetDemo(onProgress) {
  onProgress && onProgress(0, "Clearing data");
  await S.bulkDelete((f) => onProgress && onProgress(f * 0.4, "Clearing data"));
  await S.rawDb().doc("meta/seed").delete().catch(() => {});
  const { rows } = buildSeed(Date.now());
  await S.bulkWrite(rows, (f) => onProgress && onProgress(0.4 + f * 0.58, "Rebuilding the demo hospital"));
  await S.rawDb().doc("meta/seed").set({ seededAt: Date.now(), anchor: Date.now(), version: SEED_VERSION });
  S.audit("system", "Demo hospital reset", `${rows.length} records`);
  onProgress && onProgress(1, "Ready");
}

/** Shift every timestamp so the demo looks like "now" again (keeps all user changes). */
export async function rebase(delta, onProgress) {
  const rows = [];
  for (const col of S.COLLECTIONS) {
    if (col === "meta" ) continue;
    for (const row of S.all(col)) { const { id, ...data } = row; rows.push({ col, id, data: shiftTimes(data, delta) }); }
  }
  const hist = S.get("meta", "history");
  if (hist) { const { id, ...d } = hist; rows.push({ col: "meta", id: "history", data: shiftTimes(d, delta) }); }
  await S.bulkWrite(rows, (f) => onProgress && onProgress(f * 0.98, "Bringing the demo hospital to the current time"));
  const seedDoc = S.get("meta", "seed") || {};
  const { id, ...sd } = seedDoc;
  await S.rawDb().doc("meta/seed").set({ ...sd, anchor: (sd.anchor || Date.now()) + delta, version: sd.version || SEED_VERSION });
  S.audit("system", "Demo clock moved forward", `${Math.round(delta / HOUR)} h`);
}

/** Full boot. onProgress(fraction, label). Resolves when the app can render. */
export async function boot(onProgress) {
  onProgress(0.05, "Connecting to the database");
  await S.connect();
  onProgress(0.15, "Loading");
  const seedDoc = S.get("meta", "seed");
  const canWrite = S.currentUser().canWrite;
  if ((!seedDoc || (seedDoc.version || 0) < SEED_VERSION) && canWrite) {
    if (await lease("seedlock")) {
      if (seedDoc) await resetDemo(onProgress); else await seed(onProgress);
    } else {
      // another device is seeding; wait for it
      onProgress(0.5, "Another device is setting up the hospital");
      for (let i = 0; i < 60 && !S.get("meta", "seed"); i++) await new Promise((r) => setTimeout(r, 1000));
    }
  } else if (seedDoc && canWrite) {
    // after a long pause, move the demo forward so waits and clocks stay realistic
    let last = seedDoc.anchor || seedDoc.seededAt || 0;
    for (const col of ["encounters", "tasks", "beds", "threads", "reviews"]) for (const r of S.all(col)) if (r.updatedAt > last && r.updatedAt < Date.now() + 60000) last = r.updatedAt;
    const idle = Date.now() - last;
    if (last && idle > 2 * HOUR && (await lease("rebaselock"))) await rebase(idle - 5 * 60000, onProgress);
  }
  onProgress(1, "Ready");
}
