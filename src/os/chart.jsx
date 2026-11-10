// Patient chart drawer: works for ED visits, inpatients and closed visits.
import React, { useEffect, useMemo, useState } from "react";
import {
  LuFlaskConical, LuScan, LuPill, LuClipboardList, LuStethoscope, LuHeartPulse, LuTriangleAlert, LuSmartphone, LuPlus,
  LuCheck, LuX, LuPlay, LuCircleCheck, LuNotebookPen, LuSignature, LuLogIn, LuArrowRight, LuBed, LuBedDouble, LuHouse,
  LuBuilding2, LuUserX, LuSparkles, LuCircleDot, LuHistory, LuDoorOpen, LuClock, LuListChecks, LuInbox, LuFileText, LuUser,
} from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import * as AI from "../lib/ai.js";
import { go } from "../lib/ui-state.js";
import { Button, Badge, Drawer, Modal, Tabs, Seg, Field, Input, Textarea, Select, Empty, AiLabel, Markdown, Typing, toast, useNow, cx } from "../ui/index.jsx";
import { StatusBadge, WaitTime, RedFlags, VitalsRow, Ctas } from "../ui/clinical.jsx";
import { Menu, Group, SlotList, suggestService, VitalsInputs, parseVitals, vitalsToForm } from "./ed-parts.jsx";
import {
  ORDER_CATALOG, ORDER_STATUS, ORDER_TYPE_LABEL, isPendingOrder, isBackOrder, ordersProgress, isClosed, locationOf, langPlain,
  actorLabel, focusTriage, nextSlots, diversionCheck, encounterContext, fallbackSbar, fallbackDischarge, vitalsText,
} from "./ed-lib.js";
import "./ed.css";

const TYPE_ICON = { lab: LuFlaskConical, imaging: LuScan, med: LuPill, nursing: LuClipboardList, consult: LuStethoscope };
const name = (p) => D.fullName(p);

function normTab(tab, inpatient) {
  const t = { disposition: "dispo", discharge: inpatient ? "plan" : "dispo", dc: "plan", plan: "plan" }[tab] || tab || "overview";
  if (inpatient && t === "dispo") return "plan";
  if (!inpatient && t === "plan") return "dispo";
  return ["overview", "orders", "notes", "timeline", "dispo", "plan"].includes(t) ? t : "overview";
}

/* =================================================================== */
export default function ChartDrawer({ encounterId, tab, onClose }) {
  useNow();
  const e = S.useDoc("encounters", encounterId);
  const p = S.useDoc("patients", e?.patientId);
  const bed = S.useDoc("beds", e?.bedId);
  const inpatient = e?.status === "admitted";
  const [t, setT] = useState(() => normTab(tab, inpatient));
  useEffect(() => { setT(normTab(tab, inpatient)); }, [tab, encounterId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!encounterId) return null;
  if (!e) return <Drawer open onClose={onClose} title="Chart"><Empty icon={LuInbox} title="This visit could not be found">It may have been removed. Close the chart and pick another patient.</Empty></Drawer>;
  const cur = normTab(t, inpatient);
  const prog = ordersProgress(e);
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "orders", label: "Orders", count: prog.total || null },
    { key: "notes", label: "Notes", count: (e.notes || []).length || null },
    { key: "timeline", label: "Timeline" },
    inpatient ? { key: "plan", label: "Discharge plan" } : { key: "dispo", label: "Disposition" },
  ];
  return (
    <Drawer open onClose={onClose} width="min(800px, 100vw)" title={<ChartHead e={e} p={p} bed={bed} cur={cur} onTab={setT} onClose={onClose} />}>
      <Tabs tabs={tabs} value={cur} onChange={setT} />
      <div key={e.id + cur} className="ed-tabpane">
        {cur === "overview" ? <Overview e={e} p={p} bed={bed} onTab={setT} /> : null}
        {cur === "orders" ? <Orders e={e} p={p} /> : null}
        {cur === "notes" ? <Notes e={e} p={p} /> : null}
        {cur === "timeline" ? <Timeline e={e} /> : null}
        {cur === "dispo" ? <Disposition e={e} p={p} bed={bed} /> : null}
        {cur === "plan" ? <DischargePlan e={e} p={p} bed={bed} /> : null}
      </div>
    </Drawer>
  );
}

/* ------------------------------ header ----------------------------- */
function primaryAction(e, p, { onTab, onClose }) {
  const n = name(p);
  const prog = ordersProgress(e);
  switch (e.status) {
    case "arriving": return { label: "Mark arrived", icon: LuLogIn, run: () => { D.setEdStatus(e.id, "waiting_triage", "user"); toast(`${n} arrived and joined the triage queue`); } };
    case "waiting_triage": return { label: "Triage now", icon: LuStethoscope, run: () => { focusTriage(e.id); onClose(); go("triage"); } };
    case "waiting_md": return { label: "Start treatment", icon: LuPlay, run: () => { D.setEdStatus(e.id, "in_treatment", "user"); const a = S.get("encounters", e.id); const b = a?.bedId ? S.get("beds", a.bedId) : null; toast(`Treatment started by ${a?.md || "physician"}${b ? `, placed in ${b.label}` : ". No free space: assign one from the floor view"}`); } };
    case "in_treatment": return prog.pending
      ? { label: "Mark as waiting on results", icon: LuClock, run: () => { D.setEdStatus(e.id, "awaiting_results", "user"); toast(`${n} is waiting on ${prog.pending} result${prog.pending > 1 ? "s" : ""}`); } }
      : { label: "Move to decision", icon: LuArrowRight, run: () => { D.setEdStatus(e.id, "decision", "user"); toast(`${n} is ready for a disposition decision`); } };
    case "awaiting_results": return { label: "Move to decision", icon: LuArrowRight, run: () => { D.setEdStatus(e.id, "decision", "user"); toast(`${n} is ready for a disposition decision`); } };
    case "decision": return { label: "Discharge or admit…", icon: LuDoorOpen, run: () => onTab("dispo") };
    case "boarding": return { label: "Assign inpatient bed…", icon: LuBedDouble, run: () => onTab("dispo") };
    case "admitted": return { label: "Discharge plan", icon: LuListChecks, run: () => onTab("plan") };
    default: return null;
  }
}

function ChartHead({ e, p, bed, cur, onTab, onClose }) {
  const age = D.ageOf(p?.dob);
  const allergies = p?.allergies || [];
  const act0 = primaryAction(e, p, { onTab, onClose });
  const act = act0 && ((["decision", "boarding"].includes(e.status) && cur === "dispo") || (e.status === "admitted" && cur === "plan")) ? null : act0;
  const closed = isClosed(e);
  const end = e.dischargedAt || e.closedAt;
  const stage = D.stageOf(e);
  const moveItems = D.isEdActive(e) ? D.ED_STAGES.map((s) => ({
    key: s.key, label: s.label, current: s.key === stage,
    disabled: (!e.ctas && s.key !== "waiting_triage") || s.key === "boarding",
    hint: s.key === "boarding" ? "Use Disposition" : !e.ctas && s.key !== "waiting_triage" ? "Triage first" : null,
    run: () => { D.setEdStatus(e.id, s.key, "user"); toast(`${name(p)} moved to ${s.label.toLowerCase()}`); },
  })) : null;
  return (
    <div className="ed-ch">
      <div className="ed-ch-top">
        {e.status === "admitted" ? <span className="ed-ch-ip" title="Inpatient"><LuBedDouble /></span> : <Ctas level={e.ctas} size="lg" title={e.ctas ? `CTAS ${e.ctas}: ${D.CTAS[e.ctas].label}` : "Not triaged"} />}
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="t-h2 ellipsis">{p ? name(p) : "Unknown patient"}</div>
          <div className="t-sm c-2 ed-ch-sub">
            <span className="num">{age ?? "?"} {p?.sex === "F" ? "F" : p?.sex === "M" ? "M" : ""}</span>
            <span>MRN {p?.mrn || "–"}</span>
            {p?.dob ? <span className="num">DOB {p.dob}</span> : null}
            <span>{langPlain(p?.lang)}</span>
          </div>
          <div className={cx("t-sm ed-ch-allergy", allergies.length ? "c-bad w6" : "c-3")}>
            {allergies.length ? <><LuTriangleAlert />Allergies: {allergies.join(", ")}</> : "No known allergies"}
          </div>
        </div>
      </div>
      <div className="ed-ch-meta">
        <StatusBadge status={e.status} />
        <span className="ed-ch-chip"><LuBed />{locationOf(e, bed)}</span>
        <span className="ed-ch-chip"><LuClock />
          {closed ? <>Visit {D.fmtDur((end || Date.now()) - e.arrivalAt)}{end ? `, closed ${D.fmtClock(end)}` : ""}</>
            : e.status === "admitted" ? <>Length of stay {D.fmtSince(e.admittedAt || e.arrivalAt)}</>
              : <><WaitTime encounter={e} />&nbsp;in ED</>}
        </span>
        {e.status === "boarding" ? <span className="ed-ch-chip c-bad"><LuBedDouble />Boarding {D.fmtSince(e.admitRequestAt || e.arrivalAt)} · {e.service}</span> : null}
        {e.md ? <span className="ed-ch-chip"><LuUser />{e.md}</span> : null}
        {e.status === "admitted" && e.service ? <span className="ed-ch-chip">{e.service}</span> : null}
        <span className="grow" />
        {moveItems ? <Menu label="Move to…" items={moveItems} title="Move to another stage" buttonClass="ed-ch-move" /> : null}
        {act ? <Button size="sm" variant="primary" icon={act.icon} onClick={act.run}>{act.label}</Button> : null}
      </div>
    </div>
  );
}

const Sec = ({ title, actions, children, className }) => (
  <section className={cx("ed-sec", className)}>
    {title || actions ? <div className="ed-sec-h"><span className="ed-sec-t">{title}</span><span className="grow" />{actions}</div> : null}
    {children}
  </section>
);

/* ----------------------------- overview ---------------------------- */
function Overview({ e, p, bed, onTab }) {
  const triageNote = [...(e.notes || [])].reverse().find((n) => n.kind === "triage");
  const results = (e.orders || []).filter(isBackOrder).sort((a, b) => (b.resultedAt || b.t) - (a.resultedAt || a.t));
  const pending = (e.orders || []).filter(isPendingOrder);
  return (
    <div className="col gap-16">
      <ClosedBanner e={e} />
      <Handoff e={e} p={p} bed={bed} />
      <Sec title="Presenting complaint">
        <div className="t-h3">{e.dx && e.dx !== e.cc ? e.dx : e.cc}</div>
        {e.dx && e.dx !== e.cc ? <div className="t-sm c-2 mt4">Presented with: {e.cc}</div> : null}
        <div className="row wrap gap-4 mt8">
          <Badge tone="outline">{{ "walk-in": "Walk-in", ambulance: "Ambulance", app: "Aster app", referral: "Referral" }[e.source] || (e.kind === "IP" ? "Inpatient" : "Walk-in")}</Badge>
          {e.ctas ? <Badge tone="outline">CTAS {e.ctas} · {D.CTAS[e.ctas].label}</Badge> : <Badge tone="warn">Not triaged yet</Badge>}
          {e.triagedAt ? <Badge tone="outline">Triaged {D.fmtClock(e.triagedAt)}</Badge> : null}
          {e.alc ? <Badge tone="warn">ALC</Badge> : null}
        </div>
        {(e.redFlags || []).length ? <div className="mt8"><RedFlags flags={e.redFlags} /></div> : null}
        {e.preSummary ? (
          <div className="ed-pre mt12">
            <div className="row t-xs w6 c-brand"><LuSmartphone />Pre-arrival summary from the Aster app</div>
            <div className="t-sm mt4">{e.preSummary}</div>
          </div>
        ) : null}
        {triageNote ? <div className="ed-quote mt12"><div className="t-xs c-3">Triage note · {triageNote.author} · {D.fmtClock(triageNote.t)}</div><div className="t-sm pre mt4">{triageNote.text}</div></div> : null}
      </Sec>
      <Vitals e={e} />
      <Sec title="Key results" actions={<Button size="sm" variant="ghost" onClick={() => onTab("orders")}>All orders</Button>}>
        {results.length ? (
          <div className="ed-results">
            {results.slice(0, 6).map((o) => { const I = TYPE_ICON[o.type] || LuFlaskConical; return (
              <div key={o.id} className="ed-result"><I className="c-3" /><span className="w5">{o.name}</span><span className="grow c-2 t-sm">{o.result || ORDER_STATUS[o.status].label}</span><span className="t-xs c-3 num">{D.fmtClock(o.resultedAt || o.t)}</span></div>
            ); })}
          </div>
        ) : <div className="t-sm c-3">No results yet.</div>}
        {pending.length ? <div className="t-xs c-2 mt8">{pending.length} pending: {pending.map((o) => o.name).join(", ")}</div> : null}
      </Sec>
      <Sec title="Background">
        <div className="ed-kv">
          <span>Conditions</span><span>{(p?.conditions || []).join(", ") || <span className="c-3">None recorded</span>}</span>
          <span>Home medications</span><span>{(p?.meds || []).length ? p.meds.map((m) => `${m.name}${m.dose ? ` (${m.dose})` : ""}`).join(", ") : <span className="c-3">None recorded</span>}</span>
          <span>Family doctor</span><span>{p?.familyDoctor || <span className="c-3">None on file</span>}</span>
          <span>Phone</span><span className="num">{p?.phone || "–"}</span>
          <span>RAMQ</span><span className="num">{p?.ramq || "–"}</span>
        </div>
      </Sec>
    </div>
  );
}

function ClosedBanner({ e }) {
  if (!isClosed(e)) return null;
  const txt = e.status === "discharged" ? `Discharged ${D.fmtDateTime(e.dischargedAt)}${e.followUp ? `. Follow-up: ${e.followUp}` : ""}.`
    : e.status === "diverted" ? `Redirected to ${e.diversion?.clinicName || "a clinic"}${e.diversion?.t ? ` at ${D.fmtClock(e.diversion.t)}` : ""}. Triage summary sent ahead.`
      : e.status === "lwbs" ? `Left without being seen at ${D.fmtClock(e.closedAt)}. A call-back task was created for nursing.` : D.STATUS_LABEL[e.status];
  return <div className="ed-closed"><LuCircleCheck /><div><div className="w6 t-sm">This visit is closed</div><div className="t-sm c-2">{txt} You can still add an addendum in Notes.</div></div></div>;
}

function Handoff({ e, p, bed }) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setText(""); setMode(null);
    const prompt = `Write a concise SBAR handoff for the next clinician caring for this patient.
Use exactly four Markdown headings: "#### Situation", "#### Background", "#### Assessment", "#### Recommendation". Short sentences or "- " bullets, at most 170 words in total.
Use only the facts below. If something important is missing, write "not documented". Do not invent results.

${encounterContext(e, p, bed)}`;
    const r = await AI.text(prompt, { onText: (s) => setText(s) });
    if (r === null || !String(r).trim()) { setText(fallbackSbar(e, p, bed)); setMode("rules"); }
    else { setText(r); setMode("ai"); }
    setBusy(false);
  };
  const save = () => {
    D.addNote(e.id, { kind: "nursing", text: text.replace(/^####\s*/gm, "").trim(), author: "Handoff summary", signed: true }, "user");
    toast("Handoff saved to notes");
  };
  return (
    <div className="ai-card">
      <div className="row wrap">
        <AiLabel>Handoff (SBAR)</AiLabel>
        <span className="grow" />
        {text && !busy ? <Button size="sm" variant="ghost" icon={LuNotebookPen} onClick={save}>Save to notes</Button> : null}
        <Button size="sm" variant="ai" icon={LuSparkles} loading={busy} onClick={run}>{text ? "Regenerate" : "Generate handoff"}</Button>
      </div>
      {text ? <Markdown className="mt8 t-sm ed-md" text={text} /> : busy ? <div className="mt8 c-ai"><Typing /></div> : <div className="t-sm c-2 mt8">Summarize this visit for shift change or a consult call. Built from the chart: vitals, orders, results and notes.</div>}
      {mode === "rules" ? <div className="t-xs c-3 mt8">AI is unavailable, so this summary was assembled directly from the chart data.</div> : mode === "ai" ? <div className="t-xs c-3 mt8">AI draft from chart data. Verify before relying on it.</div> : null}
    </div>
  );
}

function Vitals({ e }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => vitalsToForm(e.vitals));
  const [err, setErr] = useState([]);
  const closed = isClosed(e);
  const hist = [...(e.vitalsHistory || [])].reverse().slice(1, 5);
  const save = () => {
    const { vitals, errors } = parseVitals(form);
    if (errors.length) { setErr(errors); return; }
    if (!Object.keys(vitals).length) { setErr(["Enter at least one value."]); return; }
    D.recordVitals(e.id, vitals, "user");
    toast("Vitals recorded"); setOpen(false); setErr([]);
  };
  return (
    <Sec title={<>Vitals{e.vitals?.t ? <span className="t-xs c-3 w5"> · {D.fmtAgo(e.vitals.t)}</span> : null}</>}
      actions={!closed && !open ? <Button size="sm" icon={LuHeartPulse} onClick={() => { setForm(vitalsToForm(e.vitals)); setOpen(true); }}>Record vitals</Button> : null}>
      {open ? (
        <div className="ed-form">
          <VitalsInputs form={form} onChange={setForm} />
          {err.length ? <div className="t-xs c-bad mt8">{err.join(". ")}.</div> : null}
          <div className="row mt12"><Button variant="primary" size="sm" icon={LuCheck} onClick={save}>Save vitals</Button><Button size="sm" variant="ghost" onClick={() => { setOpen(false); setErr([]); }}>Cancel</Button><span className="t-xs c-3">Values are prefilled from the last set. Change what you measured.</span></div>
        </div>
      ) : <VitalsRow v={e.vitals} />}
      {hist.length ? (
        <div className="ed-vhist mt12">
          {hist.map((v, i) => <div key={i} className="t-xs c-2 row"><span className="num c-3" style={{ width: 44 }}>{D.fmtClock(v.t)}</span><span className="ellipsis">{vitalsText(v)}</span></div>)}
        </div>
      ) : null}
    </Sec>
  );
}

/* ------------------------------ orders ----------------------------- */
function Orders({ e, p }) {
  const [free, setFree] = useState("");
  const [prio, setPrio] = useState("routine");
  const closed = isClosed(e);
  const orders = e.orders || [];
  const pending = orders.filter(isPendingOrder);
  const back = orders.filter(isBackOrder);
  const cancelled = orders.filter((o) => o.status === "cancelled");
  const activeNames = new Set(pending.map((o) => o.name.toLowerCase()));
  const place = (name, type) => {
    if (!name.trim()) return;
    D.addOrder(e.id, { name: name.trim(), type, priority: prio === "stat" ? "stat" : "routine" }, "user");
    toast(`Ordered ${name.trim()}${prio === "stat" ? " (STAT)" : ""}`);
  };
  const offerWait = ["waiting_md", "in_treatment"].includes(e.status) && pending.length > 0;
  return (
    <div className="col gap-16">
      {offerWait ? (
        <div className="ed-callout">
          <LuClock className="ed-c-info" />
          <div className="grow"><div className="w6 t-sm">{pending.length} result{pending.length > 1 ? "s" : ""} pending</div><div className="t-xs c-2">Move {name(p)} to Results pending so the board shows who is waiting on tests. They move to Decision automatically when everything is back.</div></div>
          <Button size="sm" onClick={() => { D.setEdStatus(e.id, "awaiting_results", "user"); toast(`${name(p)} is waiting on results`); }}>Mark as waiting on results</Button>
        </div>
      ) : null}
      {!closed ? (
        <Sec title="Quick order" actions={<Seg size="sm" options={[{ value: "routine", label: "Routine" }, { value: "stat", label: "STAT" }]} value={prio} onChange={setPrio} />}>
          <div className="col" style={{ gap: 10 }}>
            {ORDER_CATALOG.map((g) => (
              <div key={g.group} className="ed-cat">
                <span className="ed-cat-g t-xs c-3">{g.group}</span>
                <div className="row wrap gap-4">
                  {g.items.map((it) => {
                    const on = activeNames.has(it.name.toLowerCase());
                    const I = TYPE_ICON[it.type];
                    return <button key={it.name} type="button" className={cx("ed-oc", on && "on")} disabled={on} onClick={() => place(it.name, it.type)} title={on ? "Already ordered and pending" : `Order ${it.name}`}>{on ? <LuCheck /> : <I />}{it.name}</button>;
                  })}
                </div>
              </div>
            ))}
            <form className="row ed-free" onSubmit={(ev) => { ev.preventDefault(); place(free); setFree(""); }}>
              <Input value={free} onChange={(ev) => setFree(ev.target.value)} placeholder="Other order, e.g. Lipid panel, Knee X-ray, Ketorolac 15 mg IV" aria-label="Free-text order" />
              <Button type="submit" variant="primary" icon={LuPlus} disabled={!free.trim()}>Place order</Button>
            </form>
          </div>
        </Sec>
      ) : null}
      <Sec title={`Pending (${pending.length})`}>
        {pending.length ? <div className="ed-orders">{pending.map((o) => <OrderRow key={o.id} e={e} o={o} closed={closed} />)}</div> : <div className="t-sm c-3">{orders.length ? "Nothing pending. All orders are back." : closed ? "No orders were placed during this visit." : "No orders yet. Use the quick order list above."}</div>}
      </Sec>
      {back.length ? <Sec title={`Resulted (${back.length})`}><div className="ed-orders">{back.map((o) => <OrderRow key={o.id} e={e} o={o} closed={closed} />)}</div></Sec> : null}
      {cancelled.length ? <details className="ed-details"><summary className="t-sm c-2">Cancelled ({cancelled.length})</summary><div className="ed-orders mt8">{cancelled.map((o) => <OrderRow key={o.id} e={e} o={o} closed />)}</div></details> : null}
    </div>
  );
}

function OrderRow({ e, o, closed }) {
  const [entering, setEntering] = useState(false);
  const [val, setVal] = useState("");
  const I = TYPE_ICON[o.type] || LuFlaskConical;
  const st = ORDER_STATUS[o.status] || { label: o.status };
  const pending = isPendingOrder(o);
  const apply = (partial, msg) => {
    const before = S.get("encounters", e.id);
    D.updateOrder(e.id, o.id, partial, "user");
    const after = S.get("encounters", e.id);
    toast(before?.status === "awaiting_results" && after?.status === "decision" ? `${msg}. All results are back: moved to Decision` : msg);
  };
  const save = () => {
    if (!val.trim()) return;
    apply({ status: "resulted", result: val.trim() }, `${o.name} resulted`);
    setEntering(false); setVal("");
  };
  return (
    <div className={cx("ed-order", o.status === "cancelled" && "off")}>
      <span className={cx("ed-order-ic", o.type)}><I /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row gap-4" style={{ gap: 6 }}>
          <span className="w5 ellipsis">{o.name}</span>
          {o.priority === "stat" ? <Badge tone="bad">STAT</Badge> : null}
          <span className="t-2xs c-3">{ORDER_TYPE_LABEL[o.type] || ""}</span>
        </div>
        <div className="t-xs c-3">{D.fmtClock(o.t)} · {o.by || "Physician"}{pending ? ` · ${D.fmtAgo(o.t)}` : ""}</div>
        {o.result ? <div className="t-sm mt4 ed-order-res">{o.result}</div> : null}
        {entering ? (
          <form className="row mt8" onSubmit={(ev) => { ev.preventDefault(); save(); }}>
            <Input className="sm" autoFocus value={val} onChange={(ev) => setVal(ev.target.value)} placeholder={o.type === "imaging" ? "e.g. No acute findings" : o.type === "lab" ? "e.g. Hb 128 g/L, WBC 11.2" : "Result or outcome"} aria-label={`Result for ${o.name}`} />
            <Button size="sm" variant="primary" type="submit" disabled={!val.trim()}>Save result</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setEntering(false)}>Cancel</Button>
          </form>
        ) : null}
      </div>
      <div className="ed-order-act">
        <Badge tone={st.tone}>{st.label}</Badge>
        {pending && !closed && !entering ? (
          <span className="row gap-4">
            {o.status === "ordered" ? <Button size="sm" variant="ghost" icon={LuPlay} onClick={() => apply({ status: "in_progress" }, `${o.name} in progress`)}>Start</Button> : null}
            {["med", "nursing"].includes(o.type) ? <Button size="sm" variant="ghost" icon={LuCheck} onClick={() => apply({ status: "done", result: o.type === "med" ? "Given" : "Done" }, `${o.name} done`)}>Done</Button> : null}
            <Button size="sm" icon={LuFileText} onClick={() => setEntering(true)}>Enter result</Button>
            <Button size="sm" variant="ghost" icon={LuX} aria-label={`Cancel ${o.name}`} title="Cancel order" onClick={() => apply({ status: "cancelled" }, `${o.name} cancelled`)} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------- notes ----------------------------- */
const NOTE_KIND = { triage: { label: "Triage", tone: "warn" }, md: { label: "Physician", tone: "brand" }, scribe: { label: "Ambient scribe", tone: "ai" }, nursing: { label: "Nursing", tone: "info" }, discharge: { label: "Discharge", tone: "ok" } };
function Notes({ e, p }) {
  const [kind, setKind] = useState("md");
  const [text, setText] = useState("");
  const closed = isClosed(e);
  const notes = [...(e.notes || [])].sort((a, b) => b.t - a.t);
  const save = () => {
    if (!text.trim()) return;
    const author = kind === "md" ? (e.md || "Physician") : (e.nurse || "RN");
    D.addNote(e.id, { kind, text: (closed ? "Addendum: " : "") + text.trim(), author, signed: true }, "user");
    setText(""); toast(closed ? "Addendum signed and saved" : "Note signed and saved");
  };
  return (
    <div className="col gap-16">
      <Sec title={closed ? "Add an addendum" : "New note"} actions={<Seg size="sm" options={[{ value: "md", label: "Physician" }, { value: "nursing", label: "Nursing" }]} value={kind} onChange={setKind} />}>
        <Textarea value={text} onChange={(ev) => setText(ev.target.value)} placeholder={kind === "md" ? "History, exam, assessment and plan" : "Observations, interventions, response"} aria-label="Note text" rows={4} />
        <div className="row mt8"><span className="t-xs c-3 grow">Signed as {kind === "md" ? (e.md || "Physician") : (e.nurse || "RN")} when saved.</span><Button variant="primary" size="sm" icon={LuSignature} disabled={!text.trim()} onClick={save}>Sign and save note</Button></div>
      </Sec>
      <Sec title={`Notes (${notes.length})`}>
        {notes.length ? (
          <div className="ed-notes">
            {notes.map((n) => {
              const k = NOTE_KIND[n.kind] || { label: n.kind, tone: "" };
              return (
                <article key={n.id} className="ed-note">
                  <div className="row wrap" style={{ gap: 6 }}>
                    <Badge tone={k.tone}>{k.label}</Badge>
                    <span className="w5 t-sm">{n.author}</span>
                    <span className="t-xs c-3 num">{D.fmtDateTime(n.t)}</span>
                    <span className="grow" />
                    {n.signed ? <span className="t-xs c-ok row gap-4"><LuSignature size={13} />Signed</span> : <Badge tone="warn">Unsigned draft</Badge>}
                  </div>
                  {n.kind === "scribe" ? <Markdown className="t-sm mt8 ed-md" text={n.text} /> : <div className="t-sm pre mt8">{n.text}</div>}
                </article>
              );
            })}
          </div>
        ) : <Empty icon={LuNotebookPen} title="No notes yet">Write the first note above. Triage and scribe notes also appear here.</Empty>}
      </Sec>
    </div>
  );
}

/* ----------------------------- timeline ---------------------------- */
const TL_ICON = { arrival: LuLogIn, triage: LuStethoscope, status: LuArrowRight, order: LuFlaskConical, result: LuCircleCheck, note: LuNotebookPen, vitals: LuHeartPulse, location: LuBed, discharge: LuHouse, admit: LuBedDouble, diverted: LuBuilding2, lwbs: LuUserX };
function Timeline({ e }) {
  const items = [...(e.timeline || [])].sort((a, b) => a.t - b.t);
  if (!items.length) return <Empty icon={LuHistory} title="No events recorded">Status changes, orders, results and notes appear here as they happen.</Empty>;
  let lastDay = null;
  return (
    <ol className="ed-tl">
      {items.map((it, i) => {
        const I = TL_ICON[it.type] || LuCircleDot;
        const day = D.fmtDate(it.t); const showDay = day !== lastDay; lastDay = day;
        return (
          <li key={i} className={cx("ed-tl-i", it.type)}>
            {showDay ? <div className="ed-tl-day t-2xs c-3">{day}</div> : null}
            <span className="ed-tl-dot"><I /></span>
            <div className="ed-tl-body">
              <div className="t-sm">{it.text}</div>
              <div className="t-xs c-3"><span className="num">{D.fmtClock(it.t)}</span> · {actorLabel(it.actor)}{it.actor?.startsWith("agent:") ? <Badge tone="ai" className="ed-tl-ai">AI</Badge> : null}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------- disposition --------------------------- */
function Disposition({ e, p, bed }) {
  const [path, setPath] = useState("home");
  const [lwbs, setLwbs] = useState(false);
  if (isClosed(e)) return <ClosedDispo e={e} />;
  if (e.status === "boarding") return <BoardingDispo e={e} p={p} />;
  const div = diversionCheck(e, p);
  const paths = [
    { k: "home", icon: LuHouse, title: "Discharge home", sub: "Instructions in the patient's language" },
    { k: "admit", icon: LuBedDouble, title: "Admit", sub: "Request an inpatient bed" },
    { k: "clinic", icon: LuBuilding2, title: "Same-day clinic", sub: div.ok ? "Eligible: book a slot" : "Not eligible", dim: !div.ok },
  ];
  return (
    <div className="col gap-16">
      {!e.ctas ? <div className="ed-callout warn"><LuTriangleAlert className="c-warn" /><div className="t-sm grow">This patient has not been triaged yet. Triage before making a disposition decision.</div></div> : null}
      <div className="ed-paths" role="radiogroup" aria-label="Disposition">
        {paths.map((x) => (
          <button key={x.k} type="button" role="radio" aria-checked={path === x.k} className={cx("ed-path", path === x.k && "on", x.dim && "dim")} onClick={() => setPath(x.k)}>
            <x.icon /><span className="w6">{x.title}</span><span className="t-xs c-3">{x.sub}</span>
          </button>
        ))}
      </div>
      {path === "home" ? <DischargeHome e={e} p={p} /> : null}
      {path === "admit" ? <AdmitInline e={e} p={p} /> : null}
      {path === "clinic" ? <ClinicInline e={e} p={p} div={div} /> : null}
      {!e.seenAt ? (
        <div className="ed-lwbs">
          <span className="t-xs c-3 grow">Patient no longer in the waiting room?</span>
          <Button size="sm" variant="danger" icon={LuUserX} onClick={() => setLwbs(true)}>Left without being seen…</Button>
        </div>
      ) : null}
      <Modal open={lwbs} onClose={() => setLwbs(false)} title="Mark as left without being seen?" subtitle={`${name(p)} will be removed from the board and nursing gets a call-back task.`}
        footer={<><Button onClick={() => setLwbs(false)}>Keep in queue</Button><Button variant="danger" icon={LuUserX} onClick={() => { D.markLwbs(e.id, "user"); setLwbs(false); toast(`${name(p)} marked as left without being seen. Call-back task created.`); }}>Mark as left</Button></>}>
        <div className="t-sm c-2">Only do this after calling the patient's name in the waiting area. CTAS {e.ctas || "–"}, waiting {D.fmtSince(e.arrivalAt)}.</div>
      </Modal>
    </div>
  );
}

function DischargeHome({ e, p }) {
  const [lang, setLang] = useState(D.LANGS[p?.lang] ? p.lang : "en");
  const [text, setText] = useState("");
  const [follow, setFollow] = useState(p?.familyDoctor ? `${p.familyDoctor} in 3 to 5 days` : "");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const draft = async () => {
    setBusy(true); setMode(null); setText("");
    const prompt = `Write discharge instructions for this emergency department patient, entirely in ${langPlain(lang)} (language code ${lang}).
Plain language at a grade 6 reading level, warm and direct, second person. Plain text only: short section headings on their own line and "- " bullets, no other Markdown.
Sections: reason for the visit; what we found and did today; what to do at home; medications; come back or call 911 right away if (specific warning signs for this complaint); follow-up.
At most 230 words. Use only the facts below. Do not invent test results, diagnoses or prescriptions that are not listed.
Follow-up requested by the physician: ${follow || "family doctor or a GMF walk-in clinic in 3 to 5 days; Info-Santé 811 for questions"}.

${encounterContext(e, p, null)}`;
    const r = await AI.text(prompt, { onText: (s) => setText(s) });
    if (r === null || !String(r).trim()) { setText(fallbackDischarge(e, p, { lang, followUp: follow })); setMode("rules"); }
    else { setText(r.trim()); setMode("ai"); }
    setBusy(false);
  };
  const sign = () => {
    D.dischargeEd(e.id, { instructions: text.trim(), lang, followUp: follow.trim() }, "user");
    setConfirm(false);
    toast(`${name(p)} discharged.${p?.appUser ? " Instructions sent to the Aster app." : " Print the instructions for the patient."}`);
  };
  const langOpts = Object.entries(D.LANGS).map(([value, label]) => ({ value, label }));
  return (
    <Sec title="Discharge home" className="ed-sec-card">
      <div className="grid g2">
        <Field label="Language for instructions" hint={p?.lang ? `Patient's preferred language: ${langPlain(p.lang)}` : null}><Select value={lang} onChange={(ev) => setLang(ev.target.value)} options={langOpts} /></Field>
        <Field label="Follow-up"><Input value={follow} onChange={(ev) => setFollow(ev.target.value)} placeholder="e.g. Family doctor or GMF in 3 to 5 days" /></Field>
      </div>
      <div className="row mt12">
        <AiLabel>Discharge instructions</AiLabel>
        <span className="grow" />
        <Button size="sm" variant="ai" icon={LuSparkles} loading={busy} onClick={draft}>{text ? "Redraft" : "Draft discharge instructions"}</Button>
      </div>
      <Textarea className="mt8 ed-dc-text" rows={12} value={text} onChange={(ev) => setText(ev.target.value)} placeholder={busy ? "Drafting…" : "Draft the instructions with AI, or write them here. You can edit everything before signing."} aria-label="Discharge instructions" dir={lang === "ar" ? "rtl" : "ltr"} />
      {mode === "rules" ? <div className="t-xs c-3 mt4">AI is unavailable, so a standard template for this complaint was filled in{!["en", "fr"].includes(lang) ? " (in English; review with an interpreter)" : ""}. Edit before signing.</div> : mode === "ai" ? <div className="t-xs c-3 mt4">AI draft. Review every line before you sign.</div> : null}
      <div className="row mt12">
        <span className="t-xs c-3 grow">{text.trim() ? `${text.trim().split(/\s+/).length} words` : "Instructions are required to discharge."}</span>
        <Button variant="primary" icon={LuSignature} disabled={!text.trim() || busy} onClick={() => setConfirm(true)}>Sign and discharge</Button>
      </div>
      <Modal open={confirm} onClose={() => setConfirm(false)} title={`Discharge ${name(p)}?`} subtitle="The visit closes, the space goes to cleaning and the instructions are saved to the chart."
        footer={<><Button onClick={() => setConfirm(false)}>Cancel</Button><Button variant="primary" icon={LuSignature} onClick={sign}>Sign and discharge</Button></>}>
        <div className="ed-kv t-sm">
          <span>Language</span><span>{langPlain(lang)}</span>
          <span>Follow-up</span><span>{follow || <span className="c-3">Not specified</span>}</span>
          <span>Patient app</span><span>{p?.appUser ? "Instructions and a 48 h check-in will be sent" : "Not an app user: print the instructions"}</span>
          {ordersProgress(e).pending ? <><span className="c-warn">Pending orders</span><span className="c-warn">{ordersProgress(e).pending} still pending. Confirm they are no longer needed.</span></> : null}
        </div>
      </Modal>
    </Sec>
  );
}

function AdmitInline({ e, p }) {
  const [service, setService] = useState(() => e.service || suggestService(e));
  const beds = S.useCollection("beds");
  const unit = D.SERVICE_UNIT[service];
  const free = beds.filter((b) => b.area === "IP" && b.unit === unit && b.state === "free").length;
  return (
    <Sec title="Admit to hospital" className="ed-sec-card">
      <Group label="Admitting service"><Seg options={D.SERVICES} value={service} onChange={setService} /></Group>
      <div className="t-sm c-2 mt12">{D.UNITS[unit]}: {free ? <b className="c-ok">{free} free bed{free > 1 ? "s" : ""}</b> : <b className="c-warn">no free beds</b>} right now. The patient moves to Boarding and the bed manager gets a task.</div>
      <div className="row mt12"><span className="grow" /><Button variant="primary" icon={LuBedDouble} onClick={() => { D.requestAdmission(e.id, service, "user"); toast(`Admission requested: ${name(p)} to ${service}`); }}>Request admission</Button></div>
    </Sec>
  );
}

function ClinicInline({ e, p, div }) {
  const clinics = S.useCollection("clinics");
  const slots = useMemo(() => nextSlots(clinics, { limit: 8 }), [clinics]);
  const [sel, setSel] = useState(null);
  if (!div.ok) return <Sec title="Same-day clinic" className="ed-sec-card"><div className="ed-callout warn"><LuTriangleAlert className="c-warn" /><div className="t-sm grow"><div className="w6">Not eligible for redirection</div>{div.why}</div></div></Sec>;
  const book = () => {
    const [slotId, clinicId] = sel.split("|");
    const appt = D.divertToClinic(e.id, clinicId, slotId, "user");
    if (appt) toast(`${name(p)} booked at ${appt.clinicName}, ${D.fmtClock(appt.t)}. Triage summary sent ahead.`);
    else { toast("That slot was just taken. Pick another one.", { kind: "bad" }); setSel(null); }
  };
  return (
    <Sec title="Redirect to a same-day clinic" className="ed-sec-card">
      <div className="t-sm c-2">{div.why}</div>
      <div className="mt12"><SlotList slots={slots} value={sel} onChange={setSel} /></div>
      <div className="row mt12"><span className="t-xs c-3 grow">{p?.appUser ? "The booking appears in the patient's Aster app." : "Give the patient the clinic address and time."}</span><Button variant="primary" icon={LuBuilding2} disabled={!sel} onClick={book}>Book and redirect</Button></div>
    </Sec>
  );
}

function BoardingDispo({ e, p }) {
  const beds = S.useCollection("beds");
  const unit = D.SERVICE_UNIT[e.service] || "7E";
  const free = useMemo(() => beds.filter((b) => b.area === "IP" && b.state === "free").sort((a, b) => (a.unit === unit ? 0 : 1) - (b.unit === unit ? 0 : 1) || a.label.localeCompare(b.label)), [beds, unit]);
  const match = free.filter((b) => b.unit === unit);
  const other = free.filter((b) => b.unit !== unit && !["ICU", "CCU"].includes(b.unit));
  const assign = (b) => { if (D.assignInpatientBed(e.id, b.id, "user")) toast(`${name(p)} assigned to ${b.label}. Porter task created.`); else toast("That bed is no longer free. Pick another one.", { kind: "bad" }); };
  const BedBtn = ({ b }) => <button type="button" className="ed-pick-row" onClick={() => assign(b)}><LuBedDouble className="c-ok" /><span className="grow"><span className="w6">{b.label}</span> <span className="t-xs c-3">{D.UNITS[b.unit]}</span></span><span className="t-xs c-brand w5">Assign bed</span></button>;
  return (
    <div className="col gap-16">
      <div className="ed-callout"><LuBedDouble className="c-bad" /><div className="grow t-sm"><div className="w6">Admitted to {e.service}, waiting for a bed</div><div className="c-2">Boarding for {D.fmtSince(e.admitRequestAt || e.arrivalAt)}. Assigning a bed creates a porter task and closes the bed manager's task.</div></div></div>
      <Sec title={`${D.UNITS[unit]} (${match.length} free)`}>{match.length ? <div className="ed-pick">{match.map((b) => <BedBtn key={b.id} b={b} />)}</div> : <div className="t-sm c-3">No free beds on {D.UNITS[unit]}. Check cleaning status in Beds and flow, or use an off-service bed below.</div>}</Sec>
      {other.length ? <Sec title={`Off-service beds (${other.length})`}><div className="ed-pick">{other.slice(0, 6).map((b) => <BedBtn key={b.id} b={b} />)}</div></Sec> : null}
    </div>
  );
}

function ClosedDispo({ e }) {
  const ins = e.dischargeInstructions;
  return (
    <div className="col gap-16">
      <ClosedBanner e={e} />
      {ins?.text ? <Sec title={`Discharge instructions · ${langPlain(ins.lang)}`}><div className="ed-quote t-sm pre" dir={ins.lang === "ar" ? "rtl" : "ltr"}>{ins.text}</div><div className="t-xs c-3 mt8">Signed {D.fmtDateTime(ins.t)}</div></Sec> : null}
      {e.diversion ? <Sec title="Clinic booking"><div className="ed-kv t-sm"><span>Clinic</span><span>{e.diversion.clinicName}</span><span>Time</span><span>{D.fmtDateTime(e.diversion.t)}</span></div></Sec> : null}
    </div>
  );
}

/* -------------------------- discharge plan ------------------------- */
const PROBS = [10, 30, 50, 70, 90];
const ETAS = ["Today", "Tomorrow", "2–3 days", "Unknown"];
function DischargePlan({ e, p }) {
  const tasks = S.useCollection("tasks");
  const dc = e.dc || { prob: 0, barriers: [], eta: null };
  const [text, setText] = useState("");
  const [owner, setOwner] = useState("RN");
  const [summary, setSummary] = useState("");
  const [confirm, setConfirm] = useState(false);
  const barriers = dc.barriers || [];
  const open = barriers.filter((b) => b.status !== "done");
  const nearest = PROBS.reduce((a, b) => (Math.abs(b - (dc.prob || 0)) < Math.abs(a - (dc.prob || 0)) ? b : a), PROBS[0]);
  const addBarrier = (ev) => {
    ev.preventDefault(); if (!text.trim()) return;
    D.setDischargePlan(e.id, { barriers: [...barriers, { id: S.newId("b"), text: text.trim(), owner, status: "open" }] }, "user");
    toast(`Barrier added for ${owner}`); setText("");
  };
  const discharge = () => {
    D.dischargeInpatient(e.id, { summary: summary.trim() }, "user");
    setConfirm(false); toast(`${name(p)} discharged from ${D.UNITS[e.unit] || "the unit"}. Bed sent to cleaning.`);
  };
  const toneP = dc.prob >= 70 ? "var(--ok)" : dc.prob >= 40 ? "var(--warn)" : "var(--ink-3)";
  return (
    <div className="col gap-16">
      <Sec title="Discharge readiness" className="ed-sec-card">
        <div className="ed-prob">
          <div><div className="ed-prob-v num" style={{ color: toneP }}>{dc.prob ?? 0}%</div><div className="t-xs c-3">likely to go home {dc.eta ? dc.eta.toLowerCase() : "(no ETA)"}</div></div>
          <div className="grow"><div className="ed-bar"><i style={{ width: `${dc.prob || 0}%`, background: toneP }} /></div></div>
        </div>
        <div className="grid g2 mt12">
          <Group label="Discharge probability"><Seg options={PROBS.map((v) => ({ value: v, label: `${v}%` }))} value={nearest} onChange={(v) => { D.setDischargePlan(e.id, { prob: v }, "user"); toast(`Discharge probability set to ${v}%`); }} /></Group>
          <Group label="Expected discharge"><Seg options={ETAS} value={dc.eta || "Unknown"} onChange={(v) => { D.setDischargePlan(e.id, { eta: v === "Unknown" ? null : v }, "user"); toast(`Expected discharge: ${v.toLowerCase()}`); }} /></Group>
        </div>
        <label className="check mt12">
          <input type="checkbox" checked={!!e.alc} onChange={(ev) => { S.patch("encounters", e.id, { alc: ev.target.checked }); S.audit("user", ev.target.checked ? "Flagged ALC" : "Removed ALC flag", name(p), { encounterId: e.id }); toast(ev.target.checked ? "Flagged as alternate level of care" : "ALC flag removed"); }} />
          Alternate level of care (ALC): medically ready, waiting for a placement
        </label>
      </Sec>
      <Sec title={`Barriers to discharge (${open.length} open)`}>
        {barriers.length ? (
          <div className="ed-orders">
            {barriers.map((b) => {
              const task = tasks.find((t) => t.barrierId === b.id && t.status !== "done");
              const done = b.status === "done";
              return (
                <div key={b.id} className={cx("ed-order", done && "off")}>
                  <span className={cx("ed-order-ic", done ? "ok" : "warn")}>{done ? <LuCheck /> : <LuTriangleAlert />}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="w5">{b.text}</div>
                    <div className="t-xs c-3">Owner: {b.owner || "RN"}{task ? ` · task ${task.status === "in_progress" ? "in progress" : "open"}${task.assignee ? " with " + task.assignee : ""}` : ""}{done && b.doneAt ? ` · cleared ${D.fmtAgo(b.doneAt)}` : ""}</div>
                  </div>
                  <div className="ed-order-act">
                    {done ? <Badge tone="ok">Cleared</Badge> : <span className="row gap-4">
                      {task ? <Badge tone="info">Task assigned</Badge> : <Button size="sm" icon={LuListChecks} onClick={() => { D.createTask({ title: `${b.text}: ${name(p)}`, role: b.owner || "RN", encounterId: e.id, barrierId: b.id, priority: "high", dueMin: 120 }, "user"); toast(`Task sent to ${b.owner || "RN"}`); }}>Assign task</Button>}
                      <Button size="sm" variant="ghost" icon={LuCheck} onClick={() => { D.resolveBarrier(e.id, b.id, "user"); toast("Barrier cleared"); }}>Resolve</Button>
                    </span>}
                  </div>
                </div>
              );
            })}
          </div>
        ) : <div className="t-sm c-3">No barriers recorded.</div>}
        <form className="row mt12 ed-free" onSubmit={addBarrier}>
          <Input value={text} onChange={(ev) => setText(ev.target.value)} placeholder="New barrier, e.g. Home oxygen not arranged" aria-label="New barrier" />
          <Select value={owner} onChange={(ev) => setOwner(ev.target.value)} options={D.ROLES} aria-label="Barrier owner" style={{ width: 150 }} />
          <Button type="submit" icon={LuPlus} disabled={!text.trim()}>Add barrier</Button>
        </form>
      </Sec>
      <Sec title="Discharge" className="ed-sec-card">
        <Textarea rows={3} value={summary} onChange={(ev) => setSummary(ev.target.value)} placeholder="Optional discharge summary for the chart" aria-label="Discharge summary" />
        <div className="row mt12">
          <span className={cx("t-xs grow", open.length ? "c-warn" : "c-3")}>{open.length ? `${open.length} barrier${open.length > 1 ? "s are" : " is"} still open.` : "All barriers cleared."}</span>
          <Button variant="primary" icon={LuHouse} onClick={() => (open.length ? setConfirm(true) : discharge())}>Discharge patient</Button>
        </div>
      </Sec>
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Discharge with open barriers?" subtitle={`${open.length} barrier${open.length > 1 ? "s" : ""} not cleared: ${open.map((b) => b.text).join(", ")}.`}
        footer={<><Button onClick={() => setConfirm(false)}>Go back</Button><Button variant="primary" onClick={discharge}>Discharge anyway</Button></>}>
        <div className="t-sm c-2">Open tasks for this patient will be closed and the bed sent to cleaning.</div>
      </Modal>
    </div>
  );
}
