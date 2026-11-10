// Blueprint: market research, strategy and plan behind Aster (investor-facing).
import React from "react";
import { LuCheck, LuMinus, LuArrowUpRight } from "react-icons/lu";
import { PageHead, Panel, Badge } from "../ui/index.jsx";

const SOURCES = [
  ["CIHI via Global News: 16.1M ED visits in 2024–25; 1 in 10 admitted patients waited 48 h+ for a bed", "https://globalnews.ca/news/11938222/emergency-room-wait-times-cihi-report/"],
  ["RefDesk summary of CIHI (June 25, 2026): half of admitted patients spent 16 h+ in the ED", "https://refdesk.ca/blog/cihi-emergency-room-48-hour-wait-180000-canadians-2024-25-report-june-25-2026-patients-caregivers-vulnerable-guide"],
  ["Canadian Healthcare Technology: 7.7% left EDs before seeing a physician (2024–25)", "https://www.canhealth.com/2026/07/08/ed-wait-times-on-the-rise-across-canada/"],
  ["Canadian Press via Ground News: Québec median ER stay 5 h 12 in 2025 (MEI)", "https://ground.news/article/emergency-waiting-improved-by-11-minutes_148b29"],
  ["CTV: ~430,000 Quebecers left ERs untreated; most were P4/P5 (MEI)", "https://www.ctvnews.ca/montreal/article/almost-half-a-million-quebecers-left-ers-without-being-treated-last-year-study-finds/"],
  ["Canadian Press: Montreal General ER at 213% capacity", "https://lethbridgenewsnow.com/?p=574075"],
  ["CBC: ~1.2M Quebecers without a family doctor; the GAP", "https://amp.cbc.ca/news/canada/montreal/gap-emergency-room-family-doctor-appointments-1.6660438"],
  ["Québec.ca: GAP left 30% of requests without an appointment in one region (2025–26)", "https://www.quebec.ca/nouvelles/actualites/details/echecs-du-guichet-acces-premiere-ligne-gap-30-des-demandes-sans-rendez-vous-en-chaudiere-appalaches-monsef-derraji-denonce-labandon-des-patients-71215"],
  ["Longwoods/CIHI: health spending $399B in 2025; hospitals 26%", "https://www.longwoods.com/newsdetail/22685"],
  ["Globe and Mail: hospitals $103.7B in 2025, about half on workers", "https://www.theglobeandmail.com/opinion/article-the-never-ending-riddle-of-canadian-health-spending"],
  ["CKOM/CP: Québec 2026–27 health spending $68.7B (+4.1%)", "https://www.ckom.com/?p=1043071"],
  ["Wikipedia: 2026 Québec general election (PQ government)", "https://en.wikipedia.org/wiki/2026_Quebec_general_election"],
  ["Noovo: PQ plan to fold Santé Québec's useful functions back into the ministry", "https://www.noovo.info/nouvelles/politique/elections-quebec/article/quels-types-de-changement-souhaitent-les-quebecois-christine-frechette/"],
  ["Fierce Healthcare: Rock Health H1 2026, $7.4B digital health funding", "https://fiercehealthcare.com/digital-health/digital-health-brought-74b-vc-funding-ai-powered-rebound-fuels-market"],
  ["MarketScale: megadeals took 45% of H1 2026 capital", "https://www.marketscale.com/industries/healthcare/rock-health-74b-went-into-digital-health-in-h1-2026-and-20-rounds-took-45"],
  ["TechCrunch: Lotus Health raises $35M for a free AI doctor", "https://techcrunch.com/2026/02/03/lotus-health-nabs-35m-for-ai-doctor-that-sees-patients-for-free/"],
  ["Pulse 2.0: Doctronic $40M Series B; AI prescription renewals", "https://pulse2.com/doctronic-40-million-raised-for-ai-healthcare-platform-expansion/amp/"],
  ["Entrepreneur Loop: Doctronic, Utah sandbox, Mindgard prompt-injection report", "https://entrepreneurloop.com/ai-prescription-automation-doctronic-40m-series-b/"],
  ["Revenue Memo: Abridge funding history", "https://www.revenuememo.com/p/abridge-funding"],
  ["Revenue Memo: OpenEvidence at $15B (Sep 2026)", "https://www.revenuememo.com/p/openevidence-funding"],
  ["HLTH: Hippocratic AI $126M Series C at $3.5B", "https://hlth.com/insights/news/hippocratic-ai-raises-126m-to-fund-mergers-acquisitions-and-product-innovation-2025-11-07"],
  ["HTWorld: Assort Health $120M Series C at $1.2B", "https://htworld.co.uk/?p=50876"],
  ["Becker's: Ambience $243M at $1.25B", "https://www.beckershospitalreview.com/healthcare-information-technology/ai/ambience-healthcare-reaches-1-25b-valuation/"],
  ["Fierce Healthcare: Vitalize $31M, AI OS for hospital staffing", "https://www.fiercehealthcare.com/health-tech/vitalize-secures-31m-scale-ai-powered-operating-system-hospital-staffing-and-scheduling"],
  ["MobiHealthNews: Qventus, a logistical OS for hospitals", "https://www.mobihealthnews.com/news/qventus-receives-30m-investment-bring-ai-hospital-workflows"],
  ["IndiaMedToday: Superhealth SuperOS agentic hospital OS", "https://indiamedtoday.com/superhealth-introduces-superos/"],
  ["Tali AI: Canadian AI scribe, Infoway pre-qualified", "https://tali.ai/enterprise"],
  ["ACFP: Canada Health Infoway funds up to 10,000 AI scribe licences", "https://acfp.ca/ai-scribe-license-funding-available/"],
];

const COMP = [
  // name, front door, triage, flow/beds, staffing, documentation, agents, Canada-native, funding signal
  ["Lotus Health", 2, 1, 0, 0, 0, 1, 0, "$41M total (Series A, Feb 2026)"],
  ["Doctronic", 2, 1, 0, 0, 0, 1, 0, "$65M+ (Series B, Mar 2026)"],
  ["Abridge", 0, 0, 0, 0, 2, 1, 0, "~$758M raised, ~$5.3B"],
  ["Hippocratic AI", 1, 0, 0, 0, 0, 2, 0, "$3.5B (Series C)"],
  ["Assort Health", 2, 0, 0, 0, 0, 2, 0, "$1.2B (Series C, Jun 2026)"],
  ["Qventus / LeanTaaS", 0, 0, 2, 1, 0, 1, 0, "Scaled in US systems"],
  ["Vitalize (YC W23)", 0, 0, 1, 2, 0, 1, 0, "$31M"],
  ["Tennr", 0, 0, 0, 0, 1, 1, 0, "$101M Series C"],
  ["Tali AI (Toronto)", 0, 0, 0, 0, 2, 1, 2, "Seed; Infoway pre-qualified"],
  ["Aster", 2, 2, 2, 2, 2, 2, 2, "Pre-seed (this demo)"],
];
const COLS = ["Patient front door", "Triage", "Beds & flow", "Staffing", "Documentation", "AI agents", "Built for Canada"];

function Mark({ v }) {
  if (v === 2) return <span className="c-ok" title="Core"><LuCheck size={16} /></span>;
  if (v === 1) return <span className="c-3" title="Partial"><LuMinus size={16} /></span>;
  return <span className="c-3" style={{ opacity: 0.35 }}>·</span>;
}
function Stat({ v, l }) { return <div className="panel panel-pad"><div className="t-display num c-brand">{v}</div><div className="t-sm c-2 mt4">{l}</div></div>; }
function H({ children }) { return <h2 className="t-h2 mt24" style={{ marginBottom: 10 }}>{children}</h2>; }

export default function Blueprint() {
  return <div style={{ maxWidth: 1080 }}>
    <PageHead title="Blueprint" subtitle="Market research, strategy and the plan behind Aster. Prepared October 30, 2026." />

    <div className="panel" style={{ background: "var(--rail)", color: "#fff", border: 0, padding: "24px 26px" }}>
      <div className="t-sm" style={{ color: "#9FD8C8" }}>The one-liner</div>
      <div className="t-h1 mt8" style={{ color: "#fff", maxWidth: "62ch", lineHeight: 1.3 }}>Aster is the AI operating system for Canadian hospitals and the AI front door for their patients. One shared patient memory runs from the first symptom on a phone to the discharge home.</div>
    </div>

    <H>The problem, in numbers</H>
    <div className="grid g4">
      <Stat v="16.1M" l="ED visits in Canada in 2024–25; 12% were admitted." />
      <Stat v="1 in 10" l="admitted patients waited more than 48 hours in the ED for a bed (about 180,000 people)." />
      <Stat v="5 h 12" l="median ER stay in Québec in 2025. Montréal-area regions run 6–8 h." />
      <Stat v="~430k" l="Quebecers left an ER without treatment in a year. Most were P4/P5 (low acuity)." />
    </div>
    <p className="t-sm c-2 mt12" style={{ maxWidth: "80ch" }}>CIHI's diagnosis is that ER crowding is a whole-system problem: people with nowhere else to go come in at the front, and admitted patients can't leave at the back because inpatient beds, long-term care and home care are full. JB spent 3–4 days at Montreal General and saw it from the inside: no shared picture of who is waiting, why, or what should happen next. That runs on whiteboards, phone calls, fax and memory.</p>

    <H>Where the money is</H>
    <div className="grid g3">
      <Panel title="Canada"><p className="t-sm">Total health spending is <b>$399B</b> in 2025. Hospitals are the largest share (26%, about $104B), and roughly half of hospital spending is staff.</p></Panel>
      <Panel title="Québec"><p className="t-sm">Health is <b>$68.7B</b> in 2026–27, about 43% of the provincial budget, up 4.1%. ER waits and family-doctor access are the most visible political issues.</p></Panel>
      <Panel title="Venture"><p className="t-sm">US digital health raised <b>$7.4B in H1 2026</b>, and $100M+ rounds took 45% of it. AI is now table stakes. Investors ask what AI alone can't provide: workflow ownership, data, licences, distribution, trust.</p></Panel>
    </div>

    <H>Competitive landscape</H>
    <Panel flush>
      <div className="scroll-x"><table className="table">
        <thead><tr><th>Company</th>{COLS.map((c) => <th key={c} style={{ textAlign: "center" }}>{c}</th>)}<th>Funding signal</th></tr></thead>
        <tbody>{COMP.map((r) => <tr key={r[0]} style={r[0] === "Aster" ? { background: "var(--brand-soft)" } : null}>
          <td className="w6">{r[0]}</td>{r.slice(1, 8).map((v, i) => <td key={i} style={{ textAlign: "center" }}><Mark v={v} /></td>)}<td className="t-sm c-2">{r[8]}</td></tr>)}</tbody>
      </table></div>
    </Panel>
    <p className="t-xs c-3 mt8">Check = core product. Dash = partial or adjacent. Assessment from public descriptions as of October 2026.</p>

    <H>What we took from each, and what we changed for Canada</H>
    <div className="grid g2">
      {[
        ["Lotus Health", "Free 24/7 AI doctor in many languages, where real physicians sign diagnoses and prescriptions.", "Aster Care: Québec-licensed sign-off queue inside the hospital OS; plans and pre-registration flow straight into triage."],
        ["Doctronic", "Chronic-medication renewals at scale.", "Renewals are always physician-signed. Doctronic's Utah pushback and a published prompt-injection report show the cost of autonomy."],
        ["Abridge · Ambience", "Ambient notes linked to the conversation; coding support.", "French-first SOAP notes with transcript evidence, order extraction and RAMQ act guidance (no invented codes)."],
        ["Hippocratic AI · Assort", "Patient-facing agents; a shared 'patient journey memory'.", "Post-discharge check-ins in the patient's language that escalate into the sign-off queue; one memory from app to bed to home."],
        ["Qventus · LeanTaaS · Casera", "Predicted discharges, barrier routing, next best action.", "Barriers become owned tasks; ALC and CLSC handoffs; boarders matched to beds by service."],
        ["Vitalize", "Explainable staffing and scheduling.", "Float pool and internal staff before agency, with reasons shown for every recommendation."],
        ["Tennr", "AI that reads faxes and referrals.", "Bilingual Québec referral forms (priority A–E), patient creation and booking in one step."],
        ["OpenEvidence · SuperOS", "Bedside answers; an agent fabric that runs the hospital.", "A copilot that reads live state through tools and proposes actions a human approves."],
      ].map(([who, what, ours]) => <Panel key={who} title={who}><p className="t-sm c-2">{what}</p><p className="t-sm mt8"><b>Aster:</b> {ours}</p></Panel>)}
    </div>

    <H>The insight</H>
    <div className="grid g3">
      <Panel title="Close the loop"><p className="t-sm">Competitors sell one piece. In Canada, one public payer owns both the ER cost and the primary-care gap. A product that sends a P4 patient to a same-day slot <i>and</i> frees the bed upstairs shows its savings on one budget line.</p></Panel>
      <Panel title="Built-in moat"><p className="t-sm">French, RAMQ, CTAS, CMQ licensing, Québec referral forms, Loi 25 and Canadian data residency. These are slow for US players to clear and natural for a Montréal team.</p></Panel>
      <Panel title="Trust by design"><p className="t-sm">Every agent has an autonomy level, shows its reasoning and logs every action. Clinical changes always need a human click. That is what a public system can actually buy and defend.</p></Panel>
    </div>

    <H>Business model (hypotheses to test)</H>
    <div className="grid g3">
      <Panel title="Hospital OS"><p className="t-sm">Annual SaaS per site, priced per staffed bed. Example: a 400-bed hospital at $1,500 per bed per year is $600k ARR. The value case is measured in ER hours, boarding hours and agency spend.</p></Panel>
      <Panel title="Aster Care"><p className="t-sm">Free to patients. Paid by the province or region per resolved episode, aligned to avoided ER visits, not to ads or subscriptions.</p></Panel>
      <Panel title="Scribe land"><p className="t-sm">Per-clinician seats, eligible for Infoway-style programs. Doctors already want it, and it seeds Aster in the clinics that take diverted patients.</p></Panel>
    </div>

    <H>Go-to-market and the next 12 months</H>
    <Panel flush><table className="table"><tbody>
      <tr><td className="w6" style={{ width: 140 }}>Months 0–2</td><td className="t-sm">15 interviews (ER nurses, patient-flow leads, chefs de service, GMF doctors). Recruit a Québec-licensed physician co-founder or medical director. Apply to YC with this demo.</td></tr>
      <tr><td className="w6">Months 2–5</td><td className="t-sm">Wedge pilot in one Montréal ER: Triage copilot plus redirection to partner GMF and super-clinic slots. Measure LWBS rate, P4/P5 door-to-physician time and ER length of stay. Complete a Loi 25 privacy impact assessment and host data in Canada.</td></tr>
      <tr><td className="w6">Months 5–9</td><td className="t-sm">Expand in the same hospital to Beds & flow and the discharge agent. Offer Aster Care to the GAP waitlist in that territory. Get a Health Canada SaMD classification opinion for triage support.</td></tr>
      <tr><td className="w6">Months 9–12</td><td className="t-sm">Second Québec region, then Ontario (AI scribe vendor route, OHT patient flow).</td></tr>
    </tbody></table></Panel>

    <H>Risks and how Aster handles them</H>
    <Panel flush><table className="table"><tbody>
      <tr><td className="w6" style={{ width: 160 }}>Political change</td><td className="t-sm">The Parti Québécois won the October 5, 2026 election and plans to fold Santé Québec's useful functions back into the ministry. Expect procurement churn in 2027. Sell to sites and regions on measured results, and keep the product structure-agnostic.</td></tr>
      <tr><td className="w6">Regulation</td><td className="t-sm">Triage and diagnosis support may be a medical device for Health Canada; telemedicine follows CMQ rules. Physician-in-the-loop by design, early regulatory counsel.</td></tr>
      <tr><td className="w6">Privacy</td><td className="t-sm">Loi 25 and provincial health-information law: Canadian hosting, consent, minimal data, full audit log (built in).</td></tr>
      <tr><td className="w6">Clinical safety</td><td className="t-sm">Hallucination and prompt injection: structured outputs, deterministic rules running alongside the model (e.g. CTAS modifiers, allergy checks), human sign-off, override logging.</td></tr>
      <tr><td className="w6">Integration</td><td className="t-sm">Start as an overlay (HL7/FHIR read feeds, fax and SMS as interfaces). Deep write-back comes after trust.</td></tr>
    </tbody></table></Panel>

    <H>YC application: draft answers</H>
    <Panel>
      <p className="t-sm"><b>What are you building?</b> An AI operating system for Canadian hospitals and an AI doctor for their patients. Patients get free, physician-signed care in their language. Hospitals get triage, bed flow, staffing, documentation and agents on one live data layer.</p>
      <p className="t-sm mt12"><b>Why now?</b> LLMs make history-taking, triage support and notes good enough to help. Québec's ER and family-doctor crises are front-page every week. Public money already pays for AI scribes. US AI-doctor companies have proven the demand but can't operate here.</p>
      <p className="t-sm mt12"><b>Why us?</b> A Montréal CS & Math founder with medical-imaging AI experience who saw the problem inside Montreal General. <span className="c-3">(Add co-founders and a clinical lead.)</span></p>
      <p className="t-sm mt12"><b>How big?</b> Canadian hospitals spend over $100B a year. Every province has the same ER and access problem, and so do the UK and Australia.</p>
    </Panel>

    <H>What's real in this demo</H>
    <Panel>
      <ul className="t-sm" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
        <li><b>Real:</b> a live shared database (every change syncs across devices), the full patient state machine, beds, tasks, staffing, sign-off, referrals and audit. AI by Claude: triage second opinion, AI doctor, scribe notes, referral extraction, discharge instructions, safety checks, and a copilot that calls tools on live data.</li>
        <li><b>Real:</b> the closed loop. A patient chat becomes a plan, a physician signs it in the OS, and the patient sees it live. App pre-registration lands in the triage queue.</li>
        <li><b>Simulated:</b> the hospital and every person in it (fictional), live arrivals and test results, clinic schedules and integrations (EHR, SMS, fax, pharmacy).</li>
        <li><b>Not for clinical use.</b></li>
      </ul>
    </Panel>

    <H>Sources</H>
    <Panel>
      <ol className="t-sm" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.75 }}>{SOURCES.map(([t, u]) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer">{t} <LuArrowUpRight size={12} /></a></li>)}</ol>
    </Panel>
  </div>;
}
