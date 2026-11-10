// Staffing: explainable RN coverage for today. Shift grid with model
// requirements, ranked candidates (internal float pool before agency),
// greedy "Fill all gaps", ED arrival forecast, roster and an AI rationale.
import React, { useMemo, useState } from "react";
import {
  LuSparkles, LuUsers, LuX, LuUserPlus, LuUserMinus, LuWandSparkles, LuInfo, LuSun, LuSunset, LuMoon, LuUndo2, LuCircleCheck, LuTriangleAlert,
} from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import * as AI from "../lib/ai.js";
import { Button, Badge, Panel, PageHead, Kpi, Seg, Drawer, Modal, toast, Empty, AiLabel, Markdown, Typing, Avatar, useNow, cx } from "../ui/index.jsx";
import { STAFF_UNITS, filledOf, unitCensus, shiftCost, AGENCY_SHIFT, otRisk, planFill, rankForShift, staffingFallback } from "./flow-lib.js";
import "./flow.css";

const SHIFT_ICON = { day: LuSun, evening: LuSunset, night: LuMoon };
const money = (n) => `${Math.round(n).toLocaleString("en-CA")} $`;
const POS = /^(Works|Cross-trained|No overtime|Under weekly hours|Rested|Bilingual)/;
const reasonTone = (w) => (/^Agency/.test(w) ? "bad" : POS.test(w) ? "ok" : "warn");
function agencyNote(ranked) {
  const bi = ranked.find((x) => x.internal);
  return bi ? `Agency costs ${money(AGENCY_SHIFT - shiftCost(bi, bi.b2b))} more per shift than the best internal option.` : "No internal nurse is available for this shift.";
}
const shiftLabel = (k) => D.SHIFTS.find((s) => s.key === k)?.label || k;

export default function StaffingPage() {
  useNow();
  const shifts = S.useCollection("shifts");
  const staff = S.useCollection("staff");
  const encounters = S.useCollection("encounters");
  const beds = S.useCollection("beds");
  const cur = D.currentShift();

  const [openId, setOpenId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [explain, setExplain] = useState(null);
  const [mShift, setMShift] = useState(cur);

  const today = D.todayKey();
  const date = useMemo(() => {
    if (shifts.some((s) => s.date === today)) return today;
    return [...new Set(shifts.map((s) => s.date))].sort().pop() || today;
  }, [shifts, today]);
  const day = useMemo(() => shifts.filter((s) => s.date === date), [shifts, date]);
  const metrics = useMemo(() => D.computeMetrics(encounters, beds), [encounters, beds]);
  const census = useMemo(() => unitCensus(encounters, beds), [encounters, beds]);
  const rows = useMemo(() => STAFF_UNITS.flatMap((u) => D.SHIFTS.map((sh) => {
    const doc = day.find((s) => s.unit === u && s.shift === sh.key);
    const model = D.requiredStaff(u, sh.key, { edCensus: metrics.edCount, unitCensus: census });
    const required = doc?.required?.RN ?? 0; const filled = filledOf(doc);
    return { id: doc?.id, doc, unit: u, shift: sh.key, required, filled, gap: required - filled, model: model.RN, why: model.why };
  })), [day, metrics.edCount, census]);
  const cell = (u, k) => rows.find((r) => r.unit === u && r.shift === k);
  const gaps = rows.filter((r) => r.doc && r.gap > 0);
  const openPositions = gaps.reduce((s, r) => s + r.gap, 0);
  const curRows = rows.filter((r) => r.shift === cur);
  const curFilled = curRows.reduce((s, r) => s + r.filled, 0), curReq = curRows.reduce((s, r) => s + r.required, 0);
  const otCount = staff.filter((m) => m.role === "RN" && otRisk(m)).length;
  const fc = D.forecastEdCensus(cur, metrics.edCount);

  const fillAll = () => {
    const idx = D.SHIFTS.findIndex((s) => s.key === cur);
    const order = [0, 1, 2].map((i) => D.SHIFTS[(idx + i) % 3].key)
      .flatMap((k) => rows.filter((r) => r.shift === k && r.doc && r.gap > 0).sort((a, b) => b.gap - a.gap).map((r) => r.id));
    const plan = planFill(S.all("shifts").filter((s) => s.date === date), S.all("staff"), order);
    const made = plan.filter((p) => p.staffId);
    made.forEach((p) => D.assignToShift(p.shiftId, p.staffId, "user"));
    setSummary({ plan, t: Date.now() });
    if (made.length) toast(`Filled ${made.length} position${made.length > 1 ? "s" : ""} across ${new Set(made.map((p) => p.shiftId)).size} shifts.`);
    else toast("No qualified nurse is available for the open positions.", { kind: "bad" });
  };
  const updateReq = (r) => {
    const s = S.get("shifts", r.id); if (!s) return;
    S.patch("shifts", r.id, { required: { ...(s.required || {}), RN: r.model } });
    S.audit("user", "Updated staffing requirement", `${D.UNITS[r.unit]} ${r.shift}: ${r.required} → ${r.model} RN (demand model: ${r.why})`, { shiftId: r.id });
    toast(`${r.unit} ${r.shift} now requires ${r.model} RNs.`);
  };
  const runExplain = async () => {
    setExplain({ loading: true, text: "", ai: true });
    const data = { date, currentShift: cur, edCensus: metrics.edCount, edForecastThisShift: fc, unitCensus: census,
      grid: rows.map((r) => ({ unit: r.unit, shift: r.shift, requiredRN: r.required, filledRN: r.filled, gap: r.gap, modelRN: r.model, modelWhy: r.why })),
      overtimeRiskStaff: staff.filter((m) => m.role === "RN" && otRisk(m)).map((m) => m.name),
      floatPool: staff.filter((m) => /^Float/.test(m.name)).map((m) => ({ name: m.name, hours: m.hoursThisWeek })),
      agency: staff.filter((m) => !m.internal).map((m) => ({ name: m.name, costPerHour: m.costPerHour })) };
    const prompt = `Write a short staffing rationale for the charge nurse at Hôpital St-Laurent (Montréal). 4 to 6 bullets, each starting with a bold label. Say where coverage is short now and later today, whether the planned requirement matches the demand model and why, and the fill order (unit nurses, internal float pool, cross-trained without overtime, agency last). Mention overtime and fairness in line with the collective agreement. Use only this data, no invented names or numbers, plain calm language, no preamble.\n\nDATA (JSON):\n${JSON.stringify(data)}`;
    const t = await AI.text(prompt, { onText: (s) => setExplain({ loading: true, text: s, ai: true }) });
    if (t === null || !t.trim()) setExplain({ loading: false, text: staffingFallback({ rows: rows.filter((r) => r.doc), shiftKey: cur, edCensus: metrics.edCount }), ai: false });
    else setExplain({ loading: false, text: t, ai: true });
  };

  const openRow = openId ? rows.find((r) => r.id === openId) : null;

  return (
    <div>
      <PageHead title="Staffing" subtitle="Today's RN coverage by unit. Suggestions use the internal float pool before agency, avoid overtime, and explain every pick."
        actions={<>
          <Button variant="ai" icon={LuSparkles} loading={explain?.loading && !explain?.text} onClick={runExplain}>Explain this plan</Button>
          <Button variant="primary" icon={LuWandSparkles} disabled={!openPositions} onClick={fillAll}>{openPositions ? `Fill all gaps (${openPositions})` : "All shifts covered"}</Button>
        </>} />

      {explain ? (
        <div className="ai-card flow-ai" aria-live="polite">
          <div className="row" style={{ marginBottom: 8 }}>
            <AiLabel>Staffing rationale</AiLabel>
            {explain.loading ? <Typing /> : <span className="t-xs c-3">For the charge nurse · {D.fmtClock(Date.now())}</span>}
            <span className="grow" /><Button variant="ghost" size="sm" icon={LuX} aria-label="Close rationale" onClick={() => setExplain(null)} />
          </div>
          {explain.text ? <Markdown text={explain.text} /> : <div className="t-sm c-3">Reading the shift grid and roster…</div>}
        </div>
      ) : null}

      <div className="flow-kpis">
        <Kpi label="Open RN positions" value={openPositions} tone={openPositions ? "bad" : "ok"} sub={openPositions ? `Across ${gaps.length} shift${gaps.length > 1 ? "s" : ""}` : "Every shift meets its requirement"} />
        <Kpi label={`Coverage now (${shiftLabel(cur).toLowerCase()})`} value={`${curReq ? Math.round((curFilled / curReq) * 100) : 100}%`} tone={curFilled < curReq ? "warn" : "ok"} sub={`${curFilled} of ${curReq} RNs on shift`} />
        <Kpi label="Overtime risk" value={otCount} tone={otCount ? "warn" : undefined} sub="RNs past 37.5 h × FTE" />
        <Kpi label="ED census now" value={metrics.edCount} sub={`${fc.arrivals} arrivals due this shift`} title={`Forecast ${fc.arrivals} arrivals this shift, peak census about ${fc.peak}`} />
      </div>

      {date !== today ? <div className="well t-sm mt8" style={{ marginBottom: 12 }}><LuInfo size={14} style={{ verticalAlign: -2 }} /> No roster has been published for today yet. Showing the latest roster ({date}).</div> : null}

      <Panel flush title="Shift grid" icon={LuUsers} subtitle={`${D.fmtDate(Date.now())} · filled / required RNs · the model line shows what demand calls for`}>
        <div className="flow-mobile" style={{ padding: "12px 14px" }}>
          <Seg size="sm" value={mShift} onChange={setMShift} options={D.SHIFTS.map((s) => ({ value: s.key, label: s.key === cur ? `${s.label} (now)` : s.label }))} />
          {STAFF_UNITS.map((u) => { const r = cell(u, mShift); return (
            <div key={u} className="mt12">
              <div className="row t-sm" style={{ marginBottom: 6 }}><span className="w6">{u}</span><span className="c-3 t-xs">{u === "ED" ? `${metrics.edCount} patients now` : `${census[u] || 0} patients`}</span></div>
              <ShiftCell r={r} onOpen={() => r.id && setOpenId(r.id)} onUpdate={() => updateReq(r)} />
            </div>); })}
        </div>
        <div className="scroll-x flow-desk">
          <table className="flow-shifts">
            <thead><tr><th>Unit</th>{D.SHIFTS.map((s) => { const I = SHIFT_ICON[s.key]; return <th key={s.key} className={cx(s.key === cur && "cur")}><span className="row gap-4"><I size={13} />{s.label} <span className="c-3 w5">{s.hours}</span>{s.key === cur ? <Badge tone="brand">Now</Badge> : null}</span></th>; })}</tr></thead>
            <tbody>
              {STAFF_UNITS.map((u) => (
                <tr key={u}>
                  <td className="unit"><div className="w6">{u}</div><div className="t-xs c-3">{u === "ED" ? `${metrics.edCount} patients now` : `${census[u] || 0} patients`}</div></td>
                  {D.SHIFTS.map((s) => { const r = cell(u, s.key); return <td key={s.key} className={cx(s.key === cur && "cur")}><ShiftCell r={r} onOpen={() => r.id && setOpenId(r.id)} onUpdate={() => updateReq(r)} /></td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid g2 mt16 flow-g2" style={{ alignItems: "start" }}>
        <ForecastPanel edCount={metrics.edCount} waiting={metrics.waitingMd + metrics.waitingTriage} cur={cur} />
        <RosterPanel staff={staff} day={day} />
      </div>

      <CellDrawer row={openRow} onClose={() => setOpenId(null)} staff={staff} shifts={shifts} day={day} onUpdate={updateReq} />
      <SummaryModal summary={summary} onClose={() => setSummary(null)} staff={staff} />
    </div>
  );
}

function ShiftCell({ r, onOpen, onUpdate }) {
  if (!r?.doc) return <div className="flow-cell"><span className="t-sm c-3">No shift planned</span></div>;
  const short = r.gap > 0;
  const ratio = r.required ? Math.min(1, r.filled / r.required) : 1;
  return (
    <div className={cx("flow-cell", short && "gap")} data-shift={r.id}>
      <button type="button" className="flow-cell-main" onClick={onOpen} aria-label={`${r.unit} ${r.shift}: ${r.filled} of ${r.required} RNs. Open staffing details`}>
        <span className="flow-cell-n num" style={{ color: short ? "var(--bad)" : "var(--ink)" }}>{r.filled}</span><span className="t-sm c-2 num">/ {r.required} RN</span>
        <span className="grow" />
        {short ? <Badge tone="bad">{r.gap} short</Badge> : r.gap < 0 ? <Badge tone="info">+{-r.gap}</Badge> : <Badge tone="ok">Covered</Badge>}
      </button>
      <span className={cx("flow-mini", !short && "ok")}><i style={{ width: `${ratio * 100}%`, background: short ? "var(--bad)" : undefined }} /></span>
      <div className="flow-cell-why" title={r.why}>
        {r.model > r.required ? <span className="c-warn w6">Demand model: {r.model} RN. </span> : <span>Model {r.model} RN · </span>}{r.why}
      </div>
      {short || r.model > r.required ? (
        <div className="row wrap" style={{ gap: 6 }}>
          {short ? <Button size="sm" variant="danger" icon={LuUserPlus} onClick={onOpen}>Fill</Button> : null}
          {r.model > r.required ? <Button size="sm" variant="ghost" onClick={onUpdate} title={`Raise the requirement from ${r.required} to the model's ${r.model} RNs`}>Update requirement</Button> : null}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------- drawer ----------------------------- */
function CellDrawer({ row, onClose, staff, shifts, day, onUpdate }) {
  const [all, setAll] = useState(false);
  const doc = row?.doc;
  const ranked = useMemo(() => (doc ? rankForShift(doc, staff, shifts) : []), [doc, staff, shifts]);
  if (!row || !doc) return null;
  const smap = new Map(staff.map((m) => [m.id, m]));
  const assigned = (doc.assigned || []).map((id) => smap.get(id)).filter(Boolean);
  const shown = all ? ranked : ranked.slice(0, 8);
  const sh = D.SHIFTS.find((s) => s.key === row.shift);
  const offer = (m) => { D.assignToShift(doc.id, m.id, "user"); toast(`${m.name} accepted the ${row.unit} ${row.shift} shift (offer simulated).`); };
  const remove = (m) => { D.removeFromShift(doc.id, m.id, "user"); toast(`${m.name} removed from ${row.unit} ${row.shift}.`); };
  return (
    <Drawer open onClose={onClose} width={560} title={`${D.UNITS[row.unit]} · ${sh.label} shift`}
      subtitle={<span className="row wrap gap-4">{sh.hours} · <b className="num" style={{ color: row.gap > 0 ? "var(--bad)" : "var(--ok)" }}>{row.filled} of {row.required}</b> RNs filled{row.gap > 0 ? <Badge tone="bad">{row.gap} short</Badge> : <Badge tone="ok">Covered</Badge>}</span>}>
      <div className="well row top" style={{ gap: 10 }}>
        <LuInfo size={16} style={{ color: "var(--ink-3)", flex: "none", marginTop: 2 }} />
        <div className="grow t-sm"><b>Demand model: {row.model} RNs.</b> {row.why}.{row.model !== row.required ? ` The plan says ${row.required}.` : " Matches the plan."}</div>
        {row.model !== row.required ? <Button size="sm" onClick={() => onUpdate(row)}>Update requirement</Button> : null}
      </div>

      <div className="flow-sec mt20">On this shift ({row.filled})</div>
      {!assigned.length && !doc.rosterCount ? <div className="t-sm c-3">Nobody is assigned yet.</div> : null}
      <div className="flow-list">
        {assigned.map((m) => (
          <div key={m.id} className="flow-li" data-assigned={m.id}>
            <Avatar name={m.name.replace(/^.*?:\s*/, "")} size={28} />
            <div className="grow col" style={{ gap: 1 }}><span className="w6 ellipsis">{m.name}</span><span className="t-xs c-2">{(m.units || []).join(", ")} · {m.hoursThisWeek} h this week{m.internal ? "" : " · agency"}</span></div>
            <Button size="sm" variant="ghost" icon={LuUserMinus} onClick={() => remove(m)}>Remove</Button>
          </div>
        ))}
      </div>
      {doc.rosterCount ? <div className="t-xs c-3 mt8">Plus {doc.rosterCount} rostered nurse{doc.rosterCount > 1 ? "s" : ""} from the unit schedule, not listed individually.</div> : null}

      <div className="row mt24" style={{ marginBottom: 4 }}><span className="flow-sec grow" style={{ margin: 0 }}>Ranked candidates</span><span className="t-xs c-3">Score: unit skill, overtime, rest, language, cost</span></div>
      {!ranked.length ? <Empty icon={LuUsers} title="No available RNs">Everyone qualified is already working this shift.</Empty> : shown.map((m, i) => {
        const score = Math.max(0, Math.min(100, m.score));
        const cost = m.internal ? shiftCost(m, m.b2b) : m.costPerHour * 8;
        return (
          <div key={m.id} className="flow-cand" data-cand={m.id}>
            <div className="row" style={{ gap: 10 }}>
              <Avatar name={m.name.replace(/^.*?:\s*/, "")} size={30} />
              <div className="grow col" style={{ gap: 1, minWidth: 0 }}>
                <span className="row gap-4"><span className="w6 ellipsis">{m.name}</span>{/^Float/.test(m.name) ? <Badge tone="brand">Float pool</Badge> : null}{!m.internal ? <Badge tone="bad">Agency</Badge> : null}</span>
                <span className="t-xs c-2">{(m.units || []).join(", ")} · {m.hoursThisWeek} h this week · FTE {m.fte}</span>
              </div>
              <div className="col" style={{ gap: 0, alignItems: "flex-end" }}><span className="w6 num">{money(cost)}</span><span className="t-2xs c-3">per shift{(m.overtime || m.b2b) && m.internal ? ", overtime" : ""}</span></div>
            </div>
            <div className="flow-score"><span className={cx("flow-mini", score >= 60 ? "ok" : score >= 20 ? "" : "hi")}><i style={{ width: `${score}%` }} /></span><span className="t-xs w6 num">{m.score}</span>
              <span className="row wrap" style={{ gap: 4 }}>{m.why.map((w) => <Badge key={w} tone={reasonTone(w)}>{w}</Badge>)}</span></div>
            <div className="row"><span className="grow t-xs c-3">{!m.internal ? agencyNote(ranked) : i === 0 ? "Best match for this shift." : ""}</span>
              <Button size="sm" variant={i === 0 ? "primary" : undefined} icon={LuUserPlus} onClick={() => offer(m)}>Offer shift</Button></div>
          </div>
        );
      })}
      {ranked.length > 8 ? <Button variant="ghost" size="sm" className="mt8" onClick={() => setAll(!all)}>{all ? "Show top 8" : `Show all ${ranked.length}`}</Button> : null}
    </Drawer>
  );
}

/* ----------------------------- summary ---------------------------- */
function SummaryModal({ summary, onClose, staff }) {
  if (!summary) return null;
  const made = summary.plan.filter((p) => p.staffId);
  const missed = summary.plan.filter((p) => !p.staffId);
  const cost = made.reduce((s, p) => s + p.cost, 0);
  const agencyEq = made.length * AGENCY_SHIFT;
  const internal = made.filter((p) => p.internal).length;
  const undo = () => { made.forEach((p) => D.removeFromShift(p.shiftId, p.staffId, "user")); toast(`Undid ${made.length} assignment${made.length === 1 ? "" : "s"}.`); onClose(); };
  return (
    <Modal open wide onClose={onClose} title={made.length ? `Filled ${made.length} open position${made.length > 1 ? "s" : ""}` : "No positions filled"}
      subtitle={`${internal} internal${made.length - internal ? `, ${made.length - internal} agency` : ", no agency"}. Offers are simulated as accepted.`}
      footer={<>{made.length ? <Button icon={LuUndo2} onClick={undo}>Undo all</Button> : null}<Button variant="primary" onClick={onClose}>Done</Button></>}>
      {made.length ? <>
        <div className="grid g3" style={{ gap: 10 }}>
          <div className="well"><div className="t-xs c-2">Estimated cost</div><div className="t-h2 num mt4">{money(cost)}</div></div>
          <div className="well"><div className="t-xs c-2">Same shifts through agency</div><div className="t-h2 num mt4">{money(agencyEq)}</div></div>
          <div className="well"><div className="t-xs c-2">Saved vs agency</div><div className="t-h2 num mt4 c-ok">{money(agencyEq - cost)}</div></div>
        </div>
        <div className="scroll-x mt16">
          <table className="table">
            <thead><tr><th>Shift</th><th>Nurse</th><th>Score</th><th>Why</th><th style={{ textAlign: "right" }}>Cost</th></tr></thead>
            <tbody>{made.map((p, i) => (
              <tr key={i}><td className="w6" style={{ whiteSpace: "nowrap" }}>{p.unit} {p.shift}</td><td style={{ whiteSpace: "nowrap" }}>{p.name}{!p.internal ? <> <Badge tone="bad">Agency</Badge></> : null}</td><td className="num">{p.score}</td>
                <td><span className="row wrap" style={{ gap: 4 }}>{p.why.map((w) => <Badge key={w} tone={reasonTone(w)}>{w}</Badge>)}</span></td><td className="num" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(p.cost)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </> : null}
      {missed.length ? <div className="well mt16 row top t-sm" style={{ gap: 8 }}><LuTriangleAlert size={16} style={{ color: "var(--warn)", flex: "none", marginTop: 2 }} /><div>Still short: {missed.map((p) => `${p.unit} ${p.shift}`).join(", ")}. No nurse with a score of 20 or more is free; call the unit's on-call list.</div></div>
        : <div className="row t-sm c-ok mt16" style={{ gap: 6 }}><LuCircleCheck size={16} />Every shift today now meets its requirement.</div>}
    </Modal>
  );
}

/* ----------------------------- forecast --------------------------- */
function ForecastPanel({ edCount, waiting, cur }) {
  const h = new Date().getHours();
  const vals = D.ARRIVAL_CURVE.map((v) => Math.round(v * 1.08 * 10) / 10);
  const max = Math.max(...vals);
  let peak = 15; for (let i = 15; i <= 22; i++) if (vals[i] > vals[peak]) peak = i;
  const peakEnd = vals[peak + 1] === vals[peak] ? peak + 2 : peak + 1;
  const total = Math.round(vals.reduce((a, b) => a + b, 0));
  const rest = Math.round(vals.slice(h).reduce((a, b) => a + b, 0));
  const hh = (x) => `${String(x % 24).padStart(2, "0")}:00`;
  return (
    <Panel title="ED arrivals forecast" subtitle={`About ${total} arrivals today, ${rest} still to come. ED census ${edCount} now, ${waiting} waiting.`}>
      <div className="flow-arr" role="img" aria-label={`Hourly ED arrivals. Evening peak ${hh(peak)} to ${hh(peakEnd)} at about ${vals[peak]} per hour.`}>
        {vals.map((v, i) => (
          <div key={i} className={cx("flow-arr-c", i === h && "now", i >= peak && i < peakEnd && i !== h && "peak")} title={`${hh(i)}–${hh(i + 1)}: about ${v} arrivals`}>
            <i style={{ height: `${(v / max) * 96}px` }} />
            <span>{i % 3 === 0 || i === h ? String(i).padStart(2, "0") : ""}</span>
          </div>
        ))}
        <span className="flow-arr-now" style={{ left: `${((h + 0.5) / 24) * 100}%` }}>Now</span>
      </div>
      <div className="row wrap mt12" style={{ gap: 8 }}>
        <Badge tone="brand">Evening peak {hh(peak)}–{hh(peakEnd)} · ~{vals[peak]}/h</Badge>
        <span className="t-xs c-3">The {shiftLabel(cur).toLowerCase()} shift ED requirement uses this curve: peak census ÷ 3.5 patients per RN.</span>
      </div>
    </Panel>
  );
}

/* ----------------------------- roster ----------------------------- */
function RosterPanel({ staff, day }) {
  const [role, setRole] = useState("RN");
  const list = staff.filter((m) => role === "All" || m.role === role).sort((a, b) => Number(otRisk(b)) - Number(otRisk(a)) || (b.hoursThisWeek || 0) - (a.hoursThisWeek || 0));
  const todayOf = (id) => day.filter((s) => (s.assigned || []).includes(id));
  return (
    <Panel flush title="Roster" subtitle="Sorted by overtime risk, then hours this week" actions={<Seg size="sm" value={role} onChange={setRole} options={["RN", "MD", "All"]} />}>
      <div className="scroll-x" style={{ maxHeight: 520, overflowY: "auto" }}>
        <table className="table">
          <thead><tr><th>Name</th><th>Units</th><th>Today</th><th>Hours</th><th>Bilingual</th><th style={{ textAlign: "right" }}>Cost/h</th></tr></thead>
          <tbody>
            {!list.length ? <tr><td colSpan={6}><Empty title="No staff">No staff with this role.</Empty></td></tr> : list.map((m) => {
              const cap = 37.5 * (m.fte || 1); const ot = otRisk(m); const t = todayOf(m.id);
              return (
                <tr key={m.id} data-staff={m.id}>
                  <td><div className="row" style={{ gap: 8 }}><Avatar name={m.name.replace(/^.*?:\s*/, "")} size={26} /><div className="col" style={{ gap: 0, minWidth: 0 }}><span className="w6 t-sm" style={{ whiteSpace: "nowrap" }}>{m.name.replace(/^.*?:\s*/, "")}</span><span className="t-2xs c-3">{m.role}{/^Float/.test(m.name) ? " · float pool" : !m.internal ? " · agency" : " · internal"}</span></div></div></td>
                  <td className="t-xs c-2">{(m.units || []).join(", ")}</td>
                  <td>{t.length ? <span className="row wrap" style={{ gap: 4 }}>{t.map((s) => <Badge key={s.id} tone="brand">{s.unit} {s.shift}</Badge>)}</span> : <span className="t-xs c-3">Off</span>}</td>
                  <td style={{ minWidth: 92 }}><div className={cx("t-sm num", ot && "flow-ot")} title={`${m.hoursThisWeek} of ${cap} h (FTE ${m.fte})`}>{m.hoursThisWeek} h{ot ? " · OT" : ""}</div><span className={cx("flow-mini", !ot && "ok")} style={{ display: "block", marginTop: 3 }}><i style={{ width: `${Math.min(100, ((m.hoursThisWeek || 0) / cap) * 100)}%`, background: ot ? "var(--bad)" : undefined }} /></span></td>
                  <td className="t-xs">{m.bilingual ? "FR / EN" : <span className="c-3" title="Not bilingual">No</span>}</td>
                  <td className="num t-sm" style={{ textAlign: "right", color: m.internal ? undefined : "var(--bad)" }}>{m.costPerHour} $</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
