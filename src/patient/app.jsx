// Aster Care: the patient app. Desktop shows it in a phone frame beside a short
// explainer of the loop with Hospital OS; mobile is full-screen.
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { LuMessageCircleHeart, LuCalendarCheck, LuMapPin, LuHeartPulse, LuMessagesSquare, LuFileText, LuSignature, LuSmartphone, LuHospital, LuCheck, LuArrowRight, LuUserRound, LuLanguages, LuMonitor, LuChevronRight } from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import { go } from "../lib/ui-state.js";
import { useNow, cx } from "../ui/index.jsx";
import { PA, useIsDesktop, BrandTile, Mark, Sheet, PButton } from "./ui.jsx";
import { savedPatientId, savePatientId, erLoad } from "./lib.js";
import Care from "./care.jsx";
import FindCare, { PreRegisterSheet } from "./find.jsx";
import Visits from "./visits.jsx";
import Health, { setLang } from "./health.jsx";
import { Picker, Onboarding } from "./onboarding.jsx";
import "./patient.css";

if (typeof window !== "undefined" && /[?&]debug=1\b/.test(window.location.search)) window.__aster = { S, D };

const TABS = [
  { key: "care", label: "Care", icon: LuMessageCircleHeart },
  { key: "visits", label: "Visits", icon: LuCalendarCheck },
  { key: "find", label: "Find care", icon: LuMapPin },
  { key: "health", label: "Health", icon: LuHeartPulse },
];
const TITLES = { care: "Aster Care", visits: "Visits", find: "Find care", health: "Health" };

export default function PatientApp() {
  const desktop = useIsDesktop();
  const [pid, setPidRaw] = useState(() => savedPatientId());
  const setPid = useCallback((id) => { savePatientId(id); setPidRaw(id); }, []);
  if (!desktop) return <div className="pa-root pa-mobile"><PhoneApp mobile pid={pid} setPid={setPid} /></div>;
  return <div className="pa-root pa-desktop">
    <header className="pa-top">
      <div className="row" style={{ gap: 10 }}><BrandTile size={28} /><span className="pa-top-name">Aster</span><span className="pa-top-sub">Patient app preview</span></div>
      <span className="grow" />
      <ModeSwitch />
    </header>
    <div className="pa-stage">
      <Explainer pid={pid} />
      <div className="pa-phone" aria-label="Aster Care on a phone">
        <div className="pa-phone-screen"><StatusBar /><PhoneApp pid={pid} setPid={setPid} /></div>
      </div>
      <LivePanel pid={pid} />
    </div>
  </div>;
}

function ModeSwitch({ compact }) {
  if (compact) return <button type="button" className="pa-os-btn" onClick={() => go("command")} aria-label="Switch to Hospital OS" title="Switch to Hospital OS"><LuMonitor aria-hidden="true" /><span>OS</span></button>;
  return <div className={cx("pa-mode", compact && "compact")} role="group" aria-label="Switch product">
    <button type="button" onClick={() => go("command")}>{compact ? <><LuMonitor aria-hidden="true" />OS</> : "Hospital OS"}</button>
    <button type="button" className="on" aria-pressed="true">{compact ? <><LuSmartphone aria-hidden="true" />App</> : "Patient app"}</button>
  </div>;
}

function StatusBar() {
  const now = useNow();
  return <div className="pa-statusbar" aria-hidden="true">
    <span className="num">{D.fmtClock(now)}</span>
    <span className="pa-notch" />
    <span className="pa-sb-icons">
      <svg width="17" height="11" viewBox="0 0 17 11"><rect x="0" y="7" width="3" height="4" rx="1" fill="currentColor" /><rect x="4.5" y="5" width="3" height="6" rx="1" fill="currentColor" /><rect x="9" y="2.5" width="3" height="8.5" rx="1" fill="currentColor" /><rect x="13.5" y="0" width="3" height="11" rx="1" fill="currentColor" /></svg>
      <svg width="24" height="11" viewBox="0 0 24 11"><rect x=".5" y=".5" width="20" height="10" rx="3" fill="none" stroke="currentColor" opacity=".45" /><rect x="2" y="2" width="15" height="7" rx="1.6" fill="currentColor" /><rect x="21.5" y="3.5" width="1.6" height="4" rx=".8" fill="currentColor" opacity=".45" /></svg>
    </span>
  </div>;
}

/* ============================== the app ============================= */
function PhoneApp({ mobile, pid, setPid }) {
  const patients = S.useCollection("patients");
  const threads = S.useCollection("threads");
  const [mode, setMode] = useState("pick"); // pick | onboard
  const [tab, setTab] = useState("care");
  const [pendingPrompt, setPendingPrompt] = useState(null);
  const [prereg, setPrereg] = useState(false);
  const [settings, setSettings] = useState(false);
  const patient = pid ? patients.find((p) => p.id === pid) : null;
  const thread = useMemo(() => (patient ? threads.filter((t) => t.patientId === patient.id).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] : null), [threads, patient?.id]);

  useEffect(() => { if (patient && !thread) D.createThread(patient.id, patient.lang || "en"); }, [patient?.id, !!thread]);
  const choose = useCallback((id) => { setPid(id); setTab("care"); setMode("pick"); }, [setPid]);
  const ask = useCallback((t) => { setPendingPrompt(t); setTab("care"); }, []);
  const ctx = useMemo(() => ({ patient, thread, tab, setTab, ask, pendingPrompt, setPendingPrompt, openPrereg: () => setPrereg(true), openSettings: () => setSettings(true) }), [patient, thread, tab, ask, pendingPrompt]);

  if (!patient) return <div className="pa-app">
    {mobile ? <div className="pa-appbar"><div className="row" style={{ gap: 8 }}><BrandTile size={26} /><b>Aster Care</b></div><ModeSwitch compact /></div> : null}
    {mode === "onboard" ? <Onboarding onDone={choose} onBack={() => setMode("pick")} /> : <Picker onPick={choose} onCreate={() => setMode("onboard")} />}
  </div>;

  const Screen = { care: Care, visits: Visits, find: FindCare, health: Health }[tab];
  const unread = (thread?.unread || 0) > 0 && tab !== "care";
  return <PA.Provider value={ctx}>
    <div className="pa-app">
      <header className={cx("pa-head", tab === "care" && "care", mobile && "mobile")}>
        {tab === "care" ? <span className="pa-head-mark" aria-hidden="true"><Mark size={16} /></span> : null}
        <div className="grow">
          <h1 className={tab === "care" ? "pa-h2" : "pa-h1"}>{TITLES[tab]}</h1>
          {tab === "care" ? <div className="pa-fine pa-ellipsis">AI doctor · a physician signs every plan</div> : null}
        </div>
        {mobile ? <ModeSwitch compact /> : null}
        <button type="button" className="pa-me" onClick={() => setSettings(true)} aria-label={`Profile and settings for ${D.fullName(patient)}`} style={{ background: D.colorFor(D.fullName(patient)) }}>{D.initials(D.fullName(patient))}</button>
      </header>
      <main className={cx("pa-main", tab === "care" && "care")} key={tab}><Screen /></main>
      <nav className="pa-tabs" aria-label="Aster Care">
        {TABS.map((t) => <button key={t.key} type="button" className={cx("pa-tab", tab === t.key && "on")} aria-current={tab === t.key ? "page" : undefined} aria-label={t.key === "care" && unread ? `${t.label}, ${thread.unread} unread` : undefined} onClick={() => setTab(t.key)}>
          <span className="pa-tab-ic"><t.icon aria-hidden="true" />{t.key === "care" && unread ? <span className="pa-unread" aria-hidden="true" /> : null}</span>
          <span>{t.label}</span>
        </button>)}
      </nav>
      <PreRegisterSheet open={prereg} onClose={() => setPrereg(false)} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} patient={patient} onSwitch={() => { setSettings(false); setPid(null); setMode("pick"); }} />
    </div>
  </PA.Provider>;
}

function SettingsSheet({ open, onClose, patient: p, onSwitch }) {
  return <Sheet open={open} onClose={onClose} title={D.fullName(p)} subtitle={`${D.ageOf(p.dob) ?? ""}${p.sex ? " · " + (p.sex === "F" ? "Female" : "Male") : ""} · MRN ${p.mrn}`}>
    <label className="pa-field"><span className="pa-label"><LuLanguages aria-hidden="true" className="pa-inline-ic" />Language</span>
      <select className="pa-input" value={p.lang || "en"} onChange={(e) => setLang(p, e.target.value)}>{Object.entries(D.LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
    <div className="pa-card flush mt16">
      <button type="button" className="pa-person" onClick={onSwitch}><span className="pa-tile sm"><LuUserRound aria-hidden="true" /></span><span className="grow w6">Switch profile</span><LuChevronRight aria-hidden="true" /></button>
      <button type="button" className="pa-person" onClick={() => go("signoff")}><span className="pa-tile sm"><LuMonitor aria-hidden="true" /></span><span className="grow"><span className="w6">Open Hospital OS</span><span className="pa-sub">See what the care team sees</span></span><LuChevronRight aria-hidden="true" /></button>
    </div>
    <p className="pa-fine mt16">Aster Care is a fictional demo. In an emergency, call 911. Info-Santé: 811.</p>
  </Sheet>;
}

/* ============================== side panels ========================= */
function Explainer({ pid }) {
  const threads = S.useCollection("threads"); const reviews = S.useCollection("reviews"); const appts = S.useCollection("appointments"); const encs = S.useCollection("encounters");
  const done = useMemo(() => {
    const th = threads.filter((t) => t.patientId === pid);
    const rv = reviews.filter((r) => r.patientId === pid && r.createdAt);
    return [
      th.some((t) => (t.messages || []).some((m) => m.role === "patient")),
      rv.length > 0,
      rv.some((r) => r.status !== "pending"),
      th.some((t) => (t.messages || []).some((m) => m.role === "md")),
      appts.some((a) => a.patientId === pid) || encs.some((e) => e.patientId === pid && e.source === "app"),
    ];
  }, [pid, threads, reviews, appts, encs]);
  const steps = [
    { icon: LuMessagesSquare, title: "The patient describes symptoms", text: "Aster interviews like a family doctor, in the patient's language, and screens for red flags first." },
    { icon: LuFileText, title: "Aster drafts a plan", text: "Assessment, next steps and any prescription go to the physician sign-off queue." },
    { icon: LuSignature, title: "A physician signs in Hospital OS", text: "They approve, edit or ask for a video visit, in seconds.", action: { label: "Open sign-off", run: () => go("signoff") } },
    { icon: LuSmartphone, title: "The patient sees it live", text: "The plan card changes to Signed and the physician's note appears in the chat." },
    { icon: LuHospital, title: "Find care uses real capacity", text: "Booking takes a real clinic slot. Pre-registering puts the patient on the hospital's triage queue.", action: { label: "Open triage", run: () => go("triage") } },
  ];
  return <aside className="pa-explain" aria-label="What you're looking at">
    <div className="pa-kicker">What you're looking at</div>
    <h2 className="pa-explain-h">One loop between patient and hospital</h2>
    <ol className="pa-explain-steps">{steps.map((s, i) => <li key={s.title} className={cx(done[i] && "done")}>
      <span className="pa-explain-n" aria-hidden="true">{done[i] ? <LuCheck /> : i + 1}</span>
      <div><div className="pa-explain-t">{s.title}</div><div className="pa-explain-d">{s.text}</div>
        {s.action ? <button type="button" className="pa-link sm" onClick={s.action.run}>{s.action.label}<LuArrowRight /></button> : null}</div>
    </li>)}</ol>
  </aside>;
}

function LivePanel({ pid }) {
  const reviews = S.useCollection("reviews"); const encs = S.useCollection("encounters"); const beds = S.useCollection("beds");
  const p = S.useDoc("patients", pid);
  const load = useMemo(() => erLoad(encs, beds), [encs, beds]);
  const mine = useMemo(() => reviews.filter((r) => r.patientId === pid).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 3), [reviews, pid]);
  const pending = reviews.filter((r) => r.status === "pending").length;
  const enc = encs.find((e) => e.patientId === pid && D.isEdActive(e));
  return <aside className="pa-livepanel" aria-label="Live in Hospital OS">
    <div className="pa-kicker"><span className="pa-live-dot" aria-hidden="true" />Live in Hospital OS</div>
    <div className="pa-lp-card">
      <div className="pa-lp-row"><span>Sign-off queue</span><b className="num">{pending}</b></div>
      <div className="pa-lp-row"><span>ER waiting now</span><b className="num">{load.waiting}</b></div>
      <div className="pa-lp-row"><span>Arriving from the app</span><b className="num">{load.metrics.arriving}</b></div>
    </div>
    {p ? <>
      <div className="pa-lp-h">{p.first}'s items</div>
      {mine.length ? mine.map((r) => <button key={r.id} type="button" className="pa-lp-item" onClick={() => go("signoff")}>
        <span className={cx("pa-lp-st", r.status)}>{r.status === "pending" ? "Waiting" : r.status === "approved" ? "Signed" : r.status === "modified" ? "Edited" : r.status === "video" ? "Video" : "Declined"}</span>
        <span className="grow ellipsis">{r.title}</span>
      </button>) : <div className="pa-lp-empty">Nothing sent yet. Start a chat on the phone to see a plan arrive here.</div>}
      {enc ? <button type="button" className="pa-lp-item" onClick={() => go("triage")}><span className="pa-lp-st arriving">ER</span><span className="grow ellipsis">{D.STATUS_LABEL[enc.status]}: {enc.cc}</span></button> : null}
    </> : null}
    <PButton variant="soft" block className="mt12" icon={LuMonitor} onClick={() => go("signoff")}>Open Hospital OS</PButton>
  </aside>;
}
