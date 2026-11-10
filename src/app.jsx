// Aster application shell: boot, navigation, command palette, routing.
import React, { useEffect, useMemo, useRef, useState, Suspense } from "react";
import {
  LuRadar, LuActivity, LuStethoscope, LuBedDouble, LuListChecks, LuCalendarClock, LuSignature, LuMic, LuInbox,
  LuChartColumn, LuScrollText, LuSettings, LuSearch, LuSmartphone, LuBookOpen, LuCloud, LuHardDrive, LuUserPlus,
  LuCornerDownLeft, LuRotateCcw, LuPlay, LuPause, LuCompass,
} from "react-icons/lu";
import * as S from "./lib/store.js";
import * as D from "./lib/domain.js";
import { boot, resetDemo } from "./lib/boot.js";
import { startSim, onSimChange, isSimLeader } from "./lib/sim.js";
import { useAIStatus } from "./lib/ai.js";
import { useUI, go, openChart, openPalette, closeChart, openGuide } from "./lib/ui-state.js";
import { Button, Badge, Dot, Toasts, toast, Kbd, Panel, PageHead, Field, Input, useHotkey, Modal, cx } from "./ui/index.jsx";
import { Ctas } from "./ui/clinical.jsx";

import CommandCenter from "./os/command.jsx";
import EdBoard from "./os/ed.jsx";
import Triage from "./os/triage.jsx";
import Beds from "./os/beds.jsx";
import Tasks from "./os/tasks.jsx";
import Staffing from "./os/staffing.jsx";
import SignOff from "./os/signoff.jsx";
import Scribe from "./os/scribe.jsx";
import Referrals from "./os/referrals.jsx";
import Analytics from "./os/analytics.jsx";
import Audit from "./os/audit.jsx";
import Blueprint from "./os/blueprint.jsx";
import ChartDrawer from "./os/chart.jsx";
import PatientApp from "./patient/app.jsx";
import Guide from "./os/guide.jsx";

const NAV = [
  { group: "Operate", items: [
    { key: "command", label: "Command center", icon: LuRadar },
    { key: "ed", label: "Emergency", icon: LuActivity, count: "ed" },
    { key: "triage", label: "Triage", icon: LuStethoscope, count: "triage" },
    { key: "beds", label: "Beds & flow", icon: LuBedDouble, count: "boarding" },
    { key: "tasks", label: "Tasks", icon: LuListChecks, count: "tasks" },
    { key: "staffing", label: "Staffing", icon: LuCalendarClock },
  ] },
  { group: "Clinical", items: [
    { key: "signoff", label: "Physician sign-off", icon: LuSignature, count: "signoff" },
    { key: "scribe", label: "Ambient scribe", icon: LuMic },
    { key: "referrals", label: "Referrals & fax", icon: LuInbox, count: "referrals" },
  ] },
  { group: "Insight", items: [
    { key: "analytics", label: "Analytics", icon: LuChartColumn },
    { key: "audit", label: "Agents & audit log", icon: LuScrollText },
  ] },
];
const PAGES = { command: CommandCenter, ed: EdBoard, triage: Triage, beds: Beds, tasks: Tasks, staffing: Staffing, signoff: SignOff, scribe: Scribe, referrals: Referrals, analytics: Analytics, audit: Audit, settings: Settings, blueprint: Blueprint };
export const TITLES = { command: "Command center", ed: "Emergency department", triage: "Triage", beds: "Beds & flow", tasks: "Tasks", staffing: "Staffing", signoff: "Physician sign-off", scribe: "Ambient scribe", referrals: "Referrals & fax", analytics: "Analytics", audit: "Agents & audit log", settings: "Settings", blueprint: "Blueprint", patient: "Aster Care" };

/* ============================== boot =============================== */
export default function App() {
  const [phase, setPhase] = useState({ p: 0, label: "Starting" });
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    boot((p, label) => setPhase({ p, label })).then(() => { setReady(true); startSim(); }).catch((e) => { console.error(e); setErr(e); });
    const off = S.onWriteError((e) => toast(e?.code === "quota_exceeded" ? "Storage is full. Reset the demo in Settings." : "A change couldn't be saved. Check your connection.", { kind: "bad" }));
    return off;
  }, []);
  if (err) return <div className="boot"><div className="boot-card"><div className="brandmark" style={{ margin: "0 auto" }}><Mark /></div><h1 className="t-h2 mt16" style={{ color: "#fff" }}>Aster couldn't start</h1><p className="t-sm mt8">{String(err.message || err)}</p><button className="btn mt16" onClick={() => location.reload()}>Try again</button></div></div>;
  if (!ready) return <Boot phase={phase} />;
  return <Root />;
}
function Mark() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" /><circle cx="12" cy="12" r="3.2" fill="#0E6B5C" /></svg>; }
function Boot({ phase }) {
  return <div className="boot"><div className="boot-card">
    <div className="row" style={{ justifyContent: "center", gap: 12 }}><div className="brandmark"><Mark /></div><span className="t-h1" style={{ color: "#fff" }}>Aster</span></div>
    <div className="t-sm mt16" style={{ color: "var(--rail-ink-2)" }}>{phase.label}…</div>
    <div className="boot-bar"><i style={{ width: `${Math.round(phase.p * 100)}%` }} /></div>
  </div></div>;
}

/* ============================== shell ============================== */
function Root() {
  const ui = useUI();
  useHotkey("mod+k", () => openPalette(true));
  if (ui.route === "patient") return <><PatientApp /><Toasts /><Palette open={ui.palette} /></>;
  const Page = PAGES[ui.route] || CommandCenter;
  return (
    <div className="shell">
      <Rail route={ui.route} />
      <div className="main">
        <TopBar route={ui.route} />
        <main className="page" id="page"><div className="page-inner" key={ui.route}><Page /></div></main>
      </div>
      <ChartDrawer encounterId={ui.chart} tab={ui.chartTab} onClose={closeChart} />
      <Palette open={ui.palette} />
      <Guide open={ui.guide} />
      <Toasts />
    </div>
  );
}

function useCounts() {
  const encs = S.useCollection("encounters"); const tasks = S.useCollection("tasks"); const reviews = S.useCollection("reviews"); const refs = S.useCollection("referrals");
  return useMemo(() => ({
    ed: encs.filter(D.isEdActive).length,
    triage: encs.filter((e) => e.kind === "ED" && ["waiting_triage", "arriving"].includes(e.status)).length,
    boarding: encs.filter((e) => e.status === "boarding").length,
    tasks: tasks.filter((t) => t.status !== "done").length,
    signoff: reviews.filter((r) => r.status === "pending").length,
    referrals: refs.filter((r) => r.status === "new").length,
  }), [encs, tasks, reviews, refs]);
}

function Rail({ route }) {
  const counts = useCounts();
  const settings = S.useDoc("meta", "settings");
  const alertKeys = { signoff: counts.signoff > 0, triage: counts.triage > 2, boarding: counts.boarding > 0 };
  return (
    <nav className="rail" aria-label="Main">
      <div className="rail-head"><div className="brandmark"><Mark /></div><div><div className="rail-name">Aster</div><div className="rail-site">{settings?.hospitalName || "Hôpital St-Laurent"}</div></div></div>
      <div className="rail-nav">
        {NAV.map((g) => <React.Fragment key={g.group}>
          <div className="rail-group">{g.group}</div>
          {g.items.map((it) => <button key={it.key} className={cx("nav-item", route === it.key && "on")} onClick={() => go(it.key)} aria-current={route === it.key ? "page" : undefined}>
            <it.icon />{it.label}{it.count && counts[it.count] ? <span className={cx("nav-count", alertKeys[it.count] && "alert")}>{counts[it.count]}</span> : null}
          </button>)}
        </React.Fragment>)}
        <div className="rail-group">Product</div>
        <button className="nav-item" onClick={() => go("patient")}><LuSmartphone />Patient app</button>
        <button className={cx("nav-item", route === "blueprint" && "on")} onClick={() => go("blueprint")}><LuBookOpen />Blueprint</button>
        <button className={cx("nav-item", route === "settings" && "on")} onClick={() => go("settings")}><LuSettings />Settings</button>
      </div>
      <div className="rail-foot">Fictional demo hospital. Not for clinical use.</div>
    </nav>
  );
}

function TopBar({ route }) {
  const ai = useAIStatus();
  const kind = S.backendKind();
  const [leader, setLeader] = useState(isSimLeader());
  useEffect(() => onSimChange(setLeader), []);
  const settings = S.useDoc("meta", "settings");
  const simOn = settings ? settings.simEnabled !== false : true;
  const aiText = { live: "Claude connected", connecting: "Connecting AI", offline: "AI offline: rules mode", denied: "AI permission off", busy: "AI busy, retrying" }[ai];
  return (
    <header className="topbar">
      <button className="search-btn" onClick={() => openPalette(true)} aria-label="Search patients and commands"><LuSearch size={15} /><span className="lbl">Search patients, beds, commands</span><span className="grow" /><Kbd>⌘K</Kbd></button>
      <span className="grow" />
      <button className="btn ghost sm only-desktop" onClick={() => openGuide(true)}><LuCompass />Demo guide</button>
      <button className="btn ghost sm" title={simOn ? "Live simulation is running (arrivals, results, cleaning)" : "Simulation paused"} onClick={() => S.patch("meta", "settings", { ...(settings || {}), simEnabled: !simOn })}>
        <Dot tone={simOn ? "live" : ""} /><span className="only-desktop">{simOn ? "Live" : "Paused"}</span>
      </button>
      <Badge tone={ai === "live" ? "ai" : ai === "denied" ? "warn" : ""} title={ai === "denied" ? "Allow Claude for this page to turn AI on" : undefined}><Dot tone={ai === "live" ? "live" : ""} /><span className="only-desktop">{aiText}</span></Badge>
      <Badge title={kind === "cloud" ? "Changes sync live to every device viewing this app" : kind === "sandbox" ? "You're viewing a shared link: this is your own private copy of the demo hospital. Changes stay in this browser." : "Stored in this browser only"} icon={kind === "cloud" ? LuCloud : LuHardDrive}><span className="only-desktop">{kind === "cloud" ? "Live sync" : kind === "sandbox" ? "Private sandbox" : "Local data"}</span></Badge>
      <div className="mode-switch only-desktop"><button className="on">Hospital OS</button><button onClick={() => go("patient")}>Patient app</button></div>
    </header>
  );
}

/* ========================= command palette ========================= */
function Palette({ open }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const inputRef = useRef(null);
  const patients = S.useCollection("patients");
  const encs = S.useCollection("encounters");
  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => inputRef.current?.focus(), 10); } }, [open]);
  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const nav = [...NAV.flatMap((g) => g.items), { key: "patient", label: "Patient app", icon: LuSmartphone }, { key: "blueprint", label: "Blueprint", icon: LuBookOpen }, { key: "settings", label: "Settings", icon: LuSettings }]
      .filter((n) => !ql || n.label.toLowerCase().includes(ql)).map((n) => ({ sec: "Go to", label: n.label, icon: n.icon, run: () => go(n.key) }));
    const actions = [
      { label: "Register a new patient", icon: LuUserPlus, run: () => go("triage"), kw: "new register arrival patient triage" },
      { label: "Open the demo guide", icon: LuCompass, run: () => openGuide(true), kw: "guide tour demo help" },
    ].filter((a) => !ql || (a.label + a.kw).toLowerCase().includes(ql)).map((a) => ({ sec: "Actions", ...a }));
    let pts = [];
    if (ql.length >= 2) {
      const active = new Map(); encs.forEach((e) => { if (D.isEdActive(e) || D.isInpatient(e)) active.set(e.patientId, e); });
      pts = patients.filter((p) => `${p.first} ${p.last} ${p.mrn}`.toLowerCase().includes(ql)).slice(0, 8).map((p) => {
        const e = active.get(p.id) || encs.filter((x) => x.patientId === p.id).sort((a, b) => b.arrivalAt - a.arrivalAt)[0];
        return { sec: "Patients", label: `${p.first} ${p.last}`, meta: e ? `${D.STATUS_LABEL[e.status]}${e.bedId ? " · " + (S.get("beds", e.bedId)?.label || "") : ""}` : p.mrn, ctas: e?.ctas, run: () => { if (e) { if (location.hash === "#patient") go("ed"); openChart(e.id); } else toast("No visit on file for this patient yet"); } };
      });
    }
    return [...pts, ...actions, ...nav];
  }, [q, patients, encs]);
  useEffect(() => setI(0), [q]);
  if (!open) return null;
  const run = (it) => { openPalette(false); it.run(); };
  let lastSec = null;
  return <>
    <div className="scrim" onClick={() => openPalette(false)} />
    <div className="palette" onClick={() => openPalette(false)}>
      <div className="palette-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <input ref={inputRef} className="palette-input" placeholder="Search patients by name or MRN, or type a command" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") openPalette(false); if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } if (e.key === "Enter" && items[i]) run(items[i]); }} />
        <div className="palette-list">
          {!items.length ? <div className="empty t-sm">No matches. Try a last name or MRN.</div> : null}
          {items.map((it, k) => { const head = it.sec !== lastSec; lastSec = it.sec; return <React.Fragment key={it.sec + it.label + k}>
            {head ? <div className="palette-sec">{it.sec}</div> : null}
            <div className={cx("palette-item", k === i && "on")} onMouseEnter={() => setI(k)} onClick={() => run(it)}>
              {it.ctas ? <Ctas level={it.ctas} /> : it.icon ? <it.icon /> : null}<span className="grow">{it.label}</span>{it.meta ? <span className="t-xs c-3">{it.meta}</span> : null}{k === i ? <LuCornerDownLeft /> : null}
            </div></React.Fragment>; })}
        </div>
      </div>
    </div>
  </>;
}

/* ============================== settings =========================== */
function Settings() {
  const settings = S.useDoc("meta", "settings") || {};
  const seed = S.useDoc("meta", "seed");
  const [confirm, setConfirm] = useState(false);
  const [prog, setProg] = useState(null);
  const user = S.currentUser();
  const doReset = async () => { setConfirm(false); setProg({ p: 0, label: "Starting" }); await resetDemo((p, label) => setProg({ p, label })); setProg(null); toast("Demo hospital reset"); };
  return <>
    <PageHead title="Settings" subtitle="Hospital profile, simulation and demo data." />
    <div className="grid g2">
      <Panel title="Hospital">
        <Field label="Display name"><Input defaultValue={settings.hospitalName || "Hôpital St-Laurent"} onBlur={(e) => e.target.value.trim() && S.patch("meta", "settings", { ...settings, hospitalName: e.target.value.trim() })} /></Field>
        <div className="t-sm c-2 mt12">Data store: <b>{S.backendKind() === "cloud" ? "Cloud database, synced live across devices" : S.backendKind() === "sandbox" ? "Your private sandbox in this browser (shared-link viewer)" : "This browser only (local mode)"}</b></div>
        <div className="t-sm c-2 mt4">Your access: <b>{user?.isOwner ? "Owner" : user?.canWrite ? "Can edit" : "View only"}</b></div>
        {seed ? <div className="t-sm c-2 mt4">Demo created {D.fmtDateTime(seed.seededAt)}</div> : null}
      </Panel>
      <Panel title="Live simulation">
        <p className="t-sm c-2">While someone has Aster open, the simulation adds realistic arrivals, returns test results and finishes bed cleaning, so the hospital keeps moving during a demo. Only one device drives it at a time.</p>
        <div className="row mt12"><Button icon={settings.simEnabled === false ? LuPlay : LuPause} onClick={() => S.patch("meta", "settings", { ...settings, simEnabled: settings.simEnabled === false })}>{settings.simEnabled === false ? "Resume simulation" : "Pause simulation"}</Button></div>
      </Panel>
      <Panel title="Demo data">
        <p className="t-sm c-2">Reset rebuilds the fictional hospital: about 100 patients, 95 beds, staff rosters, clinics and sign-off items. Every change made so far is erased for everyone viewing this app.</p>
        {prog ? <div className="mt12"><div className="t-sm">{prog.label}… {Math.round(prog.p * 100)}%</div><div className="boot-bar" style={{ background: "var(--sunken)" }}><i style={{ width: `${prog.p * 100}%`, background: "var(--brand)" }} /></div></div>
          : <div className="row mt12"><Button variant="danger" icon={LuRotateCcw} onClick={() => setConfirm(true)} disabled={!user?.canWrite}>Reset demo hospital</Button></div>}
      </Panel>
    </div>
    <Modal open={confirm} onClose={() => setConfirm(false)} title="Reset the demo hospital?" subtitle="All patients, visits, tasks and messages return to the starting state for everyone."
      footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={doReset}>Reset demo</Button></>} />
  </>;
}
