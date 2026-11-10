// Emergency department board: live kanban, sortable list and floor map.
import React, { useMemo, useRef, useState } from "react";
import {
  LuSearch, LuSquareKanban, LuList, LuMap, LuTriangleAlert, LuFlaskConical, LuBed, LuStethoscope, LuX,
  LuArrowUpDown, LuArrowUp, LuArrowDown, LuSprayCan, LuUserPlus, LuCircleCheck, LuLanguages, LuInbox, LuBan,
} from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import { go, openChart } from "../lib/ui-state.js";
import { Button, Badge, PageHead, Seg, Input, Modal, Empty, toast, useNow, cx } from "../ui/index.jsx";
import { PatientLine, StatusBadge, WaitTime, Ctas, CtasLegend } from "../ui/clinical.jsx";
import { Menu, AdmitModal } from "./ed-parts.jsx";
import { ordersProgress, resultsReady, isNew, byUrgency, locationOf, focusTriage, langPlain } from "./ed-lib.js";
import "./ed.css";

const VIEWS = [
  { value: "board", label: <span className="row gap-4"><LuSquareKanban size={14} />Board</span> },
  { value: "list", label: <span className="row gap-4"><LuList size={14} />List</span> },
  { value: "floor", label: <span className="row gap-4"><LuMap size={14} />Floor</span> },
];
const ZONES = ["Resus", "Acute", "Fast track", "Hallway"];
const stageLabel = (k) => D.ED_STAGES.find((s) => s.key === k)?.label || D.STATUS_LABEL[k] || k;

function readPref(k, d) { try { return localStorage.getItem("aster.ed." + k) || d; } catch (e) { return d; } }
function writePref(k, v) { try { localStorage.setItem("aster.ed." + k, v); } catch (e) { /* ignore */ } }

/* =================================================================== */
export default function EdBoard() {
  const now = useNow();
  const encounters = S.useCollection("encounters");
  const beds = S.useCollection("beds");
  const patients = S.useCollection("patients");
  const [view, setViewRaw] = useState(() => readPref("view", "board"));
  const setView = (v) => { setViewRaw(v); writePref("view", v); };
  const [q, setQ] = useState("");
  const [levels, setLevels] = useState([]);
  const [pastOnly, setPastOnly] = useState(false);
  const [admitId, setAdmitId] = useState(null);

  const pById = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const bById = useMemo(() => new Map(beds.map((b) => [b.id, b])), [beds]);
  const m = useMemo(() => D.computeMetrics(encounters, beds), [encounters, beds, now]);
  const active = useMemo(() => encounters.filter(D.isEdActive), [encounters]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return active.filter((e) => {
      if (levels.length && !levels.includes(e.ctas || 0)) return false;
      if (pastOnly && !D.minutesOverTarget(e)) return false;
      if (!needle) return true;
      const p = pById.get(e.patientId);
      return `${p?.first} ${p?.last} ${p?.mrn} ${e.cc}`.toLowerCase().includes(needle);
    });
  }, [active, q, levels, pastOnly, pById, now]);
  const filtering = !!(q.trim() || levels.length || pastOnly);

  const move = (id, to) => {
    const e = S.get("encounters", id); if (!e) return;
    const name = D.fullName(pById.get(e.patientId));
    if (D.stageOf(e) === to) return;
    if (to === "boarding") { setAdmitId(id); return; }
    if (!e.ctas && to !== "waiting_triage") {
      toast(`Triage ${name} first. The CTAS level sets a safe wait time.`, { kind: "bad", action: { label: "Open triage", run: () => { focusTriage(id); go("triage"); } } });
      return;
    }
    D.setEdStatus(id, to, "user");
    const after = S.get("encounters", id);
    const bed = after?.bedId && after.bedId !== e.bedId ? S.get("beds", after.bedId) : null;
    toast(`${name} moved to ${stageLabel(to).toLowerCase()}${bed ? `, placed in ${bed.label}` : ""}`);
  };
  const toggleLevel = (l) => setLevels((a) => (a.includes(l) ? a.filter((x) => x !== l) : [...a, l]));

  return (
    <div className="ed-page">
      <PageHead title="Emergency department" subtitle="Live board for every patient in the department. Drag cards between stages or open a chart."
        actions={<>
          <Seg options={VIEWS} value={view} onChange={setView} />
          <Button icon={LuStethoscope} onClick={() => go("triage")}>Open triage</Button>
        </>} />

      <StatStrip m={m} pastOnly={pastOnly} onPast={() => setPastOnly((v) => !v)} />

      <div className="ed-toolbar">
        <label className="ed-search">
          <LuSearch aria-hidden="true" />
          <input value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search name, complaint or MRN" aria-label="Search patients" />
          {q ? <button type="button" className="ed-search-x" onClick={() => setQ("")} aria-label="Clear search"><LuX /></button> : null}
        </label>
        <div className="ed-chips" role="group" aria-label="Filter by CTAS">
          {[1, 2, 3, 4, 5].map((l) => (
            <button key={l} type="button" className={cx("ed-chip", levels.includes(l) && "on")} aria-pressed={levels.includes(l)} onClick={() => toggleLevel(l)} title={`CTAS ${l}: ${D.CTAS[l].label}`}>
              <Ctas level={l} /><span className="ed-chip-l">{D.CTAS[l].label}</span>
            </button>
          ))}
        </div>
        <button type="button" className={cx("ed-chip ed-chip-past", pastOnly && "on")} aria-pressed={pastOnly} onClick={() => setPastOnly((v) => !v)}>
          <LuTriangleAlert />Past target only
        </button>
        <span className="grow" />
        <span className="t-xs c-3 num">{filtering ? `${shown.length} of ${active.length} patients` : `${active.length} patients`}</span>
        {filtering ? <Button size="sm" variant="ghost" onClick={() => { setQ(""); setLevels([]); setPastOnly(false); }}>Clear filters</Button> : null}
      </div>

      {view === "board" ? <Board list={shown} pById={pById} bById={bById} onMove={move} filtering={filtering} /> : null}
      {view === "list" ? <ListView list={shown} pById={pById} bById={bById} filtering={filtering} /> : null}
      {view === "floor" ? <Floor beds={beds} encounters={encounters} pById={pById} highlight={filtering ? new Set(shown.map((e) => e.id)) : null} /> : null}

      <div className="ed-legend mt16"><CtasLegend /></div>
      <AdmitModal encounterId={admitId} onClose={() => setAdmitId(null)} />
    </div>
  );
}

/* --------------------------- stat strip ---------------------------- */
function StatStrip({ m, pastOnly, onPast }) {
  const cells = [
    { k: "ed", label: "Patients in ED", value: m.edCount, sub: `${m.edBedsUsed} spaces in use · ${m.arriving} en route` },
    { k: "md", label: "Waiting for MD", value: m.waitingMd, sub: `${m.waitingTriage} waiting for triage` },
    { k: "past", label: "Past CTAS target", value: m.overTarget, sub: pastOnly ? "Showing these only" : "Select to filter", tone: m.overTarget ? "bad" : "ok", onClick: onPast, pressed: pastOnly },
    { k: "board", label: "Boarding", value: m.boarding, sub: m.boarding ? `Longest ${D.fmtDur(m.oldestBoardMin * D.MIN)}` : "No admitted patients waiting", tone: m.boarding >= 4 ? "warn" : null },
    { k: "med", label: "Median time in ED", value: D.fmtDur(m.medianWaitActive * D.MIN), sub: `Door to doctor ${m.doorToDocMedian} min (24 h)` },
  ];
  return (
    <div className="ed-stats" role="list">
      {cells.map((c) => {
        const Tag = c.onClick ? "button" : "div";
        return (
          <Tag key={c.k} role="listitem" type={c.onClick ? "button" : undefined} className={cx("ed-stat", c.onClick && "click", c.pressed && "on")} onClick={c.onClick} aria-pressed={c.onClick ? !!c.pressed : undefined}>
            <span className="t-xs c-2 w5">{c.label}</span>
            <span className={cx("ed-stat-v num", c.tone && "c-" + c.tone)}>{c.value}</span>
            <span className="t-2xs c-3 ellipsis">{c.sub}</span>
          </Tag>
        );
      })}
    </div>
  );
}

/* ------------------------------ board ------------------------------ */
function Board({ list, pById, bById, onMove, filtering }) {
  const [over, setOver] = useState(null);
  const [drag, setDragState] = useState(null);
  const dragRef = useRef(null);
  const setDrag = (v) => { dragRef.current = v; setDragState(v); };
  const cols = useMemo(() => D.ED_STAGES.map((s) => ({ ...s, items: list.filter((e) => D.stageOf(e) === s.key).sort(byUrgency) })), [list]);
  return (
    <div className="ed-board" role="list" aria-label="Patients by stage">
      {cols.map((c) => {
        const late = c.items.filter((e) => D.minutesOverTarget(e)).length;
        return (
          <section key={c.key} role="listitem" aria-label={`${c.label}: ${c.items.length} patients`} className={cx("ed-col", over === c.key && drag && "drop")}
            onDragOver={(ev) => { if (!dragRef.current && !ev.dataTransfer.types.includes("text/plain")) return; ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; if (over !== c.key) setOver(c.key); }}
            onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget)) setOver(null); }}
            onDrop={(ev) => { ev.preventDefault(); const id = ev.dataTransfer.getData("text/plain") || dragRef.current; setOver(null); setDrag(null); if (id) onMove(id, c.key); }}>
            <header className="ed-col-head">
              <span className="w6">{c.label}</span>
              <span className="ed-count num">{c.items.length}</span>
              {late ? <Badge tone="bad" title={`${late} past CTAS target`}>{late} late</Badge> : null}
            </header>
            <div className="ed-col-body">
              {c.items.length ? c.items.map((e) => (
                <EdCard key={e.id} e={e} p={pById.get(e.patientId)} bed={bById.get(e.bedId)} onMove={onMove} dragging={drag === e.id}
                  onDragStart={(ev) => { ev.dataTransfer.setData("text/plain", e.id); ev.dataTransfer.effectAllowed = "move"; setDrag(e.id); }}
                  onDragEnd={() => { setDrag(null); setOver(null); }} />
              )) : <div className="ed-col-empty">{filtering ? "No matches" : c.key === "waiting_triage" ? "No one waiting for triage" : c.key === "boarding" ? "No admitted patients boarding" : "No patients here"}<span className="t-2xs">Drop a card to move a patient here</span></div>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function EdCard({ e, p, bed, onMove, dragging, onDragStart, onDragEnd }) {
  const over = D.minutesOverTarget(e);
  const prog = ordersProgress(e);
  const ready = resultsReady(e);
  const flags = e.redFlags || [];
  const stage = D.stageOf(e);
  const items = D.ED_STAGES.map((s) => ({ key: s.key, label: s.label, current: s.key === stage, run: () => onMove(e.id, s.key) }));
  const odd = p?.lang && !["en", "fr"].includes(p.lang);
  return (
    <article className={cx("ed-card", e.ctas ? `ctas-${e.ctas}` : "ctas-0", over && "late", isNew(e) && "new-flash", dragging && "dragging")}
      draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      tabIndex={0} role="button" aria-label={`${D.fullName(p)}, ${e.ctas ? "CTAS " + e.ctas : "not triaged"}, ${e.cc}. Open chart.`}
      onClick={() => openChart(e.id)} onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openChart(e.id); } }}>
      <div className="ed-card-top">
        <Ctas level={e.ctas} />
        <span className="grow" style={{ minWidth: 0 }}><PatientLine encounter={e} patient={p} compact /></span>
        <Menu label="Move to…" items={items} title={`Move ${D.fullName(p)} to another stage`} />
      </div>
      <div className="ed-card-cc">{e.cc}</div>
      <div className="ed-card-meta">
        <span className="row gap-4 ed-wait"><WaitTime encounter={e} />{over ? <span className="t-2xs c-bad w6">+{over}</span> : null}</span>
        <span className="ed-dotsep" />
        <span className="ellipsis c-2" title={locationOf(e, bed)}>{e.status === "boarding" ? `${e.service || "Medicine"} · ${bed ? bed.label : "no space"}` : bed ? bed.label : locationOf(e, bed)}</span>
        {prog.total ? <span className={cx("ed-prog", prog.pending === 0 && "done")} title={`${prog.back} of ${prog.total} orders back`}><LuFlaskConical />{prog.back}/{prog.total}</span> : null}
      </div>
      {(flags.length || ready || e.status === "arriving" || odd || e.md) ? (
        <div className="ed-card-tags">
          {e.status === "arriving" ? <Badge tone="info">En route</Badge> : null}
          {flags.length ? <Badge tone="bad" icon={LuTriangleAlert} title={flags.join(", ")}>{flags[0].length > 22 ? flags[0].slice(0, 21) + "…" : flags[0]}{flags.length > 1 ? ` +${flags.length - 1}` : ""}</Badge> : null}
          {ready ? <Badge tone="ok" icon={LuCircleCheck}>Results ready</Badge> : null}
          {odd ? <Badge tone="ai" icon={LuLanguages}>{langPlain(p.lang)}</Badge> : null}
          {e.md ? <span className="t-2xs c-3 ed-md">{e.md}</span> : null}
        </div>
      ) : null}
    </article>
  );
}

/* ------------------------------- list ------------------------------ */
const COLS = [
  { k: "ctas", label: "CTAS" }, { k: "name", label: "Patient" }, { k: "cc", label: "Complaint" }, { k: "wait", label: "Time in ED" },
  { k: "status", label: "Status" }, { k: "loc", label: "Location" }, { k: "md", label: "MD" }, { k: "flags", label: "Flags" },
];
const STAGE_ORDER = Object.fromEntries(["arriving", ...D.ED_STAGES.map((s) => s.key)].map((k, i) => [k, i]));
function ListView({ list, pById, bById, filtering }) {
  const [sort, setSort] = useState({ k: "ctas", dir: 1 });
  const rows = useMemo(() => {
    const val = (e) => {
      const p = pById.get(e.patientId);
      switch (sort.k) {
        case "name": return `${p?.last} ${p?.first}`.toLowerCase();
        case "cc": return (e.cc || "").toLowerCase();
        case "wait": return -(e.arrivalAt || 0);
        case "status": return STAGE_ORDER[e.status] ?? 99;
        case "loc": return locationOf(e, bById.get(e.bedId));
        case "md": return e.md || "~";
        case "flags": return -((e.redFlags || []).length * 10 + (D.minutesOverTarget(e) ? 5 : 0));
        default: return null;
      }
    };
    return [...list].sort((a, b) => {
      if (sort.k === "ctas") return sort.dir * byUrgency(a, b);
      const x = val(a), y = val(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || byUrgency(a, b);
    });
  }, [list, sort, pById, bById]);
  const head = (c) => {
    const on = sort.k === c.k; const I = on ? (sort.dir > 0 ? LuArrowUp : LuArrowDown) : LuArrowUpDown;
    return <th key={c.k} aria-sort={on ? (sort.dir > 0 ? "ascending" : "descending") : "none"}><button type="button" className={cx("ed-th", on && "on")} onClick={() => setSort((s) => ({ k: c.k, dir: s.k === c.k ? -s.dir : 1 }))}>{c.label}<I /></button></th>;
  };
  if (!rows.length) return <div className="panel"><Empty icon={LuInbox} title={filtering ? "No patients match these filters" : "The department is empty"}>{filtering ? "Clear the filters to see everyone." : "New arrivals appear here as soon as they register."}</Empty></div>;
  return (
    <div className="panel flush ed-list">
      <div className="scroll-x">
        <table className="table">
          <thead><tr>{COLS.map(head)}</tr></thead>
          <tbody>
            {rows.map((e) => {
              const over = D.minutesOverTarget(e); const bed = bById.get(e.bedId);
              const waiting = ["waiting_triage", "waiting_md", "arriving"].includes(e.status);
              return (
                <tr key={e.id} className={cx("clickable", over && "ed-row-late", isNew(e) && "new-flash")} tabIndex={0} onClick={() => openChart(e.id)} onKeyDown={(ev) => { if (ev.key === "Enter") openChart(e.id); }}>
                  <td><Ctas level={e.ctas} /></td>
                  <td style={{ maxWidth: 220 }}><PatientLine encounter={e} patient={pById.get(e.patientId)} compact showMrn /></td>
                  <td style={{ maxWidth: 260 }}><div className="ellipsis t-sm" title={e.cc}>{e.cc}</div></td>
                  <td className="ed-nowrap">
                    <WaitTime encounter={e} />
                    <div className={cx("t-2xs", over ? "c-bad w6" : "c-3")}>
                      {over ? `${over} min past target` : waiting && e.ctas ? `Target ≤ ${D.CTAS[e.ctas].target} min` : e.seenAt ? `Seen after ${D.fmtDur(e.seenAt - e.arrivalAt)}` : waiting ? "Not triaged" : ""}
                    </div>
                  </td>
                  <td><StatusBadge status={e.status} /></td>
                  <td className="t-sm ed-nowrap">{e.status === "boarding" ? <span>{bed ? bed.label : "No space"} <span className="c-3">· {e.service}</span></span> : locationOf(e, bed)}</td>
                  <td className="t-sm ed-nowrap">{e.md || <span className="c-3">Unassigned</span>}</td>
                  <td><span className="row wrap gap-4">
                    {(e.redFlags || []).map((f) => <Badge key={f} tone="bad" icon={LuTriangleAlert}>{f}</Badge>)}
                    {resultsReady(e) ? <Badge tone="ok" icon={LuCircleCheck}>Results ready</Badge> : null}
                    {e.status === "arriving" ? <Badge tone="info">En route</Badge> : null}
                  </span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------ floor ------------------------------ */
function Floor({ beds, encounters, pById, highlight }) {
  const [assignBed, setAssignBed] = useState(null);
  const eById = useMemo(() => new Map(encounters.map((e) => [e.id, e])), [encounters]);
  const zones = useMemo(() => ZONES.map((z) => {
    const list = beds.filter((b) => b.area === "ED" && b.zone === z).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    return { z, list, occ: list.filter((b) => b.state === "occupied").length };
  }), [beds]);
  const unroomed = encounters.filter((e) => D.isEdActive(e) && !e.bedId && ["in_treatment", "awaiting_results", "decision", "boarding"].includes(e.status)).length;
  return (
    <div className="col gap-16">
      <div className="row wrap gap-12 t-xs c-2">
        <span className="row gap-4"><span className="ed-key occ" />Occupied</span>
        <span className="row gap-4"><span className="ed-key free" />Free</span>
        <span className="row gap-4"><span className="ed-key clean" />Cleaning</span>
        <span className="row gap-4"><span className="ed-key blocked" />Blocked</span>
        <span className="grow" />
        {unroomed ? <Badge tone="warn">{unroomed} patient{unroomed > 1 ? "s" : ""} in treatment without a space</Badge> : null}
      </div>
      {zones.map(({ z, list, occ }) => (
        <section key={z} className="panel ed-zone">
          <header className="panel-head"><span className="t-h3">{z}</span><span className="t-xs c-3 num">{occ} of {list.length} occupied</span></header>
          <div className="ed-beds">
            {list.map((b) => <BedTile key={b.id} b={b} e={b.encounterId ? eById.get(b.encounterId) : null} pById={pById} dim={highlight && !(b.encounterId && highlight.has(b.encounterId))} onAssign={() => setAssignBed(b.id)} />)}
          </div>
        </section>
      ))}
      <AssignBedModal bedId={assignBed} onClose={() => setAssignBed(null)} encounters={encounters} pById={pById} />
    </div>
  );
}

function BedTile({ b, e, pById, onAssign, dim }) {
  if (b.state === "occupied" && e) {
    const p = pById.get(e.patientId); const over = D.minutesOverTarget(e);
    return (
      <button type="button" className={cx("ed-bed occ", e.ctas ? `ctas-${e.ctas}` : "ctas-0", over && "late", dim && "dim")} onClick={() => openChart(e.id)} aria-label={`${b.label}: ${D.fullName(p)}. Open chart.`}>
        <span className="row"><span className="ed-bed-l">{b.label}</span><span className="grow" /><Ctas level={e.ctas} /></span>
        <span className="w6 ellipsis t-sm">{p ? `${p.first} ${p.last}` : "Patient"}</span>
        <span className="t-xs c-3 ellipsis">{e.cc}</span>
        <span className="row t-xs"><WaitTime encounter={e} /><span className="grow" /><span className="c-3 ellipsis">{D.ED_STAGES.find((s) => s.key === D.stageOf(e))?.label}</span></span>
      </button>
    );
  }
  if (b.state === "cleaning") {
    return (
      <div className="ed-bed clean">
        <span className="row"><span className="ed-bed-l">{b.label}</span><span className="grow" /><LuSprayCan className="c-warn" /></span>
        <span className="t-sm c-warn w5">Cleaning</span>
        <span className="t-xs c-3">for {D.fmtSince(b.since)}</span>
        <Button size="sm" onClick={() => { D.setBedState(b.id, "free", "user"); toast(`${b.label} marked clean and free`); }}>Mark clean</Button>
      </div>
    );
  }
  if (b.state === "blocked") {
    return (
      <div className="ed-bed blocked">
        <span className="row"><span className="ed-bed-l">{b.label}</span><span className="grow" /><LuBan className="c-3" /></span>
        <span className="t-sm c-2 w5">Blocked</span>
        <span className="t-xs c-3">{b.note || "Out of service"}</span>
        <Button size="sm" onClick={() => { D.setBedState(b.id, "free", "user"); toast(`${b.label} back in service`); }}>Unblock</Button>
      </div>
    );
  }
  return (
    <button type="button" className={cx("ed-bed free", dim && "dim")} onClick={onAssign} aria-label={`${b.label} is free. Assign a patient.`}>
      <span className="row"><span className="ed-bed-l">{b.label}</span><span className="grow" /><LuBed className="c-ok" /></span>
      <span className="t-sm c-ok w5">Free</span>
      <span className="t-xs c-3">since {D.fmtSince(b.since)}</span>
      <span className="ed-bed-cta"><LuUserPlus />Assign patient</span>
    </button>
  );
}

function AssignBedModal({ bedId, onClose, encounters, pById }) {
  const bed = S.useDoc("beds", bedId);
  const cands = useMemo(() => {
    if (!bed) return [];
    return encounters.filter((e) => D.isEdActive(e) && e.status !== "arriving" && e.status !== "waiting_triage" && (!e.bedId || S.get("beds", e.bedId)?.zone === "Hallway"))
      .sort((a, b) => {
        // most urgent first; at equal acuity, patients with no space before hallway patients
        const ra = a.bedId ? 1 : 0, rb = b.bedId ? 1 : 0;
        return (a.ctas || 9) - (b.ctas || 9) || ra - rb || (a.arrivalAt || 0) - (b.arrivalAt || 0);
      }).slice(0, 12);
  }, [encounters, bed]);
  const pick = (e) => {
    D.assignEdBed(e.id, bed.id, "user");
    toast(`${D.fullName(pById.get(e.patientId))} placed in ${bed.label}`);
    onClose();
  };
  return (
    <Modal open={!!bedId && !!bed} onClose={onClose} title={bed ? `Assign ${bed.zone === "Hallway" ? "hallway space" : bed.zone.toLowerCase() + " space"} ${bed.label}` : ""} subtitle="Patients without a space, most urgent first. Hallway patients can move into a real bed.">
      {cands.length ? (
        <div className="ed-pick">
          {cands.map((e) => {
            const p = pById.get(e.patientId); const cur = e.bedId ? S.get("beds", e.bedId) : null;
            return (
              <button key={e.id} type="button" className="ed-pick-row" onClick={() => pick(e)}>
                <Ctas level={e.ctas} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <PatientLine encounter={e} patient={p} compact />
                  <span className="t-xs c-3 ellipsis" style={{ display: "block" }}>{e.cc}</span>
                </span>
                <span className="col" style={{ gap: 2, alignItems: "flex-end" }}>
                  <WaitTime encounter={e} />
                  <span className="t-2xs c-3">{cur ? `Now in hallway ${cur.label}` : D.STATUS_LABEL[e.status]}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : <Empty icon={LuBed} title="Everyone has a space">No triaged patients are waiting for a space right now.</Empty>}
    </Modal>
  );
}
