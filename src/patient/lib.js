// Aster Care helpers: storage, ER queue estimates, plain-language labels,
// the AI doctor prompt and the deterministic offline interviewer.
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import * as AI from "../lib/ai.js";

/* ------------------------------ storage ------------------------------ */
const KEY = "aster.care.patient.v1";
export function savedPatientId() { try { return localStorage.getItem(KEY) || null; } catch (e) { return null; } }
export function savePatientId(id) { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch (e) { /* storage unavailable */ } }

/* ------------------------------ labels ------------------------------- */
export const PLAIN_STATUS = {
  arriving: "We're expecting you",
  waiting_triage: "Waiting to see the triage nurse",
  waiting_md: "Waiting to see a doctor",
  in_treatment: "With your care team",
  awaiting_results: "Waiting for your test results",
  decision: "Your doctor is deciding next steps",
  boarding: "Admitted, waiting for a bed upstairs",
  admitted: "Admitted to hospital",
  discharged: "Discharged",
  diverted: "Moved to a clinic visit",
  lwbs: "Left before being seen",
};
export const STATUS_HELP = {
  arriving: "Show this screen or say your name at the triage desk when you get there.",
  waiting_triage: "A nurse will check your vital signs and ask a few questions.",
  waiting_md: "People with more urgent needs are seen first, so your place can change.",
  in_treatment: "A doctor or nurse is looking after you now.",
  awaiting_results: "Most results take 1 to 2 hours. Your team will come back to you.",
  decision: "Your doctor will explain the plan soon.",
  boarding: "You've been admitted. Staff are finding you a bed on a unit.",
};
export const VISIT_STEPS = [
  { key: "arrive", label: "Arrive", statuses: ["arriving"] },
  { key: "triage", label: "Triage", statuses: ["waiting_triage"] },
  { key: "doctor", label: "Doctor", statuses: ["waiting_md", "in_treatment"] },
  { key: "tests", label: "Tests", statuses: ["awaiting_results"] },
  { key: "next", label: "Next steps", statuses: ["decision", "boarding", "admitted", "discharged"] },
];
export const KIND_LABEL = { care_plan: "Care plan", rx_renewal: "Prescription renewal", escalation: "Follow-up", lab: "Lab result" };

/* ------------------------------ ER queue ----------------------------- */
const WAITING = new Set(["arriving", "waiting_triage", "waiting_md"]);
export const MIN_PER_PATIENT = 9; // average physician throughput across the ED team, per patient ahead
const levelOf = (e) => e.ctas || D.assessCtas({ cc: e.cc || "", age: D.ageOf(D.patientOf(e)?.dob) || 40 }).level;
const round5 = (m) => Math.max(5, Math.round(m / 5) * 5);

/** Live ER load for a walk-in less-urgent (CTAS 4) patient arriving now. */
export function erLoad(encounters, beds) {
  const m = D.computeMetrics(encounters, beds);
  const waiting = encounters.filter((e) => e.kind === "ED" && WAITING.has(e.status));
  const ahead = waiting.filter((e) => levelOf(e) <= 4).length;
  return { waiting: m.waitingTriage + m.waitingMd, ahead, estMin: round5(15 + ahead * MIN_PER_PATIENT), metrics: m };
}
/** Place in line for one waiting encounter: everyone more urgent, plus same level who arrived first. */
export function placeInLine(e, encounters) {
  if (!WAITING.has(e.status)) return null;
  const mine = levelOf(e);
  const ahead = encounters.filter((x) => x.id !== e.id && x.kind === "ED" && WAITING.has(x.status)).filter((x) => { const l = levelOf(x); return l < mine || (l === mine && x.arrivalAt < e.arrivalAt); }).length;
  return { position: ahead + 1, ahead, estMin: round5(10 + ahead * MIN_PER_PATIENT), level: mine };
}
export const fmtMins = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + String(m % 60).padStart(2, "0") : ""}`);
export const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

/* ------------------------------ text utils --------------------------- */
const NEG = /(\bno\b|\bnot\b|\bnever\b|\bnone\b|n't|\bwithout\b|\bpas\b|\bsans\b|\baucun|\bjamais\b|\bnon\b)/i;
/** True if any keyword is mentioned without a negation shortly before it. */
export function mentions(text = "", re) {
  const t = String(text).toLowerCase();
  const g = new RegExp(re.source, "gi"); let m;
  while ((m = g.exec(t))) { const before = t.slice(Math.max(0, m.index - 16), m.index); if (!NEG.test(before)) return true; }
  return false;
}
export const saysNo = (t = "") => /^\s*(no|nope|non|none|nah|not really|pas vraiment|aucun|jamais|never)\b/i.test(t);
export const saysYes = (t = "") => /^\s*(yes|yeah|yep|oui|ouais|a (bit|little)|un peu|sometimes|parfois)\b/i.test(t);
const yesish = (t, re) => !saysNo(t) && (saysYes(t) || mentions(t, re));
export const looksFrench = (t = "") => /\b(je|j'ai|j’ai|mal|depuis|bonjour|oui|non|merci|brûl|uriner|pipi|où|aller|urgence|ordonnance|résultats|douleur|poitrine|souffle)\b/i.test(t);

/* ------------------------------ AI doctor ---------------------------- */
export const CARE_SHAPE = '{"reply":"string, max 90 words","triage":"emergency|urgent|routine|selfcare|null","plan":null,"care_setting":"self_care|pharmacist|clinic_today|virtual|er_now|null"}  where plan, when ready, is {"title":"string","assessment":"string","plan":["string"],"rx":"string or null","risk":"low|med|high","summary_for_md":"string"}';

export function careSystem(p) {
  const lang = D.LANGS[p.lang] || "English";
  return `You are Aster Care, a free 24/7 AI primary-care doctor for people in Québec, Canada. You work under licensed Québec physicians: every plan you propose is reviewed and signed by a physician (Collège des médecins du Québec) before it takes effect, and you tell the patient this when you propose one.
How you work:
- Reply in the patient's language: ${lang}. If the patient writes in a different language, reply in the language of their latest message.
- Be warm, calm and plain (grade 6 reading level). "reply" is at most 90 words. No emoji, no markdown headings, no exclamation marks.
- Ask ONE focused question per turn, like a good family doctor: onset and duration, severity, associated symptoms, red flags, relevant history. Never ask about something already in the record or the conversation.
- Screen red flags early. Any sign of an emergency (chest pain or pressure, especially with shortness of breath, sweating or pain spreading to the arm or jaw; stroke signs; severe trouble breathing; anaphylaxis; heavy bleeding; fainting; confusion; suicidal thoughts) means: triage "emergency", care_setting "er_now", tell them to call 911 now and not to drive themselves, and ask nothing more. For thoughts of suicide also give 1-866-277-3553.
- Use the record. Never suggest a drug the patient is allergic to or its class (sulfa allergy: avoid trimethoprim-sulfamethoxazole; penicillin allergy: avoid amoxicillin and other penicillins). Check interactions with current medications. Refer to their labs when relevant.
- When you know enough (usually after 3 to 6 questions; immediately for simple requests such as a stable prescription renewal or explaining lab results), return "plan". Follow Canadian and Québec practice and generic drug names. "rx" has drug, dose, route, frequency, duration and refills, or null. "plan" steps are short and written for the patient. "summary_for_md" is a concise clinical summary for the reviewing physician: age, sex, key positives and negatives, red flags screened, allergies, medications, reasoning.
- With a plan, the reply says a physician will review and sign it shortly, and what to do if things get worse (Info-Santé 811, or 911).
- care_setting: self_care, pharmacist (Québec pharmacists treat many minor ailments), clinic_today, virtual, er_now; null while you are still asking questions.
- Never invent facts that are not in the record or the conversation.`;
}

export function recordText(p, encounters = []) {
  const age = D.ageOf(p.dob);
  const labs = (p.labs || []).map((l) => `${l.name} ${l.value} (ref ${l.ref})${l.ok ? "" : " OUT OF RANGE"}${l.t ? ", " + D.fmtDate(l.t) : ""}`).join("; ");
  const visits = encounters.filter((e) => e.patientId === p.id).sort((a, b) => b.arrivalAt - a.arrivalAt).slice(0, 3).map((e) => `${D.fmtDate(e.arrivalAt)} ${e.kind} ${e.cc} (${D.STATUS_LABEL[e.status] || e.status})`).join("; ");
  return [
    `Patient: ${D.fullName(p)}, ${age ?? "unknown age"} y, sex ${p.sex || "unknown"}, language ${D.LANGS[p.lang] || p.lang || "English"}.`,
    `Allergies: ${(p.allergies || []).join(", ") || "none known"}.`,
    `Medications: ${(p.meds || []).map((m) => `${m.name}${m.dose ? " " + m.dose : ""}`).join("; ") || "none"}.`,
    `Conditions: ${(p.conditions || []).join(", ") || "none"}.`,
    `Labs: ${labs || "none on file"}.`,
    `Family doctor: ${p.familyDoctor || "none (on the Québec GAP waitlist)"}.`,
    visits ? `Recent visits: ${visits}.` : "",
  ].filter(Boolean).join("\n");
}
export function transcript(messages = []) {
  return messages.slice(-30).map((m) => {
    const who = m.role === "patient" ? "Patient" : m.role === "md" ? `Physician (${m.author || "MD"})` : m.role === "system" ? "System" : "Aster";
    const card = m.card?.type === "plan" ? ` [plan sent for sign-off: ${m.card.proposal?.title || ""}, status ${m.card.status}]` : m.card?.type === "emergency" ? " [emergency card shown]" : m.card?.type === "checkin" ? " [check-in card]" : "";
    return `${who}: ${m.text || ""}${card}`;
  }).join("\n");
}

const TRIAGE = new Set(["emergency", "urgent", "routine", "selfcare"]);
const SETTINGS = new Set(["self_care", "pharmacist", "clinic_today", "virtual", "er_now"]);
function cleanTurn(o) {
  if (!o || typeof o.reply !== "string" || !o.reply.trim()) return null;
  let plan = null;
  if (o.plan && typeof o.plan === "object" && o.plan.title) {
    plan = {
      title: String(o.plan.title), assessment: String(o.plan.assessment || ""),
      plan: Array.isArray(o.plan.plan) ? o.plan.plan.map(String).filter(Boolean).slice(0, 8) : [],
      rx: o.plan.rx ? String(o.plan.rx) : null, risk: ["low", "med", "high"].includes(o.plan.risk) ? o.plan.risk : "med",
      summary_for_md: String(o.plan.summary_for_md || o.plan.assessment || ""),
    };
  }
  const triage = TRIAGE.has(o.triage) ? o.triage : null;
  const care = SETTINGS.has(o.care_setting) ? o.care_setting : triage === "emergency" ? "er_now" : null;
  return { reply: o.reply.trim(), triage, plan, care_setting: care, ask: !plan && triage !== "emergency" && /\?\s*$/.test(o.reply.trim()), source: "ai" };
}

/** One AI doctor turn. Returns a turn object or null when AI is unavailable. */
export async function aiTurn(p, thread, encounters) {
  const prompt = `PATIENT RECORD\n${recordText(p, encounters)}\n\nCONVERSATION SO FAR (oldest first)\n${transcript(thread.messages)}\n\nQuestions you have asked in this conversation since the last plan: ${sessionMsgs(thread.messages).filter((m) => m.role === "ai" && /\?/.test(m.text || "")).length}.\nWrite Aster's next turn.`;
  const out = await AI.json(prompt, { system: careSystem(p), shape: CARE_SHAPE });
  return cleanTurn(out);
}

/** Messages since the last finished plan / emergency / terminal turn. */
export function sessionMsgs(messages = []) {
  let i = messages.length - 1;
  for (; i >= 0; i--) { const m = messages[i]; if (m.card?.type === "plan" || m.card?.type === "emergency" || m.fb?.done || m.role === "system" || m.role === "md") break; }
  return messages.slice(i + 1);
}

/** Short clinical summary for the ED triage nurse when pre-registering. */
export async function triageSummary(p, thread, cc) {
  const all = thread?.messages || [];
  let li = all.length - 1; while (li >= 0 && all[li].role !== "patient") li--;
  const msgs = sessionMsgs(all.slice(0, li + 1));
  const age = D.ageOf(p.dob);
  const fallback = () => {
    const said = msgs.filter((m) => m.role === "patient").slice(-3).map((m) => m.text).join(" / ");
    return `${age ?? "?"} ${p.sex || ""}, pre-registered from the Aster app. Reason: ${cc}.${said ? ` Patient said: "${said}".` : ""} Allergies: ${(p.allergies || []).join(", ") || "none known"}. Meds: ${(p.meds || []).map((m) => m.name).join(", ") || "none"}. Conditions: ${(p.conditions || []).join(", ") || "none"}.`;
  };
  if (!thread || !msgs.length) return fallback();
  const t = await AI.text(`Write a 2 to 3 sentence pre-arrival summary for the ED triage nurse at Hôpital St-Laurent. Start with age and sex, then the complaint, onset, key positives and negatives, red flags screened, allergies and medications. Clinical English, no headings.\n\nRECORD\n${recordText(p)}\n\nREASON GIVEN: ${cc}\n\nCHAT\n${transcript(msgs)}`);
  return t && t.trim() ? t.trim() : fallback();
}

/* ------------------------- offline interviewer ----------------------- */
const tr = (fr, en, fr2) => (fr ? fr2 : en);
const EMERG = /(chest pain|chest pressure|chest tight|pain in (my )?chest|douleur (à la |a la )?poitrine|douleur thoracique|serrement|can'?t breathe|cannot breathe|struggling to breathe|je n'arrive pas à respirer|face (is )?droop|slurred|can'?t move my|stroke|avc|suicid|kill myself|me tuer|throat (is )?closing|tongue swell|unconscious|passed out|fainted|évanoui|bleeding a lot|won'?t stop bleeding|saigne beaucoup)/i;
export function detectScenario(t = "") {
  if (EMERG.test(t) || D.assessCtas({ cc: t }).level <= 2) return "emergency";
  if (/(pee|urin|burning when|brûl|pipi|bladder|uti\b|cystit|infection urinaire)/i.test(t)) return "uti";
  if (/(inhaler|puffer|ventolin|salbutamol|pompe|asthm)/i.test(t) && /(renew|refill|renouvel|out of|run out|more|need|besoin)/i.test(t)) return "asthma";
  if (/(blood test|lab|results|bloodwork|prise de sang|résultats|analyses)/i.test(t)) return "labs";
  if (/(where should i go|er or clinic|which (place|service)|urgence ou (la )?clinique|où (devrais|dois)-je aller|where to go)/i.test(t)) return "where";
  return "gen";
}

function pickLang(p, text) { return p.lang === "fr" || looksFrench(text); }
const allergic = (p, re) => (p.allergies || []).some((a) => re.test(a));

function emergencyTurn(fr, text) {
  const suicidal = /suicid|kill myself|me tuer/i.test(text);
  return {
    reply: suicidal
      ? tr(fr, "Thank you for telling me. You deserve help right now. Call 911, or call or text 1-866-277-3553 (Québec suicide prevention, 24/7). If you can, stay with someone you trust while you wait.", "Merci de me le dire. Vous méritez de l'aide maintenant. Appelez le 911, ou le 1-866-277-3553 (prévention du suicide, 24/7). Si possible, restez avec une personne de confiance.")
      : tr(fr, "This could be serious, and it needs to be checked right away. Please call 911 now. Don't drive yourself. If you have no allergy to it and haven't been told to avoid it, the 911 operator may ask you to chew aspirin. Unlock your door and sit down while you wait.", "Cela peut être grave et doit être vérifié tout de suite. Appelez le 911 maintenant. Ne conduisez pas vous-même. Le répartiteur du 911 pourrait vous demander de croquer une aspirine si vous n'y êtes pas allergique. Déverrouillez la porte et assoyez-vous en attendant."),
    triage: "emergency", plan: null, care_setting: "er_now", ask: false, fb: { done: true, s: "emergency" },
  };
}

/** Deterministic interviewer used when AI is offline. Same output shape as aiTurn. */
export function fallbackTurn(p, thread, text) {
  const fr = pickLang(p, text);
  const age = D.ageOf(p.dob) ?? 40;
  const sexWord = p.sex === "F" ? "F" : p.sex === "M" ? "M" : "";
  const session = sessionMsgs(thread?.messages || []);
  const lastAsk = [...session].reverse().find((m) => m.role === "ai" && m.fb && !m.fb.done);
  if (EMERG.test(text) || D.assessCtas({ cc: text, age }).level <= 2) return emergencyTurn(fr, text);

  let st;
  if (lastAsk) { st = { ...lastAsk.fb, a: [...(lastAsk.fb.a || []), text] }; st.step = (st.step || 0) + 1; }
  else st = { s: detectScenario(text), step: 0, a: [], cc: text };
  if (st.s === "where" && st.step === 1) { // the answer tells us what is going on: route into a scenario
    const s2 = detectScenario(text);
    if (s2 === "emergency") return emergencyTurn(fr, text);
    st = s2 === "gen" || s2 === "where" ? { s: "gen", step: 1, a: [text], cc: text } : { s: s2, step: 0, a: [], cc: text };
  }
  const ask = (reply) => ({ reply, triage: null, plan: null, care_setting: null, ask: true, fb: st });
  const done = (o) => ({ ask: false, ...o, fb: { ...st, done: true } });
  const allergyLine = `Allergies: ${(p.allergies || []).join(", ") || "none known"}. Meds: ${(p.meds || []).map((m) => m.name).join(", ") || "none"}.`;

  /* ----- burning urination ----- */
  if (st.s === "uti") {
    if (st.step === 0) return ask(tr(fr, "I'm sorry, that's uncomfortable. Let's sort it out. Do you have a fever, chills, or pain in your back or side?", "Désolé, c'est très inconfortable. On va régler ça. Avez-vous de la fièvre, des frissons ou une douleur au dos ou sur le côté?"));
    if (st.step === 1) return ask(p.sex === "F"
      ? tr(fr, "Thanks. Is there any chance you could be pregnant?", "Merci. Est-il possible que vous soyez enceinte?")
      : tr(fr, "Thanks. Have you noticed any discharge from the penis, or had a new sexual partner in the last few months?", "Merci. Avez-vous remarqué un écoulement du pénis, ou eu un nouveau partenaire sexuel dans les derniers mois?"));
    if (st.step === 2) return ask(tr(fr, "Got it. Have you seen blood in your urine, or had a bladder infection before?", "Compris. Avez-vous vu du sang dans votre urine, ou déjà eu une infection urinaire?"));
    const [a0, a1, a2] = st.a;
    const upper = yesish(a0, /(fever|fièvre|chill|frisson|back|dos|side|côté|flank|38|39|40)/);
    const pregnant = p.sex === "F" && yesish(a1, /(pregnan|enceinte|maybe|peut-être|possible)/);
    const sti = p.sex !== "F" && yesish(a1, /(discharge|écoulement|partner|partenaire)/);
    const blood = yesish(a2, /(blood|sang)/);
    const summaryBase = `${age} ${sexWord}, dysuria ("${st.cc}"). Fever/chills/flank pain: ${upper ? "YES" : "no"} ("${a0}"). ${p.sex === "F" ? `Pregnancy possible: ${pregnant ? "yes" : "no"}` : `Urethral discharge or new partner: ${sti ? "yes" : "no"}`} ("${a1}"). Hematuria or prior UTI: "${a2}". ${allergyLine}`;
    if (upper) return done({
      reply: tr(fr, "Thanks for answering. Fever or back pain with these symptoms can mean the infection has reached the kidneys, so you should be examined today. I've asked a physician to review this now. You can book a same-day clinic visit below. Go to the ER if you vomit, can't keep fluids down or feel faint.", "Merci. De la fièvre ou une douleur au dos avec ces symptômes peut indiquer une infection des reins : il faut être examiné aujourd'hui. J'ai demandé à un médecin de réviser votre dossier. Vous pouvez réserver une visite en clinique aujourd'hui ci-dessous. Allez à l'urgence si vous vomissez ou vous sentez faible."),
      triage: "urgent", care_setting: "clinic_today",
      plan: { title: tr(fr, "Possible kidney infection: exam today", "Possible infection des reins : examen aujourd'hui"), assessment: "Dysuria with fever, chills or flank pain: rule out pyelonephritis. Needs same-day examination and urine culture before antibiotics.", plan: [tr(fr, "See a doctor today: book a same-day clinic visit", "Voir un médecin aujourd'hui : réservez une visite en clinique"), tr(fr, "Give a urine sample at the clinic (urine culture)", "Donnez un échantillon d'urine à la clinique (culture d'urine)"), tr(fr, "Drink water regularly; acetaminophen for fever or pain", "Buvez de l'eau régulièrement; acétaminophène pour la fièvre ou la douleur"), tr(fr, "Go to the ER if you vomit, can't keep fluids down or feel faint", "Allez à l'urgence si vous vomissez ou vous sentez faible")], rx: null, risk: "high", summary_for_md: summaryBase + " Proposed: same-day exam, urine culture, physician to choose antibiotic." },
    });
    if (pregnant) return done({
      reply: tr(fr, "Thank you. Bladder infections in pregnancy need a urine test and a physician's choice of antibiotic, so I've sent this to a physician now and suggest a clinic visit today. Drink plenty of water. If you get a fever, back pain or cramps, go to the ER.", "Merci. Pendant la grossesse, une infection urinaire demande un test d'urine et un antibiotique choisi par un médecin. J'ai transmis votre dossier à un médecin et je vous suggère une visite en clinique aujourd'hui. Si vous avez de la fièvre, mal au dos ou des crampes, allez à l'urgence."),
      triage: "urgent", care_setting: "clinic_today",
      plan: { title: tr(fr, "Bladder symptoms in pregnancy", "Symptômes urinaires pendant la grossesse"), assessment: "Possible cystitis in pregnancy: urine culture and physician-selected antibiotic.", plan: [tr(fr, "Clinic visit today with a urine culture", "Visite en clinique aujourd'hui avec culture d'urine"), tr(fr, "Physician will choose an antibiotic that is safe in pregnancy", "Le médecin choisira un antibiotique sécuritaire pendant la grossesse"), tr(fr, "Drink plenty of water", "Buvez beaucoup d'eau")], rx: null, risk: "med", summary_for_md: summaryBase },
    });
    const nitroOk = !allergic(p, /nitrofurant|macrobid/i);
    const days = p.sex === "F" ? 5 : 7;
    const rx = nitroOk ? `Nitrofurantoin (Macrobid) 100 mg PO twice daily with food × ${days} days, no refills`
      : allergic(p, /sulfa|sulfonamide|septra|bactrim/i) ? "Fosfomycin 3 g PO single dose" : `Trimethoprim-sulfamethoxazole DS 1 tab PO twice daily × ${p.sex === "F" ? 3 : 7} days`;
    const why = allergic(p, /sulfa|sulfonamide/i) ? " Sulfa allergy on file: trimethoprim-sulfamethoxazole avoided." : "";
    const drug = rx.split(" (")[0].split(" ")[0];
    return done({
      reply: tr(fr, `Thanks, that helps. This sounds like a bladder infection. I've written a plan with ${drug.toLowerCase()}${why ? ", an antibiotic that is safe with your sulfa allergy" : ""}. A Québec physician will review and sign it shortly, then the prescription goes to your pharmacy. If you get a fever, back pain or start vomiting, tell me or call 811.`, `Merci, ça m'aide. Cela ressemble à une infection de la vessie. J'ai préparé un plan avec de la ${drug.toLowerCase()}${why ? ", un antibiotique sans danger avec votre allergie aux sulfamides" : ""}. Un médecin du Québec va le réviser et le signer sous peu, puis l'ordonnance ira à votre pharmacie. Si vous avez de la fièvre, mal au dos ou vomissez, écrivez-moi ou appelez le 811.`),
      triage: "routine", care_setting: null,
      plan: {
        title: p.sex === "F" ? tr(fr, "Bladder infection (cystitis)", "Infection de la vessie (cystite)") : tr(fr, "Bladder infection (cystitis), 7-day treatment", "Infection de la vessie (cystite), traitement de 7 jours"),
        assessment: `${p.sex === "F" ? "Uncomplicated" : "Afebrile"} cystitis, no fever or flank pain.${p.sex === "F" ? "" : " Male: 7-day course and urine culture."}${why}`,
        plan: [
          tr(fr, `Take ${drug.toLowerCase()} as prescribed${nitroOk ? `, twice a day with food for ${days} days` : ""}`, `Prenez la ${drug.toLowerCase()} comme prescrit${nitroOk ? `, deux fois par jour avec de la nourriture pendant ${days} jours` : ""}`),
          ...(p.sex !== "F" ? [tr(fr, "Give a urine sample at a CLSC or clinic lab before your first dose if you can", "Donnez un échantillon d'urine au CLSC ou à la clinique avant la première dose si possible")] : []),
          ...(sti ? [tr(fr, "Get a urine test for chlamydia and gonorrhea", "Faites un test d'urine pour la chlamydia et la gonorrhée")] : []),
          tr(fr, "Drink plenty of water; acetaminophen can ease the burning", "Buvez beaucoup d'eau; l'acétaminophène peut soulager la brûlure"),
          tr(fr, "Get help today if you get a fever, back pain or vomiting", "Consultez aujourd'hui si vous avez de la fièvre, mal au dos ou vomissez"),
        ],
        rx, risk: p.sex === "F" && !blood ? "low" : "med",
        summary_for_md: `${summaryBase} Assessment: afebrile cystitis. Proposed ${rx}.${why}${sti ? " STI NAAT advised." : ""}`,
      },
    });
  }

  /* ----- asthma inhaler renewal ----- */
  if (st.s === "asthma") {
    const med = (p.meds || []).find((m) => /salbut|ventolin|inhal|budes|symbicort|fluticas|puffer/i.test(m.name));
    const medName = med ? med.name : "salbutamol inhaler";
    if (st.step === 0) return ask(tr(fr, `Happy to help with your ${medName.split(" ")[0].toLowerCase()} renewal. First, are you having any trouble breathing right now?`, `Avec plaisir pour le renouvellement de votre ${medName.split(" ")[0].toLowerCase()}. D'abord, avez-vous de la difficulté à respirer en ce moment?`));
    if (st.step === 1) {
      if (yesish(st.a[0], /(trouble|hard|difficult|short|tight|wheez|difficulté|essouffl|siffl|serr)/)) return done({
        reply: tr(fr, "Use your blue inhaler now: 2 to 4 puffs, one at a time. If you can't speak in full sentences, your lips look blue, or you're not better in 15 minutes, call 911. I can tell the ER at Hôpital St-Laurent you're coming.", "Prenez votre pompe bleue maintenant : 2 à 4 inhalations, une à la fois. Si vous ne pouvez pas faire de phrases complètes, si vos lèvres bleuissent ou si ça ne va pas mieux en 15 minutes, appelez le 911. Je peux prévenir l'urgence de l'Hôpital St-Laurent."),
        triage: "urgent", care_setting: "er_now", plan: null,
      });
      return ask(tr(fr, "Good. How many days a week do you use it, and does asthma wake you up at night?", "Bien. Combien de jours par semaine l'utilisez-vous, et l'asthme vous réveille-t-il la nuit?"));
    }
    if (st.step === 2) return ask(tr(fr, "Thanks. In the past year, did you need the ER or prednisone pills for your asthma?", "Merci. Dans la dernière année, avez-vous eu besoin de l'urgence ou de comprimés de prednisone pour votre asthme?"));
    const use = st.a[1] || ""; const n = parseInt((use.match(/\d+/) || [])[0] || "0", 10);
    const nights = mentions(use, /(night|nuit|wake|woke|réveil)/) && !/(no|not|never|pas|jamais)[^.,]{0,20}(night|nuit|wake|réveil)/i.test(use) && !/(night|nuit|wake|réveil)[^.,]{0,12}(no|never|pas|jamais)/i.test(use);
    const poor = n >= 3 || /(daily|every day|tous les jours|chaque jour|often|souvent|a lot|beaucoup)/i.test(use) || nights;
    const severe = yesish(st.a[2], /(er\b|emerg|urgence|prednis|steroid|cortico|hospital|hôpital)/);
    const rx = `${/salbut|ventolin/i.test(medName) || !med ? "Salbutamol 100 mcg/dose MDI" : medName}, 2 puffs inhaled every 4–6 h as needed, 1 inhaler, 2 refills`;
    return done({
      reply: poor
        ? tr(fr, "Thanks. I've drafted your renewal. Using your reliever this often means your asthma isn't fully controlled, so I've asked the physician to consider a daily preventer inhaler too. They'll review and sign shortly, then it goes to your pharmacy. If your inhaler stops helping, call 911.", "Merci. J'ai préparé votre renouvellement. Utiliser votre pompe aussi souvent veut dire que l'asthme n'est pas bien contrôlé : j'ai demandé au médecin d'envisager une pompe préventive quotidienne. Il va réviser et signer sous peu, puis l'ordonnance ira à votre pharmacie. Si la pompe n'aide plus, appelez le 911.")
        : tr(fr, "Thanks. Your asthma sounds well controlled. I've drafted a renewal of your salbutamol inhaler. A Québec physician will review and sign it shortly, then it goes to your pharmacy. If your inhaler stops helping or you're short of breath at rest, call 911.", "Merci. Votre asthme semble bien contrôlé. J'ai préparé le renouvellement de votre pompe de salbutamol. Un médecin du Québec va le réviser et le signer sous peu, puis l'ordonnance ira à votre pharmacie. Si la pompe n'aide plus ou si vous êtes essoufflé au repos, appelez le 911."),
      triage: "routine", care_setting: poor ? "virtual" : null,
      plan: {
        title: tr(fr, "Asthma inhaler renewal", "Renouvellement de la pompe pour l'asthme"),
        assessment: poor ? "Asthma not well controlled (reliever ≥ 3 days/week or night symptoms). Consider ICS-containing controller per Canadian Thoracic Society guidance." : "Mild asthma, well controlled on as-needed salbutamol.",
        plan: [tr(fr, "Renew salbutamol: 2 puffs when you have symptoms", "Renouveler le salbutamol : 2 inhalations au besoin"), ...(poor ? [tr(fr, "Physician to review a daily preventer (inhaled steroid)", "Le médecin évaluera une pompe préventive quotidienne (corticostéroïde inhalé)")] : []), tr(fr, "Ask your pharmacist to check your inhaler technique", "Demandez à votre pharmacien de vérifier votre technique"), tr(fr, "Call 911 if your inhaler doesn't help or you can't speak in full sentences", "Appelez le 911 si la pompe n'aide pas ou si vous ne pouvez pas parler normalement")],
        rx, risk: poor || severe ? "med" : "low",
        summary_for_md: `${age} ${sexWord}, ${(p.conditions || []).join(", ") || "asthma"}. Requests reliever renewal. No dyspnea now. Reliever use: "${use}". ER visit or oral steroids past year: ${severe ? "YES" : "no"} ("${st.a[2]}"). ${allergyLine} ${poor ? "Suboptimal control: consider ICS/formoterol or daily ICS." : "Well controlled."}`,
      },
    });
  }

  /* ----- explain labs ----- */
  if (st.s === "labs") {
    const labs = p.labs || [];
    if (!labs.length) return done({ reply: tr(fr, "I don't see any lab results in your Aster record yet. If you have a copy, type the test names and numbers here and I'll explain them in plain words.", "Je ne vois pas encore de résultats d'analyses dans votre dossier Aster. Si vous en avez une copie, écrivez les noms et les valeurs ici et je vous les expliquerai simplement."), triage: null, care_setting: null, plan: null });
    const lines = labs.map((l) => `- ${l.name} ${l.value}: ${labExplain(l, fr)}`);
    const off = labs.filter((l) => !l.ok);
    const when = labs[0]?.t ? D.fmtDate(labs[0].t) : "";
    return done({
      reply: `${tr(fr, `Here's what your results${when ? ` from ${when}` : ""} mean:`, `Voici ce que veulent dire vos résultats${when ? ` du ${when}` : ""} :`)}\n${lines.join("\n")}\n${off.length ? tr(fr, "Nothing here is urgent. I've sent a short plan to a physician to confirm.", "Rien d'urgent. J'ai envoyé un court plan à un médecin pour confirmation.") : tr(fr, "Everything is in the normal range. A physician will confirm.", "Tout est dans les valeurs normales. Un médecin va confirmer.")}`,
      triage: "routine", care_setting: null,
      plan: {
        title: tr(fr, "Your lab results", "Vos résultats d'analyses"),
        assessment: off.length ? `${off.map((l) => `${l.name} ${l.value} (ref ${l.ref})`).join("; ")} out of range; other results normal.` : "All results within reference range.",
        plan: off.length ? [...off.flatMap((l) => labAdvice(l, fr)), tr(fr, "No medication needed right now", "Aucun médicament nécessaire pour l'instant")] : [tr(fr, "No action needed", "Aucune action nécessaire"), tr(fr, "Repeat routine tests when your doctor advises", "Refaire les analyses de routine selon l'avis du médecin")],
        rx: null, risk: off.length > 1 ? "med" : "low",
        summary_for_md: `${age} ${sexWord}, requested lab explanation. ${labs.map((l) => `${l.name} ${l.value}${l.ok ? "" : " (H/L)"}`).join(", ")}. ${allergyLine} ${(p.conditions || []).length ? "Conditions: " + p.conditions.join(", ") + "." : ""} Proposed lifestyle advice and repeat testing.`,
      },
    });
  }

  /* ----- where should I go ----- */
  if (st.s === "where" && st.step === 0) return ask(tr(fr, "I can help you choose the right place. What's your main symptom, and when did it start?", "Je peux vous aider à choisir le bon endroit. Quel est votre principal symptôme, et quand a-t-il commencé?"));

  /* ----- anything else: 3 questions, then a sensible plan ----- */
  if (st.step === 0) return ask(tr(fr, "Thanks for telling me. When did this start, and is it getting better, worse, or staying the same?", "Merci de me le dire. Quand est-ce que ça a commencé, et est-ce que ça s'améliore, empire ou reste pareil?"));
  if (st.step === 1) return ask(tr(fr, "Do you have any of these right now: trouble breathing, chest pain, fainting, confusion, or bleeding that won't stop?", "Avez-vous en ce moment : difficulté à respirer, douleur à la poitrine, évanouissement, confusion ou saignement qui ne s'arrête pas?"));
  if (st.step === 2) {
    if (yesish(st.a[st.a.length - 1], /(breath|respir|chest|poitrine|faint|évanoui|confus|bleed|saign)/)) return emergencyTurn(fr, "");
    return ask(tr(fr, "Okay. From 0 to 10, how bad is it? And do you have a fever?", "D'accord. De 0 à 10, à quel point est-ce intense? Et avez-vous de la fièvre?"));
  }
  const last = st.a[st.a.length - 1] || "";
  const pain = parseInt((last.match(/\b(10|[0-9])\b/) || [])[0] || "0", 10);
  const fever = yesish(last.replace(/\b(10|[0-9])\b/g, ""), /(fever|fièvre|38|39|chills|frissons)/) && !/(no|pas de|sans) (fever|fièvre)/i.test(last);
  const worse = mentions(st.a.join(" "), /(worse|pire|empire)/);
  const ctas = D.assessCtas({ cc: st.cc, vitals: { pain, temp: fever ? 38.3 : null }, age }).level;
  const minor = /(sore throat|mal de gorge|cold|rhume|congest|cough|toux|rash|éruption|ear|oreille|pink eye|conjonctiv|allerg|seasonal)/i.test(st.cc);
  const noAcet = allergic(p, /acetamin|paracet|tylenol/i);
  const summary = `${age} ${sexWord}, "${st.cc}". Onset/course: "${st.a[0] || ""}". Red flags screened (dyspnea, chest pain, syncope, confusion, bleeding): denied. Pain ${pain}/10, fever ${fever ? "yes" : "no"}. ${allergyLine}`;
  if (ctas <= 3 || pain >= 8 || (fever && worse)) return done({
    reply: tr(fr, "Thank you. Because of how strong this is, you should be seen today. I've asked a physician to review it, and you can book a same-day clinic visit below. If it gets much worse before then, go to the ER or call 911. For advice any time, call Info-Santé at 811.", "Merci. Vu l'intensité, il faut être vu aujourd'hui. J'ai demandé à un médecin de réviser votre dossier et vous pouvez réserver une visite en clinique aujourd'hui ci-dessous. Si ça empire avant, allez à l'urgence ou appelez le 911. Info-Santé : 811."),
    triage: "urgent", care_setting: "clinic_today",
    plan: { title: tr(fr, "Same-day assessment", "Évaluation aujourd'hui"), assessment: `Needs same-day in-person assessment (pain ${pain}/10${fever ? ", febrile" : ""}${worse ? ", worsening" : ""}).`, plan: [tr(fr, "See a doctor today: book a same-day clinic visit", "Voir un médecin aujourd'hui : réservez une visite en clinique"), tr(fr, "Bring your medication list and RAMQ card", "Apportez votre liste de médicaments et votre carte RAMQ"), tr(fr, "Go to the ER or call 911 if it gets much worse", "Allez à l'urgence ou appelez le 911 si ça empire beaucoup")], rx: null, risk: "med", summary_for_md: summary },
  });
  if (minor) return done({
    reply: tr(fr, "Thanks. This sounds like something a pharmacist can help with today. In Québec, pharmacists can assess and treat many minor problems, and it's quick. I've also sent a short plan to a physician to confirm. If it gets worse or lasts more than a week, book a clinic visit.", "Merci. Un pharmacien peut sûrement vous aider aujourd'hui. Au Québec, les pharmaciens peuvent évaluer et traiter plusieurs problèmes mineurs, et c'est rapide. J'ai aussi envoyé un court plan à un médecin. Si ça empire ou dure plus d'une semaine, réservez une visite en clinique."),
    triage: "selfcare", care_setting: "pharmacist",
    plan: { title: tr(fr, "Minor illness: pharmacist visit", "Problème mineur : visite chez le pharmacien"), assessment: "Likely minor ailment without red flags.", plan: [tr(fr, "See a pharmacist for a minor-ailment consult", "Consultez un pharmacien pour un problème mineur"), noAcet ? tr(fr, "Ask your pharmacist which pain reliever is safe for you", "Demandez au pharmacien quel antidouleur est sûr pour vous") : tr(fr, "Acetaminophen 500–1000 mg every 6 h if needed (max 4 g a day)", "Acétaminophène 500–1000 mg aux 6 h au besoin (max 4 g par jour)"), tr(fr, "Book a clinic visit if it lasts more than a week or gets worse", "Réservez une visite si ça dure plus d'une semaine ou empire")], rx: null, risk: "low", summary_for_md: summary },
  });
  return done({
    reply: tr(fr, "Thanks for answering. Nothing you've told me suggests an emergency. Rest at home for now and follow the plan I've written. A physician will review it shortly. If you're not better in 2 to 3 days, or it gets worse, book a clinic visit. Info-Santé is at 811 any time.", "Merci. Rien de ce que vous m'avez dit n'indique une urgence. Reposez-vous et suivez le plan que j'ai préparé. Un médecin va le réviser sous peu. Si ça ne va pas mieux dans 2 ou 3 jours, ou si ça empire, réservez une visite. Info-Santé : 811, en tout temps."),
    triage: "selfcare", care_setting: "self_care",
    plan: { title: tr(fr, "Home care plan", "Plan de soins à la maison"), assessment: `Non-urgent presentation, red flags denied, pain ${pain}/10.`, plan: [tr(fr, "Rest and drink plenty of fluids", "Reposez-vous et buvez beaucoup de liquides"), noAcet ? tr(fr, "Ask your pharmacist which pain reliever is safe for you", "Demandez au pharmacien quel antidouleur est sûr pour vous") : tr(fr, "Acetaminophen 500–1000 mg every 6 h if needed (max 4 g a day)", "Acétaminophène 500–1000 mg aux 6 h au besoin (max 4 g par jour)"), tr(fr, "Book a clinic visit if not better in 2 to 3 days", "Réservez une visite si pas mieux dans 2 ou 3 jours"), tr(fr, "Call 811 (Info-Santé) for advice from a nurse any time", "Appelez le 811 (Info-Santé) pour parler à une infirmière")], rx: null, risk: "low", summary_for_md: summary },
  });
}

function labExplain(l, fr) {
  const n = l.name.toLowerCase();
  const hi = !l.ok;
  if (/a1c/.test(n)) return hi ? tr(fr, "a bit high. This is your average blood sugar over 3 months.", "un peu élevé. C'est votre sucre moyen sur 3 mois.") : tr(fr, "normal. This is your average blood sugar over 3 months.", "normal. C'est votre sucre moyen sur 3 mois.");
  if (/ldl/.test(n)) return hi ? tr(fr, `a little above the target (${l.ref}). This is the "bad" cholesterol that can build up in blood vessels over many years.`, `un peu au-dessus de la cible (${l.ref}). C'est le « mauvais » cholestérol qui peut s'accumuler dans les vaisseaux au fil des années.`) : tr(fr, "on target. This is the \"bad\" cholesterol.", "dans la cible. C'est le « mauvais » cholestérol.");
  if (/tsh/.test(n)) return hi ? tr(fr, "outside the normal range. This checks your thyroid.", "hors des valeurs normales. Cela vérifie votre thyroïde.") : tr(fr, "normal. Your thyroid is working well.", "normal. Votre thyroïde fonctionne bien.");
  if (/ferritin/.test(n)) return hi ? tr(fr, "outside the normal range. This measures your iron stores.", "hors des valeurs normales. Cela mesure vos réserves de fer.") : tr(fr, "normal. Your iron stores are fine.", "normal. Vos réserves de fer sont bonnes.");
  if (/creat/.test(n)) return hi ? tr(fr, "outside the normal range. This checks how your kidneys work.", "hors des valeurs normales. Cela vérifie vos reins.") : tr(fr, "normal. Your kidneys are working well.", "normal. Vos reins fonctionnent bien.");
  return hi ? tr(fr, `outside the usual range (${l.ref}).`, `hors des valeurs habituelles (${l.ref}).`) : tr(fr, "in the normal range.", "dans les valeurs normales.");
}
function labAdvice(l, fr) {
  const n = l.name.toLowerCase();
  if (/ldl|cholest/.test(n)) return [tr(fr, "Eat more fibre (oats, beans, vegetables) and less saturated fat", "Mangez plus de fibres (avoine, légumineuses, légumes) et moins de gras saturés"), tr(fr, "Aim for 150 minutes of activity a week", "Visez 150 minutes d'activité par semaine"), tr(fr, "Repeat the cholesterol test in 12 months", "Refaire le test de cholestérol dans 12 mois")];
  if (/a1c|glucose/.test(n)) return [tr(fr, "Repeat the test in 3 months", "Refaire le test dans 3 mois"), tr(fr, "Cut down on sugary drinks", "Réduisez les boissons sucrées")];
  return [tr(fr, `Repeat ${l.name} in 3 months`, `Refaire ${l.name} dans 3 mois`)];
}

/* ------------------------- posting a full turn ----------------------- */
/** Writes an assistant turn into the thread; creates the review for a plan. */
export function postTurn(p, threadId, turn, extra = {}) {
  const base = { role: "ai", text: turn.reply, ask: !!turn.ask, care: turn.care_setting || null, triage: turn.triage || null, src: turn.source || "rules", ...(turn.fb ? { fb: turn.fb } : {}) };
  if (turn.triage === "emergency") return D.postMessage(threadId, { ...base, card: { type: "emergency" } });
  if (!turn.plan) return D.postMessage(threadId, base);
  const proposal = { title: turn.plan.title, assessment: turn.plan.assessment, plan: turn.plan.plan, rx: turn.plan.rx || null };
  // One open sign-off per conversation: if a plan is already waiting for a
  // physician, update that request instead of opening a duplicate.
  const pending = S.all("reviews").find((r) => r.threadId === threadId && r.status === "pending");
  if (pending) {
    const samePlan = (pending.proposal?.title || "") === (proposal.title || "");
    if (samePlan) return D.postMessage(threadId, base);
    const th0 = S.get("threads", threadId);
    const m2 = D.postMessage(threadId, { ...base, card: { type: "plan", status: "pending", proposal, reviewId: pending.id } });
    if (th0 && pending.msgId) { const th1 = S.get("threads", threadId); S.patch("threads", threadId, { messages: (th1.messages || []).map((x) => (x.id === pending.msgId ? { ...x, card: { ...x.card, status: "replaced" } } : x)) }); }
    S.patch("reviews", pending.id, { proposal, msgId: m2.id, title: `${KIND_LABEL[pending.kind] || "Care plan"}: ${proposal.title}`, summary: turn.plan.summary_for_md || pending.summary, risk: turn.plan.risk || pending.risk, updatedPlanAt: Date.now() });
    S.audit("agent:Aster Care", "Updated plan awaiting sign-off", proposal.title, { reviewId: pending.id, patientId: p.id });
    return m2;
  }
  const m = D.postMessage(threadId, { ...base, card: { type: "plan", status: "pending", proposal } });
  if (!m) return null;
  const isRenewal = /renew|renouvel|refill/i.test(`${proposal.title} ${proposal.assessment} ${(proposal.plan || []).join(" ")}`);
  const kind = extra.kind || (isRenewal ? "rx_renewal" : "care_plan");
  const age = D.ageOf(p.dob);
  const r = D.createReview({ kind, patientId: p.id, threadId, msgId: m.id, title: `${KIND_LABEL[kind]}: ${proposal.title}`, summary: turn.plan.summary_for_md || `${age} ${p.sex}. ${proposal.assessment}`, proposal, risk: turn.plan.risk || "low" }, "agent:Aster Care");
  const th = S.get("threads", threadId);
  if (th) S.patch("threads", threadId, { status: "awaiting_md", messages: (th.messages || []).map((x) => (x.id === m.id ? { ...x, card: { ...x.card, reviewId: r.id } } : x)) });
  return m;
}
