// Aster Copilot: flow analysis, agent tools, proposals and the rules-mode
// responder. Everything here reads live data through the store and writes
// only through domain actions, and only after a human approves a proposal.
import { useSyncExternalStore } from "react";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import * as AI from "../lib/ai.js";

export const AGENT = "Aster Copilot";
export const APPROVED_ACTOR = `agent:${AGENT} (approved by user)`;

/* =================================================================== */
/* Patient flow analysis                                                */
/* =================================================================== */
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const firstOpenOrderAt = (e) => {
  const open = (e.orders || []).filter((o) => ["ordered", "in_progress"].includes(o.status)).map((o) => o.t).filter(Boolean);
  return open.length ? Math.min(...open) : e.seenAt || e.triagedAt || e.arrivalAt;
};

export const FLOW = [
  { key: "triage", label: "Arriving & triage", short: "Triage", statuses: ["arriving", "waiting_triage"], since: (e) => e.arrivalAt, expected: () => 15, expectedLabel: "15 min", route: "ed" },
  { key: "md", label: "Waiting for MD", short: "Waiting for MD", statuses: ["waiting_md"], since: (e) => e.triagedAt || e.arrivalAt, expected: (e) => Math.max(10, D.CTAS[e.ctas || 4].target), expectedLabel: "CTAS target", route: "ed" },
  { key: "treat", label: "In treatment", short: "In treatment", statuses: ["in_treatment"], since: (e) => e.seenAt || e.triagedAt || e.arrivalAt, expected: () => 120, expectedLabel: "2 h", route: "ed" },
  { key: "results", label: "Results pending", short: "Results", statuses: ["awaiting_results"], since: firstOpenOrderAt, expected: () => 60, expectedLabel: "1 h", route: "ed" },
  { key: "decision", label: "Decision", short: "Decision", statuses: ["decision"], since: (e) => e.decisionAt || e.seenAt || e.arrivalAt, expected: () => 30, expectedLabel: "30 min", route: "ed" },
  { key: "boarding", label: "Boarding", short: "Boarding", statuses: ["boarding"], since: (e) => e.admitRequestAt || e.decisionAt || e.arrivalAt, expected: () => 120, expectedLabel: "2 h", route: "beds" },
];

/** Live flow: per stage count, median minutes in stage, expected, ratio, patients; plus the bottleneck. */
export function analyzeFlow(encounters, beds) {
  const ed = encounters.filter(D.isEdActive);
  const stages = FLOW.map((st) => {
    const pts = ed.filter((e) => st.statuses.includes(e.status)).map((e) => {
      const mins = D.minsSince(st.since(e));
      return { e, mins, expected: st.expected(e), over: D.minutesOverTarget(e) };
    }).sort((a, b) => b.mins - a.mins);
    const med = median(pts.map((p) => p.mins));
    const expected = pts.length ? median(pts.map((p) => p.expected)) : st.expected({ ctas: 3 });
    const ratio = pts.length ? med / Math.max(1, expected) : 0;
    const score = ratio * Math.min(1, 0.6 + 0.2 * pts.length);
    return { ...st, count: pts.length, median: med, expected, ratio, score, patients: pts, overCount: pts.filter((p) => p.mins > p.expected).length };
  });
  const ip = beds.filter((b) => b.area === "IP");
  const units = ["7E", "8W", "6N", "CCU", "ICU"].map((u) => {
    const bs = ip.filter((b) => b.unit === u);
    return { unit: u, name: D.UNITS[u], total: bs.length, occupied: bs.filter((b) => b.state === "occupied").length, free: bs.filter((b) => b.state === "free").length, cleaning: bs.filter((b) => b.state === "cleaning").length, blocked: bs.filter((b) => b.state === "blocked").length };
  });
  const inpatients = encounters.filter(D.isInpatient);
  const inpatient = {
    count: inpatients.length, total: ip.length, occupied: ip.filter((b) => b.state === "occupied").length,
    free: ip.filter((b) => b.state === "free").length, cleaning: ip.filter((b) => b.state === "cleaning").length,
    likely: inpatients.filter((e) => (e.dc?.prob || 0) >= 70).length, units,
  };
  inpatient.occupancy = ip.length ? Math.round((inpatient.occupied / ip.length) * 100) : 0;
  const ranked = stages.filter((s) => s.count > 0 && s.ratio > 1).sort((a, b) => b.score - a.score);
  const b = ranked[0] || null;
  return { stages, inpatient, bottleneck: b ? { key: b.key, label: b.label, median: b.median, expected: b.expected, count: b.count, text: explain(b, stages, inpatient) } : null, edCount: ed.length };
}

const dur = (m) => D.fmtDur(m * D.MIN);
const plural = (n, a, b = a + "s") => `${n} ${n === 1 ? a : b}`;
function explain(st, stages, ip) {
  const m = dur(st.median);
  switch (st.key) {
    case "triage": return `${plural(st.count, "patient")} waiting a median ${m} for triage against a 15 min goal. Add a second triage nurse or start pre-triage from the app.`;
    case "md": return `${plural(st.count, "triaged patient")} waiting a median ${m} for a physician against CTAS targets of about ${dur(st.expected)}; ${st.overCount} past target. Physician capacity is the constraint.`;
    case "treat": return `Treatment spaces turn over slowly: median ${m} in treatment against 2 h expected, which holds ${stages[1].count} patients in the waiting room.`;
    case "results": return `${plural(st.count, "patient")} waiting a median ${m} on tests against 1 h expected. Chase outstanding lab and imaging.`;
    case "decision": return `${plural(st.count, "patient")} with results back waiting a median ${m} for a disposition against 30 min expected.`;
    case "boarding": return `${plural(st.count, "admitted patient")} waiting a median ${m} for an inpatient bed against 2 h expected, while ${ip.free} inpatient ${ip.free === 1 ? "bed is" : "beds are"} free and ${ip.cleaning} ${ip.cleaning === 1 ? "is" : "are"} being cleaned.`;
    default: return "";
  }
}

/** Waiting-room risk ranking (deterministic, explainable). */
export function waitingRisk() {
  const ed = S.all("encounters").filter((e) => ["arriving", "waiting_triage", "waiting_md"].includes(e.status));
  return ed.map((e) => {
    const p = D.patientOf(e); const age = D.ageOf(p?.dob) ?? 40;
    const why = []; let score = 0;
    let ctas = e.ctas;
    if (!ctas) {
      const v = e.pendingVitals || e.vitals || {};
      const a = D.assessCtas({ cc: e.cc, vitals: v, age });
      ctas = a.level; score += 6;
      why.push(`not triaged yet (${D.fmtSince(e.arrivalAt)}), rules screen suggests CTAS ${a.level}`);
      if (a.sepsis) { score += 25; why.push("sepsis screen positive on arrival vitals"); }
    } else why.push(`CTAS ${ctas}`);
    score += (6 - ctas) * 12;
    const over = D.minutesOverTarget(e);
    if (over) { score += Math.min(40, over / 3); why.push(`${dur(over)} past target`); }
    // seed/rules can flag "Pregnancy" from phrases like "two weeks"; ignore it for male patients
    (e.redFlags || []).filter((f) => !(f === "Pregnancy" && p?.sex === "M")).forEach((f) => { score += /sepsis/i.test(f) ? 30 : 15; why.push(f.toLowerCase()); });
    const v = e.vitals || {};
    if (v.spo2 && v.spo2 < 92) { score += 10; why.push(`SpO₂ ${v.spo2}%`); }
    if (v.hr && v.hr > 120) { score += 8; why.push(`HR ${v.hr}`); }
    if (v.sbp && v.sbp < 90) { score += 15; why.push(`SBP ${v.sbp}`); }
    if (v.temp && v.temp >= 38.5) { score += 5; why.push(`temp ${v.temp}°C`); }
    if (age >= 75) { score += 8; why.push(`age ${age}`); }
    return { e, p, age, ctas, score: Math.round(score), why };
  }).sort((a, b) => b.score - a.score);
}

/* =================================================================== */
/* Small JSON views for the agent                                       */
/* =================================================================== */
const nameOf = (e) => D.fullName(D.patientOf(e));
const bedLabel = (id) => (id ? S.get("beds", id)?.label || null : null);
function patientRow(e) {
  const p = D.patientOf(e);
  return { encounterId: e.id, name: D.fullName(p), age: D.ageOf(p?.dob), ctas: e.ctas || null, status: e.status, complaint: e.cc, minutesInEd: D.isInpatient(e) ? null : D.waitMinutes(e), bed: bedLabel(e.bedId), ...(e.unit ? { unit: e.unit } : {}) };
}
const recBrief = (r) => ({ id: r.id, severity: r.severity, title: r.title, why: String(r.why || "").slice(0, 200), impact: r.impact });

export function snapshot() {
  const encs = S.all("encounters"), beds = S.all("beds");
  const m = D.computeMetrics(encs, beds);
  const f = analyzeFlow(encs, beds);
  return {
    time: D.fmtClock(Date.now()),
    ed: { census: m.edCount, capacity: m.edCapacity, waitingTriage: m.waitingTriage, waitingMd: m.waitingMd, inTreatment: m.inTreatment, awaitingResults: m.awaitingResults, decision: m.decision, boarding: m.boarding, oldestBoardMin: m.oldestBoardMin, pastCtasTarget: m.overTarget, lwbsRisk: m.lwbsRisk, medianMinutesInEd: m.medianWaitActive, doorToDocMedianMin: m.doorToDocMedian },
    inpatient: { occupancyPct: m.ipOccupancy, free: m.ipFree, cleaning: m.ipCleaning, blocked: m.ipBlocked, likelyDischargesToday: m.likelyDischarges, alc: m.alc },
    flow: f.stages.map((s) => ({ stage: s.label, count: s.count, medianMin: s.median, expectedMin: s.expected })),
    bottleneck: f.bottleneck ? { stage: f.bottleneck.label, explanation: f.bottleneck.text } : null,
    recommendations: D.recommendations().slice(0, 5).map(recBrief),
  };
}

export function searchPatients({ query = "", status } = {}) {
  const encs = S.all("encounters").filter((e) => D.isEdActive(e) || D.isInpatient(e));
  const statuses = status ? String(status).split(/[,|\s]+/).filter(Boolean) : null;
  const toks = String(query || "").toLowerCase().replace(/[*]/g, " ").split(/\s+/).filter((t) => t && !["all", "patients", "patient", "the"].includes(t));
  const hits = encs.filter((e) => {
    if (statuses && !statuses.includes(e.status)) return false;
    if (!toks.length) return true;
    const p = D.patientOf(e);
    const hay = `${p?.first} ${p?.last} ${p?.mrn} ${e.cc} ${bedLabel(e.bedId) || ""} ${e.unit || ""} ${e.service || ""} ${D.STATUS_LABEL[e.status]} ${e.status} ctas ${e.ctas || ""} ctas${e.ctas || ""}`.toLowerCase();
    return toks.every((t) => hay.includes(t));
  }).sort((a, b) => (a.ctas || 6) - (b.ctas || 6) || D.waitMinutes(b) - D.waitMinutes(a));
  return { count: hits.length, patients: hits.slice(0, 10).map(patientRow) };
}

/** Resolve an encounter by id, or by a unique patient name / bed label. */
export function findEncounter(ref) {
  if (!ref) return null;
  const direct = S.get("encounters", ref); if (direct) return direct;
  const q = String(ref).toLowerCase().trim();
  const active = S.all("encounters").filter((e) => D.isEdActive(e) || D.isInpatient(e));
  const byName = active.filter((e) => nameOf(e).toLowerCase() === q || bedLabel(e.bedId)?.toLowerCase() === q);
  return byName.length === 1 ? byName[0] : null;
}

export function getPatient({ encounterId } = {}) {
  const e = findEncounter(encounterId);
  if (!e) return { error: `No visit found for "${encounterId}". Use search_patients to get the encounterId.` };
  const p = D.patientOf(e);
  return {
    ...patientRow(e), sex: p?.sex, lang: p?.lang, allergies: p?.allergies || [], conditions: p?.conditions || [], meds: (p?.meds || []).map((m) => m.name),
    md: e.md || null, nurse: e.nurse || null, service: e.service || null, source: e.source,
    vitals: e.vitals && Object.keys(e.vitals).length ? (({ t, ...v }) => v)(e.vitals) : (e.pendingVitals ? { ...e.pendingVitals, note: "arrival vitals, not yet confirmed by triage" } : null),
    redFlags: e.redFlags || [], minutesPastCtasTarget: D.minutesOverTarget(e),
    orders: (e.orders || []).map((o) => ({ name: o.name, status: o.status, ...(o.result ? { result: o.result } : {}) })),
    notes: (e.notes || []).slice(-3).map((n) => ({ kind: n.kind, author: n.author, excerpt: String(n.text || "").slice(0, 160) })),
    preSummary: e.preSummary ? e.preSummary.slice(0, 240) : undefined,
    timeline: (e.timeline || []).slice(-5).map((t) => ({ minutesAgo: D.minsSince(t.t), text: t.text })),
    ...(e.dc ? { discharge: { probability: e.dc.prob, eta: e.dc.eta, openBarriers: (e.dc.barriers || []).filter((b) => b.status !== "done").map((b) => b.text) }, alc: !!e.alc } : {}),
  };
}

export function listFreeBeds({ unit } = {}) {
  const u = unit ? String(unit).toUpperCase().replace(/\s+/g, "") : null;
  const valid = ["7E", "8W", "6N", "CCU", "ICU", "ED"];
  if (u && !valid.includes(u)) return { error: `Unknown unit "${unit}". Units: ${valid.join(", ")}.` };
  const beds = S.all("beds");
  const units = (u ? [u] : ["7E", "8W", "6N", "CCU", "ICU"]).map((k) => {
    const bs = beds.filter((b) => b.unit === k);
    const free = bs.filter((b) => b.state === "free");
    return { unit: k, name: D.UNITS[k], free: free.slice(0, 12).map((b) => ({ bedId: b.id, label: b.label, zone: k === "ED" ? b.zone : undefined })), freeCount: free.length, cleaning: bs.filter((b) => b.state === "cleaning").length };
  });
  return { totalFree: units.reduce((s, x) => s + x.freeCount, 0), units };
}

export function listTasks({ role } = {}) {
  const ts = S.all("tasks").filter((t) => t.status !== "done" && (!role || String(t.role).toLowerCase() === String(role).toLowerCase()));
  const pr = { stat: 0, high: 1, normal: 2 };
  const sorted = ts.sort((a, b) => (pr[a.priority] ?? 3) - (pr[b.priority] ?? 3) || (a.due || 0) - (b.due || 0));
  return { count: ts.length, tasks: sorted.slice(0, 15).map((t) => ({ taskId: t.id, title: t.title, role: t.role, priority: t.priority, status: t.status, minutesOverdue: t.due && t.due < Date.now() ? D.minsSince(t.due) : 0, patient: t.encounterId ? nameOf(S.get("encounters", t.encounterId)) : null })) };
}

/* =================================================================== */
/* Proposals (human-approved actions)                                   */
/* =================================================================== */
export const ACTION_TYPES = ["assign_bed", "move_status", "request_admission", "divert_to_clinic", "create_task", "page_md", "start_sepsis_bundle"];
export const ACTION_LABEL = { assign_bed: "Assign bed", move_status: "Move patient", request_admission: "Request admission", divert_to_clinic: "Book clinic visit", create_task: "Create task", page_md: "Page physician", start_sepsis_bundle: "Start sepsis bundle", run_recommendation: "Run next best action" };
const ED_STATUSES = ["waiting_triage", "waiting_md", "in_treatment", "awaiting_results", "decision", "boarding"];

function resolveBed(ref) {
  if (!ref) return null;
  const b = S.get("beds", ref); if (b) return b;
  const q = String(ref).toLowerCase().replace(/\s+/g, "");
  return S.all("beds").find((x) => x.label.toLowerCase() === q || x.id.toLowerCase() === q) || null;
}
function earliestSlot(slotRef) {
  const all = S.all("clinics").flatMap((c) => D.openSlots(c).map((s) => ({ ...s, clinicId: c.id, clinicName: c.name }))).sort((a, b) => a.t - b.t);
  if (slotRef) return all.find((s) => s.id === slotRef || s.clinicId === slotRef || s.clinicName.toLowerCase().includes(String(slotRef).toLowerCase())) || null;
  return all[0] || null;
}

/** Validate a proposal against live data. Returns {ok, error, title, detail, resolved}. */
export function checkProposal(p) {
  const type = p.type;
  if (type === "run_recommendation") {
    const rec = D.recommendations().find((r) => r.id === p.recId);
    if (!rec) return { ok: false, error: "This recommendation no longer applies because the data changed. Ask again for a fresh one." };
    return { ok: true, title: rec.action.label, detail: rec.title, resolved: { rec } };
  }
  if (!ACTION_TYPES.includes(type)) return { ok: false, error: `Unknown action "${type}". Use one of: ${ACTION_TYPES.join(", ")}.` };
  const needsEnc = type !== "create_task" || p.encounterId;
  const e = needsEnc ? findEncounter(p.encounterId) : null;
  if (needsEnc && !e) return { ok: false, error: p.encounterId ? `No active visit matches "${p.encounterId}". Search for the patient first.` : "Pick a patient for this action." };
  const who = e ? nameOf(e) : "";
  switch (type) {
    case "assign_bed": {
      const b = resolveBed(p.bedId);
      if (!b) return { ok: false, error: `Bed "${p.bedId || ""}" doesn't exist. Use list_free_beds to pick one.` };
      if (b.state !== "free") return { ok: false, error: `${b.label} is ${b.state === "cleaning" ? "being cleaned" : b.state}, not free. Pick another free bed.` };
      if (b.area === "IP" && !["boarding", "admitted"].includes(e.status)) return { ok: false, error: `${who} isn't admitted yet. Request admission before assigning an inpatient bed.` };
      if (b.area === "ED" && !D.isEdActive(e)) return { ok: false, error: `${who} isn't in the emergency department.` };
      const home = D.SERVICE_UNIT[e.service || "Medicine"];
      const off = b.area === "IP" && home && b.unit !== home ? `, off-service for ${e.service || "Medicine"}` : "";
      return { ok: true, title: "Assign bed", detail: `${who} → ${b.label}${b.area === "IP" ? ` (${D.UNITS[b.unit]}${off})` : ` (ED ${b.zone})`}`, resolved: { e, b } };
    }
    case "move_status": {
      const st = p.status;
      if (!ED_STATUSES.includes(st)) return { ok: false, error: `Status must be one of: ${ED_STATUSES.join(", ")}.` };
      if (!D.isEdActive(e)) return { ok: false, error: `${who} isn't on the emergency board.` };
      if (e.status === st) return { ok: false, error: `${who} is already "${D.STATUS_LABEL[st]}".` };
      return { ok: true, title: "Move patient", detail: `${who}: ${D.STATUS_LABEL[e.status]} → ${D.STATUS_LABEL[st]}`, resolved: { e, st } };
    }
    case "request_admission": {
      const svc = D.SERVICES.find((s) => s.toLowerCase() === String(p.service || "Medicine").toLowerCase());
      if (!svc) return { ok: false, error: `Service must be one of: ${D.SERVICES.join(", ")}.` };
      if (!D.isEdActive(e) || e.status === "boarding") return { ok: false, error: `${who} ${e.status === "boarding" ? "is already admitted and waiting for a bed" : "isn't in the emergency department"}.` };
      return { ok: true, title: "Request admission", detail: `Admit ${who} to ${svc} (${D.UNITS[D.SERVICE_UNIT[svc]]})`, resolved: { e, svc } };
    }
    case "divert_to_clinic": {
      if (!["waiting_triage", "waiting_md"].includes(e.status)) return { ok: false, error: `${who} is already being treated, so can't be redirected.` };
      if (!e.ctas || e.ctas < 4 || (e.redFlags || []).length) return { ok: false, error: `Only triaged CTAS 4–5 patients without red flags can be redirected. ${who} is ${e.ctas ? "CTAS " + e.ctas : "not triaged"}.` };
      const slot = earliestSlot(p.clinicSlot);
      if (!slot) return { ok: false, error: "No open clinic slots match. Ask for the list of open slots." };
      return { ok: true, title: "Book clinic visit", detail: `${who} → ${slot.clinicName} at ${D.fmtClock(slot.t)}`, resolved: { e, slot } };
    }
    case "create_task": {
      const role = D.ROLES.find((r) => r.toLowerCase() === String(p.role || "RN").toLowerCase()) || "RN";
      const title = String(p.title || "").trim();
      if (!title) return { ok: false, error: "A task needs a title." };
      return { ok: true, title: "Create task", detail: `${role}: ${title}${e ? ` (${who})` : ""}`, resolved: { e, role, title } };
    }
    case "page_md": {
      if (!D.isEdActive(e)) return { ok: false, error: `${who} isn't in the emergency department.` };
      return { ok: true, title: "Page physician", detail: `See ${who} now${e.ctas ? ` (CTAS ${e.ctas})` : ""}`, resolved: { e } };
    }
    case "start_sepsis_bundle": {
      if (!D.isEdActive(e)) return { ok: false, error: `${who} isn't in the emergency department.` };
      return { ok: true, title: "Start sepsis bundle", detail: `${who}: lactate, blood cultures, antibiotics within 1 h, fluids; move to treatment`, resolved: { e } };
    }
    default: return { ok: false, error: "Unsupported action." };
  }
}

/** Execute an approved proposal through domain actions. Returns a result message (throws on failure). */
export function executeProposal(p, actor = APPROVED_ACTOR) {
  const c = checkProposal(p);
  if (!c.ok) throw new Error(c.error);
  const r = c.resolved;
  switch (p.type) {
    case "run_recommendation": { const msg = D.runRecommendation(r.rec, actor); S.audit(actor, "Ran next best action", r.rec.title, { recId: r.rec.id }); return msg; }
    case "assign_bed":
      if (r.b.area === "IP") { if (!D.assignInpatientBed(r.e.id, r.b.id, actor)) throw new Error(`${r.b.label} could not be assigned. It may have just been taken.`); return `Placed ${nameOf(r.e)} in ${r.b.label}`; }
      D.assignEdBed(r.e.id, r.b.id, actor); return `Moved ${nameOf(r.e)} to ${r.b.label}`;
    case "move_status":
      if (r.st === "boarding") D.requestAdmission(r.e.id, r.e.service || "Medicine", actor); else D.setEdStatus(r.e.id, r.st, actor);
      return `${nameOf(r.e)} is now "${D.STATUS_LABEL[r.st]}"`;
    case "request_admission": D.requestAdmission(r.e.id, r.svc, actor); return `Admission to ${r.svc} requested for ${nameOf(r.e)}; bed manager tasked`;
    case "divert_to_clinic": { const a = D.divertToClinic(r.e.id, r.slot.clinicId, r.slot.id, actor); if (!a) throw new Error("That slot was just taken. Ask again for the next one."); return `Booked ${nameOf(r.e)} at ${a.clinicName}, ${D.fmtClock(a.t)}`; }
    case "create_task": D.createTask({ title: r.title, role: r.role, encounterId: r.e?.id || null, priority: p.priority && ["stat", "high", "normal"].includes(p.priority) ? p.priority : "high", detail: p.reason || "" }, actor); return `Task created for ${r.role}`;
    case "page_md": D.createTask({ title: `See ${nameOf(r.e)} now${r.e.ctas ? ` (CTAS ${r.e.ctas})` : ""}`, detail: p.reason || "", role: "MD", encounterId: r.e.id, priority: "stat" }, actor); return `Paged the physician for ${nameOf(r.e)}`;
    case "start_sepsis_bundle": D.runRecommendation({ action: { type: "sepsis" }, targets: [r.e.id] }, actor); return `Sepsis bundle started for ${nameOf(r.e)}`;
    default: throw new Error("Unsupported action.");
  }
}

/* =================================================================== */
/* Conversation store (session)                                         */
/* =================================================================== */
const st = { turns: [], proposals: {}, busy: false, asked: 0 };
const subs = new Set();
let snap = { ...st };
const emit = () => { snap = { ...st }; subs.forEach((f) => f()); };
export function useCopilot() { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => snap, () => snap); }
const uid = () => Math.random().toString(36).slice(2, 9);
function patchTurn(id, partial) { st.turns = st.turns.map((t) => (t.id === id ? { ...t, ...(typeof partial === "function" ? partial(t) : partial) } : t)); emit(); }
export function clearConversation() { if (st.busy) return; st.turns = []; st.proposals = {}; emit(); }

function addProposal(turnId, p) {
  const id = "pr-" + uid();
  const c = checkProposal(p);
  st.proposals = { ...st.proposals, [id]: { id, ...p, title: c.title, detail: c.detail, status: "pending", createdAt: Date.now() } };
  patchTurn(turnId, (t) => ({ proposals: [...(t.proposals || []), id] }));
  return id;
}
export function decideProposal(id, approve) {
  const p = st.proposals[id]; if (!p || p.status !== "pending") return null;
  let next;
  if (!approve) next = { ...p, status: "rejected", decidedAt: Date.now() };
  else {
    try { next = { ...p, status: "approved", result: executeProposal(p), decidedAt: Date.now() }; }
    catch (e) { next = { ...p, status: "failed", error: String(e.message || e), decidedAt: Date.now() }; }
  }
  st.proposals = { ...st.proposals, [id]: next }; emit();
  return next;
}

/* =================================================================== */
/* Tools for AI.agent                                                   */
/* =================================================================== */
function toolLabel(name, input = {}, out = {}) {
  switch (name) {
    case "get_hospital_snapshot": return "Read the live hospital snapshot";
    case "search_patients": return `Looked up ${out?.count ?? 0} patient${out?.count === 1 ? "" : "s"}${input.query ? ` for “${String(input.query).slice(0, 24)}”` : ""}${input.status ? ` (${String(input.status).replace(/_/g, " ")})` : ""}`;
    case "get_patient": return out?.error ? "Patient not found" : `Opened the chart of ${out?.name || "a patient"}`;
    case "list_free_beds": return input.unit ? `Checked free beds on ${String(input.unit).toUpperCase()}` : `Checked free beds (${out?.totalFree ?? 0} free)`;
    case "list_tasks": return `Checked ${out?.count ?? 0} open task${out?.count === 1 ? "" : "s"}${input.role ? ` for ${input.role}` : ""}`;
    case "propose_action": return out?.error ? "Proposal needs a fix" : `Drafted: ${ACTION_LABEL[input.type] || "action"}`;
    default: return name;
  }
}

export function buildTools(turnId) {
  return [
    { name: "get_hospital_snapshot", description: "Live hospital snapshot: ED census by stage, patient-flow medians per stage and the bottleneck, inpatient occupancy and free beds, and the top 5 ranked next best actions.", inputSchema: { type: "object", properties: {} }, execute: async () => snapshot() },
    { name: "search_patients", description: "Search active ED patients and inpatients by name, MRN, complaint, bed, unit, service or 'ctas 2'. Empty query lists all. Optional status filter: arriving, waiting_triage, waiting_md, in_treatment, awaiting_results, decision, boarding, admitted (comma-separated allowed). Returns up to 10, most acute first.", inputSchema: { type: "object", properties: { query: { type: "string" }, status: { type: "string" } } }, execute: async (i) => searchPatients(i) },
    { name: "get_patient", description: "Compact chart summary for one visit: vitals, orders with status, red flags, note excerpts, last 5 timeline events, discharge barriers for inpatients.", inputSchema: { type: "object", properties: { encounterId: { type: "string" } }, required: ["encounterId"] }, execute: async (i) => getPatient(i) },
    { name: "list_free_beds", description: "Free beds by unit (7E Medicine, 8W Surgery, 6N Orthopedics, CCU Cardiology, ICU, or ED). Omit unit for all inpatient units.", inputSchema: { type: "object", properties: { unit: { type: "string" } } }, execute: async (i) => listFreeBeds(i) },
    { name: "list_tasks", description: "Open tasks, most urgent first. Optional role filter: RN, MD, Bed manager, Pharmacy, Social work, EVS, Porter, Lab, Clerk.", inputSchema: { type: "object", properties: { role: { type: "string" } } }, execute: async (i) => listTasks(i) },
    {
      name: "propose_action",
      description: "Propose ONE change for a human to approve. Does not change anything: it shows an approval card to the charge nurse. Types: assign_bed {encounterId, bedId}, move_status {encounterId, status}, request_admission {encounterId, service}, divert_to_clinic {encounterId, clinicSlot?}, create_task {title, role, encounterId?}, page_md {encounterId}, start_sepsis_bundle {encounterId}. Always include a one-sentence reason.",
      inputSchema: { type: "object", properties: { type: { type: "string", enum: ACTION_TYPES }, encounterId: { type: "string" }, bedId: { type: "string" }, status: { type: "string" }, service: { type: "string", enum: D.SERVICES }, clinicSlot: { type: "string" }, role: { type: "string" }, title: { type: "string" }, reason: { type: "string" } }, required: ["type", "reason"] },
      execute: async (i) => {
        const c = checkProposal(i || {});
        if (!c.ok) return { error: c.error };
        const proposalId = addProposal(turnId, { ...i, by: "ai" });
        return { proposalId, status: "awaiting human approval", summary: c.detail };
      },
    },
  ];
}

const COPILOT_SYSTEM = () => `${AI.SYSTEM}

You are ${AGENT}, the patient-flow agent working with the charge nurse and the patient-flow manager at Hôpital St-Laurent (fictional demo hospital in Montréal). Local time ${D.fmtClock(Date.now())}.
- Read live data with tools before answering. Never guess names, numbers or bed labels. Usually 1 to 3 tool calls are enough.
- To change anything, call propose_action. It only creates an approval card; nothing changes until a human clicks Approve. Never say a change was made. Say it is ready for approval. Propose at most 3 actions per answer, most valuable first.
- Answer in short markdown: one bold headline line, then at most 5 bullets with patient names, CTAS, times and bed labels. No preamble, no emoji, no exclamation marks, sentence case. Do not show encounter ids.`;

function historyFor(turns) {
  const msgs = [];
  for (const t of turns) {
    if (t.role === "user") msgs.push({ role: "user", content: t.text });
    else if (t.role === "assistant") {
      const notes = (t.proposals || []).map((id) => st.proposals[id]).filter(Boolean).map((p) => `[Proposed: ${p.detail || p.title}. Status: ${p.status}${p.result ? `, ${p.result}` : ""}${p.error ? `, failed: ${p.error}` : ""}]`);
      msgs.push({ role: "assistant", content: [t.text || "(no reply)", ...notes].join("\n") });
    }
  }
  return msgs.slice(-12).filter((m, i, a) => !(i === 0 && m.role !== "user"));
}

/** Send a user message: tries the AI agent, falls back to the rules responder. */
export async function ask(text) {
  const q = String(text || "").trim();
  if (!q || st.busy) return;
  const prior = historyFor(st.turns);
  const userTurn = { id: uid(), role: "user", text: q, t: Date.now() };
  const turnId = uid();
  st.turns = [...st.turns, userTurn, { id: turnId, role: "assistant", text: "", tools: [], proposals: [], pending: true, t: Date.now() }];
  st.busy = true; st.asked++; emit();
  let out = null;
  try {
    out = await AI.agent({
      system: COPILOT_SYSTEM(),
      messages: [...prior, { role: "user", content: q }],
      tools: buildTools(turnId),
      onText: (soFar) => patchTurn(turnId, { text: soFar }),
      onTool: ({ name, input, output, error }) => patchTurn(turnId, (t) => ({ tools: [...(t.tools || []), { id: uid(), name, label: error ? `${name} failed` : toolLabel(name, input || {}, output), error: !!error || !!output?.error }] })),
    });
  } catch (e) { out = null; }
  if (out === null) {
    patchTurn(turnId, { mode: "rules", text: "", tools: [], proposals: [] });
    await rulesRespond(q, turnId);
  } else {
    patchTurn(turnId, (t) => ({ mode: "ai", text: out || t.text || "Done. Nothing to add." }));
  }
  patchTurn(turnId, { pending: false });
  st.busy = false; emit();
}

/* =================================================================== */
/* Rules-mode responder (AI unavailable)                                */
/* =================================================================== */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function streamText(turnId, text) {
  const words = text.split(/(\s+)/);
  const step = Math.max(6, Math.ceil(words.length / 14));
  for (let i = step; i < words.length + step; i += step) { patchTurn(turnId, { text: words.slice(0, i).join("") }); await sleep(28); }
  patchTurn(turnId, { text });
}
function chip(turnId, name, input, output) { patchTurn(turnId, (t) => ({ tools: [...(t.tools || []), { id: uid(), name, label: toolLabel(name, input, output) }] })); }

export function detectIntent(q) {
  const s = q.toLowerCase();
  if (/huddle|brief|3 ?pm|15 ?h/.test(s)) return "huddle";
  if (/free up|boarder|boarding|bed(s)? for|placement|place (the )?admit/.test(s)) return "beds";
  if (/risk|waiting room|sickest|deteriorat|who.*(first|next)|unsafe/.test(s)) return "risk";
  if (/slow|bottleneck|block|stuck|delay|why .*(long|wait)|flow|backed up|crowd/.test(s)) return "slow";
  return "other";
}

async function rulesRespond(q, turnId) {
  await sleep(250);
  const intent = detectIntent(q);
  const snapOut = snapshot();
  chip(turnId, "get_hospital_snapshot", {}, snapOut);
  const recs = D.recommendations();
  const encs = S.all("encounters"), beds = S.all("beds");
  const flow = analyzeFlow(encs, beds);
  const m = D.computeMetrics(encs, beds);
  const offerRec = (rec) => rec && addProposal(turnId, { type: "run_recommendation", recId: rec.id, reason: String(rec.why || "").split(" · ").slice(0, 2).join("; "), by: "rules" });
  let text = "";

  if (intent === "slow") {
    const b = flow.bottleneck;
    const lines = flow.stages.filter((s) => s.count).map((s) => `- ${s.label}: ${s.count} patient${s.count > 1 ? "s" : ""}, median ${dur(s.median)}${s.ratio > 1 ? ` (expected ${dur(s.expected)})` : ""}`);
    const top = b ? flow.stages.find((s) => s.key === b.key).patients.slice(0, 3).map((p) => `${nameOf(p.e)} (${dur(p.mins)})`).join(", ") : "";
    text = b
      ? `**${b.label} is slowing the ED down right now.**\n${b.text}\n\nLongest in that stage: ${top}.\n\n${lines.join("\n")}\n\n${recs[0] ? `Best next move: **${recs[0].title}**. It is ready for your approval below.` : ""}`
      : `**Flow is within expected times.**\nNo stage is over its expected time. ${m.edCount} patients in the ED, median ${dur(m.medianWaitActive)} since arrival.\n\n${lines.join("\n")}`;
    await streamText(turnId, text.trim());
    offerRec(recs[0]);
  } else if (intent === "huddle") {
    const fb = listFreeBeds({}); chip(turnId, "list_free_beds", {}, fb);
    const boarders = searchPatients({ status: "boarding" }); chip(turnId, "search_patients", { status: "boarding" }, boarders);
    const inpatients = encs.filter(D.isInpatient);
    const likely = inpatients.filter((e) => (e.dc?.prob || 0) >= 70);
    const blocked = likely.filter((e) => (e.dc?.barriers || []).some((x) => x.status !== "done"));
    const bList = encs.filter((e) => e.status === "boarding").sort((a, b) => (a.admitRequestAt || 0) - (b.admitRequestAt || 0));
    const freeBy = fb.units.filter((u) => u.freeCount).map((u) => `${u.unit} ${u.freeCount}`).join(", ") || "none";
    const barrierTexts = [...new Set(blocked.flatMap((e) => e.dc.barriers.filter((x) => x.status !== "done").map((x) => x.text)))].slice(0, 3);
    text = `**Bed huddle brief, ${D.fmtClock(Date.now())}**\n` +
      `- **Demand:** ${bList.length} admitted patient${bList.length === 1 ? "" : "s"} boarding in the ED${bList.length ? `: ${bList.slice(0, 4).map((e) => `${nameOf(e)} (${e.service || "Medicine"}, ${D.fmtSince(e.admitRequestAt || e.arrivalAt)})`).join(", ")}` : ""}. ${m.decision} more awaiting disposition.\n` +
      `- **Capacity:** ${m.ipFree} free inpatient beds (${freeBy}), ${m.ipCleaning} being cleaned, ${m.ipBlocked} blocked. Occupancy ${m.ipOccupancy}%.\n` +
      `- **Discharges:** ${likely.length} likely today; ${blocked.length} still have open barriers${barrierTexts.length ? ` (${barrierTexts.join("; ").toLowerCase()})` : ""}.\n` +
      `- **ALC:** ${m.alc} patient${m.alc === 1 ? "" : "s"} waiting for an alternate level of care.\n` +
      `- **Asks:** match boarders to free beds now, assign barrier owners before noon discharges, escalate beds waiting for cleaning.`;
    await streamText(turnId, text);
    offerRec(recs.find((r) => r.id === "beds"));
    offerRec(recs.find((r) => r.id === "barriers"));
  } else if (intent === "risk") {
    const ranked = waitingRisk();
    chip(turnId, "search_patients", { status: "waiting_triage,waiting_md" }, { count: ranked.length });
    if (!ranked.length) text = "**The waiting room is empty.** Every patient is in a treatment space.";
    else {
      text = `**Highest risk in the waiting room (${ranked.length} waiting)**\n` + ranked.slice(0, 5).map((r, i) => `${i + 1}. **${D.fullName(r.p)}**, ${r.age}${r.p?.sex || ""}: ${r.e.cc}. ${r.why.slice(0, 4).join(", ")}.`).join("\n") +
        `\n\nRanked by acuity, time past target, red flags, vital signs and age. Proposed: get a physician to ${D.fullName(ranked[0].p)} now.`;
    }
    await streamText(turnId, text);
    if (ranked.length) {
      const top = ranked[0];
      const sepsis = (top.e.redFlags || []).some((f) => /sepsis/i.test(f));
      addProposal(turnId, { type: sepsis ? "start_sepsis_bundle" : "page_md", encounterId: top.e.id, reason: `Highest risk score in the waiting room: ${top.why.slice(0, 3).join(", ")}.`, by: "rules" });
    }
  } else if (intent === "beds") {
    const fb = listFreeBeds({}); chip(turnId, "list_free_beds", {}, fb);
    const boarders = encs.filter((e) => e.status === "boarding").sort((a, b) => (a.admitRequestAt || 0) - (b.admitRequestAt || 0));
    chip(turnId, "search_patients", { status: "boarding" }, { count: boarders.length });
    const bedRec = recs.find((r) => r.id === "beds"), barRec = recs.find((r) => r.id === "barriers"), evsRec = recs.find((r) => r.id === "evs");
    text = boarders.length
      ? `**${boarders.length} boarder${boarders.length > 1 ? "s" : ""}, ${fb.totalFree} free inpatient bed${fb.totalFree === 1 ? "" : "s"}.**\n` +
        (bedRec ? `- **Place now:** ${bedRec.why}.\n` : "- No free bed matches a boarder's service right now.\n") +
        (barRec ? `- **Unlock discharges:** ${barRec.title}. ${barRec.why}\n` : "") +
        (evsRec ? `- **Cleaning:** ${evsRec.why}.\n` : "") +
        `- Oldest boarder: ${nameOf(boarders[0])}, waiting ${D.fmtSince(boarders[0].admitRequestAt || boarders[0].arrivalAt)} for ${boarders[0].service || "Medicine"}.`
      : `**No boarders right now.** ${fb.totalFree} inpatient beds are free.`;
    await streamText(turnId, text);
    offerRec(bedRec); offerRec(barRec);
  } else {
    const found = searchPatients({ query: q.replace(/[?.!,]/g, " ") });
    if (found.count && found.count <= 3) {
      chip(turnId, "search_patients", { query: q.slice(0, 24) }, found);
      const pt = getPatient({ encounterId: found.patients[0].encounterId }); chip(turnId, "get_patient", {}, pt);
      text = `**${pt.name}, ${pt.age}${pt.sex || ""}: ${D.STATUS_LABEL[pt.status]}**\n- ${pt.complaint}${pt.ctas ? `, CTAS ${pt.ctas}` : ""}${pt.bed ? `, bed ${pt.bed}` : ""}${pt.minutesInEd != null ? `, ${dur(pt.minutesInEd)} in the ED` : ""}\n` +
        (pt.redFlags.length ? `- Red flags: ${pt.redFlags.join(", ")}\n` : "") +
        (pt.orders.length ? `- Orders: ${pt.orders.map((o) => `${o.name} (${o.status.replace("_", " ")})`).join(", ")}\n` : "") +
        (pt.discharge ? `- Discharge: ${pt.discharge.probability}% likely${pt.discharge.openBarriers.length ? `, barriers: ${pt.discharge.openBarriers.join(", ")}` : ""}\n` : "") +
        (pt.timeline.length ? `- Last event: ${pt.timeline[pt.timeline.length - 1].text} (${dur(pt.timeline[pt.timeline.length - 1].minutesAgo)} ago)` : "");
      await streamText(turnId, text);
    } else {
      text = `**${m.edCount} patients in the ED, ${m.boarding} boarding, ${m.ipOccupancy}% inpatient occupancy.**\n` +
        `${flow.bottleneck ? `Bottleneck: ${flow.bottleneck.label.toLowerCase()}. ` : ""}${m.overTarget} past their CTAS target, ${m.lwbsRisk} at risk of leaving without being seen.\n\n` +
        "In rules mode I can answer these precisely:\n- What's slowing the ED down right now?\n- Give me the 3pm bed huddle brief\n- Who is at highest risk in the waiting room?\n- Free up beds for the boarders\n- Or type a patient's name";
      await streamText(turnId, text);
      offerRec(recs[0]);
    }
  }
}
