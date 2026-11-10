// Beds & flow: the bed manager's cockpit. Capacity by unit, live bed board with
// drag-to-place for ED boarders, discharge barriers with owners, a 24-hour
// capacity outlook and an AI huddle brief (deterministic fallback).
import React, { useMemo, useState, useCallback } from "react";
import {
  LuBedDouble, LuSparkles, LuGripVertical, LuWand, LuCircleCheck, LuLock, LuLockOpen, LuSprayCan,
  LuExternalLink, LuLogOut, LuUserCheck, LuX, LuTrendingUp, LuClock, LuListChecks, LuCheck, LuArrowRight,
} from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import * as AI from "../lib/ai.js";
import { openChart } from "../lib/ui-state.js";
import {
  Button, Badge, Panel, PageHead, Seg, Drawer, Modal, toast, Empty, AiLabel, Markdown, Typing, Select, Field, useNow, cx,
} from "../ui/index.jsx";
import { PatientLine } from "../ui/clinical.jsx";
import {
  IP_UNITS, CHART, shortName, dayOfStay, unitStats, bestBedFor, capacityOutlook, outlookSentence,
  huddleData, huddleFallback, openBarriers, openTaskFor, pct, ED_ADMIT_RATE,
} from "./flow-lib.js";
import "./flow.css";

const BLOCK_REASONS = ["Maintenance", "Isolation (infection control)", "Equipment out of service", "No nurse to staff it", "Reserved for incoming transfer"];
const UNIT_SHORT = { "7E": "Medicine", "8W": "Surgery", "6N": "Orthopedics", CCU: "Cardiology", ICU: "Intensive care" };
const ago = (t, pre = "") => (!t || D.minsSince(t) < 1 ? "just now" : pre + D.fmtSince(t));
const DRAG_TYPE = "text/aster-encounter";

export default function BedsPage() {
  useNow();
  const encounters = S.useCollection("encounters");
  const beds = S.useCollection("beds");
  const tasks = S.useCollection("tasks");
  const patients = S.useCollection("patients");
  const pmap = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);

  const [unit, setUnit] = useState("all");
  const [selBed, setSelBed] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [overBed, setOverBed] = useState(null);
  const [bestFor, setBestFor] = useState(null);
  const [brief, setBrief] = useState(null);

  const ipBeds = useMemo(() => beds.filter((b) => b.area === "IP").sort((a, b) => a.label.localeCompare(b.label)), [beds]);
  const encById = useMemo(() => new Map(encounters.map((e) => [e.id, e])), [encounters]);
  const stats = useMemo(() => IP_UNITS.map((u) => unitStats(u, beds, encounters)), [beds, encounters]);
  const total = useMemo(() => {
    const t = stats.reduce((s, u) => ({ occupied: s.occupied + u.occupied, total: s.total + u.total, free: s.free + u.free, cleaning: s.cleaning + u.cleaning, blocked: s.blocked + u.blocked, likely: s.likely + u.likely, alc: s.alc + u.alc }), { occupied: 0, total: 0, free: 0, cleaning: 0, blocked: 0, likely: 0, alc: 0 });
    return { ...t, occ: pct(t.occupied, t.total) };
  }, [stats]);
  const boarders = useMemo(() => encounters.filter((e) => D.isEdActive(e) && e.status === "boarding").sort((a, b) => (a.admitRequestAt || a.arrivalAt || 0) - (b.admitRequestAt || b.arrivalAt || 0)), [encounters]);
  const dragEnc = dragId ? encById.get(dragId) : null;
  const dragUnit = dragEnc ? D.SERVICE_UNIT[dragEnc.service] || "7E" : null;

  const place = useCallback((encId, bedId) => {
    const e = S.get("encounters", encId); const b = S.get("beds", bedId);
    if (!e || !b) return false;
    if (b.state !== "free") { toast(`${b.label} is not free. Pick a green bed.`, { kind: "bad" }); return false; }
    const edBed = e.bedId ? S.get("beds", e.bedId)?.label : null;
    const ok = D.assignInpatientBed(encId, bedId, "user");
    if (ok) toast(`Placed ${shortName(D.patientOf(e))} in ${b.label}.${edBed ? ` ED space ${edBed} sent for cleaning.` : ""} Porter task created.`);
    else toast("Couldn't place the patient. Refresh and try again.", { kind: "bad" });
    return ok;
  }, []);

  const runBrief = async () => {
    setBrief({ loading: true, text: "", ai: true });
    const data = huddleData(S.all("encounters"), S.all("beds"), S.all("tasks"));
    const prompt = `Write the bed huddle brief for the bed manager at Hôpital St-Laurent (Montréal). Use exactly 6 bullets, each starting with a short bold label (for example **Census:**). Cover: overall census and the tightest unit, ED boarders (oldest first, with wait), likely discharges today, discharge barriers that still need an owner (name the owner roles), ALC patients, and the 24-hour outlook with one concrete action. Use only these numbers; do not invent patients. Plain, calm language, no preamble.\n\nDATA (JSON):\n${JSON.stringify(data)}`;
    const t = await AI.text(prompt, { onText: (s) => setBrief({ loading: true, text: s, ai: true }) });
    if (t === null || !t.trim()) setBrief({ loading: false, text: huddleFallback(data), ai: false });
    else setBrief({ loading: false, text: t, ai: true });
  };

  const shownUnits = unit === "all" ? IP_UNITS : [unit];
  const sel = selBed ? beds.find((b) => b.id === selBed) : null;

  return (
    <div>
      <PageHead title="Beds & flow" subtitle="Inpatient capacity, ED boarders and discharge readiness across Hôpital St-Laurent. Drag a boarder onto a green bed to place them."
        actions={<Button variant="ai" icon={LuSparkles} loading={brief?.loading && !brief?.text} onClick={runBrief}>Bed huddle brief</Button>} />

      {brief ? (
        <div className="ai-card flow-ai" aria-live="polite">
          <div className="row" style={{ marginBottom: 8 }}>
            <AiLabel>Bed huddle brief</AiLabel>
            {brief.loading ? <Typing /> : <span className="t-xs c-3">{brief.ai ? "Generated from live bed data" : "Built from live bed data by rules"} at {D.fmtClock(Date.now())}</span>}
            <span className="grow" />
            <Button variant="ghost" size="sm" icon={LuX} aria-label="Close brief" onClick={() => setBrief(null)} />
          </div>
          {brief.text ? <Markdown text={brief.text} /> : <div className="t-sm c-3">Reading unit census, boarders and barriers…</div>}
        </div>
      ) : null}

      {/* capacity strip */}
      <div className="flow-cap">
        <div className="flow-total">
          <div className="t-xs c-2 w5">Hospital occupancy</div>
          <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
            <span className="t-display num" style={{ color: total.occ >= 95 ? "var(--bad)" : total.occ >= 90 ? "var(--warn)" : "var(--ink)" }}>{total.occ}%</span>
            <span className="t-sm c-2 num">{total.occupied} of {total.total} beds</span>
          </div>
          <OccBar s={total} />
          <div className="t-xs c-2 row wrap" style={{ gap: "2px 10px" }}>
            <span><b className="num">{total.free}</b> free</span><span><b className="num">{total.cleaning}</b> cleaning</span>
            <span className={boarders.length ? "c-bad" : ""}><b className="num">{boarders.length}</b> boarding in ED</span>
          </div>
        </div>
        {stats.map((s) => (
          <button key={s.unit} type="button" className={cx("flow-unit", unit === s.unit && "on")} aria-pressed={unit === s.unit}
            onClick={() => setUnit(unit === s.unit ? "all" : s.unit)} title={`Show only ${s.name}`}>
            <div className="flow-u-top"><span className="flow-u-name">{s.unit}</span><span className="t-xs c-3 ellipsis">{UNIT_SHORT[s.unit]}</span>
              <span className="flow-u-pct num" style={{ color: s.occ >= 95 ? "var(--bad)" : s.occ >= 90 ? "var(--warn)" : "var(--ink)" }}>{s.occ}%</span></div>
            <OccBar s={s} />
            <div className="flow-u-stats num">
              <span><b>{s.occupied}</b>/{s.total}</span><span className={s.free ? "c-ok" : ""}><b className={s.free ? "c-ok" : ""}>{s.free}</b> free</span>
              {s.cleaning ? <span><b>{s.cleaning}</b> cleaning</span> : null}{s.blocked ? <span><b>{s.blocked}</b> blocked</span> : null}
            </div>
            <div className="flow-u-stats num"><span><b>{s.likely}</b> likely discharges</span>{s.alc ? <span><b>{s.alc}</b> ALC</span> : null}</div>
          </button>
        ))}
      </div>

      <div className="flow-main">
        {/* bed board */}
        <Panel title="Bed board" icon={LuBedDouble} subtitle={unit === "all" ? "All inpatient units" : D.UNITS[unit]}
          actions={<div className="only-desktop"><Seg size="sm" value={unit} onChange={setUnit} options={[{ value: "all", label: "All" }, ...IP_UNITS.map((u) => ({ value: u, label: u }))]} /></div>}>
          <div className="flow-legend" style={{ marginBottom: 14 }}>
            <span><i className="flow-sw" style={{ background: "#F1F9F5", borderColor: "#C6E6D5" }} />Free</span>
            <span><i className="flow-sw" style={{ background: "#F0F4FB", borderColor: "#CCD9F0" }} />Cleaning</span>
            <span><i className="flow-sw" style={{ background: "#fff" }} />Occupied</span>
            <span><i className="flow-sw" style={{ background: "#fff", boxShadow: "inset 3px 0 0 var(--c3)" }} />Likely discharge (70%+)</span>
            <span><i className="flow-sw" style={{ background: "repeating-linear-gradient(135deg,#F3F5F7 0 3px,#E2E6EA 3px 6px)" }} />Blocked</span>
          </div>
          {dragEnc ? <div className="t-sm c-brand w5" style={{ marginBottom: 10 }}>Drop {shortName(pmap.get(dragEnc.patientId))} on a green bed. {dragUnit} beds match the {dragEnc.service} service.</div> : null}
          {shownUnits.map((u) => {
            const s = stats.find((x) => x.unit === u);
            return (
              <div key={u} className="flow-unit-block">
                <div className="flow-unit-head"><span className="t-h3">{u}</span><span className="t-sm c-2">{D.UNITS[u]}</span><span className="grow" /><span className="t-xs c-3 num">{s.occupied}/{s.total} occupied · {s.free} free</span></div>
                <div className="flow-beds">
                  {ipBeds.filter((b) => b.unit === u).map((b) => (
                    <BedTile key={b.id} bed={b} enc={b.encounterId ? encById.get(b.encounterId) : null} patient={b.encounterId ? pmap.get(encById.get(b.encounterId)?.patientId) : null}
                      dragging={!!dragId} matchUnit={dragUnit} over={overBed === b.id}
                      onOpen={() => setSelBed(b.id)}
                      onDragOver={(ev) => { if (dragId && b.state === "free") { ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; if (overBed !== b.id) setOverBed(b.id); } }}
                      onDragLeave={() => { if (overBed === b.id) setOverBed(null); }}
                      onDrop={(ev) => { ev.preventDefault(); const id = ev.dataTransfer.getData(DRAG_TYPE) || dragId; setOverBed(null); setDragId(null); if (id && b.state === "free") place(id, b.id); }} />
                  ))}
                </div>
              </div>
            );
          })}
        </Panel>

        <div className="flow-side">
          <Panel title="Admitted, waiting for a bed" subtitle={boarders.length ? "Oldest first. Drag onto a green bed or use Best bed." : null}
            actions={boarders.length ? <Badge tone="bad">{boarders.length} boarding</Badge> : null}>
            {!boarders.length ? <Empty icon={LuCircleCheck} title="No ED boarders">Every admitted patient has an inpatient bed.</Empty> : boarders.map((e) => (
              <BoarderCard key={e.id} e={e} p={pmap.get(e.patientId)} dragging={dragId === e.id}
                onDragStart={(ev) => { ev.dataTransfer.setData(DRAG_TYPE, e.id); ev.dataTransfer.setData("text/plain", e.id); ev.dataTransfer.effectAllowed = "move"; setDragId(e.id); }}
                onDragEnd={() => { setDragId(null); setOverBed(null); }}
                onBest={() => setBestFor(e.id)} />
            ))}
          </Panel>
          <OutlookPanel encounters={encounters} beds={beds} />
        </div>
      </div>

      <DischargePanel encounters={encounters} tasks={tasks} pmap={pmap} beds={beds} onOpenBed={setSelBed} />

      <BestBedModal encId={bestFor} onClose={() => setBestFor(null)} encounters={encounters} beds={beds} place={place} pmap={pmap} />
      <BedDrawer bed={sel} enc={sel?.encounterId ? encById.get(sel.encounterId) : null} onClose={() => setSelBed(null)} tasks={tasks} boarders={boarders} pmap={pmap} place={place} />
    </div>
  );
}

function OccBar({ s }) {
  const w = (n) => `${(n / Math.max(1, s.total)) * 100}%`;
  return (
    <div className="flow-bar" role="img" aria-label={`${s.occupied} occupied, ${s.cleaning} cleaning, ${s.blocked} blocked, ${s.free} free`}>
      <i style={{ width: w(s.occupied), background: "var(--ink-2)" }} />
      {s.cleaning ? <i style={{ width: w(s.cleaning), background: "#8FA9D9" }} /> : null}
      {s.blocked ? <i style={{ width: w(s.blocked), background: "var(--ink-4)" }} /> : null}
      {s.free ? <i style={{ width: w(s.free), background: "#5DBB8E" }} /> : null}
    </div>
  );
}

function BedTile({ bed: b, enc, patient, dragging, matchUnit, over, onOpen, onDragOver, onDragLeave, onDrop }) {
  const prob = enc?.dc?.prob ?? null;
  const likely = b.state === "occupied" && prob >= 70;
  const target = dragging && b.state === "free";
  const stateText = { free: "Free", cleaning: "Cleaning", blocked: "Blocked", occupied: likely ? "Likely d/c" : "" }[b.state];
  const aria = b.state === "occupied" && enc ? `${b.label}, occupied by ${shortName(patient)}, day ${dayOfStay(enc.admittedAt)}, discharge probability ${prob}%` : `${b.label}, ${b.state}`;
  return (
    <button type="button" data-state={b.state} data-bed={b.id} aria-label={aria}
      className={cx("flow-bed", likely && "likely", dragging && (target ? "target" : "dim"), target && b.unit === matchUnit && "match", over && "over")}
      onClick={onOpen} onDragOver={onDragOver} onDragEnter={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="flow-b-top"><span className="flow-b-label">{b.label}</span><span className="flow-b-state">{stateText}</span></div>
      {b.state === "occupied" && enc ? <>
        <span className="flow-b-name">{shortName(patient)}</span>
        <span className="flow-b-meta num">Day {dayOfStay(enc.admittedAt)}<span className="c-3">·</span>{prob ?? 0}% d/c</span>
        <span className="flow-b-foot">
          <span className={cx("flow-mini", likely ? "hi" : "")} style={{ flex: 1 }}><i style={{ width: `${prob || 0}%` }} /></span>
          {enc.alc ? <span className="flow-tag alc" title="Alternate level of care">ALC</span> : null}
        </span>
      </> : b.state === "free" ? <>
        <span className="flow-b-meta" style={{ color: "var(--ok)" }}>{target && b.unit === matchUnit ? "Service match" : "Ready"}</span>
        <span className="flow-b-meta c-3 num" style={{ marginTop: "auto" }}>{ago(b.since, "for ")}</span>
      </> : b.state === "cleaning" ? <>
        <span className="flow-b-meta"><LuSprayCan size={12} /> EVS</span>
        <span className="flow-b-meta num" style={{ marginTop: "auto", color: D.minsSince(b.since) > 40 ? "var(--bad)" : undefined }}>{ago(b.since)}</span>
      </> : <>
        <span className="flow-b-meta ellipsis">{b.note || "Out of service"}</span>
        <span className="flow-b-meta c-3 num" style={{ marginTop: "auto" }}>{ago(b.since)}</span>
      </>}
    </button>
  );
}

function BoarderCard({ e, p, dragging, onDragStart, onDragEnd, onBest }) {
  const mins = D.minsSince(e.admitRequestAt || e.arrivalAt);
  const edBed = e.bedId ? S.get("beds", e.bedId)?.label : null;
  return (
    <div className={cx("flow-boarder", dragging && "dragging")} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} data-boarder={e.id}>
      <LuGripVertical className="flow-grip" size={16} aria-hidden="true" />
      <div className="grow col" style={{ gap: 4 }}>
        <div className="row" style={{ gap: 6 }}>
          <button type="button" className="flow-link ellipsis" onClick={() => openChart(e.id)}>{p ? `${p.first} ${p.last}` : "Patient"}</button>
          <span className="flow-tag svc">{e.service || "Medicine"}</span>
          <span className="grow" />
          <span className="row num t-xs" title="Time since admission request" style={{ gap: 4, whiteSpace: "nowrap", color: mins > 480 ? "var(--bad)" : mins > 240 ? "var(--warn)" : "var(--ink-2)", fontWeight: 600 }}><LuClock size={12} />{D.fmtDur(mins * D.MIN)}</span>
        </div>
        <div className="t-xs c-2 ellipsis">{e.cc}</div>
        <div className="row t-xs" style={{ gap: 8 }}>
          <span className="c-3 grow ellipsis">{edBed ? `ED ${edBed}` : "ED"} · needs {D.SERVICE_UNIT[e.service] || "7E"}</span>
          <Button size="sm" icon={LuWand} onClick={onBest}>Best bed</Button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------- best bed --------------------------- */
function BestBedModal({ encId, onClose, encounters, beds, place, pmap }) {
  const e = encId ? encounters.find((x) => x.id === encId) : null;
  const rec = useMemo(() => (e ? bestBedFor(e, beds, encounters) : null), [e, beds, encounters]);
  const [choice, setChoice] = useState(null);
  const freeBeds = beds.filter((b) => b.area === "IP" && b.state === "free").sort((a, b) => a.label.localeCompare(b.label));
  React.useEffect(() => { setChoice(rec?.bed?.id || null); }, [encId, rec?.bed?.id]);
  if (!e) return null;
  const p = pmap.get(e.patientId);
  const chosen = freeBeds.find((b) => b.id === choice);
  const s = chosen ? unitStats(chosen.unit, beds, encounters) : null;
  const confirm = () => { if (chosen && place(e.id, chosen.id)) onClose(); };
  return (
    <Modal open onClose={onClose} title={`Best bed for ${p ? `${p.first} ${p.last}` : "patient"}`}
      subtitle={`${e.service || "Medicine"} admission · boarding ${D.fmtSince(e.admitRequestAt || e.arrivalAt)}`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={LuUserCheck} disabled={!chosen} onClick={confirm}>{chosen ? `Place in ${chosen.label}` : "Place in bed"}</Button></>}>
      {rec?.bed ? (
        <div className="well">
          <div className="row"><span className="t-xs c-2 w5">Recommended</span>{rec.match ? <Badge tone="ok">Service match</Badge> : <Badge tone="warn">Off-service</Badge>}</div>
          <div className="row mt4" style={{ alignItems: "baseline" }}><span className="t-h1">{rec.bed.label}</span><span className="t-sm c-2">{D.UNITS[rec.bed.unit]}</span></div>
          <ul className="col mt8" style={{ gap: 6, listStyle: "none", padding: 0, margin: "8px 0 0" }}>
            {rec.reasons.map((r) => <li key={r} className="row top t-sm" style={{ gap: 8 }}><LuCheck size={14} style={{ color: "var(--ok)", flex: "none", marginTop: 2 }} />{r}</li>)}
          </ul>
        </div>
      ) : (
        <div className="well t-sm"><b>No bed to recommend.</b> {rec?.reasons?.[0]} Choose another free bed below or keep the patient boarding.</div>
      )}
      <Field label="Bed" style={{ marginTop: 14 }}>
        <Select value={choice || ""} onChange={(ev) => setChoice(ev.target.value || null)}
          options={[{ value: "", label: freeBeds.length ? "Choose a free bed" : "No free beds" }, ...freeBeds.map((b) => ({ value: b.id, label: `${b.label} · ${D.UNITS[b.unit]}${b.id === rec?.bed?.id ? " (recommended)" : ""}` }))]} />
      </Field>
      {s ? <div className="t-xs c-2 mt8 num">{chosen.unit} after placement: {s.occupied + 1} of {s.total} occupied ({pct(s.occupied + 1, s.total)}%). The ED space is sent for cleaning and a porter is tasked.</div> : null}
    </Modal>
  );
}

/* ---------------------------- bed drawer -------------------------- */
function BedDrawer({ bed, enc, onClose, tasks, boarders, pmap, place }) {
  const [reason, setReason] = useState(BLOCK_REASONS[0]);
  const [confirmDc, setConfirmDc] = useState(false);
  if (!bed) return null;
  const p = enc ? pmap.get(enc.patientId) : null;
  const tone = { free: "ok", cleaning: "info", blocked: "", occupied: "brand" }[bed.state];
  const evs = tasks.find((t) => t.bedId === bed.id && t.status !== "done");

  const markClean = () => { D.setBedState(bed.id, "free", "user"); toast(`${bed.label} is clean and ready.`); };
  const block = () => { D.setBedState(bed.id, "blocked", "user"); S.patch("beds", bed.id, { note: reason }); toast(`${bed.label} blocked: ${reason.toLowerCase()}.`); };
  const unblock = () => { D.setBedState(bed.id, "free", "user"); S.patch("beds", bed.id, { note: null }); toast(`${bed.label} is back in service.`); };
  const discharge = () => { D.dischargeInpatient(enc.id, {}, "user"); setConfirmDc(false); toast(`Discharged ${p ? `${p.first} ${p.last}` : "patient"}. ${bed.label} sent for cleaning.`); onClose(); };

  return (
    <Drawer open onClose={onClose} width={520}
      title={<div className="row"><span className="t-h2">{bed.label}</span><Badge tone={tone}>{bed.state === "occupied" ? "Occupied" : bed.state[0].toUpperCase() + bed.state.slice(1)}</Badge></div>}
      subtitle={`${D.UNITS[bed.unit]} · since ${D.fmtDateTime(bed.since || Date.now())}`}>
      {bed.state === "occupied" && enc ? <>
        <div className="row" style={{ gap: 10 }}><PatientLine encounter={enc} showMrn /></div>
        <div className="t-sm c-2 mt4">{enc.dx || enc.cc} · {enc.service}</div>
        <div className="grid g3 mt16" style={{ gap: 10 }}>
          <Stat label="Day of stay" value={`Day ${dayOfStay(enc.admittedAt)}`} sub={`Admitted ${D.fmtDate(enc.admittedAt || Date.now())}`} />
          <Stat label="Discharge" value={`${enc.dc?.prob ?? 0}%`} sub={enc.dc?.eta ? `Expected ${enc.dc.eta.toLowerCase()}` : "No date yet"} tone={(enc.dc?.prob || 0) >= 70 ? "var(--warn)" : undefined} />
          <Stat label="Level of care" value={enc.alc ? "ALC" : "Acute"} sub={enc.alc ? "Awaiting placement" : "Needs acute bed"} />
        </div>
        <div className="flow-sec mt20">Discharge barriers</div>
        <BarrierList enc={enc} tasks={tasks} p={p} />
        <div className="row wrap mt20">
          <Button icon={LuExternalLink} onClick={() => { openChart(enc.id); onClose(); }}>Open chart</Button>
          <Button variant="primary" icon={LuLogOut} onClick={() => setConfirmDc(true)}>Discharge</Button>
        </div>
        <Modal open={confirmDc} onClose={() => setConfirmDc(false)} title={`Discharge ${p ? `${p.first} ${p.last}` : "patient"}?`}
          footer={<><Button onClick={() => setConfirmDc(false)}>Cancel</Button><Button variant="primary" icon={LuLogOut} onClick={discharge}>Discharge</Button></>}>
          <p className="t-sm">{bed.label} goes to cleaning and EVS gets a task. Open tasks for this patient are closed, and app users get a follow-up check-in.</p>
          {openBarriers(enc).length ? <p className="t-sm c-warn mt8 w5">{openBarriers(enc).length} discharge barrier{openBarriers(enc).length > 1 ? "s are" : " is"} still open: {openBarriers(enc).map((b) => b.text.toLowerCase()).join(", ")}.</p> : null}
        </Modal>
      </> : bed.state === "cleaning" ? <>
        <div className="grid g2" style={{ gap: 10 }}>
          <Stat label="In cleaning for" value={D.fmtSince(bed.since || Date.now())} tone={D.minsSince(bed.since) > 40 ? "var(--bad)" : undefined} sub={D.minsSince(bed.since) > 40 ? "Over the 40 min turnaround target" : "Target turnaround 40 min"} />
          <Stat label="EVS task" value={evs ? (evs.status === "in_progress" ? "In progress" : "Open") : "None"} sub={evs ? evs.title : "No open cleaning task"} />
        </div>
        <p className="t-sm c-2 mt16">Mark the bed clean when environmental services confirm. It turns green and boarders can be placed in it.</p>
        <div className="row mt16"><Button variant="primary" icon={LuSprayCan} onClick={markClean}>Mark clean</Button></div>
      </> : bed.state === "free" ? <>
        <Stat label="Ready for" value={D.fmtSince(bed.since || Date.now())} sub="Clean and staffed" />
        <div className="flow-sec mt20">Place a boarder here</div>
        {!boarders.length ? <div className="t-sm c-3">No admitted patients are waiting in the ED.</div> : (
          <div className="flow-list">{boarders.map((e) => { const bp = pmap.get(e.patientId); const match = (D.SERVICE_UNIT[e.service] || "7E") === bed.unit; return (
            <div key={e.id} className="flow-li">
              <div className="grow col" style={{ gap: 2 }}>
                <span className="w6 ellipsis">{bp ? `${bp.first} ${bp.last}` : "Patient"}</span>
                <span className="t-xs c-2">{e.service} · boarding {D.fmtSince(e.admitRequestAt || e.arrivalAt)}</span>
              </div>
              {match ? <Badge tone="ok">Service match</Badge> : <Badge>Off-service</Badge>}
              <Button size="sm" variant={match ? "primary" : undefined} icon={LuArrowRight} onClick={() => { if (place(e.id, bed.id)) onClose(); }}>Place here</Button>
            </div>); })}</div>
        )}
        <div className="flow-sec mt24">Take out of service</div>
        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <Field label="Reason" style={{ flex: 1, minWidth: 200 }}><Select value={reason} onChange={(e) => setReason(e.target.value)} options={BLOCK_REASONS} /></Field>
          <Button icon={LuLock} onClick={block}>Block bed</Button>
        </div>
      </> : bed.state === "occupied" ? <>
        <p className="t-sm c-2">This bed is marked occupied but has no linked patient. Send it for cleaning if the patient has left.</p>
        <div className="row mt16"><Button icon={LuSprayCan} onClick={() => { D.setBedState(bed.id, "cleaning", "user"); toast(`${bed.label} sent for cleaning.`); }}>Send for cleaning</Button></div>
      </> : <>
        <div className="grid g2" style={{ gap: 10 }}>
          <Stat label="Reason" value={bed.note || "Out of service"} small />
          <Stat label="Blocked for" value={D.fmtSince(bed.since || Date.now())} />
        </div>
        <p className="t-sm c-2 mt16">Unblock when the issue is resolved. The bed returns as free and can take a boarder.</p>
        <div className="row mt16"><Button variant="primary" icon={LuLockOpen} onClick={unblock}>Unblock</Button></div>
      </>}
    </Drawer>
  );
}
function Stat({ label, value, sub, tone, small }) {
  return <div className="well" style={{ padding: "10px 12px" }}><div className="t-xs c-2">{label}</div><div className={cx(small ? "t-h3" : "t-h2", "num mt4")} style={{ color: tone }}>{value}</div>{sub ? <div className="t-xs c-3 mt4">{sub}</div> : null}</div>;
}

/* ---------------------------- barriers ---------------------------- */
function assignBarrier(enc, b, p) {
  D.createTask({ title: `${b.text}: ${p ? `${p.first} ${p.last}` : "patient"}`, role: b.owner || "RN", encounterId: enc.id, barrierId: b.id, priority: "high", dueMin: 120, detail: `Discharge barrier on ${enc.unit}. Discharge probability ${enc.dc?.prob ?? 0}%.` }, "user");
}
function BarrierList({ enc, tasks, p, compact }) {
  const bars = openBarriers(enc);
  const done = (enc.dc?.barriers || []).filter((b) => b.status === "done");
  if (!bars.length) return <div className="row t-sm c-2" style={{ gap: 6 }}><LuCircleCheck size={15} style={{ color: "var(--ok)" }} />{done.length ? `${done.length} barrier${done.length > 1 ? "s" : ""} cleared. Nothing blocking discharge.` : "No barriers recorded."}</div>;
  return <div>{bars.map((b) => {
    const t = openTaskFor(tasks, b.id);
    return (
      <div key={b.id} className="flow-barrier" data-barrier={b.id}>
        <div className="grow"><div className="t-sm w5">{b.text}</div>{!compact || t ? <div className="t-xs c-3 mt4">{t ? `Task with ${t.role} · ${t.status === "in_progress" ? "in progress" : "open"} · ${t.due < Date.now() ? "overdue" : "due " + D.fmtClock(t.due)}` : `Owner: ${b.owner || "RN"} · no task yet`}</div> : null}</div>
        <Badge tone="outline">{b.owner || "RN"}</Badge>
        {t ? <Badge tone="info" icon={LuListChecks}>Assigned</Badge> : <Button size="sm" onClick={() => { assignBarrier(enc, b, p); toast(`Task sent to ${b.owner || "RN"}: ${b.text.toLowerCase()}.`); }}>Assign owner</Button>}
        <Button size="sm" icon={LuCheck} onClick={() => { D.resolveBarrier(enc.id, b.id, "user"); toast(`Cleared: ${b.text.toLowerCase()}.`); }}>Resolve</Button>
      </div>
    );
  })}</div>;
}

function DischargePanel({ encounters, tasks, pmap, beds, onOpenBed }) {
  const [mode, setMode] = useState("likely");
  const [more, setMore] = useState(false);
  const inpatients = useMemo(() => encounters.filter(D.isInpatient).sort((a, b) => (b.dc?.prob || 0) - (a.dc?.prob || 0) || openBarriers(b).length - openBarriers(a).length), [encounters]);
  const list = mode === "likely" ? inpatients.filter((e) => (e.dc?.prob || 0) >= 70) : mode === "alc" ? inpatients.filter((e) => e.alc) : inpatients;
  const shown = more ? list : list.slice(0, 10);
  const unowned = inpatients.flatMap((e) => openBarriers(e).filter((b) => !openTaskFor(tasks, b.id)).map((b) => ({ e, b })));
  const assignAll = () => {
    unowned.forEach(({ e, b }) => assignBarrier(e, b, pmap.get(e.patientId)));
    const roles = [...new Set(unowned.map(({ b }) => b.owner || "RN"))];
    toast(`Assigned ${unowned.length} barrier${unowned.length === 1 ? "" : "s"} to ${roles.join(", ")}.`);
  };
  const expected = Math.round(inpatients.reduce((s, e) => s + (e.dc?.prob || 0) / 100, 0));
  return (
    <Panel className="mt16" flush icon={LuTrendingUp} title="Discharge forecast"
      subtitle={`${inpatients.filter((e) => (e.dc?.prob || 0) >= 70).length} likely today · about ${expected} expected in 24 h · ${unowned.length} open barrier${unowned.length === 1 ? "" : "s"} without an owner`}
      actions={<div className="row wrap" style={{ justifyContent: "flex-end" }}>
        <Seg size="sm" value={mode} onChange={(v) => { setMode(v); setMore(false); }} options={[{ value: "likely", label: "Likely today" }, { value: "alc", label: "ALC" }, { value: "all", label: "All" }]} />
        <Button size="sm" variant="primary" icon={LuListChecks} disabled={!unowned.length} onClick={assignAll}>Assign all open barriers</Button>
      </div>}>
      {!list.length ? <Empty icon={LuCircleCheck} title={mode === "alc" ? "No ALC patients" : "No likely discharges"}>{mode === "alc" ? "No inpatient is flagged as alternate level of care." : "No inpatient is at 70% or more. Switch to All to review barriers."}</Empty> : shown.map((e) => {
        const p = pmap.get(e.patientId); const bed = beds.find((b) => b.id === e.bedId); const prob = e.dc?.prob || 0;
        return (
          <div key={e.id} className="flow-dc" data-enc={e.id}>
            <div className="col" style={{ gap: 3, minWidth: 0 }}>
              <button type="button" className="flow-link ellipsis" onClick={() => openChart(e.id)}>{p ? `${p.first} ${p.last}` : "Patient"}</button>
              <div className="t-xs c-2 ellipsis">{e.dx || e.cc}</div>
              <div className="row t-xs c-3" style={{ gap: 6 }}>
                <button type="button" className="flow-link t-xs" style={{ fontWeight: 500 }} onClick={() => bed && onOpenBed(bed.id)}>{bed?.label || e.unit}</button>
                <span>· Day {dayOfStay(e.admittedAt)}</span>{e.alc ? <span className="flow-tag alc">ALC</span> : null}
              </div>
            </div>
            <div className="flow-dc-prob">
              <div className="row" style={{ gap: 6 }}><span className="t-h3 num" style={{ color: prob >= 70 ? "var(--warn)" : "var(--ink)" }}>{prob}%</span><span className="t-xs c-3">{e.dc?.eta || "No date"}</span></div>
              <span className={cx("flow-mini", prob >= 70 && "hi")}><i style={{ width: `${prob}%` }} /></span>
            </div>
            <BarrierList enc={e} tasks={tasks} p={p} compact />
          </div>
        );
      })}
      {list.length > 10 ? <div style={{ padding: "10px 18px" }}><Button variant="ghost" size="sm" onClick={() => setMore(!more)}>{more ? "Show fewer" : `Show all ${list.length}`}</Button></div> : null}
    </Panel>
  );
}

/* ---------------------------- outlook ----------------------------- */
function OutlookPanel({ encounters, beds }) {
  const o = useMemo(() => capacityOutlook(encounters, beds), [encounters, beds]);
  const max = Math.max(1, ...o.points.flatMap((p) => [p.discharges, p.admissions]));
  return (
    <Panel title="24-hour capacity outlook" subtitle="Expected discharges vs admissions, inpatient units">
      <div className="flow-legend" style={{ marginBottom: 10 }}>
        <span><i className="flow-sw" style={{ background: CHART.discharge, borderColor: CHART.discharge }} />Expected discharges</span>
        <span><i className="flow-sw" style={{ background: CHART.admit, borderColor: CHART.admit }} />Expected admissions</span>
      </div>
      <div className="flow-oc" role="img" aria-label={outlookSentence(o)}>
        {o.points.map((p) => (
          <div key={p.label} className="flow-oc-g" title={`By ${p.label}: ${p.discharges} discharges, ${p.admissions} admissions (${o.boarders} boarders + ${Math.round(p.arrivals * ED_ADMIT_RATE)} from ${p.arrivals} forecast ED arrivals), ${p.free} projected free beds`}>
            <div className="flow-oc-bars">
              <div className="col" style={{ gap: 2, alignItems: "center" }}><span className="flow-oc-val num">{p.discharges}</span><i style={{ height: (p.discharges / max) * 92, background: CHART.discharge }} /></div>
              <div className="col" style={{ gap: 2, alignItems: "center" }}><span className="flow-oc-val num">{p.admissions}</span><i style={{ height: (p.admissions / max) * 92, background: CHART.admit }} /></div>
            </div>
          </div>
        ))}
      </div>
      <div className="flow-oc-x">
        {o.points.map((p) => (
          <div key={p.label}>
            <div className="t-xs c-2 w5">By {p.label}</div>
            <div className="flow-oc-free num" style={{ color: p.free <= 0 ? "var(--bad)" : p.free <= 3 ? "var(--warn)" : "var(--ink)" }}>{p.free}</div>
            <div className="t-2xs c-3">projected free</div>
          </div>
        ))}
      </div>
      <p className="t-sm mt12">{outlookSentence(o)}</p>
      <p className="t-2xs c-3 mt8">Discharges: each patient's probability spread over a typical discharge-hour curve. Admissions: current boarders plus {Math.round(ED_ADMIT_RATE * 100)}% of forecast ED arrivals. Free now {o.freeNow}, cleaning {o.cleaning}.</p>
    </Panel>
  );
}
