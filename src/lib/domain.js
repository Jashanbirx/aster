// Aster domain layer: clinical rules, state machine, selectors and actions.
// Every UI module and every AI tool goes through these functions, so the
// behaviour is identical whether a nurse clicks a button or the agent acts.
import * as S from "./store.js";

/* =================================================================== */
/* Time & formatting                                                    */
/* =================================================================== */
export const MIN = 60000, HOUR = 3600000, DAY = 86400000;
export const now = () => Date.now();
export const minsSince = (t) => (t ? Math.max(0, Math.round((Date.now() - t) / MIN)) : 0);
export function fmtDur(ms) {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
export const fmtSince = (t) => fmtDur(Date.now() - t);
export function fmtClock(t) { return new Date(t).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit", hour12: false }); }
export function fmtDate(t) { return new Date(t).toLocaleDateString("en-CA", { month: "short", day: "numeric" }); }
export function fmtDateTime(t) { return `${fmtDate(t)}, ${fmtClock(t)}`; }
export function fmtAgo(t) {
  const m = minsSince(t);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.floor(m / 60)} h ago`;
  return `${Math.floor(m / 1440)} d ago`;
}
export function ageOf(dob) {
  if (!dob) return null;
  const d = new Date(dob); const n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  if (n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) a--;
  return a;
}
export const fullName = (p) => (p ? `${p.first} ${p.last}` : "Unknown patient");
export const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
const AV = ["#0E6B5C", "#2257C5", "#7A4FD0", "#B5476B", "#B26A00", "#2C7A8C", "#4F6B2E", "#8A4B2D"];
export function colorFor(str = "") { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV[h % AV.length]; }
export const todayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const LANGS = { en: "English", fr: "Français", pa: "ਪੰਜਾਬੀ (Punjabi)", ar: "العربية (Arabic)", es: "Español", zh: "中文 (Chinese)", hi: "हिन्दी (Hindi)", tl: "Tagalog", ht: "Kreyòl (Haitian Creole)" };

/* =================================================================== */
/* CTAS (Canadian Triage and Acuity Scale)                              */
/* =================================================================== */
export const CTAS = {
  1: { label: "Resuscitation", target: 0, reassess: 0 },
  2: { label: "Emergent", target: 15, reassess: 15 },
  3: { label: "Urgent", target: 30, reassess: 30 },
  4: { label: "Less urgent", target: 60, reassess: 60 },
  5: { label: "Non-urgent", target: 120, reassess: 120 },
};

const RX = (s) => new RegExp(s, "i");
const COMPLAINTS = [
  { k: "arrest", re: RX("arrest|unresponsive|not breathing|apn|inconscient|arrêt"), level: 1, flags: ["Unresponsive / arrest"], protocols: ["Resuscitation team now", "Cardiac monitor", "IV access ×2"] },
  { k: "anaphylaxis", re: RX("anaphyla|throat (is )?closing|tongue swell|lips swell|hives.*breath|allergic reaction"), level: 2, flags: ["Possible anaphylaxis"], protocols: ["Epinephrine 0.5 mg IM per directive", "Cardiac monitor", "IV access"] },
  { k: "chest", re: RX("chest|thorac|poitrine|angina|heart pain"), level: 3, central: true, cardiac: RX("radiat|arm|bras|jaw|mâchoire|sweat|diaph|nause|pressure|serrement|crushing|exertion|effort"), protocols: ["ECG within 10 min", "Troponin", "Cardiac monitor"] },
  { k: "stroke", re: RX("weakness|faiblesse|slurred|speech|droop|facial|stroke|avc|numb|engourd|can't move|vision loss"), level: 2, flags: ["Possible stroke: check FAST, last known well"], protocols: ["Code stroke page", "Capillary glucose", "CT head"] },
  { k: "seizure", re: RX("seizure|convuls|épilep|fit "), level: 2, flags: ["Seizure"], protocols: ["Capillary glucose", "Seizure precautions"] },
  { k: "suicidal", re: RX("suicid|kill (my|him|her)self|self[- ]harm|overdose|surdose"), level: 2, flags: ["Safety risk: constant observation"], protocols: ["Constant observation", "Remove means of harm", "Psychiatry consult"] },
  { k: "sob", re: RX("short(ness)? of breath|sob\\b|dyspn|essouffl|can't breathe|wheez|asthma|breath"), level: 3, protocols: ["SpO₂ monitoring", "Peak flow if asthma"] },
  { k: "bleed", re: RX("bleed|saign|hemorr|vomiting blood|black stool|méléna"), level: 3, flags: ["Bleeding"], protocols: ["CBC, group & screen"] },
  { k: "pregnant", re: RX("pregnan|enceinte|grossesse|gestation"), level: 3, flags: ["Pregnancy"], protocols: ["OB consult if > 20 weeks", "Fetal heart rate"] },
  { k: "headache", re: RX("headache|céphal|mal de tête|migraine"), level: 4, central: true, worst: RX("worst|sudden|thunder|soudain|pire|stiff neck"), protocols: [] },
  { k: "abdo", re: RX("abdo|belly|stomach|ventre|epigast|rlq|right lower|flank|appendic"), level: 4, central: true, protocols: ["CBC, lytes, lipase", "Urinalysis", "β-hCG if applicable"] },
  { k: "confusion", re: RX("confus|disorient|delirium|altered"), level: 3, flags: ["Altered mental status"], protocols: ["Capillary glucose", "Sepsis screen"] },
  { k: "fever", re: RX("fever|fièvre|chills|frissons"), level: 4, protocols: [] },
  { k: "trauma", re: RX("fall|chute|fracture|injur|blessure|accident|hit|sprain|entorse|ankle|wrist|knee|hip|cheville|poignet"), level: 4, peripheral: true, protocols: ["Ice, elevation, analgesia per directive"] },
  { k: "lac", re: RX("lacerat|cut |coupure|wound|plaie"), level: 4, peripheral: true, protocols: ["Wound irrigation", "Tetanus status"] },
  { k: "urinary", re: RX("urin|pee|dysur|burning when|brûlure|uti\\b|cystit"), level: 4, minor: true, protocols: ["Urine dipstick"] },
  { k: "minor", re: RX("sore throat|mal de gorge|cold|rhume|congest|cough|toux|rash|éruption|earache|ear pain|oreille|sick note|billet|renew|renouvel|prescription|refill|pink eye|conjonctiv"), level: 5, minor: true, protocols: [] },
];

/**
 * Deterministic CTAS assessment using complaint + first-order modifiers
 * (vital signs, pain severity, sepsis screen). Returns the most urgent level
 * found and the reasons, so the nurse (and the AI) can see why.
 */
export function assessCtas({ cc = "", vitals = {}, age = 40, history = "" } = {}) {
  const text = `${cc}`; // complaint keywords match the presenting complaint only (history is context, not acuity)
  const reasons = [], redFlags = [], protocols = new Set();
  let level = 4, complaint = null;
  const take = (lvl, why) => { if (lvl < level) level = lvl; reasons.push({ level: lvl, why }); };
  const matched = COMPLAINTS.filter((c) => c.re.test(text));
  if (matched.length) {
    complaint = matched[0].k;
    let base = 5;
    for (const c of matched) {
      let l = c.level;
      if (c.k === "chest") l = (c.cardiac.test(text) || age >= 35) ? 2 : 3;
      if (c.k === "headache" && c.worst.test(text)) { l = 2; redFlags.push("Sudden or worst-ever headache"); protocols.add("CT head"); }
      if (c.k === "pregnant" && /bleed|saign|pain|douleur/i.test(text)) l = 2;
      base = Math.min(base, l);
      (c.flags || []).forEach((f) => redFlags.push(f));
      (c.protocols || []).forEach((p) => protocols.add(p));
      if (c.k === "chest" && l === 2) redFlags.push("Possible acute coronary syndrome");
    }
    level = base; reasons.push({ level: base, why: `Presenting complaint: ${matched.map((m) => m.k).join(", ")}` });
  } else reasons.push({ level: 4, why: "Complaint not in quick list: default level 4, reassess" });

  const v = vitals || {};
  const hr = +v.hr, sbp = +v.sbp, rr = +v.rr, spo2 = +v.spo2, temp = +v.temp, pain = +v.pain, gcs = +v.gcs;
  if (spo2) { if (spo2 < 86) take(1, `SpO₂ ${spo2}% (severe hypoxia)`); else if (spo2 < 90) take(2, `SpO₂ ${spo2}% (< 90%)`); else if (spo2 < 93) take(3, `SpO₂ ${spo2}% (90–92%)`); }
  if (hr) { if (hr > 150 || hr < 40) take(2, `Heart rate ${hr}`); else if (hr > 120) take(3, `Heart rate ${hr} (> 120)`); }
  if (sbp) { if (sbp < 80) take(1, `Systolic BP ${sbp} (shock)`); else if (sbp < 90) take(2, `Systolic BP ${sbp} (< 90)`); else if (sbp >= 220) take(2, `Systolic BP ${sbp} (≥ 220)`); else if (sbp >= 200) take(3, `Systolic BP ${sbp} (≥ 200)`); }
  if (rr) { if (rr > 30 || rr < 10) take(2, `Respiratory rate ${rr}`); else if (rr > 24) take(3, `Respiratory rate ${rr} (> 24)`); }
  if (gcs) { if (gcs < 10) take(1, `GCS ${gcs}`); else if (gcs < 14) take(2, `GCS ${gcs}`); }
  // sepsis screen: fever + SIRS-type signs
  let sepsis = false;
  if (temp >= 38 || (temp && temp < 36)) {
    const sirs = [hr > 90, rr > 20, sbp && sbp < 100, age >= 75].filter(Boolean).length;
    if (sirs >= 2) { sepsis = true; take(2, `Temp ${temp}°C with ${sirs} sepsis criteria`); redFlags.push("Sepsis screen positive"); ["Lactate", "Blood cultures ×2", "Sepsis bundle within 1 h"].forEach((p) => protocols.add(p)); }
    else if (temp >= 38.5) take(3, `Temp ${temp}°C`);
  }
  if (pain) {
    const central = matched.some((c) => c.central);
    if (central) { if (pain >= 8) take(2, `Severe central pain ${pain}/10`); else if (pain >= 4) take(3, `Moderate central pain ${pain}/10`); }
    else { if (pain >= 8) take(3, `Severe pain ${pain}/10`); else if (pain >= 4 && level > 4) take(4, `Moderate pain ${pain}/10`); }
  }
  if (age >= 80 && level === 5) take(4, "Age ≥ 80");
  const uniqFlags = [...new Set(redFlags)];
  const divertible = level >= 4 && !uniqFlags.length && age >= 2 && age < 80;
  return { level, label: CTAS[level].label, reasons: reasons.sort((a, b) => a.level - b.level), redFlags: uniqFlags, protocols: [...protocols], divertible, sepsis, complaint };
}

/* =================================================================== */
/* ED state machine                                                     */
/* =================================================================== */
export const ED_STAGES = [
  { key: "waiting_triage", label: "Triage", long: "Waiting for triage" },
  { key: "waiting_md", label: "Waiting for MD", long: "Waiting for physician" },
  { key: "in_treatment", label: "In treatment", long: "Being treated" },
  { key: "awaiting_results", label: "Results pending", long: "Waiting on tests" },
  { key: "decision", label: "Decision", long: "Ready for disposition" },
  { key: "boarding", label: "Boarding", long: "Admitted, waiting for a bed" },
];
export const STATUS_LABEL = {
  arriving: "En route (pre-registered)", waiting_triage: "Waiting for triage", waiting_md: "Waiting for physician",
  in_treatment: "In treatment", awaiting_results: "Waiting on results", decision: "Ready for disposition",
  boarding: "Admitted, waiting for bed", admitted: "Inpatient", discharged: "Discharged", diverted: "Redirected to clinic",
  lwbs: "Left without being seen", transferred: "Transferred",
};
export const ACTIVE_ED = new Set(["arriving", "waiting_triage", "waiting_md", "in_treatment", "awaiting_results", "decision", "boarding"]);
export const stageOf = (e) => (e.status === "arriving" ? "waiting_triage" : e.status);
export const isEdActive = (e) => e.kind === "ED" && ACTIVE_ED.has(e.status);
export const isInpatient = (e) => e.status === "admitted";
export const SERVICES = ["Medicine", "Surgery", "Orthopedics", "Cardiology", "ICU"];
export const SERVICE_UNIT = { Medicine: "7E", Surgery: "8W", Orthopedics: "6N", Cardiology: "CCU", ICU: "ICU" };
export const UNITS = { "7E": "Medicine 7 East", "8W": "Surgery 8 West", "6N": "Orthopedics 6 North", CCU: "Cardiology / CCU", ICU: "Intensive Care", ED: "Emergency" };
export const ROLES = ["RN", "MD", "Bed manager", "Pharmacy", "Social work", "EVS", "Porter", "Lab", "Clerk"];

export function waitMinutes(e) { return minsSince(e.arrivalAt); }
/** Minutes past CTAS time-to-physician target (null if seen / not applicable). */
export function minutesOverTarget(e) {
  if (!["waiting_triage", "waiting_md", "arriving"].includes(e.status) || !e.ctas) return null;
  const over = waitMinutes(e) - CTAS[e.ctas].target;
  return over > 0 ? over : null;
}
export const patientOf = (e) => (e ? S.get("patients", e.patientId) : undefined);
export const bedOf = (id) => (id ? S.get("beds", id) : undefined);

/* =================================================================== */
/* Metrics                                                              */
/* =================================================================== */
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
export function computeMetrics(encounters, beds) {
  const t = Date.now();
  const ed = encounters.filter(isEdActive);
  const by = (st) => ed.filter((e) => e.status === st).length;
  const edBeds = beds.filter((b) => b.area === "ED" && b.zone !== "Hallway");
  const edOcc = beds.filter((b) => b.area === "ED" && b.state === "occupied").length;
  const ip = beds.filter((b) => b.area === "IP");
  const ipOcc = ip.filter((b) => b.state === "occupied");
  const inpatients = encounters.filter(isInpatient);
  const likely = inpatients.filter((e) => (e.dc?.prob || 0) >= 70);
  const boarders = ed.filter((e) => e.status === "boarding");
  const since24 = t - DAY;
  const recent = encounters.filter((e) => e.kind === "ED" && e.arrivalAt >= since24);
  const d2d = recent.filter((e) => e.seenAt).map((e) => (e.seenAt - e.arrivalAt) / MIN);
  const closed = recent.filter((e) => ["discharged", "admitted", "diverted", "lwbs"].includes(e.status) && (e.dischargedAt || e.admittedAt || e.closedAt));
  const los = closed.map((e) => ((e.dischargedAt || e.admittedAt || e.closedAt) - e.arrivalAt) / MIN);
  const waitingLow = ed.filter((e) => ["waiting_md", "waiting_triage"].includes(e.status) && e.ctas >= 4);
  return {
    edCount: ed.length,
    edCapacity: edBeds.length,
    edOccupancy: edBeds.length ? Math.round((ed.length / edBeds.length) * 100) : 0,
    edBedsUsed: edOcc,
    arriving: by("arriving"),
    waitingTriage: by("waiting_triage") + by("arriving"),
    waitingMd: by("waiting_md"),
    inTreatment: by("in_treatment"),
    awaitingResults: by("awaiting_results"),
    decision: by("decision"),
    boarding: boarders.length,
    oldestBoardMin: boarders.length ? Math.max(...boarders.map((e) => minsSince(e.admitRequestAt || e.arrivalAt))) : 0,
    boardingHours: Math.round(boarders.reduce((s, e) => s + minsSince(e.admitRequestAt || e.arrivalAt), 0) / 60),
    medianWaitActive: median(ed.map(waitMinutes)),
    overTarget: ed.filter((e) => minutesOverTarget(e)).length,
    lwbsRisk: waitingLow.filter((e) => waitMinutes(e) > 150).length,
    divertible: waitingLow.filter((e) => e.divertible !== false && !(e.redFlags || []).length).length,
    ipTotal: ip.length,
    ipOccupied: ipOcc.length,
    ipFree: ip.filter((b) => b.state === "free").length,
    ipCleaning: ip.filter((b) => b.state === "cleaning").length,
    ipBlocked: ip.filter((b) => b.state === "blocked").length,
    ipOccupancy: ip.length ? Math.round((ipOcc.length / ip.length) * 100) : 0,
    likelyDischarges: likely.length,
    alc: inpatients.filter((e) => e.alc).length,
    arrivals24: recent.length,
    diverted24: recent.filter((e) => e.status === "diverted").length,
    lwbs24: recent.filter((e) => e.status === "lwbs").length,
    discharged24: encounters.filter((e) => e.dischargedAt && e.dischargedAt >= since24).length,
    doorToDocMedian: Math.round(median(d2d)),
    losMedian: Math.round(median(los)),
  };
}

/* =================================================================== */
/* Actions — every mutation in the app                                  */
/* =================================================================== */
const ev = (type, text, actor = "user") => ({ t: Date.now(), type, text, actor });
function pushTimeline(enc, ...events) { return [...(enc.timeline || []), ...events].slice(-80); }

export function createPatient(data, actor = "user") {
  const id = S.newId("p");
  const mrn = "SLG" + Math.floor(100000 + Math.random() * 899999);
  const p = S.put("patients", id, { mrn, allergies: [], meds: [], conditions: [], lang: "en", createdAt: Date.now(), ...data });
  S.audit(actor, "Registered patient", `${fullName(p)} (${mrn})`, { patientId: id });
  return p;
}
export function updatePatient(id, partial, actor = "user") {
  const p = S.patch("patients", id, partial);
  S.audit(actor, "Updated patient record", fullName(p), { patientId: id });
  return p;
}

/** New ED visit. status 'arriving' for app pre-registration, else 'waiting_triage'. */
export function registerArrival({ patientId, cc, source = "walk-in", vitals = null, note = "", summary = "", threadId = null, status }, actor = "user") {
  const id = S.newId("e");
  const st = status || (source === "app" ? "arriving" : "waiting_triage");
  const p = S.get("patients", patientId);
  const enc = S.put("encounters", id, {
    kind: "ED", patientId, cc, source, status: st, arrivalAt: Date.now(), vitals: vitals || {}, notes: [], orders: [], flags: [],
    redFlags: [], threadId, preSummary: summary || "",
    timeline: [ev("arrival", source === "app" ? "Pre-registered from Aster app" : source === "ambulance" ? "Arrived by ambulance" : "Registered at front desk", actor)],
  });
  if (note) addNote(id, { kind: "nursing", text: note, author: actor }, actor);
  S.audit(actor, source === "app" ? "Pre-registered ED visit" : "Registered ED arrival", `${fullName(p)}: ${cc}`, { encounterId: id, patientId });
  return enc;
}

function guessOrderType(name) {
  if (/ct |x-ray|xray|ultrasound|echo|mri|imaging|ct$/i.test(name)) return "imaging";
  if (/ecg|monitor|observation|precaution|irrigation|ice|glucose|spo|peak flow|fetal/i.test(name)) return "nursing";
  if (/consult|page|team/i.test(name)) return "consult";
  if (/mg|epinephrine|asa|analges|bundle/i.test(name)) return "med";
  return "lab";
}
export function completeTriage(encId, { ctas, vitals, note, redFlags = [], protocols = [], rulesCtas, aiCtas, divertible, nurse = "Triage RN" }, actor = "user") {
  const e = S.get("encounters", encId); if (!e) return;
  const orders = [...(e.orders || [])];
  protocols.forEach((name) => orders.push({ id: S.newId("o"), name, type: guessOrderType(name), status: "ordered", t: Date.now(), by: "Medical directive (nurse-initiated)" }));
  const timeline = pushTimeline(e, ev("triage", `Triaged CTAS ${ctas}${aiCtas && aiCtas !== ctas ? ` (AI suggested ${aiCtas})` : ""}${rulesCtas && rulesCtas !== ctas ? ` (rules ${rulesCtas})` : ""}`, actor));
  if (protocols.length) timeline.push(ev("order", `Nurse-initiated: ${protocols.join(", ")}`, actor));
  S.patch("encounters", encId, {
    status: "waiting_md", ctas, vitals: { ...(e.vitals || {}), ...vitals, t: Date.now() }, triagedAt: Date.now(), redFlags,
    divertible: divertible ?? (ctas >= 4 && !redFlags.length), orders, nurse, timeline,
    vitalsHistory: [...(e.vitalsHistory || []), { ...vitals, t: Date.now() }].slice(-20),
  });
  if (note) addNote(encId, { kind: "triage", text: note, author: nurse }, actor);
  S.audit(actor, "Completed triage", `${fullName(patientOf(e))}: CTAS ${ctas}`, { encounterId: encId });
}

export function recordVitals(encId, vitals, actor = "user") {
  const e = S.get("encounters", encId); if (!e) return;
  S.patch("encounters", encId, { vitals: { ...vitals, t: Date.now() }, vitalsHistory: [...(e.vitalsHistory || []), { ...vitals, t: Date.now() }].slice(-20), timeline: pushTimeline(e, ev("vitals", "Vitals recorded", actor)) });
}

/** Move a patient along the ED board (drag & drop or buttons). Applies side effects. */
export function setEdStatus(encId, status, actor = "user", extra = {}) {
  const e = S.get("encounters", encId); if (!e || e.status === status) return;
  const p = {};
  if (status === "in_treatment" && !e.seenAt) { p.seenAt = Date.now(); p.md = extra.md || e.md || pickMd(); }
  if (status === "decision" && !e.decisionAt) p.decisionAt = Date.now();
  if (status === "waiting_md" && !e.triagedAt) { p.triagedAt = Date.now(); p.ctas = e.ctas || 4; }
  if (status === "boarding") { p.admitRequestAt = Date.now(); p.service = extra.service || e.service || "Medicine"; }
  if (status === "in_treatment" && !e.bedId) { const b = firstFreeEdBed(e.ctas); if (b) { p.bedId = b.id; S.patch("beds", b.id, { state: "occupied", encounterId: encId, since: Date.now() }); } }
  S.patch("encounters", encId, { status, ...p, timeline: pushTimeline(e, ev("status", `${STATUS_LABEL[e.status] || e.status} → ${STATUS_LABEL[status]}`, actor)) });
  if (status === "boarding") createTask({ title: `Find ${p.service} bed for ${fullName(patientOf(e))}`, role: "Bed manager", encounterId: encId, priority: "high" }, actor);
  S.audit(actor, "Moved patient", `${fullName(patientOf(e))}: ${STATUS_LABEL[status]}`, { encounterId: encId });
}
const MDS = ["Dr. Okafor", "Dr. Pelletier", "Dr. Ahmed", "Dr. Tremblay"];
function pickMd() { return MDS[Math.floor(Math.random() * MDS.length)]; }
export function firstFreeEdBed(ctas = 3) {
  const beds = S.all("beds").filter((b) => b.area === "ED" && b.state === "free");
  const pref = ctas <= 2 ? ["Resus", "Acute"] : ctas >= 4 ? ["Fast track", "Acute"] : ["Acute", "Fast track"];
  for (const z of pref) { const b = beds.find((x) => x.zone === z); if (b) return b; }
  return beds.find((x) => x.zone !== "Resus") || null;
}

export function assignEdBed(encId, bedId, actor = "user") {
  const e = S.get("encounters", encId); const b = S.get("beds", bedId); if (!e || !b) return;
  if (e.bedId && e.bedId !== bedId) S.patch("beds", e.bedId, { state: "cleaning", encounterId: null, since: Date.now() });
  S.patch("beds", bedId, { state: "occupied", encounterId: encId, since: Date.now() });
  S.patch("encounters", encId, { bedId, timeline: pushTimeline(e, ev("location", `Moved to ${b.label}`, actor)) });
  S.audit(actor, "Assigned ED space", `${fullName(patientOf(e))} → ${b.label}`, { encounterId: encId });
}

export function addOrder(encId, { name, type, priority = "routine" }, actor = "user") {
  const e = S.get("encounters", encId); if (!e) return;
  const o = { id: S.newId("o"), name, type: type || guessOrderType(name), status: "ordered", priority, t: Date.now(), by: actor === "user" ? (e.md || "Physician") : actor };
  S.patch("encounters", encId, { orders: [...(e.orders || []), o], timeline: pushTimeline(e, ev("order", `Ordered ${name}`, actor)) });
  S.audit(actor, "Placed order", `${name} for ${fullName(patientOf(e))}`, { encounterId: encId });
  return o;
}
export function updateOrder(encId, orderId, partial, actor = "user") {
  const e = S.get("encounters", encId); if (!e) return;
  const orders = (e.orders || []).map((o) => (o.id === orderId ? { ...o, ...partial, ...(partial.status === "resulted" ? { resultedAt: Date.now() } : {}) } : o));
  const o = orders.find((x) => x.id === orderId);
  const tl = partial.status === "resulted" ? pushTimeline(e, ev("result", `${o.name}: ${partial.result || "resulted"}`, actor)) : e.timeline;
  // when every order is back and the patient was waiting on results, move to decision
  const allBack = orders.every((x) => ["resulted", "done", "cancelled"].includes(x.status));
  S.patch("encounters", encId, { orders, timeline: tl, ...(allBack && e.status === "awaiting_results" ? { status: "decision", decisionAt: Date.now() } : {}) });
  S.audit(actor, "Updated order", `${o?.name}: ${partial.status}`, { encounterId: encId });
}

export function addNote(encId, { kind = "md", text, author = "Physician", signed = true, source }, actor = "user") {
  const e = S.get("encounters", encId); if (!e) return;
  const n = { id: S.newId("n"), kind, text, author, signed, t: Date.now(), source: source || null };
  S.patch("encounters", encId, { notes: [...(e.notes || []), n], timeline: pushTimeline(e, ev("note", `${kind === "scribe" ? "Ambient scribe note" : kind === "triage" ? "Triage note" : kind === "discharge" ? "Discharge instructions" : "Note"} by ${author}`, actor)) });
  S.audit(actor, "Added note", `${kind} note for ${fullName(patientOf(e))}`, { encounterId: encId });
  return n;
}

export function requestAdmission(encId, service = "Medicine", actor = "user") {
  setEdStatus(encId, "boarding", actor, { service });
}

/** Place an admitted ED patient (or transfer an inpatient) into an inpatient bed. */
export function assignInpatientBed(encId, bedId, actor = "user") {
  const e = S.get("encounters", encId); const b = S.get("beds", bedId);
  if (!e || !b || b.state !== "free") return false;
  if (e.bedId) { const old = S.get("beds", e.bedId); S.patch("beds", e.bedId, { state: "cleaning", encounterId: null, since: Date.now() }); createTask({ title: `Clean ${old?.label || "bed"}`, role: "EVS", priority: "high", bedId: e.bedId }, "system"); }
  S.patch("beds", bedId, { state: "occupied", encounterId: encId, since: Date.now() });
  S.patch("encounters", encId, {
    status: "admitted", kind: e.kind === "ED" ? "ED" : e.kind, unit: b.unit, bedId: bedId, admittedAt: Date.now(), service: e.service || "Medicine",
    dc: { prob: 5, barriers: [], eta: null }, los0: Date.now(),
    timeline: pushTimeline(e, ev("admit", `Admitted to ${UNITS[b.unit]} bed ${b.label}`, actor)),
  });
  createTask({ title: `Transport ${fullName(patientOf(e))} to ${b.label}`, role: "Porter", encounterId: encId, priority: "high" }, "system");
  S.all("tasks").filter((t) => t.encounterId === encId && t.role === "Bed manager" && t.status !== "done").forEach((t) => setTaskStatus(t.id, "done", "system"));
  S.audit(actor, "Assigned inpatient bed", `${fullName(patientOf(e))} → ${b.label} (${UNITS[b.unit]})`, { encounterId: encId });
  return true;
}

function freeBedAfter(e, actor) {
  if (!e.bedId) return;
  const b = S.get("beds", e.bedId);
  S.patch("beds", e.bedId, { state: "cleaning", encounterId: null, since: Date.now() });
  createTask({ title: `Clean ${b?.label || "bed"}`, role: "EVS", priority: b?.area === "IP" ? "high" : "normal", bedId: e.bedId }, "system");
}

export function dischargeEd(encId, { instructions = "", lang = "en", followUp = "" } = {}, actor = "user") {
  const e = S.get("encounters", encId); if (!e) return;
  freeBedAfter(e, actor);
  S.patch("encounters", encId, { status: "discharged", dischargedAt: Date.now(), bedId: null, dischargeInstructions: instructions ? { text: instructions, lang, t: Date.now() } : null, followUp, timeline: pushTimeline(e, ev("discharge", "Discharged home", actor)) });
  if (instructions) addNote(encId, { kind: "discharge", text: instructions, author: e.md || "Physician" }, actor);
  notifyPatient(e.patientId, { role: "system", text: `You were discharged from Hôpital St-Laurent. Your discharge instructions are in Visits.${followUp ? " Follow-up: " + followUp : ""}`, card: { type: "discharge", encounterId: encId } });
  scheduleCheckin(e.patientId, encId);
  S.audit(actor, "Discharged from ED", fullName(patientOf(e)), { encounterId: encId });
}
export function dischargeInpatient(encId, { summary = "" } = {}, actor = "user") {
  const e = S.get("encounters", encId); if (!e) return;
  freeBedAfter(e, actor);
  S.patch("encounters", encId, { status: "discharged", dischargedAt: Date.now(), bedId: null, dc: { ...(e.dc || {}), prob: 100 }, timeline: pushTimeline(e, ev("discharge", "Discharged from unit", actor)) });
  if (summary) addNote(encId, { kind: "discharge", text: summary, author: "Attending" }, actor);
  S.all("tasks").filter((t) => t.encounterId === encId && t.status !== "done").forEach((t) => setTaskStatus(t.id, "done", "system"));
  scheduleCheckin(e.patientId, encId);
  S.audit(actor, "Discharged inpatient", `${fullName(patientOf(e))} from ${UNITS[e.unit] || "unit"}`, { encounterId: encId });
}
export function markLwbs(encId, actor = "user") {
  const e = S.get("encounters", encId); if (!e) return;
  freeBedAfter(e, actor);
  S.patch("encounters", encId, { status: "lwbs", closedAt: Date.now(), bedId: null, timeline: pushTimeline(e, ev("lwbs", "Left without being seen", actor)) });
  createTask({ title: `Call back ${fullName(patientOf(e))} (left without being seen)`, role: "RN", encounterId: encId, priority: "high" }, "system");
  S.audit(actor, "Left without being seen", fullName(patientOf(e)), { encounterId: encId });
}

export function setBedState(bedId, state, actor = "user") {
  const b = S.get("beds", bedId); if (!b) return;
  S.patch("beds", bedId, { state, since: Date.now(), ...(state !== "occupied" ? { encounterId: null } : {}) });
  if (state === "free") S.all("tasks").filter((t) => t.bedId === bedId && t.status !== "done").forEach((t) => setTaskStatus(t.id, "done", "system"));
  S.audit(actor, "Bed status", `${b.label}: ${state}`, { bedId });
}

export function setDischargePlan(encId, partial, actor = "user") {
  const e = S.get("encounters", encId); if (!e) return;
  S.patch("encounters", encId, { dc: { ...(e.dc || {}), ...partial } });
  S.audit(actor, "Updated discharge plan", fullName(patientOf(e)), { encounterId: encId });
}
export function resolveBarrier(encId, barrierId, actor = "user") {
  const e = S.get("encounters", encId); if (!e) return;
  const barriers = (e.dc?.barriers || []).map((b) => (b.id === barrierId ? { ...b, status: "done", doneAt: Date.now() } : b));
  const open = barriers.filter((b) => b.status !== "done").length;
  S.patch("encounters", encId, { dc: { ...(e.dc || {}), barriers, prob: open ? e.dc?.prob : Math.max(e.dc?.prob || 0, 90) } });
  S.all("tasks").filter((t) => t.barrierId === barrierId && t.status !== "done").forEach((t) => setTaskStatus(t.id, "done", "system"));
  S.audit(actor, "Cleared discharge barrier", `${fullName(patientOf(e))}`, { encounterId: encId });
}

/* ------------------------------ tasks ------------------------------ */
export function createTask({ title, detail = "", role = "RN", encounterId = null, bedId = null, barrierId = null, priority = "normal", dueMin = null }, actor = "user") {
  const id = S.newId("t");
  const due = dueMin ? Date.now() + dueMin * MIN : priority === "stat" ? Date.now() + 15 * MIN : priority === "high" ? Date.now() + 60 * MIN : Date.now() + 4 * HOUR;
  const t = S.put("tasks", id, { title, detail, role, encounterId, bedId, barrierId, priority, status: "open", createdAt: Date.now(), due, createdBy: actor });
  S.audit(actor, "Created task", `${role}: ${title}`, { taskId: id, encounterId });
  return t;
}
export function setTaskStatus(id, status, actor = "user", assignee) {
  const t = S.get("tasks", id); if (!t) return;
  S.patch("tasks", id, { status, ...(status === "done" ? { doneAt: Date.now() } : {}), ...(assignee ? { assignee } : {}) });
  if (status === "done" && t.barrierId && t.encounterId) {
    const e = S.get("encounters", t.encounterId);
    if (e && (e.dc?.barriers || []).some((b) => b.id === t.barrierId && b.status !== "done")) resolveBarrier(t.encounterId, t.barrierId, actor);
  }
  if (status === "done" && t.bedId && t.role === "EVS") { const b = S.get("beds", t.bedId); if (b && b.state === "cleaning") S.patch("beds", t.bedId, { state: "free", since: Date.now() }); }
  if (actor !== "system") S.audit(actor, status === "done" ? "Completed task" : "Updated task", t.title, { taskId: id });
}

/* ------------------------- clinics & diversion ---------------------- */
export function openSlots(clinic, fromT = Date.now()) { return (clinic.slots || []).filter((s) => !s.bookedBy && s.t >= fromT - 5 * MIN); }
export function bookSlot({ clinicId, slotId, patientId, encounterId = null, source = "staff", threadId = null }, actor = "user") {
  const c = S.get("clinics", clinicId); if (!c) return null;
  const slot = (c.slots || []).find((s) => s.id === slotId); if (!slot || slot.bookedBy) return null;
  const apptId = S.newId("ap");
  S.patch("clinics", clinicId, { slots: c.slots.map((s) => (s.id === slotId ? { ...s, bookedBy: { patientId, apptId } } : s)) });
  const appt = S.put("appointments", apptId, { clinicId, clinicName: c.name, slotId, t: slot.t, patientId, encounterId, source, status: "booked", createdAt: Date.now(), threadId });
  S.audit(actor, "Booked clinic slot", `${fullName(S.get("patients", patientId))}: ${c.name} ${fmtClock(slot.t)}`, { patientId, encounterId });
  return appt;
}
export function divertToClinic(encId, clinicId, slotId, actor = "user") {
  const e = S.get("encounters", encId); if (!e) return null;
  const appt = bookSlot({ clinicId, slotId, patientId: e.patientId, encounterId: encId, source: "ed-diversion" }, actor);
  if (!appt) return null;
  freeBedAfter(e, actor);
  S.patch("encounters", encId, { status: "diverted", closedAt: Date.now(), bedId: null, diversion: { clinicId, slotId, apptId: appt.id, t: appt.t, clinicName: appt.clinicName }, timeline: pushTimeline(e, ev("diverted", `Booked ${appt.clinicName} at ${fmtClock(appt.t)}`, actor)) });
  notifyPatient(e.patientId, { role: "system", text: `Your visit was moved to ${appt.clinicName} at ${fmtClock(appt.t)}. Your triage summary was sent ahead.`, card: { type: "appointment", apptId: appt.id } });
  S.audit(actor, "Redirected to clinic", `${fullName(patientOf(e))} → ${appt.clinicName} ${fmtClock(appt.t)}`, { encounterId: encId });
  return appt;
}

/* ----------------------- patient app threads ------------------------ */
export function threadFor(patientId) {
  return S.all("threads").filter((t) => t.patientId === patientId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
}
export function createThread(patientId, lang = "en") {
  const id = S.newId("th");
  return S.put("threads", id, { patientId, lang, status: "active", messages: [], createdAt: Date.now(), updatedAt: Date.now() });
}
export function postMessage(threadId, msg) {
  const th = S.get("threads", threadId); if (!th) return;
  const m = { id: S.newId("m"), t: Date.now(), ...msg };
  S.patch("threads", threadId, { messages: [...(th.messages || []), m].slice(-120), updatedAt: Date.now(), ...(msg.role === "md" || msg.role === "system" || (msg.role === "ai" && msg.card) ? { unread: (th.unread || 0) + 1 } : {}) });
  return m;
}
export function notifyPatient(patientId, msg) {
  const p = S.get("patients", patientId); if (!p || !p.appUser) return;
  const th = threadFor(patientId) || createThread(patientId, p.lang);
  postMessage(th.id, msg);
}
export function scheduleCheckin(patientId, encId) {
  const p = S.get("patients", patientId); if (!p || !p.appUser) return;
  const th = threadFor(patientId) || createThread(patientId, p.lang);
  postMessage(th.id, { role: "ai", text: "How are you feeling since your visit? This 30-second check-in goes to your care team.", card: { type: "checkin", encounterId: encId, status: "open" } });
}
export function submitCheckin(threadId, msgId, answers, actor = "patient") {
  const th = S.get("threads", threadId); if (!th) return;
  const worse = answers.feeling === "worse" || answers.redFlag;
  const messages = (th.messages || []).map((m) => (m.id === msgId ? { ...m, card: { ...m.card, status: "done", answers } } : m));
  S.patch("threads", threadId, { messages, updatedAt: Date.now() });
  const p = S.get("patients", th.patientId);
  if (worse) {
    createReview({ kind: "escalation", patientId: th.patientId, threadId, encounterId: answers.encounterId, title: "Post-visit check-in: patient reports getting worse", summary: `Feeling: ${answers.feeling}. Meds understood: ${answers.meds}. New symptom: ${answers.redFlag ? "yes: " + (answers.detail || "not described") : "no"}.`, risk: answers.redFlag ? "high" : "med" }, "agent:Follow-up Nurse");
    postMessage(threadId, { role: "ai", text: "Thanks. I've flagged this for a physician now. If you have trouble breathing, chest pain or feel faint, call 911." });
  } else postMessage(threadId, { role: "ai", text: "Glad you're doing okay. I'll check in again if needed. Message me any time." });
  S.audit(actor, "Submitted check-in", `${fullName(p)}: ${answers.feeling}`, { patientId: th.patientId });
}

/* ------------------------- physician sign-off ----------------------- */
export function createReview({ kind = "care_plan", patientId, threadId = null, encounterId = null, title, summary = "", proposal = null, risk = "low", msgId = null }, actor = "agent:Aster Care") {
  const id = S.newId("rv");
  const r = S.put("reviews", id, { kind, patientId, threadId, encounterId, title, summary, proposal, risk, msgId, status: "pending", createdAt: Date.now() });
  S.audit(actor, "Sent for physician sign-off", `${title} (${fullName(S.get("patients", patientId))})`, { reviewId: id, patientId });
  return r;
}
export function decideReview(id, { decision, note = "", md = "Dr. A. Okafor", edited = null }, actor = "user") {
  const r = S.get("reviews", id); if (!r) return;
  const status = { approve: "approved", modify: "modified", reject: "rejected", video: "video" }[decision];
  const proposal = edited ? { ...(r.proposal || {}), ...edited } : r.proposal;
  S.patch("reviews", id, { status, decidedAt: Date.now(), decidedBy: md, physicianNote: note, proposal });
  if (r.threadId) {
    const th = S.get("threads", r.threadId);
    if (th && r.msgId) {
      S.patch("threads", r.threadId, { messages: (th.messages || []).map((m) => (m.id === r.msgId ? { ...m, card: { ...m.card, status, decidedBy: md, proposal } } : m)) });
    }
    const text = {
      approved: `I reviewed your plan and signed it.${proposal?.rx ? " Your prescription was sent to your pharmacy." : ""}${note ? " " + note : ""}`,
      modified: `I reviewed your plan and made a change: ${note || "see the updated plan."}${proposal?.rx ? " The prescription was sent to your pharmacy." : ""}`,
      rejected: `I'd like a different approach. ${note || "A nurse will call you shortly."}`,
      video: `I'd like to see you on video to be safe. ${note || "Your video visit is booked for today."}`,
    }[status];
    postMessage(r.threadId, { role: "md", author: md, text });
  }
  S.audit(actor, `Physician ${status}`, `${r.title} (${fullName(S.get("patients", r.patientId))})`, { reviewId: id, patientId: r.patientId });
}

/* ------------------------------ referrals --------------------------- */
export function addReferral({ from, raw, image = null }, actor = "user") {
  const id = S.newId("rf");
  S.put("referrals", id, { from, raw, image, receivedAt: Date.now(), status: "new" });
  S.audit(actor, "Received referral", from, { referralId: id });
  return id;
}

/* =================================================================== */
/* Staffing model                                                       */
/* =================================================================== */
export const SHIFTS = [
  { key: "day", label: "Day", hours: "07:00–15:00", start: 7 },
  { key: "evening", label: "Evening", hours: "15:00–23:00", start: 15 },
  { key: "night", label: "Night", hours: "23:00–07:00", start: 23 },
];
export function currentShift(t = Date.now()) { const h = new Date(t).getHours(); return h >= 7 && h < 15 ? "day" : h >= 15 && h < 23 ? "evening" : "night"; }
// ED arrivals per hour (typical urban curve) used for forecasting
export const ARRIVAL_CURVE = [3, 2, 2, 1.5, 1.5, 2, 3, 5, 7, 8, 8.5, 8, 7.5, 7.5, 7, 7, 7.5, 8, 8, 7.5, 6.5, 5.5, 4.5, 3.5];
export function forecastEdCensus(shiftKey, currentCensus) {
  const s = SHIFTS.find((x) => x.key === shiftKey);
  const hrs = Array.from({ length: 8 }, (_, i) => ARRIVAL_CURVE[(s.start + i) % 24]);
  const arrivals = Math.round(hrs.reduce((a, b) => a + b, 0) * 1.08);
  const peak = Math.round(currentCensus * 0.55 + Math.max(...hrs) * 2.4);
  return { arrivals, peak };
}
/** Required RNs for a unit/shift and the reasoning. */
export function requiredStaff(unit, shiftKey, { edCensus = 20, unitCensus = {} } = {}) {
  if (unit === "ED") { const f = forecastEdCensus(shiftKey, edCensus); const rn = Math.max(6, Math.ceil(f.peak / 3.5)); return { RN: rn, MD: shiftKey === "night" ? 2 : 3, why: `Forecast ${f.arrivals} arrivals, peak census ~${f.peak} → 1 RN per 3.5 patients` }; }
  if (unit === "ICU") { const c = unitCensus.ICU || 10; return { RN: Math.ceil(c / 1.5), why: `${c} patients at 1:1.5` }; }
  const ratio = { day: 5, evening: 6, night: 7 }[shiftKey];
  const c = unitCensus[unit] || 15;
  return { RN: Math.ceil(c / ratio), why: `${c} patients at 1:${ratio}` };
}
export function rankCandidates(shift, staff, allShifts) {
  const assignedSameTime = new Set(allShifts.filter((s) => s.date === shift.date && s.shift === shift.shift).flatMap((s) => s.assigned || []));
  return staff
    .filter((m) => m.role === "RN" && !assignedSameTime.has(m.id))
    .map((m) => {
      const why = []; let score = 0;
      if ((m.units || []).includes(shift.unit)) { score += 50; why.push(`Works ${shift.unit}`); } else if ((m.skills || []).some((s) => s === shift.unit || (shift.unit === "ED" && s === "Emergency"))) { score += 35; why.push(`Cross-trained for ${shift.unit}`); } else { score -= 20; why.push("Not trained for this unit"); }
      const ot = (m.hoursThisWeek || 0) + 8 > (m.fte || 1) * 37.5;
      if (ot) { score -= 15; why.push("Would be overtime"); } else { score += 15; why.push("No overtime"); }
      if ((m.hoursThisWeek || 0) < 24) { score += 10; why.push("Rested"); } else if ((m.hoursThisWeek || 0) > 40) { score -= 10; why.push("High hours this week"); }
      if (m.bilingual) { score += 4; why.push("Bilingual"); }
      if (!m.internal) { score -= 35; why.push(`Agency (${m.costPerHour} $/h)`); }
      return { ...m, score, why, overtime: ot };
    })
    .sort((a, b) => b.score - a.score);
}
export function assignToShift(shiftId, staffId, actor = "user") {
  const s = S.get("shifts", shiftId); const m = S.get("staff", staffId); if (!s || !m) return;
  if ((s.assigned || []).includes(staffId)) return;
  S.patch("shifts", shiftId, { assigned: [...(s.assigned || []), staffId] });
  S.patch("staff", staffId, { hoursThisWeek: (m.hoursThisWeek || 0) + 8 });
  S.audit(actor, "Filled shift", `${m.name} → ${UNITS[s.unit] || s.unit} ${s.shift}`, { shiftId });
}
export function removeFromShift(shiftId, staffId, actor = "user") {
  const s = S.get("shifts", shiftId); const m = S.get("staff", staffId); if (!s) return;
  S.patch("shifts", shiftId, { assigned: (s.assigned || []).filter((x) => x !== staffId) });
  if (m) S.patch("staff", staffId, { hoursThisWeek: Math.max(0, (m.hoursThisWeek || 0) - 8) });
  S.audit(actor, "Removed from shift", `${m?.name || staffId}`, { shiftId });
}

/* =================================================================== */
/* Next-best-action engine                                              */
/* =================================================================== */
/**
 * Returns ranked, explainable recommendations computed from live data.
 * Each item: { id, kind, severity: 'critical'|'high'|'medium', title, why,
 *   impact (patient-hours or minutes saved, number), targets: [encounterIds],
 *   action: { label, type, payload } }
 * The UI executes them with runRecommendation(), which calls the actions above.
 */
export function recommendations() {
  const encs = S.all("encounters"), beds = S.all("beds"), clinics = S.all("clinics"), tasks = S.all("tasks");
  const ed = encs.filter(isEdActive);
  const out = [];
  const name = (e) => fullName(patientOf(e));

  // 1. Over-target high acuity
  const hasOpenTask = (pred) => tasks.some((t) => t.status !== "done" && pred(t));
  const late = ed.filter((e) => e.ctas && e.ctas <= 3 && minutesOverTarget(e) && !hasOpenTask((t) => t.encounterId === e.id && t.role === "MD")).sort((a, b) => a.ctas - b.ctas || minutesOverTarget(b) - minutesOverTarget(a));
  if (late.length) out.push({ id: "late", kind: "late", severity: late.some((e) => e.ctas <= 2) ? "critical" : "high", title: `${late.length} patient${late.length > 1 ? "s are" : " is"} past the CTAS time-to-physician target`, why: late.slice(0, 3).map((e) => `${name(e)} (CTAS ${e.ctas}, ${minutesOverTarget(e)} min over)`).join(" · "), impact: late.reduce((s, e) => s + minutesOverTarget(e), 0), targets: late.map((e) => e.id), action: { label: "Page physicians", type: "pageMd" } });
  // 2. Sepsis screen positive not yet seen
  const sepsis = ed.filter((e) => (e.redFlags || []).some((f) => /sepsis/i.test(f)) && ["waiting_md", "waiting_triage"].includes(e.status));
  if (sepsis.length) out.push({ id: "sepsis", kind: "sepsis", severity: "critical", title: `Sepsis screen positive: ${sepsis.map(name).join(", ")}`, why: "Antibiotics within the first hour reduce mortality. Patient is still in the waiting area.", impact: 60 * sepsis.length, targets: sepsis.map((e) => e.id), action: { label: "Start bundle and move to acute", type: "sepsis" } });
  // 3. Boarders + free beds
  const boarders = ed.filter((e) => e.status === "boarding").sort((a, b) => (a.admitRequestAt || 0) - (b.admitRequestAt || 0));
  const free = beds.filter((b) => b.area === "IP" && b.state === "free");
  const matches = [];
  const used = new Set();
  for (const e of boarders) { const unit = SERVICE_UNIT[e.service] || "7E"; const b = free.find((x) => x.unit === unit && !used.has(x.id)) || free.find((x) => !used.has(x.id) && x.unit !== "ICU" && x.unit !== "CCU" && unit !== "ICU"); if (b) { used.add(b.id); matches.push({ encounterId: e.id, bedId: b.id, label: `${name(e)} → ${b.label}` }); } }
  if (matches.length) out.push({ id: "beds", kind: "beds", severity: "high", title: `Place ${matches.length} admitted patient${matches.length > 1 ? "s" : ""} into free beds`, why: matches.map((m) => m.label).join(" · "), impact: Math.round(boarders.slice(0, matches.length).reduce((s, e) => s + minsSince(e.admitRequestAt || e.arrivalAt), 0) / 60 * 10) / 10, targets: matches.map((m) => m.encounterId), action: { label: "Assign beds", type: "assignBeds", payload: { matches } } });
  // 4. Diversion
  const divertible = ed.filter((e) => ["waiting_md", "waiting_triage"].includes(e.status) && e.ctas >= 4 && e.divertible !== false && !(e.redFlags || []).length && waitMinutes(e) > 45);
  const slots = clinics.flatMap((c) => openSlots(c).map((s) => ({ ...s, clinicId: c.id, clinicName: c.name }))).filter((s) => s.t < Date.now() + 4 * HOUR).sort((a, b) => a.t - b.t);
  if (divertible.length && slots.length) { const n = Math.min(divertible.length, slots.length); out.push({ id: "divert", kind: "divert", severity: "medium", title: `Offer ${n} low-acuity patient${n > 1 ? "s" : ""} a same-day clinic visit`, why: `${divertible.slice(0, 4).map((e) => `${name(e)} (CTAS ${e.ctas}, waiting ${fmtSince(e.arrivalAt)})`).join(" · ")}. ${slots.length} open slots in the next 4 h.`, impact: Math.round(divertible.slice(0, n).reduce((s, e) => s + Math.max(60, 300 - waitMinutes(e)), 0) / 60 * 10) / 10, targets: divertible.slice(0, n).map((e) => e.id), action: { label: "Review and book", type: "divert", payload: { encounterIds: divertible.slice(0, n).map((e) => e.id) } } }); }
  // 5. Discharge barriers
  const inpatients = encs.filter(isInpatient);
  const blocked = inpatients.filter((e) => (e.dc?.prob || 0) >= 60 && (e.dc?.barriers || []).some((b) => b.status !== "done" && !tasks.some((t) => t.barrierId === b.id && t.status !== "done")));
  if (blocked.length) { const bars = blocked.flatMap((e) => e.dc.barriers.filter((b) => b.status !== "done").map((b) => ({ ...b, e }))); out.push({ id: "barriers", kind: "barriers", severity: "medium", title: `Unblock ${blocked.length} likely discharge${blocked.length > 1 ? "s" : ""} before noon`, why: [...new Set(bars.map((b) => b.text))].slice(0, 4).join(" · ") + `. ${bars.length} barriers have no owner yet.`, impact: blocked.length * 4, targets: blocked.map((e) => e.id), action: { label: "Assign barrier owners", type: "barriers" } }); }
  // 6. Cleaning backlog
  const dirty = beds.filter((b) => b.state === "cleaning" && minsSince(b.since) > 40 && !tasks.some((t) => t.status !== "done" && t.bedId === b.id && t.priority === "stat"));
  if (dirty.length) out.push({ id: "evs", kind: "evs", severity: boarders.length ? "high" : "medium", title: `${dirty.length} bed${dirty.length > 1 ? "s have" : " has"} been waiting for cleaning over 40 min`, why: dirty.map((b) => `${b.label} (${fmtSince(b.since)})`).join(" · "), impact: dirty.length * 1.5, targets: [], action: { label: "Escalate to EVS", type: "evs", payload: { bedIds: dirty.map((b) => b.id) } } });
  // 7. Results ready → decision
  const resultsBack = ed.filter((e) => e.status === "awaiting_results" && (e.orders || []).length && (e.orders || []).every((o) => ["resulted", "done", "cancelled"].includes(o.status)));
  if (resultsBack.length) out.push({ id: "results", kind: "results", severity: "medium", title: `${resultsBack.length} patient${resultsBack.length > 1 ? "s have" : " has"} all results back`, why: resultsBack.map(name).join(" · ") + ": ready for a disposition decision.", impact: resultsBack.length * 0.8, targets: resultsBack.map((e) => e.id), action: { label: "Move to decision", type: "toDecision" } });

  const sev = { critical: 0, high: 1, medium: 2 };
  return out.sort((a, b) => sev[a.severity] - sev[b.severity] || b.impact - a.impact);
}

export function runRecommendation(rec, actor = "user", opts = {}) {
  const name = (id) => fullName(patientOf(S.get("encounters", id)));
  switch (rec.action.type) {
    case "pageMd": rec.targets.forEach((id) => { const e = S.get("encounters", id); createTask({ title: `See ${name(id)} now (CTAS ${e.ctas}, over target)`, role: "MD", encounterId: id, priority: "stat" }, actor); }); return `Paged physicians for ${rec.targets.length} patient(s)`;
    case "sepsis": rec.targets.forEach((id) => { setEdStatus(id, "in_treatment", actor); ["Lactate", "Blood cultures ×2", "Broad-spectrum antibiotics within 1 h", "IV fluid bolus 30 mL/kg"].forEach((n) => { const e = S.get("encounters", id); if (!(e.orders || []).some((o) => o.name === n)) addOrder(id, { name: n, priority: "stat" }, actor); }); }); return "Sepsis bundle started";
    case "assignBeds": { let n = 0; rec.action.payload.matches.forEach((m) => { if (assignInpatientBed(m.encounterId, m.bedId, actor)) n++; }); return `Placed ${n} patient(s) in beds`; }
    case "divert": { let n = 0; const clinics = S.all("clinics"); for (const id of rec.action.payload.encounterIds) { const slot = clinics.flatMap((c) => openSlots(c).map((s) => ({ ...s, clinicId: c.id }))).sort((a, b) => a.t - b.t)[0]; if (slot && divertToClinic(id, slot.clinicId, slot.id, actor)) n++; } return `Booked ${n} same-day clinic visit(s)`; }
    case "barriers": { let n = 0; S.all("encounters").filter(isInpatient).forEach((e) => (e.dc?.barriers || []).filter((b) => b.status !== "done").forEach((b) => { if (!S.all("tasks").some((t) => t.barrierId === b.id && t.status !== "done")) { createTask({ title: `${b.text}: ${fullName(patientOf(e))}`, role: b.owner || "RN", encounterId: e.id, barrierId: b.id, priority: "high", dueMin: 120 }, actor); n++; } })); return `Assigned ${n} barrier(s) to owners`; }
    case "evs": rec.action.payload.bedIds.forEach((id) => createTask({ title: `STAT clean ${S.get("beds", id)?.label}`, role: "EVS", bedId: id, priority: "stat" }, actor)); return "Escalated to environmental services";
    case "toDecision": rec.targets.forEach((id) => setEdStatus(id, "decision", actor)); return "Moved to decision";
    default: return "Done";
  }
}
