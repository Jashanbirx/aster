// Live hospital simulation. Exactly one open device (the lease holder) drives
// it, so several screens can watch the same hospital without double events.
// It only advances things a real hospital would: arrivals, tests resulting,
// cleaning finishing, and 15-minute metric snapshots for trends.
import * as S from "./store.js";
import * as D from "./domain.js";

const ARRIVALS = [
  { cc: "Sprained wrist playing soccer", age: [14, 35], v: { hr: 88, sbp: 122, dbp: 76, rr: 16, spo2: 99, temp: 36.8, pain: 5 } },
  { cc: "Cold symptoms for 4 days, congested", age: [20, 50], v: { hr: 84, sbp: 118, dbp: 74, rr: 16, spo2: 98, temp: 37.6, pain: 2 } },
  { cc: "Chest tightness and sweating", age: [50, 80], v: { hr: 108, sbp: 160, dbp: 96, rr: 22, spo2: 95, temp: 36.9, pain: 7 } },
  { cc: "Vomiting and diarrhea since last night", age: [18, 70], v: { hr: 112, sbp: 104, dbp: 66, rr: 18, spo2: 98, temp: 37.9, pain: 4 } },
  { cc: "Fever and cough, 81 years old", age: [79, 90], v: { hr: 104, sbp: 112, dbp: 64, rr: 24, spo2: 92, temp: 38.6, pain: 2 } },
  { cc: "Ear pain since yesterday", age: [3, 25], v: { hr: 98, sbp: 110, dbp: 70, rr: 18, spo2: 99, temp: 37.8, pain: 4 } },
  { cc: "Needs a sick note for work", age: [20, 50], v: { hr: 74, sbp: 120, dbp: 78, rr: 14, spo2: 99, temp: 36.7, pain: 0 } },
  { cc: "Minor burn on hand from cooking", age: [18, 60], v: { hr: 86, sbp: 126, dbp: 80, rr: 16, spo2: 99, temp: 36.8, pain: 5 } },
  { cc: "Face drooping and trouble speaking", age: [60, 88], v: { hr: 92, sbp: 186, dbp: 104, rr: 18, spo2: 96, temp: 36.9, pain: 0, gcs: 14 } },
  { cc: "Shortness of breath, asthma not improving with puffer", age: [15, 45], v: { hr: 118, sbp: 130, dbp: 82, rr: 28, spo2: 91, temp: 37.0, pain: 3 } },
  { cc: "Back pain after moving furniture", age: [25, 60], v: { hr: 82, sbp: 128, dbp: 80, rr: 16, spo2: 99, temp: 36.7, pain: 6 } },
  { cc: "Rash and itchy eyes after new medication", age: [18, 60], v: { hr: 94, sbp: 124, dbp: 78, rr: 18, spo2: 98, temp: 36.9, pain: 2 } },
];
const F = ["Lucie", "Noah", "Zoé", "Adam", "Maya", "Liam", "Inès", "Raphaël", "Sara", "Arjun", "Aaliyah", "Thomas", "Élodie", "Omar", "Jasmine", "Victor"];
const L = ["Gauthier", "Bergeron", "Leblanc", "Gill", "Mansour", "Cyr", "Huang", "Desrosiers", "Patel", "Laroche", "Ibrahim", "Caron"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const between = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

let leader = false, timer = null, leaseTimer = null;
const holder = "sim:" + Math.random().toString(36).slice(2, 9);
const listeners = new Set();
export const isSimLeader = () => leader;
export function onSimChange(f) { listeners.add(f); return () => listeners.delete(f); }

async function claim() {
  try {
    const r = await S.rawDb().doc("meta/simlease").acquire({ holder, ttlMs: 45000 });
    const was = leader; leader = !!r.acquired;
    if (was !== leader) listeners.forEach((f) => f(leader));
  } catch (e) { leader = false; }
}

function enabled() { const s = S.get("meta", "settings"); return s ? s.simEnabled !== false : true; }

export function tick() {
  if (!enabled() || !S.currentUser()?.canWrite) return;
  const encs = S.all("encounters");
  const ed = encs.filter(D.isEdActive);
  const h = new Date().getHours();
  // 1. arrivals (rate follows the time-of-day curve)
  const pArrive = Math.min(0.55, D.ARRIVAL_CURVE[h] / 16);
  if (ed.length < 34 && Math.random() < pArrive) {
    const c = pick(ARRIVALS);
    const p = D.createPatient({ first: pick(F), last: pick(L), sex: Math.random() < 0.5 ? "F" : "M", dob: `${new Date().getFullYear() - between(c.age[0], c.age[1])}-0${between(1, 9)}-1${between(0, 9)}`, lang: Math.random() < 0.55 ? "fr" : "en" }, "system");
    D.registerArrival({ patientId: p.id, cc: c.cc, source: Math.random() < 0.18 ? "ambulance" : "walk-in", vitals: null }, "system");
    // stash vitals for the triage nurse to confirm
    const e = S.all("encounters").filter((x) => x.patientId === p.id)[0];
    if (e) S.patch("encounters", e.id, { pendingVitals: c.v });
    return;
  }
  // 2. tests come back
  const pending = ed.filter((e) => ["in_treatment", "awaiting_results"].includes(e.status) && (e.orders || []).some((o) => ["ordered", "in_progress"].includes(o.status) && D.minsSince(o.t) > 25));
  if (pending.length && Math.random() < 0.5) {
    const e = pick(pending); const o = e.orders.find((x) => ["ordered", "in_progress"].includes(x.status));
    const results = { lab: ["Within normal limits", "Mildly elevated, see values", "Abnormal: physician to review"], imaging: ["No acute findings", "Findings reported, see radiology", "Preliminary read available"], nursing: ["Done"], consult: ["Consultant notified"], med: ["Given"] };
    D.updateOrder(e.id, o.id, { status: ["nursing", "med", "consult"].includes(o.type) ? "done" : "resulted", result: pick(results[o.type] || results.lab) }, "system");
    return;
  }
  // 3. cleaning finishes
  const cleaning = S.all("beds").filter((b) => b.state === "cleaning" && D.minsSince(b.since) > 35);
  if (cleaning.length && Math.random() < 0.35) {
    const b = pick(cleaning);
    D.setBedState(b.id, "free", "system");
    return;
  }
  // 4. a likely inpatient discharge goes home
  const ready = encs.filter((e) => D.isInpatient(e) && (e.dc?.prob || 0) >= 85 && !(e.dc?.barriers || []).some((x) => x.status !== "done"));
  if (ready.length && Math.random() < 0.15) { D.dischargeInpatient(pick(ready).id, {}, "system"); return; }
}

function snapshot() {
  const m = D.computeMetrics(S.all("encounters"), S.all("beds"));
  const hist = S.get("meta", "history") || { points: [] };
  const last = hist.points[hist.points.length - 1];
  if (last && Date.now() - last.t < 14 * 60000) return;
  const points = [...hist.points, { t: Date.now(), census: m.edCount, waiting: m.waitingMd + m.waitingTriage, boarding: m.boarding, ipOcc: m.ipOccupancy }].slice(-97);
  S.put("meta", "history", { points });
}

export function startSim() {
  if (timer) return;
  claim();
  leaseTimer = setInterval(claim, 20000);
  timer = setInterval(() => { if (leader) { tick(); snapshot(); } }, 15000);
}
export function stopSim() { clearInterval(timer); clearInterval(leaseTimer); timer = null; }
