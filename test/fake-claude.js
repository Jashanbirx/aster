// Test double for the claude.ai artifact runtime: window.claude.use(name).
// - db: MemoryDB with latency (exercises the cloud code path, async snapshots)
// - user: owner with write access
// - sample: a fake model that returns plausible JSON/text by prompt intent and
//   calls page tools when provided (to verify tool wiring end to end).
import { MemoryDB } from "../src/lib/memdb.js";

const db = new MemoryDB({ latency: 40 });
const user = { id: async () => "user-test", isOwner: async () => true, canEdit: async () => true, can: async () => true, me: async () => ({ id: "user-test" }) };

function pickJSON(p) {
  const s = p.toLowerCase();
  if (s.includes("ctas") && s.includes("triage")) return { ctas: 2, rationale: "Chest pain with radiation and diaphoresis in a 64-year-old: possible ACS (CTAS 2 by complaint).", red_flags: ["Possible acute coronary syndrome"], protocols: ["ECG within 10 min", "Troponin", "ASA 160 mg chewed if no allergy"], disposition: "Acute stretcher now", divertible: false, translation: "Chest pain for 40 minutes radiating to the left arm, nausea" };
  if (s.includes("primary-care doctor") || s.includes("ai primary-care") || s.includes("aster care") || s.includes("\"reply\"")) {
    const turns = (p.match(/patient:/gi) || []).length;
    if (/chest pain/i.test(p) && turns <= 1) return { reply: "Chest pain with shortness of breath can be serious. Please call 911 now.", triage: "emergency", plan: null, care_setting: "er_now" };
    if (turns >= 2) return { reply: "Thanks. I've drafted a plan and sent it to a physician to review.", triage: "routine", plan: { title: "Uncomplicated urinary tract infection", assessment: "Dysuria without fever or flank pain.", plan: ["Nitrofurantoin 100 mg twice daily for 5 days", "Drink fluids", "Seek care if fever or back pain"], rx: "Nitrofurantoin 100 mg PO BID x 5 days", risk: "low", summary_for_md: "29 M, dysuria 1 day, no red flags, sulfa allergy." }, care_setting: "virtual" };
    return { reply: "Sorry you're dealing with that. Do you have a fever, back pain or blood in your urine?", triage: null, plan: null, care_setting: null };
  }
  if (s.includes("safety") && s.includes("issues")) return { ok: true, issues: [{ severity: "info", text: "No allergy conflict found." }] };
  if (s.includes("orders")) return { orders: [{ name: "CT abdomen/pelvis", type: "imaging", why: "Suspected appendicitis" }], billing: "ED physician assessment; consult request." };
  if (s.includes("referral") || s.includes("fax")) return { patient_name: "Denis Hébert", dob: "1958-03-14", health_card: "HEBD 5803 1412", referral_type: "Specialist referral", specialty: "Cardiology", reason: "Exertional dyspnea, systolic murmur", urgency: "B (within 10 days)", referring_clinician: "Dre Lucie Martel", contact: "514-555-0142", allergies: "Penicillin", medications: "Ramipril, ASA, atorvastatin", missing_fields: [], next_action: "Book echo and cardiology consult within 10 days" };
  return null;
}

async function sample(input, opts = {}) {
  const prompt = Array.isArray(input) ? input.map((m) => m.content).join("\n") : String(input);
  if (opts.tools && opts.tools.length) {
    const calls = [];
    const snap = opts.tools.find((t) => /snapshot/.test(t.name));
    if (snap) calls.push(["snapshot", await snap.execute({})]);
    const search = opts.tools.find((t) => /search/.test(t.name));
    if (search) calls.push(["search", await search.execute({ query: "" })]);
    const propose = opts.tools.find((t) => /propose/.test(t.name));
    if (propose && /bed|free up|boarder/i.test(prompt)) calls.push(["propose", await propose.execute({ type: "create_task", role: "Bed manager", title: "Review boarders for placement", reason: "Test proposal from fake model" })]);
    const text = `I checked the live board. ${calls.length} tool calls made. The main bottleneck is boarding: admitted patients waiting for beds.`;
    if (opts.onText) { let acc = ""; for (const w of text.split(" ")) { acc += (acc ? " " : "") + w; opts.onText({ text: acc, delta: w }); await new Promise((r) => setTimeout(r, 5)); } }
    return { text, truncated: false };
  }
  const j = /json/i.test(prompt) ? pickJSON(prompt) : null;
  const text = j ? JSON.stringify(j) : "## Summary\n- Fake model response for testing.\n- **Bold** point.";
  if (opts.onText) { let acc = ""; for (const ch of text.match(/.{1,12}/g)) { acc += ch; opts.onText({ text: acc, delta: ch }); await new Promise((r) => setTimeout(r, 3)); } }
  await new Promise((r) => setTimeout(r, 60));
  return { text, truncated: false };
}
sample.limits = async () => ({ images: true });
sample.json = async (input, opts) => JSON.parse((await sample(input, opts)).text);

window.claude = { use: async (name) => (name === "db" ? db : name === "user" ? user : name === "sample" ? sample : null) };
window.__fakeDb = db;
