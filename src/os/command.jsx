// Command center: live patient flow, KPIs, next best actions, Copilot, activity.
import React, { useLayoutEffect, useMemo, useRef, useState, useEffect } from "react";
import {
  LuChevronRight, LuChevronDown, LuZap, LuCircleCheck, LuActivity, LuSparkles, LuCompass, LuCheck, LuScrollText,
} from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import { go, openChart, openGuide } from "../lib/ui-state.js";
import { Button, Badge, Panel, PageHead, Kpi, Empty, toast, useNow, cx } from "../ui/index.jsx";
import { analyzeFlow } from "./copilot.js";
import Copilot from "./copilot.jsx";
import "./command.css";

const dur = (m) => D.fmtDur(m * D.MIN);
const shortName = (e) => { const p = D.patientOf(e); return p ? `${p.first} ${p.last[0]}.` : "Unknown"; };

export default function CommandCenter() {
  const now = useNow();
  const encounters = S.useCollection("encounters");
  const beds = S.useCollection("beds");
  const settings = S.useDoc("meta", "settings");
  const flow = useMemo(() => analyzeFlow(encounters, beds), [encounters, beds, now]);
  const m = useMemo(() => D.computeMetrics(encounters, beds), [encounters, beds, now]);
  return (
    <div className="cc">
      <PageHead
        title="Command center"
        subtitle={`${settings?.hospitalName || "Hôpital St-Laurent"} · live as of ${D.fmtClock(now)}. Every number is computed from the current census.`}
        actions={<Button size="sm" icon={LuCompass} onClick={() => openGuide(true)}>Demo guide</Button>}
      />
      <FlowHero flow={flow} />
      <Kpis m={m} />
      <div className="cc-grid">
        <div className="cc-a"><NextActions now={now} /></div>
        <aside className="cc-side"><Copilot /></aside>
        <div className="cc-f"><Feed /></div>
      </div>
    </div>
  );
}

/* ============================== flow hero ============================== */
function useFlip(deps) {
  const nodes = useRef(new Map());
  const rects = useRef(new Map());
  const box = useRef(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const root = box.current; if (!root) return;
    const o = root.getBoundingClientRect();
    const next = new Map();
    nodes.current.forEach((el, id) => {
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      const pos = { x: r.left - o.left, y: r.top - o.top };
      next.set(id, pos);
      const prev = rects.current.get(id);
      if (prev) {
        const dx = prev.x - pos.x, dy = prev.y - pos.y;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          el.style.transition = "none";
          el.style.transform = `translate(${dx}px, ${dy}px)`;
          el.classList.add("moving");
          requestAnimationFrame(() => requestAnimationFrame(() => {
            el.style.transition = "transform 1.1s var(--ease)"; el.style.transform = "";
            setTimeout(() => el.classList.remove("moving"), 1200);
          }));
        }
      } else if (mounted.current) el.classList.add("cc-dot-new");
    });
    rects.current = next;
    mounted.current = true;
  });
  // re-measure after resizes so a resize is not animated as movement
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const root = box.current; if (!root) return;
      const o = root.getBoundingClientRect();
      nodes.current.forEach((el, id) => { if (el.isConnected) { const r = el.getBoundingClientRect(); rects.current.set(id, { x: r.left - o.left, y: r.top - o.top }); } });
    });
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const refFor = (id) => (el) => { if (el) nodes.current.set(id, el); else nodes.current.delete(id); };
  return { box, refFor };
}

function FlowHero({ flow }) {
  const { box, refFor } = useFlip();
  const b = flow.bottleneck;
  const ip = flow.inpatient;
  return (
    <section className="cc-hero" aria-label="Patient flow across the hospital">
      <div className="cc-hero-top">
        <div className="grow">
          <div className="cc-eyebrow"><span className="cc-live" />Patient flow · live</div>
          <div className="cc-hero-title"><span className="num">{flow.edCount}</span> patients moving through emergency, <span className="num">{ip.occupancy}%</span> of inpatient beds full</div>
        </div>
        <div className="cc-legend" aria-label="Legend">
          {[1, 2, 3, 4, 5].map((l) => <span key={l} className="row" style={{ gap: 5 }}><i className={cx("cc-dot", "l" + l)} />{l}</span>)}
          <span className="row" style={{ gap: 5 }}><i className="cc-dot l5 over" />past target</span>
        </div>
      </div>

      <div className={cx("cc-bneck", !b && "clear")} role="status">
        {b ? <><span className="cc-bneck-tag">Bottleneck</span><span><b>{b.label}.</b> {b.text}</span></>
          : <><LuCircleCheck /><span>Every stage is within its expected time.</span></>}
      </div>

      <div className="cc-track" ref={box}>
        {flow.stages.map((s, i) => {
          const isB = b && b.key === s.key;
          const over = s.count && s.ratio > 1;
          return (
            <React.Fragment key={s.key}>
              <button className={cx("cc-stage", isB && "is-b", !s.count && "empty")} onClick={() => go(s.route)}
                aria-label={`${s.label}: ${s.count} patients, median ${dur(s.median)} in stage, expected ${s.expectedLabel}. Open ${s.route === "beds" ? "Beds and flow" : "Emergency board"}.`}>
                <div className="cc-st-head"><span className="cc-st-label">{s.short}</span>{isB ? <span className="cc-st-flag">Bottleneck</span> : null}</div>
                <div className="cc-st-nums">
                  <span className="cc-st-count num">{s.count}</span>
                  <span className={cx("cc-st-time num", over && "over")}>{s.count ? dur(s.median) : "–"}</span>
                </div>
                <div className="cc-gauge" aria-hidden="true">
                  <i className={cx(over && "over")} style={{ width: `${Math.min(100, (s.ratio / 2) * 100)}%` }} /><b />
                </div>
                <div className="cc-st-exp">goal {s.key === "md" && s.count ? dur(s.expected) : s.expectedLabel}{s.overCount ? <span className="cc-st-over"> · {s.overCount} over</span> : null}</div>
                <div className="cc-dots" aria-hidden="true">
                  {s.patients.map((p) => <i key={p.e.id} ref={refFor(p.e.id)} className={cx("cc-dot", "l" + (p.e.ctas || 0), p.mins > p.expected && "over")}
                    title={`${D.fullName(D.patientOf(p.e))}${p.e.ctas ? `, CTAS ${p.e.ctas}` : ", not triaged"}, ${dur(p.mins)} in stage`} />)}
                </div>
                <div className="cc-st-foot">{s.patients[0] ? <>Longest <span className="cc-st-who">{shortName(s.patients[0].e)}</span> <span className="num">{dur(s.patients[0].mins)}</span></> : "No patients"}</div>
              </button>
              <span className="cc-arrow" aria-hidden="true"><LuChevronRight /></span>
            </React.Fragment>
          );
        })}
        <button className="cc-stage cc-ip" onClick={() => go("beds")} aria-label={`Inpatient units: ${ip.occupancy}% occupied, ${ip.free} free beds. Open Beds and flow.`}>
          <div className="cc-st-head"><span className="cc-st-label">Inpatient units</span></div>
          <div className="cc-st-nums">
            <span className="cc-st-count num">{ip.occupancy}<small>%</small></span>
            <span className="cc-st-time num ok">{ip.free} free</span>
          </div>
          <div className="cc-units">
            {ip.units.map((u) => (
              <div key={u.unit} className="cc-unit" title={`${u.name}: ${u.occupied} occupied, ${u.free} free, ${u.cleaning} cleaning`}>
                <span className="cc-unit-k">{u.unit}</span>
                <span className="cc-unit-bar">
                  <i className="o" style={{ flex: u.occupied }} /><i className="c" style={{ flex: u.cleaning }} /><i className="f" style={{ flex: u.free }} /><i className="x" style={{ flex: u.blocked }} />
                </span>
                <span className={cx("cc-unit-n num", u.free && "ok")}>{u.free}</span>
              </div>
            ))}
          </div>
          <div className="cc-st-foot">{ip.likely} likely discharges today · {ip.cleaning} beds cleaning</div>
        </button>
      </div>
    </section>
  );
}

/* ================================ KPIs ================================= */
function Kpis({ m }) {
  const hist = S.useDoc("meta", "history");
  const pts = hist?.points || [];
  const series = (k, cur) => [...pts.slice(-48).map((p) => p[k]), cur];
  return (
    <div className="cc-kpis">
      <Kpi label="ED census" value={m.edCount} sub={`${m.edBedsUsed} of ${m.edCapacity} spaces in use`} spark={series("census", m.edCount)} onClick={() => go("ed")} />
      <Kpi label="Waiting" value={m.waitingTriage + m.waitingMd} sub={`${m.waitingTriage} for triage · ${m.waitingMd} for MD`} spark={series("waiting", m.waitingTriage + m.waitingMd)} onClick={() => go("ed")} />
      <Kpi label="Boarding" value={m.boarding} tone={m.boarding ? "warn" : undefined} sub={m.boarding ? `Oldest ${dur(m.oldestBoardMin)}` : "No admitted patients waiting"} spark={series("boarding", m.boarding)} sparkColor="var(--warn)" onClick={() => go("beds")} />
      <Kpi label="Inpatient occupancy" value={`${m.ipOccupancy}%`} tone={m.ipOccupancy >= 95 ? "bad" : undefined} sub={`${m.ipFree} free · ${m.ipCleaning} cleaning`} spark={series("ipOcc", m.ipOccupancy)} onClick={() => go("beds")} />
      <Kpi label="Past CTAS target" value={m.overTarget} tone={m.overTarget ? "bad" : "ok"} sub="Over CTAS wait goal" title="Patients waiting longer than their CTAS time-to-physician target" onClick={() => go("ed")} />
      <Kpi label="LWBS risk" value={m.lwbsRisk} tone={m.lwbsRisk ? "warn" : "ok"} sub="CTAS 4–5 waiting > 2.5 h" title="Low-acuity patients waiting over 2.5 hours are at risk of leaving without being seen" onClick={() => go("ed")} />
    </div>
  );
}

/* ========================== next best actions ========================== */
const dismissed = new Set(); // session-only
const ranKeys = new Set(); // session-only: actions already run with the same targets
const doneLog = []; // session-only
const recKey = (r) => `${r.id}:${(r.targets || []).join(",")}:${(r.action?.payload?.bedIds || []).join(",")}`;
const SEV = { critical: { label: "Critical", tone: "bad" }, high: { label: "High", tone: "warn" }, medium: { label: "Medium", tone: "info" } };
const MIN_KINDS = new Set(["late", "sepsis"]);
function impactText(r) {
  const hours = MIN_KINDS.has(r.kind) ? r.impact / 60 : r.impact;
  if (!hours) return null;
  if (hours < 1.5) return `saves ~${Math.max(5, Math.round(hours * 60))} patient-minutes`;
  return `saves ~${hours >= 10 ? Math.round(hours) : Math.round(hours * 10) / 10} patient-hours`;
}

function NextActions({ now }) {
  const encounters = S.useCollection("encounters");
  const beds = S.useCollection("beds");
  const clinics = S.useCollection("clinics");
  const tasks = S.useCollection("tasks");
  const [, force] = useState(0);
  const recs = useMemo(() => D.recommendations(), [encounters, beds, clinics, tasks, now]);
  const visible = recs.filter((r) => !dismissed.has(recKey(r)) && !ranKeys.has(recKey(r)));
  const run = (r) => {
    const key = recKey(r);
    const msg = D.runRecommendation(r, "user");
    S.audit("user", "Ran next best action", r.title, { recId: r.id });
    ranKeys.add(key);
    doneLog.unshift({ id: key + Date.now(), title: r.title, msg, t: Date.now() });
    toast(msg);
    force((x) => x + 1);
  };
  const dismiss = (r) => { dismissed.add(recKey(r)); force((x) => x + 1); toast("Dismissed for this session"); };
  return (
    <Panel className="cc-nba" title="Next best actions" subtitle="Ranked by clinical severity, then patient-hours saved. Recomputed as the hospital changes." icon={LuZap}
      actions={visible.length ? <Badge tone={visible.some((r) => r.severity === "critical") ? "bad" : "outline"}>{visible.length} open</Badge> : null} flush>
      <div id="cc-actions" />
      {visible.length ? <ol className="cc-recs">{visible.map((r, i) => <RecCard key={recKey(r)} r={r} rank={i + 1} onRun={() => run(r)} onDismiss={() => dismiss(r)} />)}</ol>
        : <Empty icon={LuCircleCheck} title="All clear">No action is needed right now. New recommendations appear here as patients arrive and results come back.</Empty>}
      {doneLog.length ? (
        <div className="cc-done">
          <div className="t-xs c-3 w5">Done this session</div>
          {doneLog.slice(0, 4).map((d) => <div key={d.id} className="cc-done-row"><LuCheck /><span className="grow ellipsis">{d.msg}</span><span className="t-xs c-3">{D.fmtAgo(d.t)}</span></div>)}
        </div>
      ) : null}
    </Panel>
  );
}

function RecCard({ r, rank, onRun, onDismiss }) {
  const [open, setOpen] = useState(false);
  const sev = SEV[r.severity] || SEV.medium;
  const impact = impactText(r);
  const parts = String(r.why || "").split(" · ").filter(Boolean);
  const targets = (r.targets || []).map((id) => S.get("encounters", id)).filter(Boolean).slice(0, 6);
  return (
    <li className={cx("cc-rec", r.severity)}>
      <span className="cc-rec-rank num" aria-label={`Rank ${rank}`}>{rank}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          <span className={cx("cc-sev", sev.tone)}>{sev.label}</span>
          {impact ? <span className="cc-impact num">{impact}</span> : null}
        </div>
        <div className="cc-rec-title">{r.title}</div>
        {!open ? <div className="t-xs c-2 ellipsis mt4">{parts[0]}</div> : null}
        <button className="cc-why-btn" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide why" : "Why"}<LuChevronDown style={{ transform: open ? "rotate(180deg)" : "none" }} /></button>
        {open ? (
          <div className="cc-why">
            <ul>{parts.map((p, i) => <li key={i}>{p}</li>)}</ul>
            {targets.length ? <div className="row wrap mt8" style={{ gap: 6 }}>{targets.map((e) => <button key={e.id} className="cc-pt" onClick={() => openChart(e.id)}>{D.fullName(D.patientOf(e))}<LuChevronRight /></button>)}</div> : null}
          </div>
        ) : null}
      </div>
      <div className="cc-rec-act">
        <Button size="sm" variant="ghost" onClick={onDismiss}>Dismiss</Button>
        <Button size="sm" variant="primary" onClick={onRun}>{r.action.label}</Button>
      </div>
    </li>
  );
}

/* ============================ activity feed ============================ */
function actorInfo(a = "") {
  if (a.startsWith("agent:")) { const s = a.slice(6); const m = s.match(/^(.*?)\s*\((.*)\)$/); return { kind: "agent", name: m ? m[1] : s, note: m ? m[2].replace("user", "staff") : null }; }
  if (a === "system") return { kind: "system", name: "System" };
  if (a === "patient") return { kind: "patient", name: "Patient" };
  return { kind: "user", name: "Staff" };
}
function Feed() {
  useNow();
  const audit = S.useCollection("audit");
  const rows = useMemo(() => [...audit].sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 25), [audit]);
  const seen = useRef(null);
  const fresh = new Set();
  if (seen.current) rows.forEach((r) => { if (!seen.current.has(r.id)) fresh.add(r.id); });
  useEffect(() => { seen.current = new Set(rows.map((r) => r.id)); });
  return (
    <Panel className="cc-feed" title="Live activity" subtitle="Every action by staff, AI agents and patients, as it happens." icon={LuActivity}
      actions={<Button size="sm" variant="ghost" icon={LuScrollText} onClick={() => go("audit")}>Audit log</Button>} flush>
      {!rows.length ? <Empty icon={LuActivity} title="No activity yet">Run a next best action or move a patient and it appears here.</Empty> : (
        <ul className="cc-feed-list">
          {rows.map((r) => {
            const a = actorInfo(r.actor);
            const enc = r.refs?.encounterId && S.get("encounters", r.refs.encounterId);
            const body = <>
              <span className={cx("cc-actor", a.kind)}>{a.kind === "agent" ? <LuSparkles /> : null}{a.name}</span>
              <span className="grow cc-feed-text"><span className="w5">{r.action}</span>{r.detail ? <span className="c-2"> · {r.detail}</span> : null}{a.note ? <span className="c-3"> · {a.note}</span> : null}</span>
              <time className="t-xs c-3 num" dateTime={new Date(r.t).toISOString()}>{D.fmtAgo(r.t)}</time>
            </>;
            return <li key={r.id} className={cx(fresh.has(r.id) && "new-flash")}>
              {enc ? <button className="cc-feed-row" onClick={() => openChart(enc.id)} title="Open chart">{body}</button> : <div className="cc-feed-row">{body}</div>}
            </li>;
          })}
        </ul>
      )}
    </Panel>
  );
}
