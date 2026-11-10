// Visits: live ER visit tracking, appointments, past visits with discharge instructions.
import React, { useMemo, useState } from "react";
import { LuHospital, LuClock, LuUsers, LuMapPin, LuStethoscope, LuCalendarCheck, LuCalendarX, LuChevronDown, LuFileText, LuVideo, LuCalendarClock, LuInfo } from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import { Markdown, toast, useNow, cx } from "../ui/index.jsx";
import { usePA, PButton, Sheet, Section, PEmpty } from "./ui.jsx";
import { PLAIN_STATUS, STATUS_HELP, VISIT_STEPS, placeInLine, fmtMins, ordinal } from "./lib.js";

export default function Visits() {
  const { patient: p, setTab } = usePA();
  const encounters = S.useCollection("encounters");
  const appts = S.useCollection("appointments");
  useNow();
  const mine = useMemo(() => encounters.filter((e) => e.patientId === p.id).sort((a, b) => b.arrivalAt - a.arrivalAt), [encounters, p.id]);
  const active = mine.filter((e) => D.isEdActive(e) || D.isInpatient(e));
  const past = mine.filter((e) => !D.isEdActive(e) && !D.isInpatient(e));
  const myAppts = useMemo(() => appts.filter((a) => a.patientId === p.id).sort((a, b) => a.t - b.t), [appts, p.id]);
  const upcoming = myAppts.filter((a) => a.status === "booked" && a.t > Date.now() - 30 * D.MIN);
  const pastAppts = myAppts.filter((a) => !upcoming.includes(a)).reverse();
  const [cancel, setCancel] = useState(null);
  const nothing = !active.length && !upcoming.length && !past.length && !pastAppts.length;

  return <div className="pa-scroll">
    {active.map((e) => <LiveVisit key={e.id} e={e} encounters={encounters} />)}
    {nothing ? <PEmpty icon={LuCalendarClock} title="No visits yet" action={<PButton variant="primary" onClick={() => setTab("find")}>Find care</PButton>}>When you book a clinic or pre-register at the ER, you can follow it here live.</PEmpty> : null}
    {upcoming.length ? <Section title="Upcoming">
      <div className="pa-list">{upcoming.map((a) => <ApptRow key={a.id} a={a} onCancel={() => setCancel(a)} />)}</div>
    </Section> : null}
    {past.length || pastAppts.length ? <Section title="Past visits">
      <div className="pa-list">
        {past.map((e) => <PastVisit key={e.id} e={e} lang={p.lang} />)}
        {pastAppts.map((a) => <ApptRow key={a.id} a={a} past />)}
      </div>
    </Section> : null}
    <CancelSheet a={cancel} onClose={() => setCancel(null)} />
  </div>;
}

function LiveVisit({ e, encounters }) {
  const bed = S.useDoc("beds", e.bedId);
  const pl = placeInLine(e, encounters);
  const inpatient = D.isInpatient(e);
  const stepIdx = VISIT_STEPS.findIndex((s) => s.statuses.includes(e.status));
  return <div className="pa-card pa-live-visit" aria-live="polite">
    <div className="row">
      <span className="pa-tile brand"><LuHospital aria-hidden="true" /></span>
      <div className="grow"><div className="pa-sub">{inpatient ? "Admitted" : "Emergency"} · Hôpital St-Laurent</div><div className="pa-h2" key={e.status}>{PLAIN_STATUS[e.status] || D.STATUS_LABEL[e.status]}</div></div>
      <span className="pa-live"><span className="pa-live-dot" aria-hidden="true" />Live</span>
    </div>
    {!inpatient ? <ol className="pa-progress mt16" aria-label="Visit progress">{VISIT_STEPS.map((s, i) => <li key={s.key} className={cx(i < stepIdx && "done", i === stepIdx && "now")}><span className="pa-progress-dot" aria-hidden="true" /><span>{s.label}</span></li>)}</ol> : null}
    <div className="pa-visit-grid mt16">
      {pl ? <Stat icon={LuUsers} label={e.status === "arriving" ? "Waiting now" : "Your place in line"} value={e.status === "arriving" ? `${pl.ahead} ahead` : ordinal(pl.position)} /> : null}
      {pl ? <Stat icon={LuClock} label="Estimated wait" value={fmtMins(pl.estMin)} /> : null}
      <Stat icon={LuCalendarClock} label={e.status === "arriving" ? "Pre-registered" : "Time here"} value={D.fmtSince(e.arrivalAt)} />
      {bed ? <Stat icon={LuMapPin} label="Where you are" value={inpatient ? `${D.UNITS[e.unit] || e.unit}, ${bed.label}` : `${bed.zone === "Fast track" ? "Fast track" : bed.zone === "Hallway" ? "Hallway space" : bed.zone} ${bed.label}`} /> : null}
      {e.md ? <Stat icon={LuStethoscope} label="Your doctor" value={e.md} /> : null}
    </div>
    <div className="pa-note mt12"><LuInfo aria-hidden="true" /><span>{STATUS_HELP[e.status] || "Your care team will keep you updated."}{pl ? " Wait times are estimates: anyone sicker is always seen first." : ""}</span></div>
    <div className="pa-fine mt8">Status: {D.STATUS_LABEL[e.status]} · Reason: {e.cc}</div>
  </div>;
}
const Stat = ({ icon: Icon, label, value }) => <div className="pa-stat"><Icon aria-hidden="true" /><div><div className="pa-stat-l">{label}</div><div className="pa-stat-v">{value}</div></div></div>;

function ApptRow({ a, onCancel, past }) {
  const clinic = S.useDoc("clinics", a.clinicId);
  const virtual = clinic?.distanceKm === 0;
  const today = new Date(a.t).toDateString() === new Date().toDateString();
  return <div className={cx("pa-card pa-appt-row", (past || a.status === "cancelled") && "muted")}>
    <div className="pa-appt-time"><b>{D.fmtClock(a.t)}</b><span>{today ? "Today" : D.fmtDate(a.t)}</span></div>
    <div className="grow">
      <div className="pa-h3">{a.clinicName}</div>
      <div className="pa-sub">{virtual ? <><LuVideo aria-hidden="true" className="pa-inline-ic" />Video visit</> : clinic?.kind}{a.status === "cancelled" ? " · Cancelled" : past ? " · Done" : ""}</div>
    </div>
    {onCancel ? <PButton variant="ghost" className="sm" onClick={onCancel} aria-label={`Cancel ${a.clinicName} at ${D.fmtClock(a.t)}`}>Cancel</PButton> : null}
  </div>;
}

function CancelSheet({ a, onClose }) {
  const go = () => {
    const c = S.get("clinics", a.clinicId);
    S.patch("appointments", a.id, { status: "cancelled", cancelledAt: Date.now() });
    if (c) S.patch("clinics", c.id, { slots: (c.slots || []).map((s) => (s.id === a.slotId && s.bookedBy?.apptId === a.id ? { ...s, bookedBy: null } : s)) });
    S.audit("patient", "Cancelled appointment", `${D.fullName(S.get("patients", a.patientId))}: ${a.clinicName} ${D.fmtClock(a.t)}`, { patientId: a.patientId });
    toast("Appointment cancelled. The time is free for someone else.");
    onClose();
  };
  return <Sheet open={!!a} onClose={onClose} title="Cancel this visit?" subtitle={a ? `${a.clinicName} at ${D.fmtClock(a.t)}` : ""}
    footer={<><PButton variant="ghost" onClick={onClose}>Keep it</PButton><PButton variant="danger" icon={LuCalendarX} onClick={go}>Cancel visit</PButton></>}>
    <p className="pa-sub">The time goes back to the clinic so someone else can use it.</p>
  </Sheet>;
}

function PastVisit({ e, lang }) {
  const [open, setOpen] = useState(!!e.dischargeInstructions && D.minsSince(e.dischargedAt) < 72 * 60);
  const end = e.dischargedAt || e.closedAt || e.admittedAt || e.arrivalAt;
  const di = e.dischargeInstructions;
  const has = !!(di?.text || e.diversion || e.followUp);
  return <div className="pa-card pa-past">
    <button type="button" className="pa-past-head" onClick={() => has && setOpen(!open)} aria-expanded={has ? open : undefined} disabled={!has}>
      <span className="pa-tile"><LuFileText aria-hidden="true" /></span>
      <span className="grow"><span className="pa-h3">{e.dx || e.cc}</span><span className="pa-sub">{e.kind === "IP" ? "Hospital stay" : "Emergency visit"} · {D.fmtDate(end)} · {PLAIN_STATUS[e.status] || D.STATUS_LABEL[e.status]}</span></span>
      {has ? <LuChevronDown aria-hidden="true" className={cx("pa-chev", open && "open")} /> : null}
    </button>
    {open ? <div className="pa-past-body">
      {di?.text ? <><div className="pa-label">Discharge instructions{di.lang && di.lang !== "en" ? ` · ${D.LANGS[di.lang] || di.lang}` : ""}</div><Markdown text={di.text} className="pa-md" /></> : null}
      {e.followUp ? <div className="pa-note mt8"><LuCalendarCheck aria-hidden="true" /><span>Follow-up: {e.followUp}</span></div> : null}
      {e.diversion ? <div className="pa-note mt8"><LuCalendarCheck aria-hidden="true" /><span>Moved to {e.diversion.clinicName} at {D.fmtClock(e.diversion.t)}</span></div> : null}
      {di?.text && lang && di.lang && lang !== di.lang ? <p className="pa-fine mt8">These were written in {D.LANGS[di.lang] || di.lang}. Ask Aster in Care to explain them in your language.</p> : null}
    </div> : null}
  </div>;
}
