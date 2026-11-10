// Fictional demo data for "Hôpital St-Laurent" (not a real hospital).
// Generates a consistent snapshot: ED census across stages, inpatient units at
// ~85% occupancy with discharge predictions, 24 h of history for analytics,
// staff and shifts with realistic gaps, clinics with open slots, sign-off
// items, referrals and an app patient with a conversation.
import { MIN, HOUR, DAY, todayKey, assessCtas, SERVICE_UNIT, ARRIVAL_CURVE } from "./domain.js";

export const SEED_VERSION = 4;

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const FIRST_F = ["Marie", "Amélie", "Sophie", "Chloé", "Fatima", "Priya", "Nadia", "Isabelle", "Aïcha", "Léa", "Harpreet", "Rosa", "Mei", "Yasmine", "Gabrielle", "Manon", "Camille", "Simran", "Leila", "Ana", "Thi Lan", "Josée", "Kateri", "Olga"];
const FIRST_M = ["Jean", "Luc", "Karan", "Olivier", "Mathieu", "Gabriel", "Étienne", "Wei", "Samuel", "Hugo", "Antoine", "Félix", "Mohamed", "Jay", "Denis", "Marc-André", "Raj", "Youssef", "Pierre", "Daniel", "Minh", "Carlos", "Tariq", "Guy"];
const LAST = ["Tremblay", "Gagnon", "Roy", "Côté", "Bouchard", "Singh", "Haddad", "Lavoie", "Fortin", "Pelletier", "Nguyen", "Morin", "Dubois", "Chen", "Bélanger", "Sharma", "Lefebvre", "Ouellet", "Diallo", "Girard", "Gill", "Benali", "Paquette", "Joseph", "Santos", "Kowalski", "Ahmed", "Lalonde", "Dion", "St-Pierre"];

// ED presentations: complaint, ctas hint, vitals, age range, orders, lang
const ED_CASES = [
  { cc: "Chest pain radiating to left arm, sweaty", age: [52, 78], v: { hr: 104, sbp: 156, dbp: 94, rr: 20, spo2: 95, temp: 36.9, pain: 7 }, orders: ["ECG within 10 min", "Troponin", "CBC, lytes, creatinine"], service: "Cardiology" },
  { cc: "Sudden severe headache, worst ever", age: [30, 60], v: { hr: 92, sbp: 168, dbp: 98, rr: 18, spo2: 98, temp: 37.0, pain: 9 }, orders: ["CT head"] },
  { cc: "Shortness of breath, COPD flare", age: [60, 85], v: { hr: 112, sbp: 138, dbp: 82, rr: 26, spo2: 89, temp: 37.4, pain: 2 }, orders: ["Chest X-ray", "Venous blood gas", "Salbutamol/ipratropium nebs"], service: "Medicine" },
  { cc: "Confusion and fever since yesterday", age: [78, 92], v: { hr: 118, sbp: 98, dbp: 60, rr: 24, spo2: 93, temp: 38.9, pain: 3 }, orders: ["Lactate", "Blood cultures ×2", "Urinalysis", "CBC, lytes, creatinine"], service: "Medicine" },
  { cc: "Abdominal pain right lower quadrant, vomiting", age: [18, 45], v: { hr: 102, sbp: 124, dbp: 78, rr: 18, spo2: 99, temp: 38.2, pain: 7 }, orders: ["CBC, lytes, lipase", "CT abdomen/pelvis"], service: "Surgery" },
  { cc: "Fall at home, hip pain, can't bear weight", age: [72, 94], v: { hr: 88, sbp: 142, dbp: 80, rr: 18, spo2: 96, temp: 36.6, pain: 8 }, orders: ["X-ray hip and pelvis", "CBC, lytes, creatinine"], service: "Orthopedics" },
  { cc: "Ankle injury after a fall on stairs", age: [16, 50], v: { hr: 84, sbp: 124, dbp: 78, rr: 16, spo2: 99, temp: 36.7, pain: 6 }, orders: ["X-ray ankle (Ottawa rules positive)"] },
  { cc: "Sore throat for 3 days", age: [18, 40], v: { hr: 86, sbp: 118, dbp: 74, rr: 16, spo2: 99, temp: 37.8, pain: 3 }, orders: [] },
  { cc: "Prescription renewal, no family doctor", age: [35, 65], v: { hr: 76, sbp: 132, dbp: 84, rr: 14, spo2: 98, temp: 36.6, pain: 0 }, orders: [] },
  { cc: "Burning when urinating since yesterday", age: [19, 45], v: { hr: 82, sbp: 116, dbp: 72, rr: 16, spo2: 99, temp: 37.2, pain: 3 }, orders: ["Urine dipstick"] },
  { cc: "Laceration to left hand from kitchen knife", age: [18, 60], v: { hr: 90, sbp: 130, dbp: 80, rr: 16, spo2: 99, temp: 36.8, pain: 5 }, orders: ["Wound irrigation", "Tetanus status"] },
  { cc: "Palpitations, feels heart racing", age: [45, 75], v: { hr: 138, sbp: 128, dbp: 84, rr: 18, spo2: 97, temp: 36.8, pain: 1 }, orders: ["ECG within 10 min", "TSH, lytes"], service: "Cardiology" },
  { cc: "Lower back pain after lifting, no red flags", age: [25, 55], v: { hr: 80, sbp: 128, dbp: 80, rr: 16, spo2: 99, temp: 36.7, pain: 6 }, orders: [] },
  { cc: "Cough for two weeks", age: [30, 70], v: { hr: 84, sbp: 126, dbp: 78, rr: 18, spo2: 96, temp: 37.5, pain: 1 }, orders: [] },
  { cc: "Rash on arms for 2 days, itchy", age: [5, 40], v: { hr: 88, sbp: 112, dbp: 70, rr: 18, spo2: 99, temp: 36.9, pain: 2 }, orders: [] },
  { cc: "Diabetic, high blood sugar 24 at home", age: [40, 70], v: { hr: 104, sbp: 122, dbp: 76, rr: 22, spo2: 97, temp: 37.0, pain: 2 }, orders: ["Capillary glucose", "Venous blood gas", "Ketones"] },
  { cc: "Left arm weakness and slurred speech, 40 min ago", age: [60, 85], v: { hr: 90, sbp: 182, dbp: 102, rr: 18, spo2: 96, temp: 36.8, pain: 0, gcs: 14 }, orders: ["Code stroke page", "CT head", "Capillary glucose"] },
  { cc: "Pregnant 30 weeks, abdominal pain", age: [24, 38], v: { hr: 98, sbp: 118, dbp: 74, rr: 18, spo2: 99, temp: 36.9, pain: 6 }, orders: ["OB consult", "Fetal heart rate"] },
  { cc: "Ear pain since last night", age: [4, 30], v: { hr: 96, sbp: 110, dbp: 70, rr: 18, spo2: 99, temp: 37.9, pain: 4 }, orders: [] },
  { cc: "Feeling anxious, chest tightness after argument", age: [20, 40], v: { hr: 108, sbp: 134, dbp: 86, rr: 22, spo2: 99, temp: 36.8, pain: 4 }, orders: ["ECG within 10 min"] },
];
const BARRIERS = [
  { text: "Pharmacy medication reconciliation", owner: "Pharmacy" },
  { text: "Ride home not arranged", owner: "Social work" },
  { text: "CLSC home-care referral", owner: "Social work" },
  { text: "Physiotherapy clearance", owner: "RN" },
  { text: "Echo report pending", owner: "Lab" },
  { text: "Attending sign-off on discharge summary", owner: "MD" },
  { text: "Oxygen assessment for home", owner: "RN" },
];
const IP_DX = {
  "7E": ["Pneumonia", "CHF exacerbation", "COPD exacerbation", "Cellulitis", "UTI with delirium", "AKI", "GI bleed", "Hyponatremia"],
  "8W": ["Post-op appendectomy", "Small bowel obstruction", "Cholecystitis", "Post-op hernia repair", "Diverticulitis"],
  "6N": ["Hip fracture (post-op)", "Knee replacement", "Ankle ORIF", "Spinal compression fracture"],
  CCU: ["NSTEMI", "Atrial fibrillation with RVR", "Heart failure", "Syncope workup"],
  ICU: ["Septic shock", "Respiratory failure", "DKA", "Post-cardiac arrest", "GI bleed (unstable)"],
};

export function buildSeed(t0 = Date.now()) {
  const r = rng(20261030);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const between = (a, b) => a + Math.floor(r() * (b - a + 1));
  const rows = [];
  const add = (col, id, data) => rows.push({ col, id, data });
  let pn = 0, en = 0;

  function mkPatient({ sex, age, first, last, lang, extra = {} }) {
    const id = `p${String(++pn).padStart(3, "0")}`;
    sex = sex || (r() < 0.5 ? "F" : "M");
    first = first || pick(sex === "F" ? FIRST_F : FIRST_M);
    last = last || pick(LAST);
    const by = new Date(t0).getFullYear() - age;
    const dob = `${by}-${String(between(1, 12)).padStart(2, "0")}-${String(between(1, 28)).padStart(2, "0")}`;
    const p = {
      first, last, sex, dob, lang: lang || (r() < 0.55 ? "fr" : r() < 0.8 ? "en" : pick(["ar", "pa", "es", "zh", "ht"])),
      mrn: "SLG" + (400000 + pn * 137), ramq: `${last.slice(0, 3).toUpperCase()}${first[0].toUpperCase()} •••• ••${between(10, 99)}`,
      phone: `514-555-${String(between(1000, 9999))}`, allergies: r() < 0.25 ? [pick(["Penicillin", "Sulfa", "Codeine", "Latex", "Iodine contrast"])] : [],
      meds: [], conditions: [], appUser: false, createdAt: t0 - between(30, 3000) * DAY, ...extra,
    };
    add("patients", id, p);
    return { id, ...p };
  }

  /* ---------------- beds ---------------- */
  const beds = [];
  const mkBed = (id, area, unit, zone, label) => { const b = { area, unit, zone, label, state: "free", encounterId: null, since: t0 - between(10, 300) * MIN }; beds.push({ id, ...b }); return beds[beds.length - 1]; };
  [["R", "Resus", 3], ["A", "Acute", 14], ["F", "Fast track", 6], ["H", "Hallway", 6]].forEach(([p, z, n]) => { for (let i = 1; i <= n; i++) mkBed(`ED-${p}${i}`, "ED", "ED", z, `${p}${i}`); });
  [["7E", 20], ["8W", 14], ["6N", 12], ["CCU", 8], ["ICU", 10]].forEach(([u, n]) => { for (let i = 1; i <= n; i++) mkBed(`${u}-${String(i).padStart(2, "0")}`, "IP", u, u, `${u}-${String(i).padStart(2, "0")}`); });
  const bedById = Object.fromEntries(beds.map((b) => [b.id, b]));
  const freeEd = (zones) => beds.find((b) => b.area === "ED" && zones.includes(b.zone) && b.state === "free");

  /* ---------------- current ED census ---------------- */
  const stagePlan = [
    // [status, minutesAgo range, count]
    ["waiting_triage", [3, 25], 3],
    ["waiting_md", [20, 330], 9],
    ["in_treatment", [25, 200], 6],
    ["awaiting_results", [60, 280], 4],
    ["decision", [150, 360], 2],
    ["boarding", [280, 900], 4],
  ];
  const caseOrder = [0, 7, 9, 12, 3, 8, 6, 13, 14, 18, 10, 19, 1, 16, 11, 15, 4, 5, 17, 2, 3, 5, 2, 0, 4, 6, 8];
  let ci = 0;
  const edEncounters = [];
  for (const [status, [a, b], count] of stagePlan) {
    for (let k = 0; k < count; k++) {
      const admitCases = ED_CASES.filter((x) => x.service);
      const c = status === "boarding" ? admitCases[k % admitCases.length] : ED_CASES[caseOrder[ci++ % caseOrder.length]];
      const age = between(c.age[0], c.age[1]);
      const pt = mkPatient({ age, sex: /Pregnant/.test(c.cc) ? "F" : undefined });
      const arrivalAt = t0 - between(a, b) * MIN;
      const vit = { ...c.v };
      const assess = assessCtas({ cc: c.cc, vitals: vit, age });
      const id = `e${String(++en).padStart(3, "0")}`;
      const e = {
        kind: "ED", patientId: pt.id, cc: c.cc, source: r() < 0.2 ? "ambulance" : "walk-in", status, arrivalAt,
        vitals: status === "waiting_triage" ? {} : { ...vit, t: arrivalAt + 8 * MIN }, vitalsHistory: status === "waiting_triage" ? [] : [{ ...vit, t: arrivalAt + 8 * MIN }],
        ctas: status === "waiting_triage" ? null : assess.level, redFlags: status === "waiting_triage" ? [] : assess.redFlags, divertible: assess.divertible,
        triagedAt: status === "waiting_triage" ? null : arrivalAt + between(6, 22) * MIN,
        notes: [], orders: [], flags: [], timeline: [{ t: arrivalAt, type: "arrival", text: "Registered at front desk", actor: "user" }],
      };
      if (e.triagedAt) e.timeline.push({ t: e.triagedAt, type: "triage", text: `Triaged CTAS ${e.ctas}`, actor: "user" });
      if (["in_treatment", "awaiting_results", "decision", "boarding"].includes(status)) {
        e.seenAt = e.triagedAt + between(10, Math.max(12, Math.min(200, (t0 - e.triagedAt) / MIN - 5))) * MIN;
        if (e.seenAt > t0) e.seenAt = t0 - 5 * MIN;
        e.md = pick(["Dr. Okafor", "Dr. Pelletier", "Dr. Ahmed", "Dr. Tremblay"]);
        e.timeline.push({ t: e.seenAt, type: "status", text: `Seen by ${e.md}`, actor: "user" });
        const bed = e.ctas <= 2 ? freeEd(["Resus", "Acute"]) : status === "boarding" ? freeEd(["Hallway", "Acute"]) : freeEd(["Acute", "Fast track"]);
        if (bed) { bed.state = "occupied"; bed.encounterId = id; bed.since = e.seenAt; e.bedId = bed.id; }
        e.orders = c.orders.map((name, i) => ({ id: `o${en}${i}`, name, type: /x-ray|ct |ct$|echo|ultra/i.test(name) ? "imaging" : /ecg|glucose|irrigation|monitor|heart rate|status/i.test(name) ? "nursing" : /consult|page/i.test(name) ? "consult" : /nebs/i.test(name) ? "med" : "lab", status: status === "in_treatment" ? (i === 0 ? "in_progress" : "ordered") : status === "awaiting_results" ? (i === 0 ? "resulted" : "in_progress") : "resulted", t: e.seenAt + 4 * MIN, by: e.md, result: status === "decision" || status === "boarding" || (status === "awaiting_results" && i === 0) ? "Reviewed" : undefined }));
      }
      if (status === "decision") e.decisionAt = t0 - between(10, 50) * MIN;
      if (status === "boarding") { e.decisionAt = e.seenAt + between(90, 200) * MIN; if (e.decisionAt > t0) e.decisionAt = t0 - 60 * MIN; e.admitRequestAt = e.decisionAt + 10 * MIN; e.service = c.service || "Medicine"; e.timeline.push({ t: e.admitRequestAt, type: "status", text: `Admitted to ${e.service}: waiting for bed`, actor: "user" }); }
      add("encounters", id, e);
      edEncounters.push({ id, ...e });
    }
  }
  // one pre-registered app patient en route
  const jay = mkPatient({ first: "Jay", last: "Singh", sex: "M", age: 29, lang: "en", extra: { appUser: true, allergies: ["Sulfa"], conditions: ["Mild asthma"], meds: [{ name: "Salbutamol 100 mcg inhaler", dose: "2 puffs as needed" }, { name: "Vitamin D 1000 IU", dose: "Daily" }], familyDoctor: null, labs: [{ name: "HbA1c", value: "5.4 %", ref: "< 6.0", ok: true, t: t0 - 140 * DAY }, { name: "LDL cholesterol", value: "3.6 mmol/L", ref: "< 3.5", ok: false, t: t0 - 140 * DAY }, { name: "TSH", value: "2.1 mIU/L", ref: "0.4–4.0", ok: true, t: t0 - 140 * DAY }, { name: "Ferritin", value: "38 µg/L", ref: "30–400", ok: true, t: t0 - 140 * DAY }], wearable: { hr: [68, 71, 66, 74, 70, 69, 72], sleep: [6.1, 7.2, 5.8, 6.9, 7.5, 8.1, 6.4], steps: [6200, 8900, 4100, 10300, 7600, 12100, 5400] } } });
  const amelie = mkPatient({ first: "Amélie", last: "Côté", sex: "F", age: 34, lang: "fr", extra: { appUser: true, allergies: [], conditions: ["Hypothyroidism"], meds: [{ name: "Levothyroxine 75 mcg", dose: "Daily" }] } });
  {
    const id = `e${String(++en).padStart(3, "0")}`;
    add("encounters", id, { kind: "ED", patientId: amelie.id, cc: "Douleur au poignet après une chute à vélo", source: "app", status: "arriving", arrivalAt: t0 - 6 * MIN, vitals: {}, notes: [], orders: [], flags: [], redFlags: [], preSummary: "34 F, fell from bicycle 1 h ago onto outstretched right hand. Wrist pain 6/10, swelling, can move fingers, no numbness. No head strike. Allergies: none. Meds: levothyroxine. Rules-based pre-triage: CTAS 4, X-ray likely needed.", timeline: [{ t: t0 - 6 * MIN, type: "arrival", text: "Pre-registered from Aster app", actor: "patient" }] });
  }

  /* ---------------- inpatients ---------------- */
  const ipBeds = beds.filter((b) => b.area === "IP");
  const RESERVED_FREE = new Set(["7E-03", "7E-11", "6N-05", "8W-09", "CCU-04"]);
  for (const b of ipBeds) {
    if (RESERVED_FREE.has(b.id)) { b.state = "free"; continue; }
    const roll = r();
    const occRate = b.unit === "ICU" ? 0.9 : 0.86;
    if (roll < occRate) {
      const pt = mkPatient({ age: between(b.unit === "6N" ? 55 : 40, 93) });
      const id = `e${String(++en).padStart(3, "0")}`;
      const los = between(1, 14);
      const admittedAt = t0 - los * DAY + between(-300, 300) * MIN;
      const p = r();
      const prob = b.unit === "ICU" ? between(2, 25) : p > 0.68 ? between(70, 96) : p > 0.4 ? between(30, 65) : between(3, 25);
      const barriers = prob >= 60 ? Array.from({ length: between(1, 2) }, (_, i) => ({ id: `b${en}${i}`, ...pick(BARRIERS), status: "open" })) : [];
      const alc = los >= 9 && prob < 40 && b.unit !== "ICU" && r() < 0.6;
      const dx = pick(IP_DX[b.unit]);
      add("encounters", id, { kind: "IP", patientId: pt.id, cc: dx, dx, status: "admitted", unit: b.unit, bedId: b.id, service: { "7E": "Medicine", "8W": "Surgery", "6N": "Orthopedics", CCU: "Cardiology", ICU: "ICU" }[b.unit], arrivalAt: admittedAt - between(4, 14) * HOUR, admittedAt, ctas: null, notes: [], orders: [], redFlags: [], alc, dc: { prob, barriers, eta: prob >= 70 ? "Today" : prob >= 40 ? "Tomorrow" : null }, timeline: [{ t: admittedAt, type: "admit", text: `Admitted to ${b.unit}`, actor: "user" }] });
      b.state = "occupied"; b.encounterId = id; b.since = admittedAt;
    } else if (roll < occRate + 0.06) { b.state = "cleaning"; b.since = t0 - between(15, 70) * MIN; }
    else if (roll < occRate + 0.08) { b.state = "blocked"; b.note = "Maintenance"; }
  }

  /* ---------------- 24 h history (closed ED visits) ---------------- */
  for (let i = 0; i < 46; i++) {
    const hAgo = between(2, 23);
    const c = pick(ED_CASES);
    const age = between(c.age[0], c.age[1]);
    const pt = mkPatient({ age });
    const assess = assessCtas({ cc: c.cc, vitals: c.v, age });
    const arrivalAt = t0 - hAgo * HOUR - between(0, 59) * MIN;
    const triagedAt = arrivalAt + between(5, 25) * MIN;
    const outcome = r();
    const status = assess.level >= 4 && outcome < 0.12 ? "lwbs" : assess.level >= 4 && outcome < 0.24 ? "diverted" : "discharged";
    const seenAt = status === "lwbs" ? null : triagedAt + between(assess.level <= 2 ? 3 : 30, assess.level <= 2 ? 20 : 240) * MIN;
    const end = (seenAt || triagedAt) + between(40, 280) * MIN;
    const id = `e${String(++en).padStart(3, "0")}`;
    add("encounters", id, { kind: "ED", patientId: pt.id, cc: c.cc, source: "walk-in", status, arrivalAt, triagedAt, seenAt, ctas: assess.level, vitals: { ...c.v }, redFlags: assess.redFlags, notes: [], orders: [], timeline: [], ...(status === "discharged" ? { dischargedAt: Math.min(end, t0 - 10 * MIN) } : { closedAt: Math.min(end, t0 - 10 * MIN) }) });
  }

  /* ---------------- staff & shifts ---------------- */
  const staff = [];
  const mkStaff = (name, role, units, extra = {}) => { const id = `s${String(staff.length + 1).padStart(2, "0")}`; const m = { name, role, units, skills: extra.skills || units, fte: extra.fte || 1, hoursThisWeek: extra.hours ?? between(8, 40), bilingual: extra.bilingual ?? r() < 0.7, internal: extra.internal ?? true, costPerHour: extra.internal === false ? 118 : between(44, 58) }; staff.push({ id, ...m }); add("staff", id, m); return id; };
  const rnNames = ["Julie Paquette", "Ravi Menon", "Camille Dion", "Marc-André Leduc", "Sana Iqbal", "Émilie Gauthier", "Kevin Nguyen", "Sophie Lalonde", "Nathalie Roy", "Ahmed Benali", "Chantal Morin", "Patrick Ouellet", "Mélanie Fortin", "Grace Joseph", "Vincent Côté", "Isabelle Martel", "Daniel Kowalski", "Maude Bélanger", "Rachid Haddad", "Lina Tran", "Joanie Pelletier", "Tom Fraser", "Annie Gill", "Simon Lavoie", "Rosa Santos", "Myriam Dubé"];
  const unitsCycle = ["ED", "ED", "ED", "ED", "ED", "ED", "ED", "7E", "7E", "7E", "8W", "8W", "6N", "ICU", "ICU", "ICU", "CCU", "ED", "7E", "ICU", "ED", "8W", "6N", "7E", "ED", "CCU"];
  rnNames.forEach((n, i) => mkStaff(n, "RN", [unitsCycle[i]], { skills: unitsCycle[i] === "ED" ? ["ED", "7E"] : unitsCycle[i] === "ICU" ? ["ICU", "CCU", "ED"] : [unitsCycle[i], "7E"], hours: i % 5 === 0 ? 40 : undefined }));
  mkStaff("Float pool: Julien Arsenault", "RN", ["ED", "7E", "8W"], { skills: ["ED", "7E", "8W", "6N"], hours: 16 });
  mkStaff("Float pool: Nora El-Amin", "RN", ["7E", "6N"], { skills: ["7E", "6N", "8W"], hours: 12 });
  mkStaff("Agency: Brett Collins", "RN", ["ED", "ICU"], { skills: ["ED", "ICU"], internal: false, hours: 8, bilingual: false });
  ["Dr. Okafor", "Dr. Pelletier", "Dr. Ahmed", "Dr. Tremblay", "Dr. Nakamura", "Dr. Bouchard"].forEach((n) => mkStaff(n, "MD", ["ED"], { hours: between(20, 36) }));
  const date = todayKey(t0);
  const shiftRows = [];
  const rnByUnit = (u) => staff.filter((s) => s.role === "RN" && s.units.includes(u) && s.internal && !s.name.startsWith("Float"));
  const REQ = { ED: { day: 7, evening: 8, night: 6 }, "7E": { day: 4, evening: 3, night: 3 }, "8W": { day: 3, evening: 3, night: 2 }, "6N": { day: 3, evening: 2, night: 2 }, CCU: { day: 2, evening: 2, night: 2 }, ICU: { day: 6, evening: 6, night: 6 } };
  const GAPS = { "ED_evening": 2, "ED_night": 1, "7E_night": 1, "ICU_evening": 1, "8W_evening": 1 };
  for (const u of ["ED", "7E", "8W", "6N", "CCU", "ICU"]) {
    const pool = rnByUnit(u);
    ["day", "evening", "night"].forEach((sh, si) => {
      const need = REQ[u][sh];
      const fill = Math.max(0, need - (GAPS[`${u}_${sh}`] || 0));
      // rotate the same people across shifts with placeholders (agency/other rosters) represented as counts
      const assigned = pool.filter((_, i) => i % 3 === si).map((s) => s.id).slice(0, fill);
      const extra = Math.max(0, fill - assigned.length);
      shiftRows.push({ id: `${date}_${u}_${sh}`, date, unit: u, shift: sh, required: { RN: need }, assigned, rosterCount: extra });
    });
  }
  shiftRows.forEach(({ id, ...s }) => add("shifts", id, s));

  /* ---------------- clinics & slots ---------------- */
  const startSlot = Math.ceil((t0 + 25 * MIN) / (20 * MIN)) * 20 * MIN;
  const clinics = [
    { id: "c1", name: "Super-clinique Verdun", kind: "GMF-R (walk-in super-clinic)", distanceKm: 2.1, every: 20, n: 14 },
    { id: "c2", name: "Clinique Centre-Ville", kind: "Walk-in clinic", distanceKm: 0.8, every: 30, n: 9 },
    { id: "c3", name: "Aster virtual clinic", kind: "Video visit (physician)", distanceKm: 0, every: 15, n: 20 },
    { id: "c4", name: "Pharmacie Ste-Catherine", kind: "Pharmacist minor-ailment consult", distanceKm: 0.4, every: 15, n: 12 },
    { id: "c5", name: "CLSC Côte-des-Neiges", kind: "Nurse clinic", distanceKm: 3.4, every: 30, n: 8 },
  ];
  clinics.forEach(({ id, every, n, ...c }) => {
    const slots = Array.from({ length: n }, (_, i) => ({ id: `${id}s${i}`, t: startSlot + i * every * MIN + (id === "c3" ? -10 * MIN : 0), bookedBy: r() < 0.25 ? { patientId: "external", apptId: null } : null }));
    add("clinics", id, { ...c, slots });
  });

  /* ---------------- tasks ---------------- */
  const tsk = (title, role, priority, extra = {}) => add("tasks", `t${String(rows.filter((x) => x.col === "tasks").length + 1).padStart(3, "0")}`, { title, detail: "", role, priority, status: "open", createdAt: t0 - between(5, 120) * MIN, due: t0 + between(-20, 180) * MIN, createdBy: extra.by || "user", ...extra });
  edEncounters.filter((e) => e.status === "boarding").forEach((e) => tsk(`Find ${e.service} bed`, "Bed manager", "high", { encounterId: e.id, by: "system" }));
  beds.filter((b) => b.state === "cleaning").slice(0, 4).forEach((b) => tsk(`Clean ${b.label}`, "EVS", "normal", { bedId: b.id, by: "system" }));
  tsk("Restock resus cart R2", "RN", "normal");
  tsk("Call back: abnormal potassium from yesterday's discharge", "MD", "high");
  tsk("Interpreter (Arabic) for 14:30 family meeting", "Clerk", "normal");

  /* ---------------- reviews (physician sign-off) ---------------- */
  const thJay = "th-jay";
  add("threads", thJay, { patientId: jay.id, lang: "en", status: "active", unread: 0, createdAt: t0 - 26 * HOUR, updatedAt: t0 - 26 * HOUR, messages: [
    { id: "m1", role: "ai", t: t0 - 26 * HOUR, text: "Your June bloodwork is in. Everything looks normal except LDL cholesterol (3.6 mmol/L), which is slightly above target. Nothing urgent. Want me to explain what helps?" },
  ] });
  const rx1 = mkPatient({ age: 58, extra: { appUser: true, conditions: ["Hypertension"], meds: [{ name: "Ramipril 10 mg", dose: "Daily" }] } });
  add("threads", "th-rx1", { patientId: rx1.id, lang: rx1.lang, status: "awaiting_md", unread: 0, createdAt: t0 - 50 * MIN, updatedAt: t0 - 40 * MIN, messages: [
    { id: "m1", role: "patient", t: t0 - 50 * MIN, text: "I need my blood pressure pills renewed, I have 3 left." },
    { id: "m2", role: "ai", t: t0 - 48 * MIN, text: "I can help. Your home readings over the last 30 days average 128/81, and you report no dizziness or swelling. I've drafted a 90-day renewal for a physician to sign." },
    { id: "m3", role: "ai", t: t0 - 47 * MIN, text: "", card: { type: "plan", status: "pending", reviewId: "rv-001", proposal: { title: "Ramipril renewal", assessment: "Hypertension, well controlled on ramipril 10 mg.", plan: ["Renew ramipril 10 mg daily × 90 days", "Lytes and creatinine within 3 months", "Keep home BP log"], rx: "Ramipril 10 mg PO daily, 90 days, 1 refill" } } },
  ] });
  add("reviews", "rv-001", { kind: "rx_renewal", patientId: rx1.id, threadId: "th-rx1", msgId: "m3", title: "Prescription renewal: ramipril 10 mg", summary: "58-year-old with hypertension. 30-day home BP average 128/81. No side effects. Last creatinine 4 months ago: normal.", proposal: { title: "Ramipril renewal", assessment: "Hypertension, well controlled on ramipril 10 mg.", plan: ["Renew ramipril 10 mg daily × 90 days", "Lytes and creatinine within 3 months", "Keep home BP log"], rx: "Ramipril 10 mg PO daily, 90 days, 1 refill" }, risk: "low", status: "pending", createdAt: t0 - 47 * MIN });
  const chf = mkPatient({ first: "Gabrielle", last: "Ross", sex: "F", age: 72, lang: "en", extra: { appUser: true, conditions: ["Heart failure", "Atrial fibrillation"], meds: [{ name: "Furosemide 40 mg", dose: "Daily" }, { name: "Apixaban 5 mg", dose: "Twice daily" }] } });
  add("threads", "th-chf", { patientId: chf.id, lang: "en", status: "awaiting_md", unread: 0, createdAt: t0 - 2 * DAY, updatedAt: t0 - 14 * MIN, messages: [
    { id: "m1", role: "system", t: t0 - 2 * DAY, text: "You were discharged from St-Laurent General. Your discharge instructions are in Visits." },
    { id: "m2", role: "ai", t: t0 - 20 * MIN, text: "How are you feeling since your visit? This 30-second check-in goes to your care team.", card: { type: "checkin", status: "done", answers: { feeling: "worse", meds: "yes", redFlag: true, detail: "Ankles more swollen, weight up 1.8 kg in 2 days" } } },
    { id: "m3", role: "ai", t: t0 - 14 * MIN, text: "Thanks. I've flagged this for a physician now. If you have trouble breathing, chest pain or feel faint, call 911." },
  ] });
  add("reviews", "rv-002", { kind: "escalation", patientId: chf.id, threadId: "th-chf", title: "48 h check-in: weight up 1.8 kg, ankle swelling (heart failure)", summary: "72-year-old discharged 2 days ago after a heart failure exacerbation. Reports ankle swelling and weight up 1.8 kg since discharge. Taking furosemide as prescribed. No chest pain or breathlessness at rest.", proposal: { title: "Heart failure follow-up", assessment: "Possible early fluid re-accumulation after discharge.", plan: ["Same-day heart failure clinic or video visit", "Consider furosemide 40 mg twice daily × 3 days per physician", "Daily weights; call 911 if breathless at rest"], rx: null }, risk: "high", status: "pending", createdAt: t0 - 14 * MIN });
  const labPt = edEncounters.find((e) => e.status === "awaiting_results");
  add("reviews", "rv-003", { kind: "lab", patientId: labPt.patientId, encounterId: labPt.id, title: "Critical lab value: potassium 6.1 mmol/L", summary: "Called by lab. Hemolysis not reported. Patient currently in ED (results pending).", proposal: { title: "Hyperkalemia", assessment: "Potassium 6.1 mmol/L; repeat to rule out hemolysis.", plan: ["Repeat potassium STAT", "12-lead ECG", "If confirmed: calcium gluconate, insulin/dextrose per protocol"], rx: null }, risk: "high", status: "pending", createdAt: t0 - 9 * MIN });

  /* ---------------- referrals ---------------- */
  const ref = (id, from, minsAgo, raw) => add("referrals", id, { from, raw, receivedAt: t0 - minsAgo * MIN, status: "new" });
  ref("rf-001", "Clinique médicale Rosemont (GMF)", 47, "RÉFÉRENCE — Cardiologie\nPatient : Denis Hébert   DDN : 1958-03-14   RAMQ : HEBD 5803 1412 (fictif)\nMotif : Dyspnée d'effort progressive depuis 2 mois, souffle systolique 3/6 au foyer aortique. ETT demandée.\nPriorité : B (≤ 10 jours)\nMédecin référent : Dre Lucie Martel, permis 1-08-442\nTél : 514-555-0142   Téléc. : 514-555-0143\nAllergies : Pénicilline (urticaire)\nMédication : Ramipril 10 mg die, AAS 81 mg die, atorvastatine 40 mg");
  ref("rf-002", "Pharmacie Jean-Talon", 95, "DEMANDE DE CLARIFICATION — ORDONNANCE\nPatiente : Rosa Alvarez, DDN 1990-07-02\nOrdonnances actives : Apixaban 5 mg BID + nouvelle ordonnance de clarithromycine 500 mg BID (urgence, 28 oct.)\nPréoccupation : interaction (CYP3A4 / P-gp), risque hémorragique augmenté.\nMerci de confirmer ou de modifier.\nPharmacien : M. Gauthier, 514-555-0199");
  ref("rf-003", "CLSC Côte-des-Neiges", 180, "Home care coordination request\nPatient currently admitted (Medicine 7E). CLSC can start nursing visits + PAB 3x/week from Monday.\nNeeds: discharge summary, medication list, wound care orders.\nContact: A. Nadeau, social worker, ext. 2210");
  ref("rf-004", "Dr. K. Brar, family physician (Brossard)", 260, "Referral to General Surgery\nPt: Manpreet Kaur, 46 F, DOB 1980-02-19\nReason: symptomatic gallstones, 3 episodes of biliary colic in 6 weeks, US confirms cholelithiasis, no cholecystitis.\nPriority: routine (C)\nAllergies: none known. Meds: metformin 500 mg BID.\nPreferred language: Punjabi / English. Phone 450-555-0110");

  /* ---------------- meta ---------------- */
  // 24 h of 15-minute operational snapshots for sparklines
  const points = [];
  for (let i = 96; i >= 0; i--) {
    const t = t0 - i * 15 * MIN; const h = new Date(t).getHours();
    const base = ARRIVAL_CURVE[h];
    points.push({ t, census: Math.round(14 + base * 1.9 + r() * 4), waiting: Math.round(4 + base * 0.9 + r() * 3), boarding: Math.round(2 + (h > 10 && h < 20 ? 3 : 1) + r() * 2), ipOcc: Math.round(84 + r() * 6) });
  }
  add("meta", "history", { points });
  add("meta", "settings", { hospitalName: "Hôpital St-Laurent", simEnabled: true, agentAutonomy: { triage: "suggest", flow: "approve", discharge: "approve", followup: "auto", referral: "approve", staffing: "approve", scribe: "approve", divert: "approve" } });

  beds.forEach(({ id, ...b }) => add("beds", id, b));
  return { rows, demoPatientId: jay.id };
}
