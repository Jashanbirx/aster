// Find care: same-day clinic slots, live ER load, pre-registration.
import React, { useMemo, useState } from "react";
import { LuCompass, LuChevronRight, LuHospital, LuVideo, LuPill, LuBuilding2, LuStethoscope, LuPhone, LuUsers, LuClock, LuCircleCheck, LuInfo, LuMapPin } from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import { toast, useNow, cx } from "../ui/index.jsx";
import { usePA, PButton, Sheet, Section, PEmpty } from "./ui.jsx";
import { erLoad, fmtMins, triageSummary, sessionMsgs, MIN_PER_PATIENT } from "./lib.js";

const kindIcon = (c) => (c.distanceKm === 0 ? LuVideo : /pharm/i.test(c.kind) ? LuPill : /nurse|clsc/i.test(c.kind + c.name) ? LuStethoscope : LuBuilding2);
const dist = (c) => (c.distanceKm === 0 ? "From home" : `${c.distanceKm} km`);

export default function FindCare() {
  const { patient: p, ask, openPrereg, setTab, thread } = usePA();
  const clinics = S.useCollection("clinics");
  const encounters = S.useCollection("encounters"); const beds = S.useCollection("beds");
  const now = useNow();
  const load = useMemo(() => erLoad(encounters, beds), [encounters, beds, now]);
  const active = encounters.find((e) => e.patientId === p.id && D.isEdActive(e));
  const [book, setBook] = useState(null);
  const list = useMemo(() => [...clinics].map((c) => ({ c, slots: D.openSlots(c).sort((a, b) => a.t - b.t).slice(0, 3) })).sort((a, b) => (a.slots[0]?.t || Infinity) - (b.slots[0]?.t || Infinity)), [clinics, now]);
  const [why, setWhy] = useState(false);

  return <div className="pa-scroll">
    <button type="button" className="pa-helper" onClick={() => ask("Where should I go: ER or clinic?")}>
      <span className="pa-helper-ic"><LuCompass aria-hidden="true" /></span>
      <span className="grow"><span className="pa-h3">Where should I go?</span><span className="pa-sub">Answer 3 quick questions and Aster suggests the right place.</span></span>
      <LuChevronRight aria-hidden="true" />
    </button>

    <Section title="Emergency room">
      <div className="pa-card pa-er">
        <div className="row" style={{ alignItems: "flex-start" }}>
          <span className="pa-tile red"><LuHospital aria-hidden="true" /></span>
          <div className="grow"><div className="pa-h3">Hôpital St-Laurent</div><div className="pa-sub">Emergency department · open 24/7</div></div>
          <span className="pa-live"><span className="pa-live-dot" aria-hidden="true" />Live</span>
        </div>
        <div className="pa-er-stats mt12">
          <div><LuUsers aria-hidden="true" /><b className="num">{load.waiting}</b><span>people waiting</span></div>
          <div><LuClock aria-hidden="true" /><b className="num">{fmtMins(load.estMin)}</b><span>estimated wait if less urgent</span></div>
        </div>
        <button type="button" className="pa-link mt8" aria-expanded={why} onClick={() => setWhy(!why)}><LuInfo />How we estimate this</button>
        {why ? <p className="pa-fine mt4">It's an estimate, not a promise. {load.ahead} people are waiting who would be seen before or with a less-urgent (CTAS 4) patient, and the team sees about one patient every {MIN_PER_PATIENT} minutes. Anyone sicker who arrives is seen first, so the wait can change.</p> : null}
        {active
          ? <PButton variant="soft" block className="mt12" icon={LuCircleCheck} onClick={() => setTab("visits")}>You're checked in. Follow your visit</PButton>
          : <PButton variant="primary" block className="mt12" icon={LuHospital} onClick={() => openPrereg({})}>Pre-register</PButton>}
        <p className="pa-fine mt8">Pre-registering sends your details and chat summary to the triage nurse. It doesn't move you ahead of sicker patients.</p>
      </div>
    </Section>

    <Section title="Same-day care near you">
      {list.length ? <div className="pa-list">{list.map(({ c, slots }) => {
        const Ic = kindIcon(c);
        return <div key={c.id} className="pa-card pa-clinic">
          <div className="row" style={{ alignItems: "flex-start" }}>
            <span className={cx("pa-tile", c.distanceKm === 0 ? "ai" : /pharm/i.test(c.kind) ? "warm" : "")}><Ic aria-hidden="true" /></span>
            <div className="grow"><div className="pa-h3">{c.name}</div><div className="pa-sub">{c.kind}</div></div>
            <span className="pa-dist">{c.distanceKm === 0 ? null : <LuMapPin aria-hidden="true" />}{dist(c)}</span>
          </div>
          {slots.length ? <div className="pa-slots mt12" role="group" aria-label={`Open times at ${c.name}`}>{slots.map((s) => <button key={s.id} type="button" className="pa-slot" onClick={() => setBook({ c, s })} aria-label={`Book ${c.name} at ${D.fmtClock(s.t)}`}>{D.fmtClock(s.t)}</button>)}</div>
            : <div className="pa-fine mt8">No more open times today.</div>}
        </div>;
      })}</div> : <PEmpty icon={LuBuilding2} title="No clinics listed yet">Clinics appear here when they share their open times with Aster.</PEmpty>}
    </Section>

    <div className="pa-811"><LuPhone aria-hidden="true" /><div><b>Info-Santé 811</b><div className="pa-fine">Talk to a nurse any time, day or night. Free in Québec.</div></div></div>

    <BookSheet book={book} onClose={() => setBook(null)} p={p} thread={thread} setTab={setTab} />
  </div>;
}

function BookSheet({ book, onClose, p, thread, setTab }) {
  const [busy, setBusy] = useState(false);
  if (!book) return <Sheet open={false} onClose={onClose} />;
  const { c, s } = book;
  const virtual = c.distanceKm === 0;
  const confirm = () => {
    setBusy(true);
    const appt = D.bookSlot({ clinicId: c.id, slotId: s.id, patientId: p.id, source: "app", threadId: thread?.id || null }, "patient");
    setBusy(false);
    if (!appt) { toast("That time was just taken. Please pick another.", { kind: "bad" }); onClose(); return; }
    if (thread) D.postMessage(thread.id, { role: "ai", text: `You're booked at ${c.name} at ${D.fmtClock(s.t)}. I'll keep the details here.`, card: { type: "appointment", apptId: appt.id } });
    toast(`Booked: ${c.name} at ${D.fmtClock(s.t)}`);
    onClose(); setTab("visits");
  };
  return <Sheet open onClose={onClose} title="Confirm your visit" subtitle={c.kind}
    footer={<><PButton variant="ghost" onClick={onClose}>Not now</PButton><PButton variant="primary" loading={busy} onClick={confirm}>Book {D.fmtClock(s.t)}</PButton></>}>
    <div className="pa-confirm">
      <div className="pa-appt-time big"><b>{D.fmtClock(s.t)}</b><span>{new Date(s.t).toDateString() === new Date().toDateString() ? "Today" : D.fmtDate(s.t)}</span></div>
      <div><div className="pa-h3">{c.name}</div><div className="pa-sub">{virtual ? "Video visit from home" : `${c.distanceKm} km away`}</div></div>
    </div>
    <ul className="pa-steps mt12">
      <li><span className="pa-step-dot" aria-hidden="true" />{virtual ? "Find a quiet spot with good internet a few minutes before." : "Arrive 10 minutes early and bring your RAMQ card."}</li>
      <li><span className="pa-step-dot" aria-hidden="true" />You can cancel any time in Visits.</li>
    </ul>
  </Sheet>;
}

/** Pre-register at the Hôpital St-Laurent ED. Opened from Find care or the emergency card. */
export function PreRegisterSheet({ open, onClose }) {
  const { patient: p, thread, setTab } = usePA();
  const guess = useMemo(() => {
    if (!open) return "";
    const msgs = thread?.messages || [];
    let li = msgs.length - 1; while (li >= 0 && msgs[li].role !== "patient") li--;
    const sess = sessionMsgs(msgs.slice(0, li + 1));
    const firstOfSession = (sess.length ? sess : msgs).filter((m) => m.role === "patient" && !/^where should i go/i.test(m.text || "")).map((m) => m.text);
    const lastPt = msgs.filter((m) => m.role === "patient").slice(-4).map((m) => m.text);
    const pick = [...firstOfSession, ...lastPt].find((t) => t && t.length > 8 && !/^(yes|no|oui|non)\b/i.test(t));
    return (pick || "").slice(0, 120);
  }, [open, thread?.id]);
  const [cc, setCc] = useState(null);
  const [busy, setBusy] = useState(false);
  const value = cc ?? guess;
  const close = () => { setCc(null); onClose(); };
  const go = async () => {
    const reason = value.trim(); if (!reason) return;
    if (S.all("encounters").some((e) => e.patientId === p.id && D.isEdActive(e))) { toast("You're already checked in"); close(); setTab("visits"); return; }
    setBusy(true);
    const summary = await triageSummary(p, S.get("threads", thread?.id), reason);
    const enc = D.registerArrival({ patientId: p.id, cc: reason, source: "app", summary, threadId: thread?.id || null }, "patient");
    if (thread) D.postMessage(thread.id, { role: "ai", text: "The emergency team at Hôpital St-Laurent knows you're coming. Your summary is with the triage nurse. You can follow your place in line in Visits.", card: { type: "queue", encounterId: enc.id } });
    setBusy(false);
    toast("The ER at Hôpital St-Laurent knows you're coming");
    close(); setTab("visits");
  };
  return <Sheet open={open} onClose={close} title="Tell the ER you're coming" subtitle="Hôpital St-Laurent emergency department"
    footer={<><PButton variant="ghost" onClick={close}>Cancel</PButton><PButton variant="primary" icon={LuHospital} loading={busy} disabled={!value.trim()} onClick={go}>Pre-register</PButton></>}>
    <label className="pa-field"><span className="pa-label">Why are you going? (one line)</span>
      <input className="pa-input" value={value} maxLength={140} onChange={(e) => setCc(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") go(); }} placeholder="For example: deep cut on my hand" /></label>
    <div className="pa-note mt12"><LuInfo aria-hidden="true" /><span>The triage nurse gets your name, allergies, medications and a short summary of your chat. If you feel worse on the way, call 911.</span></div>
  </Sheet>;
}
