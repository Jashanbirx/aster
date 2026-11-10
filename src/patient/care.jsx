// Aster Care: the AI doctor conversation, persisted in the patient's thread.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  LuArrowUp, LuStethoscope, LuSiren, LuPhone, LuHospital, LuCalendarCheck, LuPill, LuClock, LuCircleCheck,
  LuInfo, LuFileText, LuChevronRight, LuMapPin, LuVideo, LuSignature, LuPencil, LuCircleHelp, LuHeartPulse, LuHouse, LuSparkles,
} from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import * as AI from "../lib/ai.js";
import { toast, Typing, useNow, cx } from "../ui/index.jsx";
import { usePA, PButton, Mark } from "./ui.jsx";
import { aiTurn, fallbackTurn, postTurn, erLoad, placeInLine, fmtMins, ordinal, PLAIN_STATUS } from "./lib.js";

export const QUICK = [
  "Burning when I pee since yesterday",
  "Renew my asthma inhaler",
  "Explain my blood test results",
  "I have chest pain and feel short of breath",
  "Where should I go: ER or clinic?",
];

const dayLabel = (t) => { const d = new Date(t), n = new Date(); const y = new Date(); y.setDate(n.getDate() - 1); if (d.toDateString() === n.toDateString()) return "Today"; if (d.toDateString() === y.toDateString()) return "Yesterday"; return d.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" }); };

/* ============================== screen ============================== */
export default function Care() {
  const ctx = usePA();
  const { patient: p, thread, tab, pendingPrompt, setPendingPrompt } = ctx;
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");
  const scroller = useRef(null);
  const ai = AI.useAIStatus();
  const encounters = S.useCollection("encounters");
  const msgs = thread?.messages || [];

  // clear unread when the conversation is on screen
  useEffect(() => { if (tab === "care" && thread && (thread.unread || 0) > 0) S.patch("threads", thread.id, { unread: 0 }); }, [tab, thread?.unread, thread?.id]);
  // auto-scroll to newest
  useLayoutEffect(() => { const el = scroller.current; if (el && msgs.length) el.scrollTo({ top: el.scrollHeight, behavior: msgs.length > 1 ? "smooth" : "auto" }); }, [msgs.length, busy, msgs[msgs.length - 1]?.card?.status]);

  const send = async (raw) => {
    const t = String(raw || "").trim();
    if (!t || busy || !thread) return;
    setText("");
    D.postMessage(thread.id, { role: "patient", text: t });
    setBusy(true);
    const started = Date.now();
    try {
      const th = S.get("threads", thread.id);
      let turn = await aiTurn(p, th, encounters);
      if (!turn) {
        turn = fallbackTurn(p, th, t);
        const wait = 700 + Math.min(900, (turn.reply || "").length * 5) - (Date.now() - started);
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      postTurn(p, thread.id, turn);
      if (turn.plan) toast("Plan sent to a physician for sign-off");
    } catch (e) {
      console.warn(e);
      D.postMessage(thread.id, { role: "ai", text: "Sorry, I couldn't answer just now. Please try again. If this is urgent, call 811, or 911 in an emergency." });
    } finally { setBusy(false); }
  };
  // prompts sent from other tabs (Find care, Health)
  useEffect(() => { if (pendingPrompt && thread && !busy) { const t = pendingPrompt; setPendingPrompt(null); send(t); } }, [pendingPrompt, thread?.id]);

  const last = msgs[msgs.length - 1];
  const idle = !busy && (!last || !last.ask);
  const empty = !msgs.length;

  return <div className="pa-care">
    <div className="pa-chat" ref={scroller} aria-live="polite">
      {ai !== "live" && ai !== "connecting" ? <div className="pa-guided"><LuInfo aria-hidden="true" />Guided mode: the AI is offline, so Aster asks a set of clinical questions. A physician still reviews every plan.</div> : null}
      {empty ? <Welcome p={p} onPick={send} /> : <Messages msgs={msgs} p={p} thread={thread} />}
      {busy ? <div className="pa-msg ai"><AsterAvatar /><div className="pa-bubble ai typing-b"><Typing /></div></div> : null}
      {idle && !empty ? <div className="pa-quick-row" aria-label="Suggestions">{QUICK.map((q) => <button key={q} type="button" className="pa-chip" onClick={() => send(q)}>{q}</button>)}</div> : null}
    </div>
    <Composer value={text} onChange={setText} onSend={() => send(text)} busy={busy} />
  </div>;
}

function Welcome({ p, onPick }) {
  return <div className="pa-welcome">
    <span className="pa-welcome-mark"><Mark size={26} /></span>
    <h2 className="pa-h1 mt16">Hi {p.first}. I'm Aster, your AI doctor.</h2>
    <p className="pa-sub mt8">Tell me what's going on, any time. I'll ask a few questions, then a Québec physician reviews and signs every plan I make.</p>
    <div className="pa-quick-list mt20">{QUICK.map((q) => <button key={q} type="button" className="pa-quick" onClick={() => onPick(q)}><span>{q}</span><LuChevronRight aria-hidden="true" /></button>)}</div>
    <p className="pa-fine mt16">In an emergency, call 911. For health advice from a nurse, call Info-Santé at 811.</p>
  </div>;
}

/* ============================== messages ============================ */
function Messages({ msgs, p, thread }) {
  const out = []; let lastDay = null; let prevRole = null;
  msgs.forEach((m, i) => {
    const d = dayLabel(m.t);
    if (d !== lastDay) { out.push(<div key={"d" + i} className="pa-day">{d}</div>); lastDay = d; prevRole = null; }
    out.push(<Message key={m.id || i} m={m} p={p} thread={thread} first={prevRole !== m.role} />);
    prevRole = m.role;
  });
  return out;
}
export const AsterAvatar = ({ hidden }) => <span className={cx("pa-av aster", hidden && "ghost")} aria-hidden="true"><Mark size={14} /></span>;

function Message({ m, p, thread, first }) {
  if (m.role === "system") return <SystemMsg m={m} />;
  if (m.role === "patient") return <div className="pa-msg me"><div className="pa-bubble me">{m.text}<span className="pa-time">{D.fmtClock(m.t)}</span></div></div>;
  if (m.role === "md") return <div className="pa-msg md">
    <span className="pa-av md" aria-hidden="true"><LuStethoscope /></span>
    <div className="pa-stack">
      <div className="pa-who"><b>{m.author || "Physician"}</b><span className="pa-md-tag">Physician</span></div>
      <div className="pa-bubble md">{m.text}<span className="pa-time">{D.fmtClock(m.t)}</span></div>
    </div>
  </div>;
  // AI
  return <div className="pa-msg ai">
    <AsterAvatar hidden={!first} />
    <div className="pa-stack">
      {first ? <div className="pa-who"><b>Aster</b><span className="pa-ai-tag"><LuSparkles aria-hidden="true" />AI</span></div> : null}
      {m.text ? <div className="pa-bubble ai"><RichText text={m.text} /><span className="pa-time">{D.fmtClock(m.t)}</span></div> : null}
      {m.card ? <Card m={m} p={p} thread={thread} /> : null}
      {m.care && m.card?.type !== "emergency" ? <CareChips care={m.care} /> : null}
    </div>
  </div>;
}
function RichText({ text }) {
  const lines = String(text).split("\n");
  return <>{lines.map((l, i) => /^\s*[-•]\s+/.test(l) ? <div key={i} className="pa-li">{l.replace(/^\s*[-•]\s+/, "")}</div> : <p key={i}>{l}</p>)}</>;
}

function Card({ m, p, thread }) {
  const c = m.card;
  if (c.type === "plan") return <PlanCard m={m} />;
  if (c.type === "emergency") return <EmergencyCard p={p} />;
  if (c.type === "checkin") return <CheckinCard m={m} thread={thread} />;
  if (c.type === "appointment") return <ApptCard apptId={c.apptId} />;
  if (c.type === "discharge") return <DischargeCard encounterId={c.encounterId} />;
  if (c.type === "queue") return <QueueCard encounterId={c.encounterId} />;
  return null;
}

function SystemMsg({ m }) {
  const { setTab } = usePA();
  return <div className="pa-system">
    <div className="pa-system-card"><LuInfo aria-hidden="true" /><div className="grow"><div>{m.text}</div>
      {m.card?.type === "discharge" ? <button type="button" className="pa-link mt8" onClick={() => setTab("visits")}>View discharge instructions<LuChevronRight /></button> : null}
      {m.card?.type === "appointment" ? <div className="mt8"><ApptCard apptId={m.card.apptId} /></div> : null}
      <div className="pa-time static">{D.fmtClock(m.t)}</div></div></div>
  </div>;
}

/* ------------------------------ plan -------------------------------- */
const PLAN_STATE = {
  pending: { label: "Waiting for a physician", tone: "wait", icon: LuClock },
  approved: { label: "Signed by", tone: "ok", icon: LuSignature },
  modified: { label: "Signed with changes by", tone: "ok", icon: LuPencil },
  rejected: { label: "A physician suggests a different approach", tone: "warn", icon: LuCircleHelp },
  video: { label: "A physician wants a video visit", tone: "info", icon: LuVideo },
  replaced: { label: "Replaced by the updated plan below", tone: "", icon: LuFileText },
};
function PlanCard({ m }) {
  const c = m.card; const pr = c.proposal || {};
  const review = S.useDoc("reviews", c.reviewId);
  useNow();
  const status = c.status === "replaced" ? "replaced" : review?.status && review.status !== "pending" ? review.status : c.status || "pending";
  const st = PLAN_STATE[status] || PLAN_STATE.pending;
  const by = c.decidedBy || review?.decidedBy;
  const signed = status === "approved" || status === "modified";
  return <div className={cx("pa-card pa-plan", st.tone)}>
    <div className="pa-card-kicker"><LuFileText aria-hidden="true" />Care plan</div>
    <div className="pa-h3 mt4">{pr.title}</div>
    {pr.assessment ? <p className="pa-sub mt4">{pr.assessment}</p> : null}
    {pr.plan?.length ? <ul className="pa-steps">{pr.plan.map((s, i) => <li key={i}><span className="pa-step-dot" aria-hidden="true" />{s}</li>)}</ul> : null}
    {pr.rx ? <div className="pa-rx"><LuPill aria-hidden="true" /><div><div className="pa-rx-k">Prescription{signed ? " sent to your pharmacy" : ", once signed"}</div><div className="pa-rx-v">{pr.rx}</div></div></div> : null}
    <div className={cx("pa-plan-status", st.tone)} key={status}>
      <st.icon aria-hidden="true" />
      <div className="grow">
        <div className="w6">{signed || status === "rejected" || status === "video" ? (signed ? `${st.label} ${by || "a physician"}` : st.label) : st.label}</div>
        <div className="pa-fine">{status === "pending" ? `Sent ${D.fmtAgo(m.t)}. You'll see the decision here.` : review?.decidedAt ? `${D.fmtAgo(review.decidedAt)}${review.physicianNote ? ` · "${review.physicianNote}"` : ""}` : ""}</div>
      </div>
      {status === "pending" ? <span className="pa-live-dot" aria-hidden="true" /> : status === "replaced" ? null : <LuCircleCheck aria-hidden="true" className="pa-done-ic" />}
    </div>
  </div>;
}

/* ------------------------------ emergency --------------------------- */
function EmergencyCard({ p }) {
  const { openPrereg, setTab } = usePA();
  const encounters = S.useCollection("encounters"); const beds = S.useCollection("beds");
  const load = useMemo(() => erLoad(encounters, beds), [encounters, beds]);
  const active = encounters.find((e) => e.patientId === p.id && D.isEdActive(e));
  return <div className="pa-card pa-emerg" role="alert">
    <div className="row"><span className="pa-emerg-ic"><LuSiren aria-hidden="true" /></span><div className="pa-h2">Call 911 now</div></div>
    <p className="mt8">Don't drive yourself. Unlock your door and stay where someone can find you.</p>
    <a className="pa-btn white block mt12" href="tel:911"><LuPhone aria-hidden="true" /><span>Call 911</span></a>
    <div className="pa-emerg-er mt12">
      <LuHospital aria-hidden="true" />
      <div className="grow"><div className="w6">Hôpital St-Laurent emergency</div><div className="pa-fine light">{load.waiting} people waiting now. The sickest patients are always seen first.</div></div>
    </div>
    {active
      ? <button type="button" className="pa-btn ghost-white block mt8" onClick={() => setTab("visits")}><LuCircleCheck aria-hidden="true" /><span>The ER knows you're coming</span></button>
      : <button type="button" className="pa-btn ghost-white block mt8" onClick={() => openPrereg({})}><LuHospital aria-hidden="true" /><span>Tell the ER I'm coming</span></button>}
  </div>;
}

/* ------------------------------ care chips -------------------------- */
function CareChips({ care }) {
  const { setTab, openPrereg } = usePA();
  const chips = {
    clinic_today: [{ label: "Book a clinic visit", icon: LuCalendarCheck, run: () => setTab("find") }],
    virtual: [{ label: "Book a video visit", icon: LuVideo, run: () => setTab("find") }],
    pharmacist: [{ label: "See a pharmacist", icon: LuPill, run: () => setTab("find") }],
    er_now: [{ label: "Pre-register at the ER", icon: LuHospital, run: () => openPrereg({}) }, { label: "Call 911", href: "tel:911", icon: LuPhone }],
    self_care: [{ label: "Find care if it gets worse", icon: LuHouse, run: () => setTab("find") }],
  }[care] || [];
  if (!chips.length) return null;
  return <div className="pa-actions">{chips.map((c) => c.href
    ? <a key={c.label} className="pa-chip action" href={c.href}><c.icon aria-hidden="true" />{c.label}</a>
    : <button key={c.label} type="button" className="pa-chip action" onClick={c.run}><c.icon aria-hidden="true" />{c.label}</button>)}</div>;
}

/* ------------------------------ check-in ---------------------------- */
function CheckinCard({ m, thread }) {
  const c = m.card;
  const [feeling, setFeeling] = useState(null); const [meds, setMeds] = useState(null); const [red, setRed] = useState(null); const [detail, setDetail] = useState("");
  if (c.status === "done") {
    const a = c.answers || {};
    return <div className="pa-card pa-checkin done"><div className="pa-card-kicker"><LuHeartPulse aria-hidden="true" />Check-in sent</div>
      <div className="pa-sub mt4">Feeling {a.feeling || "–"} · Medications {a.meds === "yes" ? "understood" : "unclear"} · {a.redFlag ? `New symptom: ${a.detail || "yes"}` : "No new symptoms"}</div></div>;
  }
  const can = feeling && meds && red !== null && (!red || detail.trim());
  const submit = () => { D.submitCheckin(thread.id, m.id, { feeling, meds, redFlag: !!red, detail: red ? detail.trim() : "", encounterId: c.encounterId }, "patient"); toast(feeling === "worse" || red ? "Sent to a physician now" : "Check-in sent to your care team"); };
  const Q = ({ label, value, set, opts }) => <div className="pa-q"><div className="pa-q-l">{label}</div><div className="pa-seg" role="radiogroup" aria-label={label}>{opts.map(([v, l]) => <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => set(v)}>{l}</button>)}</div></div>;
  return <div className="pa-card pa-checkin">
    <div className="pa-card-kicker"><LuHeartPulse aria-hidden="true" />30-second check-in</div>
    <Q label="How are you feeling?" value={feeling} set={setFeeling} opts={[["better", "Better"], ["same", "Same"], ["worse", "Worse"]]} />
    <Q label="Do you understand your medications?" value={meds} set={setMeds} opts={[["yes", "Yes"], ["no", "No"]]} />
    <Q label="Any new symptom?" value={red} set={setRed} opts={[[false, "No"], [true, "Yes"]]} />
    {red ? <label className="pa-field mt8"><span className="pa-label">What's new?</span><input className="pa-input" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="For example: more swelling in my ankles" /></label> : null}
    <PButton variant="primary" block className="mt12" disabled={!can} onClick={submit}>Send to my care team</PButton>
  </div>;
}

/* ------------------------------ appointment ------------------------- */
export function ApptCard({ apptId }) {
  const a = S.useDoc("appointments", apptId);
  const clinic = S.useDoc("clinics", a?.clinicId);
  const { setTab } = usePA();
  if (!a) return null;
  const virtual = clinic && clinic.distanceKm === 0;
  const cancelled = a.status === "cancelled";
  return <div className={cx("pa-card pa-appt", cancelled && "muted")}>
    <div className="pa-card-kicker">{virtual ? <LuVideo aria-hidden="true" /> : <LuCalendarCheck aria-hidden="true" />}{cancelled ? "Cancelled" : "Appointment booked"}</div>
    <div className="row mt8" style={{ alignItems: "flex-start", gap: 12 }}>
      <div className="pa-appt-time"><b>{D.fmtClock(a.t)}</b><span>{dayLabel(a.t)}</span></div>
      <div className="grow"><div className="pa-h3">{a.clinicName}</div><div className="pa-sub">{clinic?.kind}</div></div>
    </div>
    {!cancelled ? <div className="pa-note mt12">{virtual ? <><LuVideo aria-hidden="true" /><span>The physician calls you in the app at this time (simulated in this demo).</span></> : <><LuMapPin aria-hidden="true" /><span>Directions: {clinic?.distanceKm} km from you. Show this message at the front desk and bring your RAMQ card.</span></>}</div> : null}
    <button type="button" className="pa-link mt8" onClick={() => setTab("visits")}>See it in Visits<LuChevronRight /></button>
  </div>;
}
function DischargeCard({ encounterId }) {
  const { setTab } = usePA();
  const e = S.useDoc("encounters", encounterId);
  return <div className="pa-card"><div className="pa-card-kicker"><LuFileText aria-hidden="true" />Discharge instructions</div>
    <div className="pa-h3 mt4">{e?.cc || "Your visit"}</div>
    <button type="button" className="pa-link mt8" onClick={() => setTab("visits")}>Read them in Visits<LuChevronRight /></button></div>;
}
function QueueCard({ encounterId }) {
  const { setTab } = usePA();
  const e = S.useDoc("encounters", encounterId);
  const encounters = S.useCollection("encounters");
  useNow();
  if (!e) return null;
  const pl = placeInLine(e, encounters);
  return <div className="pa-card pa-queue-mini">
    <div className="pa-card-kicker"><LuHospital aria-hidden="true" />Hôpital St-Laurent emergency</div>
    <div className="pa-h3 mt4">{PLAIN_STATUS[e.status] || D.STATUS_LABEL[e.status]}</div>
    {pl ? <div className="pa-sub">{e.status === "arriving" ? `About ${fmtMins(pl.estMin)} wait once you're there (estimate)` : `You're ${ordinal(pl.position)} in line · about ${fmtMins(pl.estMin)} (estimate)`}</div> : null}
    <button type="button" className="pa-link mt8" onClick={() => setTab("visits")}>Follow my visit live<LuChevronRight /></button>
  </div>;
}

/* ------------------------------ composer ---------------------------- */
function Composer({ value, onChange, onSend, busy }) {
  const ref = useRef(null);
  useLayoutEffect(() => { const el = ref.current; if (!el) return; el.style.height = "0px"; el.style.height = Math.min(120, el.scrollHeight) + "px"; }, [value]);
  return <form className="pa-composer" onSubmit={(e) => { e.preventDefault(); onSend(); }}>
    <label htmlFor="pa-compose" className="pa-sr">Message Aster</label>
    <textarea id="pa-compose" ref={ref} rows={1} className="pa-compose-input" placeholder="Describe how you feel" value={value} onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); } }} />
    <button type="submit" className="pa-send" disabled={!value.trim() || busy} aria-label="Send message"><LuArrowUp /></button>
  </form>;
}
