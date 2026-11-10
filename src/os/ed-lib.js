// Helpers shared by the ED board, triage and the patient chart (owned by the ED module).
// Pure logic only: labels, catalogs, deterministic fallbacks for every AI feature.
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";

/* ----------------------------- orders ------------------------------ */
export const ORDER_CATALOG = [
  { group: "Labs", items: [
    { name: "CBC", type: "lab" }, { name: "Electrolytes", type: "lab" }, { name: "Creatinine", type: "lab" },
    { name: "Troponin", type: "lab" }, { name: "Lipase", type: "lab" }, { name: "Lactate", type: "lab" },
    { name: "Blood cultures ×2", type: "lab" }, { name: "Urinalysis", type: "lab" }, { name: "β-hCG", type: "lab" },
  ] },
  { group: "Imaging and ECG", items: [
    { name: "ECG", type: "nursing" }, { name: "Chest X-ray", type: "imaging" }, { name: "CT head", type: "imaging" },
    { name: "CT abdomen/pelvis", type: "imaging" }, { name: "Ultrasound", type: "imaging" },
  ] },
  { group: "Treatment", items: [
    { name: "Analgesia per protocol", type: "med" }, { name: "IV fluids NS 1 L", type: "med" }, { name: "Antiemetic: ondansetron 4 mg IV", type: "med" },
  ] },
  { group: "Consults", items: [
    { name: "Consult internal medicine", type: "consult" }, { name: "Consult general surgery", type: "consult" },
    { name: "Consult orthopedics", type: "consult" }, { name: "Consult cardiology", type: "consult" }, { name: "Consult psychiatry", type: "consult" },
  ] },
];
export const ORDER_TYPE_LABEL = { lab: "Lab", imaging: "Imaging", med: "Medication", nursing: "Nursing", consult: "Consult" };
export const ORDER_STATUS = {
  ordered: { label: "Ordered", tone: "warn" }, in_progress: { label: "In progress", tone: "info" },
  resulted: { label: "Resulted", tone: "ok" }, done: { label: "Done", tone: "ok" }, cancelled: { label: "Cancelled", tone: "" },
};
export const isPendingOrder = (o) => o.status === "ordered" || o.status === "in_progress";
export const isBackOrder = (o) => o.status === "resulted" || o.status === "done";

export function ordersProgress(e) {
  const live = (e?.orders || []).filter((o) => o.status !== "cancelled");
  const back = live.filter(isBackOrder).length;
  return { total: live.length, back, pending: live.length - back };
}
/** All results back while the patient is still being worked up. */
export function resultsReady(e) {
  const p = ordersProgress(e);
  return ["in_treatment", "awaiting_results"].includes(e.status) && p.total > 0 && p.pending === 0;
}

/* ----------------------------- status ------------------------------ */
export const CLOSED = new Set(["discharged", "diverted", "lwbs", "transferred"]);
export const isClosed = (e) => CLOSED.has(e?.status);
export const isNew = (e) => e && Date.now() - (e.arrivalAt || 0) < 2 * D.MIN;
/** Sort: most urgent CTAS first (untriaged after triaged), then longest wait. */
export function byUrgency(a, b) {
  return (a.ctas || 9) - (b.ctas || 9) || (a.arrivalAt || 0) - (b.arrivalAt || 0);
}

export function locationOf(e, bed) {
  if (!e) return "";
  if (bed) {
    if (bed.area === "IP") return `${D.UNITS[bed.unit] || bed.unit} · ${bed.label}`;
    return bed.zone === "Hallway" ? `Hallway ${bed.label}` : `${bed.zone} ${bed.label}`;
  }
  if (e.status === "arriving") return "En route";
  if (["waiting_triage", "waiting_md"].includes(e.status)) return "Waiting room";
  if (isClosed(e)) return "Left the department";
  return "No space assigned";
}

export function langName(code) {
  const n = D.LANGS[code] || code || "English";
  return n.replace(/\s*\(.*\)$/, (m) => m); // keep "ਪੰਜਾਬੀ (Punjabi)" form
}
export const langPlain = (code) => {
  const n = D.LANGS[code] || "English";
  const m = n.match(/\(([^)]+)\)/);
  return m ? m[1] : n;
};

export function actorLabel(a = "") {
  if (a === "user") return "Staff";
  if (a === "system") return "Aster";
  if (a === "patient") return "Patient";
  if (a.startsWith("agent:")) return a.slice(6) + " (AI agent)";
  return a;
}

/* ------------------------ triage hand-off -------------------------- */
// Lets the chart / board ask the triage page to open a specific patient.
let triageFocus = null;
export function focusTriage(id) { triageFocus = id; }
export function takeTriageFocus() { const v = triageFocus; triageFocus = null; return v; }

/* ----------------------------- clinics ----------------------------- */
export function nextSlots(clinics, { limit = 8, withinH = 8 } = {}) {
  const until = Date.now() + withinH * D.HOUR;
  return clinics
    .flatMap((c) => D.openSlots(c).map((s) => ({ ...s, clinicId: c.id, clinicName: c.name, clinicKind: c.kind, distanceKm: c.distanceKm })))
    .filter((s) => s.t <= until)
    .sort((a, b) => a.t - b.t)
    .slice(0, limit);
}
/** Why a visit can (or cannot) be redirected to a same-day clinic. */
export function diversionCheck(e, p) {
  const age = D.ageOf(p?.dob);
  if (!e?.ctas) return { ok: false, why: "Complete triage first. Redirecting needs a CTAS level." };
  if (e.ctas < 4) return { ok: false, why: `CTAS ${e.ctas} (${D.CTAS[e.ctas].label.toLowerCase()}) needs emergency care. Only CTAS 4 and 5 can be redirected.` };
  if ((e.redFlags || []).length) return { ok: false, why: `Red flag on file: ${e.redFlags.join(", ")}. Patients with red flags stay in the ED.` };
  if (age != null && age >= 80) return { ok: false, why: "Patients aged 80 and over stay in the ED for assessment." };
  if (age != null && age < 2) return { ok: false, why: "Children under 2 stay in the ED for assessment." };
  if (e.seenAt) return { ok: true, why: "Already seen by a physician. Redirecting closes this ED visit.", seen: true };
  return { ok: true, why: `CTAS ${e.ctas}, no red flags. Safe to offer a same-day clinic visit.` };
}

/* ------------------------- prompt context -------------------------- */
const vitalsText = (v = {}) => {
  const parts = [];
  if (v.hr) parts.push(`HR ${v.hr}`);
  if (v.sbp) parts.push(`BP ${v.sbp}/${v.dbp || "?"}`);
  if (v.rr) parts.push(`RR ${v.rr}`);
  if (v.spo2) parts.push(`SpO₂ ${v.spo2}%`);
  if (v.temp) parts.push(`T ${v.temp}°C`);
  if (v.pain != null && v.pain !== "") parts.push(`pain ${v.pain}/10`);
  if (v.gcs) parts.push(`GCS ${v.gcs}`);
  return parts.join(", ");
};
export { vitalsText };

export function encounterContext(e, p, bed) {
  const age = D.ageOf(p?.dob);
  const orders = (e.orders || []).filter((o) => o.status !== "cancelled").map((o) => `- ${o.name}: ${ORDER_STATUS[o.status]?.label || o.status}${o.result ? ` (${o.result})` : ""}`).join("\n") || "- none";
  const notes = (e.notes || []).slice(-5).map((n) => `- [${n.kind}] ${n.author}: ${String(n.text).slice(0, 400)}`).join("\n") || "- none";
  return [
    `Patient: ${D.fullName(p)}, ${age ?? "?"} ${p?.sex || ""}, MRN ${p?.mrn || "?"}, language ${langPlain(p?.lang)}.`,
    `Allergies: ${(p?.allergies || []).join(", ") || "none known"}. Conditions: ${(p?.conditions || []).join(", ") || "none recorded"}. Home meds: ${(p?.meds || []).map((m) => `${m.name} ${m.dose || ""}`.trim()).join(", ") || "none recorded"}.`,
    `Visit: ${e.kind === "IP" || e.status === "admitted" ? "inpatient" : "emergency"}, source ${e.source || "walk-in"}, status ${D.STATUS_LABEL[e.status] || e.status}, CTAS ${e.ctas || "not triaged"}.`,
    `Chief complaint / diagnosis: ${e.dx || e.cc}.`,
    `Time in department: ${D.fmtSince(e.arrivalAt)}. Location: ${locationOf(e, bed)}. Physician: ${e.md || "not assigned"}.`,
    `Latest vitals: ${vitalsText(e.vitals) || "none recorded"}.`,
    `Red flags: ${(e.redFlags || []).join(", ") || "none"}.`,
    e.preSummary ? `Pre-arrival summary from the patient app: ${e.preSummary}` : "",
    `Orders:\n${orders}`,
    `Recent notes:\n${notes}`,
    e.dc ? `Discharge plan: probability ${e.dc.prob}%, ETA ${e.dc.eta || "unknown"}, barriers: ${(e.dc.barriers || []).filter((b) => b.status !== "done").map((b) => `${b.text} (${b.owner})`).join("; ") || "none"}.` : "",
  ].filter(Boolean).join("\n");
}

/* ---------------------- deterministic SBAR ------------------------- */
export function fallbackSbar(e, p, bed) {
  const age = D.ageOf(p?.dob);
  const inpatient = e.status === "admitted";
  const prog = ordersProgress(e);
  const back = (e.orders || []).filter(isBackOrder);
  const pending = (e.orders || []).filter(isPendingOrder);
  const time = inpatient && e.admittedAt ? `day ${Math.max(1, Math.ceil((Date.now() - e.admittedAt) / D.DAY))} of admission` : `${D.fmtSince(e.arrivalAt)} in the ED`;
  const sit = `${D.fullName(p)}, ${age ?? "?"} ${p?.sex || ""}${e.ctas ? `, CTAS ${e.ctas}` : ""}, ${(e.dx || e.cc || "").toLowerCase()}. ${D.STATUS_LABEL[e.status] || e.status}, ${time}${bed ? `, ${locationOf(e, bed)}` : ""}${e.md ? `, ${e.md}` : ""}.`;
  const bg = [
    `Allergies: ${(p?.allergies || []).join(", ") || "no known allergies"}.`,
    (p?.conditions || []).length ? `History: ${p.conditions.join(", ")}.` : "No past history recorded.",
    (p?.meds || []).length ? `Home meds: ${p.meds.map((m) => m.name).join(", ")}.` : "",
    e.source === "ambulance" ? "Arrived by ambulance." : e.source === "app" ? "Pre-registered through the Aster app." : "",
  ].filter(Boolean).join(" ");
  const assess = [
    `Vitals: ${vitalsText(e.vitals) || "none recorded"}${e.vitals?.t ? ` (${D.fmtAgo(e.vitals.t)})` : ""}.`,
    (e.redFlags || []).length ? `Red flags: ${e.redFlags.join(", ")}.` : "No red flags.",
    back.length ? `Results: ${back.map((o) => `${o.name} ${o.result ? "(" + o.result + ")" : "back"}`).join("; ")}.` : prog.total ? "No results back yet." : "No orders placed.",
  ].join(" ");
  const recs = [];
  if (pending.length) recs.push(`Follow up ${pending.length} pending order${pending.length > 1 ? "s" : ""}: ${pending.map((o) => o.name).join(", ")}.`);
  const next = {
    arriving: "Triage on arrival.", waiting_triage: "Triage now.", waiting_md: `Physician assessment${e.ctas ? ` (target ${D.CTAS[e.ctas].target} min)` : ""}.`,
    in_treatment: "Complete assessment and decide on investigations.", awaiting_results: "Review results as they return, then decide disposition.",
    decision: "Ready for disposition: discharge, admit or redirect.", boarding: `Admitted to ${e.service || "Medicine"}: needs an inpatient bed.`,
    admitted: e.dc ? `Discharge probability ${e.dc.prob}%${e.dc.eta ? `, ETA ${e.dc.eta.toLowerCase()}` : ""}. ${(e.dc.barriers || []).filter((b) => b.status !== "done").length} open barrier(s).` : "Continue inpatient care.",
  }[e.status];
  if (next) recs.push(next);
  if ((e.redFlags || []).length) recs.push("Reassess red flags at each handoff.");
  return `#### Situation\n${sit}\n#### Background\n${bg}\n#### Assessment\n${assess}\n#### Recommendation\n${recs.map((r) => "- " + r).join("\n") || "- Continue current plan."}`;
}

/* -------------------- discharge instructions ----------------------- */
const DC = {
  en: {
    title: "Discharge instructions", reason: "Reason for your visit", did: "What we did today", home: "What to do at home",
    back: "Come back to the emergency department or call 911 right away if", follow: "Follow-up",
    followDefault: "See your family doctor or a walk-in clinic (GMF) in 3 to 5 days. For health questions, call Info-Santé 811 any time.",
    noTests: "Assessment by the emergency team. No tests were needed.",
    meds: "Take your usual medications unless your doctor told you otherwise.",
    generic: { home: ["Rest and drink plenty of fluids.", "Take acetaminophen (Tylenol) for pain or fever as directed on the package."], back: ["Your symptoms get much worse", "You have trouble breathing, chest pain or you faint", "You have a high fever that does not come down"] },
    cat: {
      trauma: { home: ["Rest the injured area and keep it raised above the level of your heart.", "Apply ice wrapped in a cloth for 20 minutes every 2 to 3 hours for the first 2 days.", "Take acetaminophen or ibuprofen for pain as directed on the package."], back: ["Pain becomes severe or is not controlled by medication", "The area becomes cold, pale, numb or tingly", "You cannot move your fingers or toes"] },
      lac: { home: ["Keep the wound clean and dry for 24 to 48 hours, then wash gently with soap and water.", "Have stitches removed in 7 to 10 days at a clinic or CLSC.", "Check your tetanus vaccination status."], back: ["Redness spreads, the wound swells or drains pus", "You have a fever", "Bleeding does not stop with firm pressure for 10 minutes"] },
      urinary: { home: ["Drink plenty of water.", "Finish all of your antibiotics, even if you feel better.", "Acetaminophen can help with discomfort."], back: ["You have a fever, chills or back pain", "You are vomiting and cannot keep fluids down", "You see blood in your urine"] },
      minor: { home: ["Rest and drink plenty of fluids.", "Acetaminophen or ibuprofen can help with pain and fever.", "Wash your hands often to avoid spreading illness."], back: ["You have trouble breathing or swallowing", "Fever lasts more than 3 days", "You feel much worse or confused"] },
      abdo: { home: ["Start with clear fluids, then eat light meals as you feel able.", "Avoid alcohol and fatty foods for a few days."], back: ["Pain gets worse or moves to the lower right side", "You have a fever or keep vomiting", "You see blood in your vomit or stool"] },
      chest: { home: ["Avoid strenuous activity until your follow-up.", "Take your medications as prescribed."], back: ["Chest pain comes back or lasts more than 5 minutes", "Pain spreads to your arm, jaw or back, or you feel sweaty or short of breath", "You feel faint or your heart races"] },
      sob: { home: ["Use your inhalers as prescribed.", "Avoid smoke and other triggers."], back: ["Breathing gets harder or your lips turn blue", "Your inhaler does not help or you need it more than every 4 hours", "You cannot speak in full sentences"] },
      headache: { home: ["Rest in a quiet, dark room.", "Take acetaminophen or ibuprofen as directed on the package.", "Drink plenty of fluids."], back: ["You have the worst headache of your life or it starts suddenly", "You have a stiff neck, fever, confusion or weakness", "You have trouble seeing or speaking"] },
    },
  },
  fr: {
    title: "Instructions de congé", reason: "Raison de votre visite", did: "Ce que nous avons fait aujourd'hui", home: "À la maison",
    back: "Revenez à l'urgence ou appelez le 911 immédiatement si", follow: "Suivi",
    followDefault: "Consultez votre médecin de famille ou une clinique sans rendez-vous (GMF) d'ici 3 à 5 jours. Pour toute question, appelez Info-Santé 811 en tout temps.",
    noTests: "Évaluation par l'équipe de l'urgence. Aucun examen n'a été nécessaire.",
    meds: "Continuez vos médicaments habituels, sauf avis contraire de votre médecin.",
    generic: { home: ["Reposez-vous et buvez beaucoup de liquides.", "Prenez de l'acétaminophène (Tylenol) contre la douleur ou la fièvre selon l'emballage."], back: ["Vos symptômes s'aggravent beaucoup", "Vous avez de la difficulté à respirer, une douleur à la poitrine ou vous vous évanouissez", "Vous avez une forte fièvre qui ne baisse pas"] },
    cat: {
      trauma: { home: ["Reposez la région blessée et gardez-la surélevée au-dessus du niveau du cœur.", "Appliquez de la glace enveloppée d'un linge 20 minutes toutes les 2 à 3 heures pendant 2 jours.", "Prenez de l'acétaminophène ou de l'ibuprofène contre la douleur selon l'emballage."], back: ["La douleur devient intense ou n'est pas soulagée", "La région devient froide, pâle, engourdie ou fourmille", "Vous ne pouvez plus bouger les doigts ou les orteils"] },
      lac: { home: ["Gardez la plaie propre et sèche 24 à 48 heures, puis lavez doucement à l'eau et au savon.", "Faites retirer les points dans 7 à 10 jours en clinique ou au CLSC.", "Vérifiez votre vaccination contre le tétanos."], back: ["La rougeur s'étend, la plaie enfle ou coule", "Vous faites de la fièvre", "Le saignement ne s'arrête pas après 10 minutes de pression"] },
      urinary: { home: ["Buvez beaucoup d'eau.", "Terminez tous vos antibiotiques, même si vous allez mieux.", "L'acétaminophène peut soulager l'inconfort."], back: ["Vous avez de la fièvre, des frissons ou mal au dos", "Vous vomissez et ne gardez pas les liquides", "Vous voyez du sang dans votre urine"] },
      minor: { home: ["Reposez-vous et buvez beaucoup de liquides.", "L'acétaminophène ou l'ibuprofène peuvent soulager la douleur et la fièvre.", "Lavez-vous les mains souvent."], back: ["Vous avez de la difficulté à respirer ou à avaler", "La fièvre dure plus de 3 jours", "Vous vous sentez beaucoup plus mal ou confus"] },
      abdo: { home: ["Commencez par des liquides clairs, puis des repas légers selon votre tolérance.", "Évitez l'alcool et les aliments gras quelques jours."], back: ["La douleur augmente ou se déplace en bas à droite", "Vous faites de la fièvre ou vomissez sans arrêt", "Vous voyez du sang dans vos vomissements ou vos selles"] },
      chest: { home: ["Évitez les efforts intenses jusqu'à votre suivi.", "Prenez vos médicaments tels que prescrits."], back: ["La douleur à la poitrine revient ou dure plus de 5 minutes", "La douleur s'étend au bras, à la mâchoire ou au dos, ou vous êtes en sueur ou essoufflé", "Vous vous sentez faible ou votre cœur s'emballe"] },
      sob: { home: ["Utilisez vos pompes tel que prescrit.", "Évitez la fumée et les autres déclencheurs."], back: ["Votre respiration devient plus difficile ou vos lèvres bleuissent", "Votre pompe n'aide pas ou vous en avez besoin plus d'une fois aux 4 heures", "Vous ne pouvez pas faire de phrases complètes"] },
      headache: { home: ["Reposez-vous dans une pièce calme et sombre.", "Prenez de l'acétaminophène ou de l'ibuprofène selon l'emballage.", "Buvez beaucoup de liquides."], back: ["C'est le pire mal de tête de votre vie ou il commence soudainement", "Vous avez la nuque raide, de la fièvre, de la confusion ou une faiblesse", "Vous avez de la difficulté à voir ou à parler"] },
    },
  },
};
const CAT_ALIAS = { fever: "minor", bleed: "abdo", confusion: null, pregnant: null, stroke: null, seizure: null, suicidal: null, anaphylaxis: null, arrest: null };

export function fallbackDischarge(e, p, { lang = "en", followUp = "" } = {}) {
  const L = lang === "fr" ? DC.fr : DC.en;
  const a = D.assessCtas({ cc: e.cc, vitals: {}, age: D.ageOf(p?.dob) || 40 });
  let key = a.complaint;
  if (key in CAT_ALIAS) key = CAT_ALIAS[key];
  const cat = (key && L.cat[key]) || L.generic;
  const done = (e.orders || []).filter(isBackOrder);
  const lines = [
    `${L.title}: ${D.fullName(p)}`,
    "",
    `${L.reason}`,
    `${e.dx || e.cc}`,
    "",
    L.did,
    ...(done.length ? done.map((o) => `- ${o.name}${o.result ? ": " + o.result : ""}`) : [`- ${L.noTests}`]),
    "",
    L.home,
    ...cat.home.map((x) => `- ${x}`),
    `- ${L.meds}`,
    "",
    `${L.back}:`,
    ...cat.back.map((x) => `- ${x}`),
    "",
    L.follow,
    `- ${followUp || L.followDefault}`,
  ];
  if (lang !== "en" && lang !== "fr") lines.push("", `Note: the patient's preferred language is ${langPlain(lang)}. Review these instructions with an interpreter.`);
  return lines.join("\n");
}

/** Non-hook read of open tasks for a barrier. */
export function openTaskFor(barrierId) {
  return S.all("tasks").find((t) => t.barrierId === barrierId && t.status !== "done");
}
