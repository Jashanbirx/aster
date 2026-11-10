// Tasks: the shared work queue that staff, the system and Aster agents fill.
// Kanban by status (drag or buttons), role filter, search, and a New task form.
import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  LuPlus, LuSearch, LuPlay, LuCheck, LuRotateCcw, LuUser, LuBed, LuClock, LuSparkles, LuCpu, LuInbox, LuX, LuCircleCheck, LuUndo2,
} from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import { openChart } from "../lib/ui-state.js";
import { Button, Badge, PageHead, Tabs, Seg, Modal, Field, Input, Textarea, Select, Empty, toast, useNow, cx } from "../ui/index.jsx";
import { PRIORITY, startOfToday, actorLabel, dueText } from "./flow-lib.js";
import "./flow.css";

const COLS = [
  { key: "open", label: "Open", empty: "Nothing open here. New work from agents and staff lands in this column." },
  { key: "in_progress", label: "In progress", empty: "Drag a card here, or press Start, when you pick it up." },
  { key: "done", label: "Done today", empty: "Completed tasks from today show here." },
];
const DRAG = "text/aster-task";
const DUE = [{ value: "15", label: "15 min" }, { value: "60", label: "1 h" }, { value: "240", label: "4 h" }];
const PRI_DUE = { stat: "15", high: "60", normal: "240" };

export default function TasksPage() {
  const now = useNow();
  const tasks = S.useCollection("tasks");
  const encounters = S.useCollection("encounters");
  const patients = S.useCollection("patients");
  const beds = S.useCollection("beds");
  const pmap = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const emap = useMemo(() => new Map(encounters.map((e) => [e.id, e])), [encounters]);
  const bmap = useMemo(() => new Map(beds.map((b) => [b.id, b])), [beds]);

  const [role, setRole] = useState("All");
  const [by, setBy] = useState("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const [fresh, setFresh] = useState(null);

  const today0 = startOfToday(now);
  const visible = useMemo(() => tasks.filter((t) => t.status !== "done" || (t.doneAt || 0) >= today0), [tasks, today0]);
  const active = visible.filter((t) => t.status !== "done");
  const roleCounts = useMemo(() => { const c = {}; active.forEach((t) => { c[t.role] = (c[t.role] || 0) + 1; }); return c; }, [active]);

  const describe = (t) => {
    const e = t.encounterId ? emap.get(t.encounterId) : null; const p = e ? pmap.get(e.patientId) : null; const b = t.bedId ? bmap.get(t.bedId) : null;
    return { e, p, b };
  };
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return visible.filter((t) => {
      if (role !== "All" && t.role !== role) return false;
      const a = actorLabel(t.createdBy).kind;
      if (by === "agent" && a !== "agent") return false;
      if (by === "staff" && a !== "user") return false;
      if (by === "system" && a !== "system") return false;
      if (!ql) return true;
      const { p, b } = describe(t);
      return `${t.title} ${t.detail || ""} ${t.role} ${p ? p.first + " " + p.last + " " + p.mrn : ""} ${b?.label || ""} ${t.createdBy}`.toLowerCase().includes(ql);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, role, by, q, emap, pmap, bmap]);
  const byCol = useMemo(() => {
    const o = { open: [], in_progress: [], done: [] };
    filtered.forEach((t) => (o[t.status] || o.open).push(t));
    const pr = (t) => PRIORITY[t.priority]?.rank ?? 2;
    o.open.sort((a, b) => pr(a) - pr(b) || (a.due || 0) - (b.due || 0));
    o.in_progress.sort((a, b) => pr(a) - pr(b) || (a.due || 0) - (b.due || 0));
    o.done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    return o;
  }, [filtered]);

  const overdue = active.filter((t) => t.due && t.due < now).length;
  const agentMade = active.filter((t) => actorLabel(t.createdBy).kind === "agent").length;

  const move = (id, status) => {
    const t = S.get("tasks", id); if (!t || t.status === status) return;
    D.setTaskStatus(id, status, "user");
    const extra = status === "done" && t.bedId && t.role === "EVS" ? ` ${bmap.get(t.bedId)?.label || "Bed"} is now free.` : status === "done" && t.barrierId ? " Discharge barrier cleared." : "";
    toast(`${status === "done" ? "Done" : status === "in_progress" ? "Started" : "Reopened"}: ${t.title}.${extra}`);
  };

  return (
    <div>
      <PageHead title="Tasks"
        subtitle={`One queue for staff, the system and Aster agents. ${active.length} open${overdue ? `, ${overdue} overdue` : ""}${agentMade ? `, ${agentMade} created by agents` : ""}.`}
        actions={<Button variant="primary" icon={LuPlus} onClick={() => setCreating(true)}>New task</Button>} />

      <Tabs value={role} onChange={setRole} tabs={[{ key: "All", label: "All roles", count: active.length }, ...D.ROLES.map((r) => ({ key: r, label: r, count: roleCounts[r] || 0 }))]} />

      <div className="flow-toolbar">
        <label className="flow-search"><LuSearch aria-hidden="true" /><Input aria-label="Search tasks" placeholder="Search tasks, patients, beds" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {q ? <Button variant="ghost" size="sm" icon={LuX} onClick={() => setQ("")}>Clear</Button> : null}
        <span className="grow" />
        <span className="t-xs c-2 only-desktop">Created by</span>
        <Seg size="sm" value={by} onChange={setBy} options={[{ value: "all", label: "Anyone" }, { value: "agent", label: "Agents" }, { value: "staff", label: "Staff" }, { value: "system", label: "System" }]} />
      </div>

      <div className="flow-kanban">
        {COLS.map((c) => (
          <section key={c.key} className={cx("flow-col", overCol === c.key && "over")} data-col={c.key} aria-label={c.label}
            onDragOver={(ev) => { if (!dragId) return; ev.preventDefault(); ev.dataTransfer.dropEffect = "move"; if (overCol !== c.key) setOverCol(c.key); }}
            onDragLeave={(ev) => { if (!ev.currentTarget.contains(ev.relatedTarget)) setOverCol(null); }}
            onDrop={(ev) => { ev.preventDefault(); const id = ev.dataTransfer.getData(DRAG) || dragId; setOverCol(null); setDragId(null); if (id) move(id, c.key); }}>
            <div className="flow-col-head"><span className="t-h3">{c.label}</span><Badge>{byCol[c.key].length}</Badge>
              {c.key === "open" && byCol.open.some((t) => t.due && t.due < now) ? <Badge tone="bad">{byCol.open.filter((t) => t.due && t.due < now).length} overdue</Badge> : null}</div>
            <div className="flow-col-body">
              {!byCol[c.key].length ? (
                <div className="panel" style={{ background: "transparent", borderStyle: "dashed" }}>
                  <Empty icon={c.key === "done" ? LuCircleCheck : LuInbox} title={q || role !== "All" || by !== "all" ? "No matching tasks" : c.key === "open" ? "Queue is clear" : null}
                    action={c.key === "open" ? <Button size="sm" icon={LuPlus} onClick={() => setCreating(true)}>New task</Button> : null}>
                    {q || role !== "All" || by !== "all" ? "Try another role or clear the search." : c.empty}
                  </Empty>
                </div>
              ) : byCol[c.key].map((t) => (
                <TaskCard key={t.id} t={t} now={now} showRole={role === "All"} info={describe(t)} fresh={fresh === t.id} dragging={dragId === t.id}
                  onMove={move}
                  onDragStart={(ev) => { ev.dataTransfer.setData(DRAG, t.id); ev.dataTransfer.setData("text/plain", t.id); ev.dataTransfer.effectAllowed = "move"; setDragId(t.id); }}
                  onDragEnd={() => { setDragId(null); setOverCol(null); }} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <NewTaskModal open={creating} onClose={() => setCreating(false)} encounters={encounters} pmap={pmap} bmap={bmap} defaultRole={role === "All" ? "RN" : role}
        onCreated={(t) => { setFresh(t.id); if (role !== "All" && role !== t.role) setRole(t.role); setTimeout(() => setFresh(null), 2600); }} />
    </div>
  );
}

function TaskCard({ t, now, showRole, info: { e, p, b }, fresh, dragging, onMove, onDragStart, onDragEnd }) {
  const pri = PRIORITY[t.priority] || PRIORITY.normal;
  const who = actorLabel(t.createdBy);
  const due = dueText(t.due, now);
  const done = t.status === "done";
  return (
    <article className={cx("flow-card", t.priority === "stat" && !done && "stat", done && "done", dragging && "dragging", fresh && "new-flash")} draggable onDragStart={onDragStart} onDragEnd={onDragEnd} data-task={t.id}>
      <div className="flow-card-meta">
        <Badge tone={pri.tone}>{pri.label}</Badge>
        {showRole ? <Badge tone="outline">{t.role}</Badge> : null}
        <span className="grow" />
        {who.kind === "agent" ? <Badge tone="ai" icon={LuSparkles} title={`Created by the ${who.label} agent`}>{who.label}</Badge>
          : who.kind === "system" ? <Badge icon={LuCpu} title="Created automatically by Aster rules">System</Badge>
          : <Badge tone="outline" icon={LuUser} title="Created by a staff member">{who.label}</Badge>}
      </div>
      <div className="flow-card-title">{t.title}</div>
      {t.detail ? <div className="t-xs c-2" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.detail}</div> : null}
      <div className="flow-card-meta">
        {p && e ? <button type="button" className="flow-link row gap-4 t-xs" style={{ fontWeight: 500 }} onClick={() => openChart(e.id)} title="Open chart"><LuUser size={12} />{p.first} {p.last}{e.bedId ? ` · ${S.get("beds", e.bedId)?.label || ""}` : ""}</button> : null}
        {b ? <span className="row gap-4"><LuBed size={12} />{b.label}{b.state ? <span className="c-3"> · {b.state}</span> : null}</span> : null}
        {done ? <span className="row gap-4 c-ok w5 num"><LuCheck size={12} />Done {D.fmtClock(t.doneAt || Date.now())}</span>
          : <span className="row gap-4 num" style={{ color: due.over ? "var(--bad)" : due.soon ? "var(--warn)" : "var(--ink-2)", fontWeight: due.over || due.soon ? 600 : 400 }} title={t.due ? `Due ${D.fmtDateTime(t.due)}` : undefined}><LuClock size={12} />{due.text}</span>}
        <span className="grow" />
        <span className="flow-card-actions">
          {t.status === "open" ? <><Button size="sm" variant="ghost" icon={LuPlay} onClick={() => onMove(t.id, "in_progress")}>Start</Button><Button size="sm" icon={LuCheck} onClick={() => onMove(t.id, "done")}>Done</Button></> : null}
          {t.status === "in_progress" ? <><Button size="sm" variant="ghost" icon={LuUndo2} onClick={() => onMove(t.id, "open")} aria-label="Back to open" title="Back to open" /><Button size="sm" icon={LuCheck} onClick={() => onMove(t.id, "done")}>Done</Button></> : null}
          {done ? <Button size="sm" variant="ghost" icon={LuRotateCcw} onClick={() => onMove(t.id, "open")}>Reopen</Button> : null}
        </span>
      </div>
    </article>
  );
}

function NewTaskModal({ open, onClose, encounters, pmap, bmap, defaultRole, onCreated }) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [role, setRole] = useState(defaultRole);
  const [priority, setPriority] = useState("normal");
  const [due, setDue] = useState("240");
  const [dueTouched, setDueTouched] = useState(false);
  const [pq, setPq] = useState("");
  const [encId, setEncId] = useState(null);
  const titleRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    setTitle(""); setDetail(""); setRole(defaultRole); setPriority("normal"); setDue("240"); setDueTouched(false); setPq(""); setEncId(null);
    setTimeout(() => titleRef.current?.focus(), 30);
  }, [open, defaultRole]);

  const active = useMemo(() => encounters.filter((e) => D.isEdActive(e) || D.isInpatient(e)), [encounters]);
  const matches = useMemo(() => {
    const ql = pq.trim().toLowerCase(); if (ql.length < 2) return [];
    return active.map((e) => ({ e, p: pmap.get(e.patientId), b: e.bedId ? bmap.get(e.bedId) : null }))
      .filter(({ p, b }) => p && `${p.first} ${p.last} ${p.mrn} ${b?.label || ""}`.toLowerCase().includes(ql)).slice(0, 6);
  }, [pq, active, pmap, bmap]);
  const sel = encId ? active.find((e) => e.id === encId) : null;
  const selP = sel ? pmap.get(sel.patientId) : null;

  const submit = (ev) => {
    ev?.preventDefault();
    if (!title.trim()) { titleRef.current?.focus(); return; }
    const t = D.createTask({ title: title.trim(), detail: detail.trim(), role, priority, encounterId: encId, dueMin: +due }, "user");
    toast(`Task created for ${role}: due in ${DUE.find((d) => d.value === due)?.label}.`);
    onCreated?.(t); onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="New task" subtitle="Goes straight to the shared queue for the role you pick."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={LuPlus} disabled={!title.trim()} onClick={submit}>Create task</Button></>}>
      <form onSubmit={submit} className="col" style={{ gap: 14 }}>
        <Field label="Task"><Input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: Call CLSC about home-care start date" maxLength={140} /></Field>
        <Field label="Details (optional)"><Textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} style={{ minHeight: 60 }} placeholder="Anything the person picking this up needs to know" /></Field>
        <div className="grid g2" style={{ gap: 14 }}>
          <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)} options={D.ROLES} /></Field>
          <div className="field"><span className="label">Priority</span>
            <div><Seg value={priority} onChange={(v) => { setPriority(v); if (!dueTouched) setDue(PRI_DUE[v]); }} options={[{ value: "stat", label: "Stat" }, { value: "high", label: "High" }, { value: "normal", label: "Normal" }]} /></div></div>
        </div>
        <div className="field"><span className="label">Due in</span><div><Seg value={due} onChange={(v) => { setDue(v); setDueTouched(true); }} options={DUE} /></div></div>
        <div className="field">
          <span className="label">Patient (optional)</span>
          {sel ? (
            <div className="row well" style={{ padding: "8px 12px" }}>
              <LuUser size={14} /><span className="w6 grow ellipsis">{selP ? `${selP.first} ${selP.last}` : "Patient"}</span>
              <span className="t-xs c-2">{D.STATUS_LABEL[sel.status]}{sel.bedId ? ` · ${bmap.get(sel.bedId)?.label || ""}` : ""}</span>
              <Button type="button" size="sm" variant="ghost" icon={LuX} aria-label="Remove patient" onClick={() => setEncId(null)} />
            </div>
          ) : <>
            <Input aria-label="Search active patients" value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Search active patients by name, MRN or bed" />
            {pq.trim().length >= 2 ? (matches.length ? (
              <div className="flow-pick mt4">{matches.map(({ e, p, b }) => (
                <button type="button" key={e.id} onClick={() => { setEncId(e.id); setPq(""); }}>
                  <span className="w6">{p.first} {p.last}</span><span className="t-xs c-3">{p.mrn}</span><span className="grow" /><span className="t-xs c-2">{e.status === "admitted" ? `Inpatient · ${b?.label || e.unit}` : `ED · ${D.STATUS_LABEL[e.status]}`}</span>
                </button>))}</div>
            ) : <span className="hint">No active patient matches. Tasks can also go without a patient.</span>) : null}
          </>}
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
