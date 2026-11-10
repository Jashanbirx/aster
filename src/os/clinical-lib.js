// Deterministic clinical helpers shared by sign-off, scribe, referrals,
// analytics and audit. Used as the fallback whenever AI is unavailable, and
// as a rules "floor" that always runs next to the AI.
import * as D from "../lib/domain.js";

const norm = (s = "") => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const fold = norm;

/* =================================================================== */
/* Medication safety check                                              */
/* =================================================================== */
const DRUGS = {
  sulfamethoxazole: /sulfamethoxazole|tmp[- ]?smx|bactrim|septra|co-?trimoxazole/,
  sulfasalazine: /sulfasalazine/,
  amoxicillin: /amoxicill|clavulin|amoxi-clav/,
  ampicillin: /ampicill/,
  penicillin: /\bpenicillin|\bpen v\b|cloxacill|piperacill/,
  cephalexin: /cephalexin|cefalexin|keflex/,
  cefazolin: /cefazolin/,
  ceftriaxone: /ceftriaxone/,
  cefuroxime: /cefuroxime/,
  codeine: /codeine|tylenol ?(#|no\.? ?)3/,
  morphine: /morphine/,
  hydromorphone: /hydromorphone|dilaudid/,
  oxycodone: /oxycodone|percocet/,
  apixaban: /apixaban|eliquis/,
  rivaroxaban: /rivaroxaban|xarelto/,
  warfarin: /warfarin|coumadin/,
  dabigatran: /dabigatran|pradaxa/,
  edoxaban: /edoxaban|lixiana/,
  clarithromycin: /clarithromycin|biaxin/,
  erythromycin: /erythromycin/,
  fluconazole: /fluconazole|diflucan/,
  ketoconazole: /ketoconazole|itraconazole/,
  ibuprofen: /ibuprofen|advil|motrin/,
  naproxen: /naproxen|naprosyn|aleve/,
  diclofenac: /diclofenac|voltaren/,
  ketorolac: /ketorolac|toradol/,
  celecoxib: /celecoxib|celebrex/,
  asa: /\basa\b|aspirin|acetylsalicylic/,
  ramipril: /ramipril/,
  perindopril: /perindopril/,
  lisinopril: /lisinopril/,
  enalapril: /enalapril/,
  losartan: /losartan|candesartan|valsartan|irbesartan|telmisartan/,
  potassium: /potassium chloride|\bkcl\b|k-dur|potassium supplement|slow-k/,
  spironolactone: /spironolactone|eplerenone/,
  nitrofurantoin: /nitrofurantoin|macrobid/,
  metformin: /metformin/,
  contrast: /contrast|iodinated|ct .*with contrast|angiogra/,
  furosemide: /furosemide|lasix/,
};
const CLASS = {
  anticoag: ["apixaban", "rivaroxaban", "warfarin", "dabigatran", "edoxaban"],
  cyp3a4: ["clarithromycin", "erythromycin", "fluconazole", "ketoconazole"],
  nsaid: ["ibuprofen", "naproxen", "diclofenac", "ketorolac", "celecoxib", "asa"],
  acei: ["ramipril", "perindopril", "lisinopril", "enalapril", "losartan"],
  kraise: ["potassium", "spironolactone", "sulfamethoxazole"],
};
const pretty = (k) => ({ asa: "ASA", sulfamethoxazole: "TMP-SMX", losartan: "an ARB", contrast: "iodinated contrast", potassium: "potassium" }[k] || k);

function drugsIn(text) {
  const t = norm(text); const out = new Set();
  for (const [k, re] of Object.entries(DRUGS)) if (re.test(t)) out.add(k);
  return out;
}

const ALLERGY_RULES = [
  { allergy: /sulfa|sulfon/, high: ["sulfamethoxazole", "sulfasalazine"], caution: [], why: "sulfonamide antibiotic", note: "Non-antibiotic sulfonamides (furosemide, thiazides) have low cross-reactivity." },
  { allergy: /penicil|amoxi/, high: ["penicillin", "amoxicillin", "ampicillin"], caution: ["cephalexin", "cefazolin", "cefuroxime", "ceftriaxone"], why: "penicillin-class", cautionWhy: "cephalosporin: low (~1–2%) cross-reactivity, avoid if the reaction was anaphylaxis" },
  { allergy: /codeine/, high: ["codeine"], caution: ["morphine", "hydromorphone", "oxycodone"], why: "codeine", cautionWhy: "opioid: true cross-allergy is uncommon, but monitor for the same reaction" },
  { allergy: /iod|contrast/, high: ["contrast"], caution: [], why: "iodinated contrast" },
];

/**
 * Deterministic safety check of a proposal against the patient's chart.
 * Returns { ok, issues:[{severity:'high'|'moderate'|'info', text, source:'rules'}], checked }
 */
export function safetyRules(proposal = {}, patient = {}) {
  const pText = [proposal.title, proposal.assessment, ...(proposal.plan || []), proposal.rx].filter(Boolean).join(" \n ");
  const medText = (patient.meds || []).map((m) => `${m.name} ${m.dose || ""}`).join(" \n ");
  const proposed = drugsIn(pText), current = drugsIn(medText);
  const issues = [];
  const add = (severity, text) => { if (!issues.some((i) => i.text === text)) issues.push({ severity, text, source: "rules" }); };
  // allergies
  for (const a of patient.allergies || []) {
    const an = norm(a);
    for (const rule of ALLERGY_RULES) {
      if (!rule.allergy.test(an)) continue;
      rule.high.filter((d) => proposed.has(d)).forEach((d) => add("high", `Allergy conflict: patient is allergic to ${a}; the plan includes ${pretty(d)} (${rule.why}).`));
      rule.caution.filter((d) => proposed.has(d)).forEach((d) => add("moderate", `Allergy caution: ${a} allergy and ${pretty(d)} in the plan (${rule.cautionWhy}).`));
      if (rule.note && /furosemide|thiazide|hydrochlorothiazide/.test(norm(pText))) add("info", `${a} allergy: ${rule.note}`);
    }
  }
  // interactions
  const all = new Set([...proposed, ...current]);
  const has = (cls) => CLASS[cls].filter((d) => all.has(d));
  const involvesProposal = (...ds) => ds.some((d) => proposed.has(d));
  const sev = (base, ...ds) => (involvesProposal(...ds) ? base : "info");
  for (const ac of has("anticoag")) {
    for (const x of has("cyp3a4")) add(sev("high", ac, x), `Interaction: ${ac} with ${x} (CYP3A4 / P-gp inhibition) raises anticoagulant levels and bleeding risk. Prefer another agent or adjust.`);
    for (const x of has("nsaid")) add(sev("high", ac, x), `Interaction: ${ac} with ${pretty(x)} increases bleeding risk. Avoid NSAIDs; use acetaminophen.`);
  }
  for (const a of has("acei")) for (const k of has("kraise")) add(sev("moderate", a, k), `Interaction: ${pretty(a)} with ${pretty(k)} can cause hyperkalemia. Check potassium and creatinine within 1 week.`);
  const age = D.ageOf(patient.dob);
  const renal = (patient.conditions || []).some((c) => /kidney|renal|ckd|irc|insuffisance r/i.test(c)) || (patient.labs || []).some((l) => /egfr|dfg/i.test(l.name) && parseFloat(l.value) < 45);
  if (all.has("nitrofurantoin") && (renal || (age && age >= 65))) add(sev("moderate", "nitrofurantoin"), `Nitrofurantoin: ${renal ? "reduced kidney function on file" : `age ${age}`}. Avoid if eGFR < 30 mL/min; confirm a recent eGFR.`);
  if (all.has("metformin") && all.has("contrast")) add(sev("moderate", "metformin", "contrast"), "Metformin with iodinated contrast: hold metformin for 48 h after contrast if eGFR < 30 or acute kidney injury.");
  if (all.has("furosemide") && /twice|bid|increase|augment|×\s*\d|x\s*\d/i.test(pText) && proposed.has("furosemide")) add("info", "Diuretic intensification: check potassium and creatinine in 3–5 days.");
  if (age && age >= 65 && has("nsaid").some((d) => proposed.has(d))) add("moderate", `Age ${age}: NSAIDs are potentially inappropriate (Beers criteria: GI bleeding, kidney injury).`);
  if ((patient.conditions || []).some((c) => /heart failure|insuffisance cardiaque/i.test(c)) && has("nsaid").some((d) => proposed.has(d))) add("high", "Heart failure on file: NSAIDs can worsen fluid retention.");
  const order = { high: 0, moderate: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    ok: !issues.some((i) => i.severity !== "info"),
    issues,
    checked: { allergies: (patient.allergies || []).length, meds: (patient.meds || []).length, conditions: (patient.conditions || []).length, age, proposed: [...proposed].map(pretty) },
  };
}

/** Merge AI issues with rules: rules are always kept (they are the floor). */
export function mergeIssues(rules, ai) {
  const out = [...rules.issues];
  for (const i of (ai && ai.issues) || []) {
    const sevRaw = norm(i.severity || "info");
    const severity = /high|major|severe|critical/.test(sevRaw) ? "high" : /mod|med|caution|warn/.test(sevRaw) ? "moderate" : "info";
    const text = String(i.text || i.issue || "").trim();
    if (!text) continue;
    out.push({ severity, text, source: "ai" });
  }
  const order = { high: 0, moderate: 1, info: 2 };
  out.sort((a, b) => order[a.severity] - order[b.severity] || (a.source === "rules" ? -1 : 1));
  return { ok: !out.some((i) => i.severity !== "info"), issues: out };
}

/* =================================================================== */
/* Ambient scribe                                                       */
/* =================================================================== */
export const DEMO_TRANSCRIPTS = {
  en: {
    label: "English ED visit: right lower quadrant pain",
    lang: "en",
    text: `Dr: Hi, I'm Dr. Okafor. What brings you in today?
Patient: I've had pain in my belly since last night. It started around my belly button and now it's down on the right side.
Dr: How bad is the pain right now, out of ten?
Patient: About a seven. It's worse when I walk, and every bump in the car on the way here hurt.
Dr: Any nausea or vomiting?
Patient: I threw up twice this morning and I don't feel like eating anything.
Dr: Any fever, diarrhea, or pain when you pee?
Patient: I felt hot and had chills overnight. No diarrhea, and peeing is normal.
Dr: Any medical problems, medications or allergies?
Patient: No medical problems. I only take ibuprofen sometimes. I'm allergic to penicillin, I get hives.
Nurse: Vitals: temperature is 38.2, heart rate 102, blood pressure 124 over 78, respiratory rate 18, oxygen saturation 99 percent.
Dr: I'm going to press on your belly. Tell me where it hurts.
Patient: Ow, right there, on the lower right.
Dr: You're tender in the right lower quadrant with guarding, and pressing on the left side hurts on the right. That's a positive Rovsing sign.
Dr: This could be appendicitis. I'm going to order a CBC, lytes, lipase and a urinalysis, and a CT scan of your abdomen and pelvis.
Dr: We'll start IV fluids, give you something for the pain and for nausea, and keep you fasting, nothing to eat or drink for now.
Dr: I'll ask the surgery team to see you if the CT confirms it.
Patient: Okay. Will I need surgery?
Dr: If it's appendicitis, most likely yes, a small keyhole operation. We'll know more after the scan, in about two hours.`,
  },
  fr: {
    label: "Visite en français : exacerbation de MPOC",
    lang: "fr",
    text: `Médecin : Bonjour, je suis la Dre Pelletier. Qu'est-ce qui vous amène aujourd'hui ?
Patient : J'ai de la misère à respirer depuis trois jours. Ça empire, surtout la nuit.
Médecin : Vous toussez ? Est-ce que vos crachats ont changé de couleur ?
Patient : Oui, je tousse beaucoup et mes crachats sont verts depuis hier.
Médecin : Avez-vous de la fièvre ou des douleurs à la poitrine ?
Patient : Un peu de fièvre hier soir, pas de douleur à la poitrine.
Médecin : Quels médicaments prenez-vous pour votre MPOC ?
Patient : Mes pompes, le tiotropium le matin et le salbutamol quand j'en ai besoin. Là, je le prends aux deux heures.
Médecin : Des allergies à des médicaments ?
Patient : Oui, je suis allergique à la sulfa.
Infirmière : Signes vitaux : température 37,9, pouls 112, tension 138 sur 82, fréquence respiratoire 26, saturation 88 % à l'air ambiant.
Médecin : J'entends des sibilances des deux côtés et une diminution de l'entrée d'air aux bases. Vous utilisez vos muscles accessoires.
Médecin : C'est probablement une exacerbation de votre MPOC, peut-être déclenchée par une infection.
Médecin : On va faire une radiographie pulmonaire, une formule sanguine, des électrolytes et un gaz veineux.
Médecin : Je vais vous donner des nébulisations de salbutamol et d'ipratropium, de la prednisone 40 mg par la bouche et un antibiotique, la doxycycline, puisque vous êtes allergique à la sulfa.
Médecin : On vise une saturation entre 88 et 92 % avec de l'oxygène au besoin.
Patient : Est-ce que je vais devoir rester à l'hôpital ?
Médecin : On va réévaluer dans une heure après les traitements. Si ça ne s'améliore pas, on va vous admettre en médecine.`,
  },
};

/** Split a transcript into [{speaker, role, text}] */
export function parseTranscript(text = "") {
  return String(text).split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{0,24}?)\s*:\s*(.*)$/);
    const speaker = m ? m[1].trim() : "";
    const body = m ? m[2] : l;
    const s = norm(speaker);
    const role = /patient|pt\b|client|mother|mere|pere|father|family|famille/.test(s) ? "patient" : /nurse|infirm|rn\b|inf\b/.test(s) ? "nurse" : /dr|doc|md|medecin|physician|clinician|resident/.test(s) ? "md" : speaker ? "other" : "md";
    return { speaker: speaker || "Speaker", role, text: body };
  });
}

const L = {
  en: { s: "Subjective", o: "Objective", a: "Assessment", p: "Plan", f: "Patient-friendly summary", cc: "Chief complaint", hpi: "History", neg: "Pertinent negatives", meds: "Medications", all: "Allergies", nka: "No known drug allergies mentioned", nomeds: "None mentioned", pmh: "Medical history", vitals: "Vitals", exam: "Exam", none: "Not documented in the transcript" },
  fr: { s: "Subjectif", o: "Objectif", a: "Évaluation", p: "Plan", f: "Résumé pour le patient", cc: "Raison de consultation", hpi: "Histoire", neg: "Négatifs pertinents", meds: "Médicaments", all: "Allergies", nka: "Aucune allergie mentionnée", nomeds: "Aucun mentionné", pmh: "Antécédents", vitals: "Signes vitaux", exam: "Examen", none: "Non documenté dans la transcription" },
};
const SYMPTOMS = [
  { re: /belly|abdom|stomach|ventre/, en: "abdominal pain", fr: "douleur abdominale" },
  { re: /belly button|umbilic|nombril/, en: "pain that started periumbilical", fr: "douleur initialement périombilicale" },
  { re: /right side|lower right|right lower|fosse iliaque droite|cote droit/, en: "migration to the right lower quadrant", fr: "migration en fosse iliaque droite" },
  { re: /threw up|vomit|vomis/, en: "vomiting", fr: "vomissements" },
  { re: /nause|feel like eating|appetit|appetite/, en: "nausea and anorexia", fr: "nausées et anorexie" },
  { re: /fever|felt hot|chills|fievre|frisson/, en: "subjective fever and chills", fr: "fièvre subjective" },
  { re: /respir|breath|essouffl|souffle/, en: "shortness of breath", fr: "dyspnée" },
  { re: /cough|tousse|toux/, en: "cough", fr: "toux" },
  { re: /sputum|phlegm|crachat|expector/, en: "change in sputum colour", fr: "changement de couleur des expectorations" },
  { re: /worse at night|surtout la nuit|nocturn/, en: "worse at night", fr: "aggravation nocturne" },
  { re: /chest pain|douleur a la poitrine|douleurs a la poitrine/, en: "chest pain", fr: "douleur thoracique" },
  { re: /headache|mal de tete|cephal/, en: "headache", fr: "céphalée" },
  { re: /dizz|etourdi|vertig/, en: "dizziness", fr: "étourdissements" },
  { re: /diarrh/, en: "diarrhea", fr: "diarrhée" },
];
const CONDITIONS = [
  { re: /copd|mpoc|emphys/, en: "COPD", fr: "MPOC" },
  { re: /diabet/, en: "Diabetes", fr: "Diabète" },
  { re: /hypertens|blood pressure pills|haute pression/, en: "Hypertension", fr: "Hypertension" },
  { re: /asthma|asthme/, en: "Asthma", fr: "Asthme" },
  { re: /heart failure|insuffisance cardiaque/, en: "Heart failure", fr: "Insuffisance cardiaque" },
];
const MED_NAMES = ["ibuprofen", "acetaminophen", "tiotropium", "salbutamol", "metformin", "ramipril", "apixaban", "warfarin", "furosemide", "levothyroxine", "atorvastatin", "prednisone", "insulin", "fluticasone", "budesonide", "naproxen"];
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10 };

export function extractVitals(text = "") {
  const t = norm(text).replace(/(\d),(\d)/g, "$1.$2");
  const num = (re) => { const m = t.match(re); return m ? parseFloat(m[1]) : null; };
  const bp = t.match(/(?:blood pressure|tension|\bbp|\bta)\D{0,12}(\d{2,3})\s*(?:over|sur|\/)\s*(\d{2,3})/);
  const v = {
    temp: num(/(?:temperature|temp)\D{0,10}(\d{2}(?:\.\d)?)/),
    hr: num(/(?:heart rate|pulse|pouls|\bhr|frequence cardiaque|\bfc)\D{0,10}(\d{2,3})/),
    sbp: bp ? +bp[1] : null, dbp: bp ? +bp[2] : null,
    rr: num(/(?:respiratory rate|frequence respiratoire|\brr|\bfr)\D{0,10}(\d{1,2})/),
    spo2: num(/(?:saturation|spo2|sat|oxygen saturation)\D{0,10}(\d{2,3})/),
  };
  const pain = t.match(/(\d{1,2})\s*(?:\/|out of|sur)\s*10/) || t.match(/about an? (one|two|three|four|five|six|seven|eight|nine|ten)\b/) || t.match(/environ (un|deux|trois|quatre|cinq|six|sept|huit|neuf|dix) sur dix/);
  if (pain) v.pain = WORDNUM[pain[1]] || +pain[1];
  Object.keys(v).forEach((k) => (v[k] == null || Number.isNaN(v[k])) && delete v[k]);
  return v;
}

const short = (s, n = 70) => { const x = String(s).replace(/\s+/g, " ").trim(); return x.length > n ? x.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : x; };
const quote = (s, lang) => (lang === "fr" ? `[« ${short(s)} »]` : `["${short(s)}"]`);
/** Snippet of a line around a keyword match. */
function snippet(line, re) {
  const m = norm(line).match(re); if (!m) return short(line);
  const start = Math.max(0, m.index - 25); const end = Math.min(line.length, m.index + m[0].length + 35);
  let s = line.slice(start, end).trim();
  if (start > 0) s = s.replace(/^\S*\s/, "");
  if (end < line.length) s = s.replace(/\s\S*$/, "");
  return s;
}

/** Keyword order extraction from clinician lines. */
const ORDER_RULES = [
  { re: /\bcbc\b|complete blood count|formule sanguine|\bfsc\b/, name: "CBC", type: "lab", why: { en: "Infection / leukocytosis", fr: "Recherche de leucocytose" } },
  { re: /\blytes\b|electrolyte/, name: "Electrolytes, creatinine", type: "lab", why: { en: "Baseline lytes and kidney function", fr: "Électrolytes et fonction rénale" } },
  { re: /lipase/, name: "Lipase", type: "lab", why: { en: "Rule out pancreatitis", fr: "Exclure une pancréatite" } },
  { re: /urinalysis|urine test|analyse d.urine/, name: "Urinalysis", type: "lab", why: { en: "Rule out urinary source", fr: "Exclure une cause urinaire" } },
  { re: /troponin/, name: "Troponin", type: "lab", why: { en: "Rule out myocardial injury", fr: "Exclure une atteinte myocardique" } },
  { re: /lactate/, name: "Lactate", type: "lab", why: { en: "Sepsis screen", fr: "Dépistage du sepsis" } },
  { re: /blood culture|hemoculture/, name: "Blood cultures ×2", type: "lab", why: { en: "Possible bacteremia", fr: "Bactériémie possible" } },
  { re: /gaz veineux|venous (blood )?gas|\bvbg\b/, name: "Venous blood gas", type: "lab", why: { en: "Assess CO₂ retention", fr: "Évaluer la rétention de CO₂" } },
  { re: /pregnancy test|hcg|test de grossesse/, name: "β-hCG", type: "lab", why: { en: "Rule out pregnancy before imaging", fr: "Exclure une grossesse" } },
  { re: /ct (scan )?(of )?(your |the )?(abdomen|belly)|scan of your abdomen|ct abdo|tomodensitometrie abdo|scan abdo/, name: "CT abdomen/pelvis", type: "imaging", why: { en: "Confirm appendicitis vs other causes", fr: "Confirmer le diagnostic" } },
  { re: /ct (scan )?(of )?(the |your )?head|scan (de la )?tete/, name: "CT head", type: "imaging", why: { en: "Rule out intracranial process", fr: "Exclure une atteinte intracrânienne" } },
  { re: /chest x-?ray|radiographie pulmonaire|radio(graphie)? des poumons|radiographie du thorax/, name: "Chest X-ray", type: "imaging", why: { en: "Rule out pneumonia / pneumothorax", fr: "Exclure pneumonie ou pneumothorax" } },
  { re: /\becg\b|\bekg\b|electrocardiogram/, name: "ECG", type: "nursing", why: { en: "Rhythm and ischemia screen", fr: "Rythme et ischémie" } },
  { re: /iv fluids|fluid bolus|solute|hydratation iv/, name: "IV fluids (normal saline)", type: "med", why: { en: "Vomiting, poor oral intake", fr: "Vomissements, faible apport oral" } },
  { re: /something for the pain|analges|morphine|hydromorphone|acetaminophen/, name: "Analgesia per protocol", type: "med", why: { en: "Pain control", fr: "Contrôle de la douleur" } },
  { re: /for nausea|ondansetron|antiemetic|antinause/, name: "Ondansetron 4 mg IV", type: "med", why: { en: "Nausea and vomiting", fr: "Nausées et vomissements" } },
  { re: /nothing to eat|fasting|\bnpo\b|a jeun/, name: "NPO (nothing by mouth)", type: "nursing", why: { en: "Possible surgery", fr: "Chirurgie possible" } },
  { re: /surgery team|surgeon|surgical consult|chirurg/, name: "General surgery consult", type: "consult", why: { en: "Possible appendicitis", fr: "Appendicite possible" } },
  { re: /nebuli[sz]|nebs\b/, name: "Salbutamol/ipratropium nebs", type: "med", why: { en: "Bronchospasm", fr: "Bronchospasme" } },
  { re: /prednisone/, name: "Prednisone 40 mg PO", type: "med", why: { en: "COPD exacerbation", fr: "Exacerbation de MPOC" } },
  { re: /doxycycline/, name: "Doxycycline 100 mg PO BID", type: "med", why: { en: "Purulent sputum; sulfa allergy", fr: "Expectorations purulentes; allergie à la sulfa" } },
  { re: /amoxicillin|ceftriaxone|antibiotic(?! la doxy)/, name: "Antibiotic per physician", type: "med", why: { en: "Suspected bacterial infection", fr: "Infection bactérienne suspectée" } },
  { re: /oxyg[eè]n|oxygen/, name: "Oxygen to SpO₂ 88–92%", type: "nursing", why: { en: "Hypoxemia in COPD", fr: "Hypoxémie chez MPOC" } },
  { re: /admettre en medecine|admit (you )?to medicine|admission/, name: "Medicine consult for admission if no improvement", type: "consult", why: { en: "Possible admission", fr: "Admission possible" } },
];

export function extractOrders(transcript, lang = "en") {
  const lines = parseTranscript(transcript).filter((l) => l.role === "md" || l.role === "other");
  const out = [];
  for (const r of ORDER_RULES) {
    const line = lines.find((l) => r.re.test(norm(l.text)));
    if (line && !out.some((o) => o.name === r.name)) out.push({ name: r.name, type: r.type, why: r.why[lang] || r.why.en, quote: snippet(line.text, r.re) });
  }
  return out;
}

/** Deterministic SOAP note (Markdown). */
export function buildNote(transcript, { lang = "en", patient } = {}) {
  const T = L[lang] || L.en;
  const lines = parseTranscript(transcript);
  const pt = lines.filter((l) => l.role === "patient");
  const md = lines.filter((l) => l.role === "md" || l.role === "other");
  const all = lines.map((l) => l.text).join("\n");
  const ptText = norm(pt.map((l) => l.text).join(" "));
  const out = [];
  // Subjective
  out.push(`## ${T.s}`);
  if (pt[0]) out.push(`- **${T.cc}:** ${short(pt[0].text, 160)}`);
  const posText = ptText.replace(/\b(?:no|without|denies|pas de|pas d'|aucune?|sans)\s+[^,.;!?]+/g, " ");
  const sx = SYMPTOMS.filter((s) => s.re.test(posText)).map((s) => s[lang] || s.en);
  const v = extractVitals(all);
  if (sx.length) out.push(`- **${T.hpi}:** ${sx.join(", ")}${v.pain ? (lang === "fr" ? `; douleur ${v.pain}/10` : `; pain ${v.pain}/10`) : ""}.`);
  const negs = [];
  pt.forEach((l) => { const t = l.text; const re = lang === "fr" ? /\bpas de ([a-zà-ÿ' ]{3,30}?)(?:[,.;]|$)/gi : /\bno ([a-z ]{3,30}?)(?:[,.;]|$)/gi; let m; while ((m = re.exec(t))) { if (!/medical problems|problème|allergi/i.test(m[1])) negs.push(m[1].trim()); } });
  if (negs.length) out.push(`- **${T.neg}:** ${[...new Set(negs)].join(", ")}.`);
  const cond = CONDITIONS.filter((c) => c.re.test(norm(all))).map((c) => c[lang] || c.en);
  if (cond.length) out.push(`- **${T.pmh}:** ${cond.join(", ")}.`);
  else if (/no medical problems|aucun probleme|pas d.antecedent/.test(ptText)) out.push(`- **${T.pmh}:** ${lang === "fr" ? "aucun" : "none reported"}.`);
  const meds = MED_NAMES.filter((m) => ptText.includes(m));
  out.push(`- **${T.meds}:** ${meds.length ? meds.join(", ") : T.nomeds}.`);
  const alg = [];
  pt.forEach((l) => { const m = norm(l.text).match(/allergic to ([a-z-]+)|allergique (?:a|au|aux) (?:la |le |l')?([a-z-]+)/); if (m) alg.push(m[1] || m[2]); });
  (patient?.allergies || []).forEach((a) => alg.push(norm(a)));
  out.push(`- **${T.all}:** ${alg.length ? [...new Set(alg)].join(", ") : T.nka}.`);
  // Objective
  out.push(`## ${T.o}`);
  const vparts = [];
  const fr = lang === "fr"; const dec = (x) => (fr ? String(x).replace(".", ",") : x);
  if (v.temp) vparts.push(`T ${dec(v.temp)} °C`); if (v.hr) vparts.push(`${fr ? "FC" : "HR"} ${v.hr}`); if (v.sbp) vparts.push(`${fr ? "TA" : "BP"} ${v.sbp}/${v.dbp}`); if (v.rr) vparts.push(`${fr ? "FR" : "RR"} ${v.rr}`); if (v.spo2) vparts.push(`SpO₂ ${v.spo2}${fr ? " %" : "%"}`);
  out.push(`- **${T.vitals}:** ${vparts.length ? vparts.join(", ") : T.none}`);
  const examRe = /tender|guarding|rovsing|murphy|rebound|wheez|crackle|sibilance|crepitant|entree d.air|muscles accessoires|accessory|auscult|j.entends/;
  const exam = md.filter((l) => examRe.test(norm(l.text)));
  if (exam.length) exam.forEach((l) => out.push(`- **${T.exam}:** ${short(l.text.replace(/^(you're|you are)\s/i, "").replace(/^j'entends /i, ""), 180)}`));
  else out.push(`- **${T.exam}:** ${T.none}`);
  // Assessment
  out.push(`## ${T.a}`);
  const lower = norm(all);
  const dxLine = md.find((l) => /could be|probably|likely|looks like|consistent with|probablement|pourrait|ressemble/.test(norm(l.text)));
  if (/appendic/.test(lower)) out.push(`- ${lang === "fr" ? "Douleur en fosse iliaque droite avec fièvre et anorexie : appendicite aiguë suspectée" : "Right lower quadrant pain with fever and anorexia, concerning for acute appendicitis"} ${quote(dxLine ? dxLine.text : "appendicitis", lang)}`);
  else if (/mpoc|copd/.test(lower) && /exacerb/.test(lower)) out.push(`- ${lang === "fr" ? "Exacerbation aiguë de MPOC, probablement d'origine infectieuse" : "Acute exacerbation of COPD, likely infectious trigger"} ${quote(dxLine ? dxLine.text : "exacerbation", lang)}`);
  else if (dxLine) out.push(`- ${short(dxLine.text, 140)} ${quote(dxLine.text, lang)}`);
  else out.push(`- ${lang === "fr" ? "Impression clinique non énoncée dans la transcription : à compléter par le médecin" : "Clinical impression not stated in the transcript: physician to complete"}`);
  const vline = lines.find((l) => /temperature|temp|saturation|pouls|heart rate/.test(norm(l.text)));
  if (v.temp >= 38 && vline) out.push(`- ${lang === "fr" ? `Fièvre ${v.temp} °C` : `Fever ${v.temp} °C`}${v.hr > 100 ? (lang === "fr" ? ` et tachycardie ${v.hr}` : ` with tachycardia ${v.hr}`) : ""} ${quote(snippet(vline.text, /temp/), lang)}`);
  if (v.spo2 && v.spo2 < 92 && vline) out.push(`- ${lang === "fr" ? `Hypoxémie (SpO₂ ${v.spo2} %)` : `Hypoxemia (SpO₂ ${v.spo2}%)`}${v.rr > 24 ? (lang === "fr" ? ` avec tachypnée ${v.rr}/min` : ` with tachypnea ${v.rr}/min`) : ""} ${quote(snippet(vline.text, /saturation/), lang)}`);
  if (alg.length) { const al = pt.find((l) => /allerg/.test(norm(l.text))); if (al) out.push(`- ${lang === "fr" ? `Allergie : ${[...new Set(alg)].join(", ")}` : `Allergy: ${[...new Set(alg)].join(", ")}`} ${quote(snippet(al.text, /allerg/), lang)}`); }
  // Plan
  out.push(`## ${T.p}`);
  const orders = extractOrders(transcript, lang);
  if (orders.length) orders.forEach((o) => out.push(`- ${o.name} ${quote(o.quote, lang)}`));
  const reassess = md.find((l) => /reevaluer|reassess|re-evaluate|we'll know more|after the scan|apres les traitements/.test(norm(l.text)));
  if (reassess) out.push(`- ${lang === "fr" ? "Réévaluation après traitement et résultats" : "Reassess after results and treatment"} ${quote(reassess.text, lang)}`);
  if (!orders.length && !reassess) out.push(`- ${lang === "fr" ? "Aucun plan énoncé dans la transcription : à compléter" : "No plan stated in the transcript: physician to complete"}`);
  // Patient-friendly summary
  out.push(`## ${T.f}`);
  const name = patient ? patient.first : null;
  if (/appendic/.test(lower)) out.push(lang === "fr" ? `${name ? name + ", v" : "V"}otre douleur au ventre pourrait venir de l'appendice. Nous faisons des prises de sang et un scan. En attendant, ne mangez pas et ne buvez pas. Si c'est l'appendicite, une petite opération sera probablement nécessaire.` : `${name ? name + ", y" : "Y"}our belly pain may be coming from your appendix. We're doing blood tests and a CT scan. Please don't eat or drink for now. If it is appendicitis, you will most likely need a small keyhole operation.`);
  else if (/mpoc|copd/.test(lower)) out.push(lang === "fr" ? `${name ? name + ", v" : "V"}otre MPOC s'est aggravée, probablement à cause d'une infection. Vous recevez des nébulisations, de la prednisone et un antibiotique (doxycycline, sans sulfa). Nous vous réévaluons dans une heure; si ça ne s'améliore pas, vous serez admis en médecine.` : `${name ? name + ", y" : "Y"}our COPD has flared up, probably because of an infection. You're getting breathing treatments, prednisone and an antibiotic (doxycycline, which is safe with your sulfa allergy). We'll check again in an hour; if you're not better, you'll be admitted.`);
  else out.push(lang === "fr" ? "Votre médecin vous expliquera les résultats et la suite des soins." : "Your doctor will go over your results and next steps with you.");
  return out.join("\n");
}

/** RAMQ billing guidance (categories only, never code numbers). */
export function billingGuidance({ encounter, transcript = "", orders = [] }) {
  const out = [];
  const lower = norm(transcript);
  const isEd = !encounter || encounter.kind === "ED" && encounter.status !== "admitted";
  if (isEd) out.push({ category: "Emergency department visit", detail: "Examination in the emergency department by the treating physician. Pick the examination level (complete vs. ordinary) that the documented history and exam support." });
  else out.push({ category: "Inpatient visit", detail: "Hospital visit by the attending (principal or follow-up visit depending on the day of stay)." });
  const h = new Date().getHours(); const day = new Date().getDay();
  if (h >= 20 || h < 8 || day === 0 || day === 6) out.push({ category: "Time-of-day supplement", detail: `Seen at ${D.fmtClock(Date.now())}${day === 0 || day === 6 ? " on a weekend" : ""}: an evening, night or weekend supplement may apply under the current agreement.` });
  if (orders.some((o) => o.type === "consult") || /surgery team|admettre|consult/.test(lower)) out.push({ category: "Consultation request", detail: "The consultant bills the consultation. The requesting physician documents the reason for the request; it is not billed separately." });
  if (orders.some((o) => /neb|fluid|oxygen/i.test(o.name))) out.push({ category: "Treatments in the ED", detail: "Nebulized treatments, IV fluids and oxygen given by nursing are part of the visit; they are not billed separately by the physician." });
  if (/rovsing|guarding|wheez|sibilance/.test(lower)) out.push({ category: "Documentation", detail: "The note documents a focused history, vitals and a targeted exam, which supports the examination level. Add total time if your agreement uses time-based billing." });
  return out;
}

/* =================================================================== */
/* Referral fax parser                                                  */
/* =================================================================== */
export const PRIORITY = {
  A: "Within 3 days", B: "Within 10 days", C: "Within 28 days", D: "Within 3 months", E: "Within 12 months",
};
export const priorityLabel = (u) => { const c = String(u || "").match(/\b([A-E])\b/); return c ? `${c[1]}: ${PRIORITY[c[1]].toLowerCase()}` : u || ""; };

const SPECIALTY_FR = { cardiologie: "Cardiology", "chirurgie generale": "General surgery", chirurgie: "Surgery", neurologie: "Neurology", gastroenterologie: "Gastroenterology", orthopedie: "Orthopedics", pneumologie: "Respirology", endocrinologie: "Endocrinology", dermatologie: "Dermatology" };
const LANG_CODE = { punjabi: "pa", english: "en", anglais: "en", francais: "fr", french: "fr", arabic: "ar", arabe: "ar", spanish: "es", espagnol: "es", chinese: "zh", mandarin: "zh", haitian: "ht", creole: "ht", tagalog: "tl", hindi: "hi" };
export function langCode(s = "") { const n = norm(s); for (const [k, v] of Object.entries(LANG_CODE)) if (n.includes(k)) return v; return n.length === 2 ? n : null; }

export function maskCard(c = "") {
  const s = String(c).replace(/\s+/g, "").toUpperCase();
  if (s.length < 6) return c;
  return `${s.slice(0, 4)} •••• ••${s.slice(-2)}`;
}

export const REFERRAL_FIELDS = [
  ["patient_name", "Patient name"], ["dob", "Date of birth"], ["health_card", "Health card (RAMQ)"], ["sex", "Sex"], ["language", "Language"],
  ["referral_type", "Referral type"], ["specialty", "Specialty / service"], ["reason", "Reason"], ["urgency", "Urgency"],
  ["referring_clinician", "Referring clinician"], ["contact", "Contact"], ["allergies", "Allergies"], ["medications", "Medications"],
];

export function requiredFor(type = "") {
  const t = norm(type);
  if (/pharm/.test(t)) return ["patient_name", "dob", "reason", "contact"];
  if (/home|domicile|clsc/.test(t)) return ["patient_name", "reason", "contact"];
  return ["patient_name", "dob", "health_card", "reason", "urgency", "referring_clinician", "contact"];
}
export function missingFields(x) { return requiredFor(x.referral_type).filter((k) => !String(x[k] || "").trim()); }

export function parseReferral(raw = "", from = "") {
  const text = String(raw);
  const n = norm(text);
  const grab = (re) => { const m = text.match(re); return m ? m[1].trim() : ""; };
  const x = {};
  x.patient_name = grab(/(?:Patiente?|Pt|Nom du patient|Patient name|Name)\s*[:：]\s*([A-Za-zÀ-ÿ'’-]+(?:[ ][A-Za-zÀ-ÿ'’-]+){0,3}?)(?=\s{2,}|\s*,|\s+(?:DDN|DOB)\b|\s*\n|$)/);
  x.dob = grab(/(?:DDN|DOB|Date de naissance|Date of birth|Né(?:e)? le)\s*[:：]?\s*(\d{4}-\d{2}-\d{2})/i);
  const card = grab(/(?:RAMQ|NAM|Health card)\s*[:：#]?\s*([A-Z]{4}\s?\d{4}\s?\d{4})/i);
  x.health_card = card ? maskCard(card) : "";
  const sx = text.match(/,\s*\d{1,3}\s*([FM])\b/) || text.match(/\b(?:Sexe|Sex)\s*[:：]\s*([FMfm])/);
  x.sex = sx ? sx[1].toUpperCase() : /\bpatiente\b|\bmme\b|\bmrs\b|\bms\b/i.test(text) ? "F" : "";
  const lang = grab(/(?:Preferred language|Langue(?: préférée)?|Language)\s*[:：]\s*([^.\n]+)/i);
  x.language = lang || (/[éèàç]|\bmotif\b|\bpatiente?\b\s*:/i.test(text) ? "Français" : "English");
  // type & specialty
  if (/clarification|ordonnance|pharmac/.test(n) && /pharmac/.test(norm(from + " " + text))) x.referral_type = "Pharmacy clarification";
  else if (/home care|soins a domicile|clsc|pab\b|nursing visits/.test(n)) x.referral_type = "Home care coordination";
  else if (/follow-?up visit|suivi|wound check|walk-in|sans rendez-vous|nurse clinic/.test(n) && !/referral to|reference\s*[—-]/.test(n)) x.referral_type = "Primary care follow-up";
  else x.referral_type = "Specialist consultation";
  const spec = grab(/(?:RÉFÉRENCE|REFERENCE|Référence|Referral)\s*(?:—|-|–|to|à|en)\s*([A-Za-zÀ-ÿ ]{3,40})/);
  x.specialty = spec ? (SPECIALTY_FR[norm(spec).trim()] || spec.replace(/\s+$/, "")) : x.referral_type === "Pharmacy clarification" ? "Pharmacy" : x.referral_type === "Home care coordination" ? "CLSC home care" : x.referral_type === "Primary care follow-up" ? "Primary care" : "";
  x.reason = grab(/(?:Motif|Reason|Raison|Préoccupation|Concern)\s*[:：]\s*([^\n]+)/i) || short(text.split("\n").slice(1).filter((l) => !/^\s*(contact|tél|tel|phone)\b/i.test(l)).join(" "), 220);
  // urgency
  const pr = grab(/(?:Priorité|Priority|Urgence|Urgency)\s*[:：]\s*([^\n]+)/i);
  const letter = pr.match(/\b([A-E])\b/);
  x.urgency = letter ? `${letter[1]}: ${PRIORITY[letter[1]].toLowerCase()}` : pr ? pr : x.referral_type === "Pharmacy clarification" ? "Same day: pharmacist is waiting to dispense" : x.referral_type === "Home care coordination" ? "Before discharge" : "";
  x.referring_clinician = grab(/(?:Médecin référent|Referring (?:physician|clinician|MD)|Pharmacien(?:ne)?|Pharmacist|Contact|Infirmière)\s*[:：]\s*([^,\n]+?)(?:,\s*(?:\d{3}|social|ext|permis)|\s{2,}|\n|$)/i) || (/^dr\.?|dre\b/i.test(from) ? from.split(",")[0] : "");
  const phone = text.match(/(?:Tél|Tel|Phone|Téléphone)\.?\s*[:：]?\s*(\d{3}[-. ]\d{3}[-. ]\d{4})/i) || text.match(/(\d{3}-\d{3}-\d{4})/);
  const ext = text.match(/\b(?:ext|poste)\.?\s*(\d{2,5})/i);
  x.contact = phone ? phone[1] : ext ? `Ext. ${ext[1]} (${from})` : "";
  const alg = grab(/Allergies?\s*[:：]\s*([^.\n]+)/i);
  x.allergies = /none|aucune|nka|nkda/i.test(alg) ? "None known" : alg;
  x.medications = grab(/(?:Médication|Medications?|Meds|Ordonnances actives|Rx)\s*[:：]\s*([^\n]+?)\.?\s*(?:Preferred|$|\n)/im);
  x.missing_fields = missingFields(x);
  x.next_action = nextActionFor(x);
  return x;
}

export function nextActionFor(x) {
  const t = norm(x.referral_type);
  if (/pharm/.test(t)) return "Send to a physician today to confirm or change the prescription, then fax the answer to the pharmacy.";
  if (/home|clsc/.test(t)) return "Send to social work to match the patient and coordinate the discharge summary, medication list and wound care orders.";
  if (/primary|follow/.test(t)) return "Book the first open slot at a nurse or walk-in clinic and confirm with the patient.";
  const pr = String(x.urgency || "").match(/\b([A-E])\b/);
  return `Ask the clerk to book ${x.specialty || "the specialty"} clinic${pr ? ` ${PRIORITY[pr[1]].toLowerCase()} (priority ${pr[1]})` : ""} and confirm with the referring clinician.`;
}

/** Normalise an AI extraction into our field set. */
export function normaliseExtraction(ai, fallback) {
  const x = { ...fallback };
  for (const [k] of REFERRAL_FIELDS) {
    let v = ai?.[k];
    if (Array.isArray(v)) v = v.join(", ");
    if (v != null && String(v).trim() && !/^(null|unknown|n\/a|none provided)$/i.test(String(v).trim())) x[k] = String(v).trim();
  }
  if (x.health_card && /\d{4}\s?\d{4}/.test(x.health_card) && !/•/.test(x.health_card)) x.health_card = maskCard(x.health_card);
  if (x.urgency && /^[A-E]\b/.test(x.urgency.trim()) && !/within|day|month/i.test(x.urgency)) x.urgency = priorityLabel(x.urgency);
  x.missing_fields = Array.isArray(ai?.missing_fields) ? ai.missing_fields.filter((f) => typeof f === "string") : missingFields(x);
  // recompute against our own required list so the UI is consistent
  x.missing_fields = [...new Set([...missingFields(x)])];
  x.next_action = ai?.next_action || nextActionFor(x);
  return x;
}

/** Find a patient by name + dob (accent/case-insensitive). */
export function findPatient(patients, name, dob) {
  const nn = norm(name).replace(/\s+/g, " ").trim(); if (!nn) return null;
  return patients.find((p) => norm(`${p.first} ${p.last}`) === nn && (!dob || p.dob === dob)) || null;
}

/* =================================================================== */
/* Agents                                                               */
/* =================================================================== */
export const AGENTS = [
  { key: "triage", name: "Triage copilot", actor: "agent:Aster Copilot (triage)", desc: "Suggests a CTAS level, red flags and nurse-initiated orders from the complaint and vitals.", re: /triage/i },
  { key: "flow", name: "Bed & flow", actor: "agent:Aster Copilot", desc: "Matches admitted patients to free beds, escalates cleaning and moves results-ready patients to decision.", re: /bed|flow|copilot|command/i },
  { key: "discharge", name: "Discharge", actor: "agent:Discharge Planner", desc: "Predicts likely discharges and assigns barrier owners (pharmacy, social work, rides) early in the day.", re: /discharg/i },
  { key: "scribe", name: "Ambient scribe", actor: "agent:Ambient Scribe", desc: "Drafts bilingual SOAP notes and suggested orders from the visit conversation for physician signature.", re: /scrib/i },
  { key: "followup", name: "Follow-up nurse", actor: "agent:Follow-up Nurse", desc: "Checks in with patients after discharge in the Aster Care app and escalates to a physician when they report getting worse.", re: /follow|aster care/i },
  { key: "referral", name: "Referral & fax", actor: "agent:Referral & Fax", desc: "Reads incoming faxes, extracts the referral fields and routes them to booking or the right team.", re: /referr|fax/i },
  { key: "staffing", name: "Staffing", actor: "agent:Staffing", desc: "Forecasts census by shift and ranks nurses to fill gaps without overtime or agency cost.", re: /staff|shift/i },
  { key: "divert", name: "Diversion", actor: "agent:Diversion", desc: "Offers low-acuity waiting patients a same-day clinic, pharmacy or video slot and books it.", re: /divers|divert|clinic/i },
];
export const AUTONOMY = [
  { value: "suggest", label: "Suggest only" },
  { value: "approve", label: "Act with approval" },
  { value: "auto", label: "Autonomous for low-risk" },
];
/** Which roster agent an audit actor belongs to (null for non-agents). */
export function agentKeyFor(actor = "") {
  if (!String(actor).startsWith("agent:")) return null;
  const name = actor.slice(6);
  const order = ["scribe", "referral", "followup", "discharge", "staffing", "divert", "triage", "flow"];
  for (const k of order) { const a = AGENTS.find((x) => x.key === k); if (a.re.test(name)) return k; }
  return "flow";
}
export function actorType(actor = "") {
  if (String(actor).startsWith("agent:")) return "agent";
  if (actor === "system") return "system";
  if (actor === "patient") return "patient";
  return "user";
}

/* =================================================================== */
/* CSV                                                                  */
/* =================================================================== */
export function toCsv(rows, cols) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.map((c) => esc(c.label)).join(","), ...rows.map((r) => cols.map((c) => esc(c.get(r))).join(","))].join("\n");
}

export const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
