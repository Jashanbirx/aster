// Analytics: flow metrics for the last 24 h and the measured impact of Aster.
import React, { useMemo, useState } from "react";
import { LuSparkles, LuCopy, LuTrendingDown, LuClock, LuFileText, LuRefreshCw } from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import * as AI from "../lib/ai.js";
import { Button, Panel, PageHead, Kpi, HBars, Columns, LineChart, Markdown, AiLabel, Typing, Empty, toast, useNow, cx } from "../ui/index.jsx";
import { Ctas } from "../ui/clinical.jsx";
import { median, actorType } from "./clinical-lib.js";
import "./clinical.css";

const { MIN, HOUR, DAY } = D;
const LOS_BUCKETS = [[0, 2, "< 2 h"], [2, 4, "2–4 h"], [4, 6, "4–6 h"], [6, 8, "6–8 h"], [8, 12, "8–12 h"], [12, 24, "12–24 h"], [24, Infinity, "> 24 h"]];
const OUTCOMES = [
  { key: "discharged", label: "Discharged home", color: "var(--brand)" },
  { key: "admitted", label: "Admitted", color: "var(--info)" },
  { key: "diverted", label: "Redirected to a clinic", color: "#7FB8AE" },
  { key: "lwbs", label: "Left without being seen", color: "var(--bad)" },
];
// Assumptions behind the impact estimate (shown to the user verbatim).
const A = { signoffHours: 2, scribeMin: 7, referralMin: 6, placementHours: 1, defaultLowAcuityLos: 4 };
const fmtH = (h) => (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10);

export function useAnalytics() {
  const now = useNow();
  const encounters = S.useCollection("encounters");
  const beds = S.useCollection("beds");
  const audit = S.useCollection("audit");
  const tasks = S.useCollection("tasks");
  const reviews = S.useCollection("reviews");
  const referrals = S.useCollection("referrals");
  const history = S.useDoc("meta", "history");
  return useMemo(() => {
    const t = Date.now(), since = t - DAY;
    const ed = encounters.filter((e) => e.kind === "ED" && (e.arrivalAt >= since || D.isEdActive(e)));
    const recent = ed.filter((e) => e.arrivalAt >= since);
    const m = D.computeMetrics(encounters, beds);
    // door-to-physician by CTAS
    const d2d = [1, 2, 3, 4, 5].map((l) => {
      const v = ed.filter((e) => e.ctas === l && e.seenAt).map((e) => (e.seenAt - e.arrivalAt) / MIN);
      return { level: l, n: v.length, median: Math.round(median(v)), target: D.CTAS[l].target, over: v.filter((x) => x > D.CTAS[l].target).length };
    });
    const allD2d = ed.filter((e) => e.seenAt).map((e) => (e.seenAt - e.arrivalAt) / MIN);
    // length of stay for visits that ended
    const endOf = (e) => e.dischargedAt || e.admittedAt || e.closedAt;
    const closed = ed.filter((e) => ["discharged", "admitted", "diverted", "lwbs"].includes(e.status) && endOf(e));
    const losH = closed.map((e) => (endOf(e) - e.arrivalAt) / HOUR);
    const los = LOS_BUCKETS.map(([a, b, label]) => ({ label, value: losH.filter((h) => h >= a && h < b).length }));
    // arrivals by clock hour (last 24)
    const h0 = new Date(t); h0.setMinutes(0, 0, 0);
    const arrivals = Array.from({ length: 24 }, (_, i) => { const start = h0.getTime() - (23 - i) * HOUR; const hr = new Date(start).getHours(); return { label: hr % 3 === 0 ? String(hr).padStart(2, "0") : "", hour: hr, value: recent.filter((e) => e.arrivalAt >= start && e.arrivalAt < start + HOUR).length }; });
    // outcomes
    const outcomes = { discharged: recent.filter((e) => e.status === "discharged").length, admitted: recent.filter((e) => e.status === "admitted" || e.status === "boarding").length, diverted: recent.filter((e) => e.status === "diverted").length, lwbs: recent.filter((e) => e.status === "lwbs").length };
    const stillIn = recent.filter((e) => D.isEdActive(e) && e.status !== "boarding").length;
    const lowLos = closed.filter((e) => e.status === "discharged" && e.ctas >= 4).map((e) => (endOf(e) - e.arrivalAt) / HOUR);
    const lowAcuityLos = lowLos.length >= 3 ? median(lowLos) : A.defaultLowAcuityLos;
    // impact
    const a24 = audit.filter((x) => x.t >= since);
    const placed = a24.filter((x) => x.action === "Assigned inpatient bed").length;
    const agentTasks = tasks.filter((x) => String(x.createdBy || "").startsWith("agent:")).length;
    const agentActions = a24.filter((x) => actorType(x.actor) === "agent").length;
    const drafted = audit.filter((x) => x.action === "Drafted note" && /scribe/i.test(x.actor)).length;
    const signedScribe = encounters.reduce((s, e) => s + (e.notes || []).filter((n) => n.kind === "scribe").length, 0);
    const signoffs = reviews.filter((r) => r.status !== "pending" && r.decidedAt && r.decidedAt >= since).length;
    const refDone = referrals.filter((r) => r.status === "booked" || r.status === "declined").length;
    const refExtracted = referrals.filter((r) => r.extracted).length;
    const divertedHours = outcomes.diverted * lowAcuityLos;
    const patientHours = divertedHours + signoffs * A.signoffHours + placed * A.placementHours;
    const clinicianHours = (Math.max(drafted, signedScribe) * A.scribeMin + refExtracted * A.referralMin) / 60;
    const lwbsRate = recent.length ? (outcomes.lwbs / recent.length) * 100 : 0;
    const hist = (history?.points || []).slice(-97);
    return {
      t, m, ed, recent, d2d, d2dMedian: Math.round(median(allD2d)), los, losMedianH: losH.length ? median(losH) : 0, closedN: closed.length, arrivals, outcomes, stillIn, lowAcuityLos, lwbsRate,
      impact: { placed, agentTasks, agentActions, drafted, signedScribe, signoffs, refDone, refExtracted, divertedHours, patientHours, clinicianHours },
      hist,
    };
  }, [encounters, beds, audit, tasks, reviews, referrals, history, now]);
}

export default function Analytics() {
  const x = useAnalytics();
  const [report, setReport] = useState(null); // {text, status, source}
  const totalOut = Object.values(x.outcomes).reduce((a, b) => a + b, 0);
  const d2dMax = Math.max(130, ...x.d2d.map((d) => d.median)) * 1.08;

  function metricsJson() {
    return {
      hospital: "Hôpital St-Laurent", generated: new Date(x.t).toISOString(), window: "last 24 h",
      ed_now: { census: x.m.edCount, capacity: x.m.edCapacity, waiting_for_md: x.m.waitingMd, waiting_triage: x.m.waitingTriage, boarding: x.m.boarding, boarding_hours: x.m.boardingHours, oldest_boarder_h: Math.round(x.m.oldestBoardMin / 6) / 10, over_ctas_target: x.m.overTarget },
      arrivals_24h: x.recent.length, door_to_physician_median_min: x.d2dMedian,
      door_to_physician_by_ctas: x.d2d.filter((d) => d.n).map((d) => ({ ctas: d.level, median_min: d.median, target_min: d.target, over_target: d.over, n: d.n })),
      los_median_h: fmtH(x.losMedianH), outcomes: x.outcomes, lwbs_rate_pct: Math.round(x.lwbsRate * 10) / 10,
      inpatient: { occupancy_pct: x.m.ipOccupancy, free_beds: x.m.ipFree, cleaning: x.m.ipCleaning, likely_discharges_today: x.m.likelyDischarges, alc: x.m.alc },
      aster_impact: { redirected_to_clinic: x.outcomes.diverted, ed_hours_avoided: fmtH(x.impact.divertedHours), beds_assigned: x.impact.placed, agent_tasks: x.impact.agentTasks, scribe_notes: Math.max(x.impact.drafted, x.impact.signedScribe), signoffs: x.impact.signoffs, patient_hours_saved: fmtH(x.impact.patientHours) },
    };
  }
  function fallbackReport(j) {
    const worst = j.door_to_physician_by_ctas.filter((d) => d.median_min > d.target_min).sort((a, b) => a.ctas - b.ctas)[0];
    return `## Overnight at a glance
- **${j.arrivals_24h} ED arrivals** in the last 24 h; median door-to-physician **${j.door_to_physician_median_min} min**, median length of stay **${j.los_median_h} h**.
- Outcomes: ${j.outcomes.discharged} discharged, ${j.outcomes.admitted} admitted, ${j.outcomes.diverted} redirected to a clinic, ${j.outcomes.lwbs} left without being seen (${j.lwbs_rate_pct}%).
## Right now
- ${j.ed_now.census} patients in the ED (${j.ed_now.capacity} spaces): ${j.ed_now.waiting_for_md} waiting for a physician, ${j.ed_now.over_ctas_target} past their CTAS target.
- **${j.ed_now.boarding} admitted patients boarding** in the ED (${j.ed_now.boarding_hours} boarding hours, oldest ${j.ed_now.oldest_boarder_h} h).
- Inpatient occupancy ${j.inpatient.occupancy_pct}%, ${j.inpatient.free_beds} free beds, ${j.inpatient.cleaning} being cleaned, ${j.inpatient.likely_discharges_today} likely discharges today, ${j.inpatient.alc} ALC.
## Watch today
- ${worst ? `CTAS ${worst.ctas} median wait is ${worst.median_min} min against a ${worst.target_min} min target (${worst.over_target} of ${worst.n} over).` : "All CTAS levels met their median time-to-physician target."}
- ${j.ed_now.boarding ? `Clear boarders first: ${j.inpatient.likely_discharges_today} likely discharges could free beds before noon if barriers are assigned early.` : "No boarders: keep discharges moving to protect afternoon capacity."}
- ${j.outcomes.lwbs ? `${j.outcomes.lwbs} patient${j.outcomes.lwbs === 1 ? "" : "s"} left without being seen: offer same-day clinic slots to low-acuity patients waiting more than 45 min.` : "No patients left without being seen."}
## Aster impact
- ${j.aster_impact.redirected_to_clinic} patients redirected to clinics (~${j.aster_impact.ed_hours_avoided} ED hours avoided), ${j.aster_impact.beds_assigned} beds assigned, ${j.aster_impact.signoffs} sign-offs, ${j.aster_impact.scribe_notes} scribe notes.
- Estimated **${j.aster_impact.patient_hours_saved} patient-hours saved** (assumptions on the Analytics page).`;
  }
  async function writeReport() {
    const j = metricsJson();
    setReport({ text: "", status: "streaming", source: null });
    const out = await AI.text(`Write the 7:30 morning operations report for the leadership huddle at Hôpital St-Laurent from these metrics (JSON). Audience: ED chief, bed manager, nursing director. Markdown with these level-2 headings: Overnight at a glance, Right now, Watch today, Aster impact. 3 bullets max per section, specific numbers, plain language, no fluff, no exclamation marks. Name concrete actions in "Watch today". Do not invent numbers that are not in the JSON.\n\n${JSON.stringify(j)}`, { onText: (s) => setReport({ text: s, status: "streaming", source: "ai" }) });
    if (out) { setReport({ text: out.trim(), status: "done", source: "ai" }); S.audit("agent:Aster Copilot", "Wrote morning report", `${out.length} characters`, {}); }
    else { const t = fallbackReport(j); setReport({ text: t, status: "done", source: "rules" }); S.audit("system", "Wrote morning report", "Offline template", {}); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(report.text); toast("Report copied"); }
    catch (e) { toast("Couldn't copy: the browser blocked clipboard access. Select the text and copy it instead.", { kind: "bad" }); }
  }

  const imp = x.impact;
  return (
    <div>
      <PageHead title="Analytics" subtitle="Emergency flow over the last 24 hours and the measured impact of Aster. Every number is computed from live data."
        actions={<Button variant="ai" icon={LuSparkles} loading={report?.status === "streaming"} onClick={writeReport}>{report ? "Rewrite the morning report" : "Write the morning report"}</Button>} />

      <div className="grid g4">
        <Kpi label="ED arrivals, 24 h" value={x.recent.length} sub={`${x.m.edCount} in the department now`} spark={x.arrivals.map((a) => a.value)} />
        <Kpi label="Median door-to-physician" value={`${x.d2dMedian} min`} sub={`${x.d2d.reduce((s, d) => s + d.over, 0)} patients over CTAS target`} tone={x.d2dMedian > 60 ? "warn" : undefined} />
        <Kpi label="Median length of stay" value={`${fmtH(x.losMedianH)} h`} sub={`${x.closedN} visits completed`} />
        <Kpi label="Boarding hours now" value={x.m.boardingHours} sub={`${x.m.boarding} admitted patients waiting for a bed`} tone={x.m.boarding ? "bad" : "ok"} spark={x.hist.map((p) => p.boarding)} sparkColor="var(--bad)" />
      </div>

      {report ? (
        <div className="ai-card mt16">
          <div className="row wrap"><AiLabel>Morning report</AiLabel>{report.status === "streaming" ? <Typing /> : <span className="t-xs c-3">{report.source === "ai" ? "Written by Claude from the metrics below" : "Offline template from the metrics below"}</span>}<span className="grow" />
            {report.status === "done" ? <><Button size="sm" variant="ghost" icon={LuCopy} onClick={copy}>Copy</Button><Button size="sm" variant="ghost" icon={LuRefreshCw} onClick={writeReport}>Rewrite</Button></> : null}</div>
          <div className="mt8"><Markdown text={report.text || " "} /></div>
        </div>
      ) : null}

      <div className="grid g2 mt16">
        <Panel title="Door-to-physician by CTAS" subtitle="Median minutes from arrival to first physician contact. The dark line is the CTAS target.">
          {x.d2d.every((d) => !d.n) ? <Empty title="No patients seen yet">Medians appear once physicians start seeing patients.</Empty> : x.d2d.map((d) => (
            <div key={d.level} className="row cl-ctas-row" style={{ alignItems: "flex-start", gap: 10 }}>
              <div style={{ paddingTop: 1 }}><Ctas level={d.level} /></div>
              <div className="grow">
                <HBars data={[{ label: `${D.CTAS[d.level].label}`, value: d.median, color: d.n && d.median > d.target ? "var(--bad)" : "var(--brand-2)", sub: d.n ? `n ${d.n}` : "none seen" }]} max={d2dMax} target={d.target} format={(v) => (d.n ? `${v} min` : "–")} />
                <div className="t-2xs c-3 mt4">{d.level === 1 ? "Target: immediate" : `Target ≤ ${d.target} min`}{d.n ? ` · ${d.over} of ${d.n} over` : ""}</div>
              </div>
            </div>
          ))}
        </Panel>

        <Panel title="Outcomes" subtitle={`${totalOut} visits that arrived in the last 24 h${x.stillIn ? ` · ${x.stillIn} still in the department` : ""}`}>
          <div className="cl-stack" role="img" aria-label={OUTCOMES.map((o) => `${o.label} ${x.outcomes[o.key]}`).join(", ")}>
            {OUTCOMES.map((o) => (x.outcomes[o.key] ? <i key={o.key} style={{ width: `${(x.outcomes[o.key] / Math.max(1, totalOut)) * 100}%`, background: o.color }} title={`${o.label}: ${x.outcomes[o.key]}`} /> : null))}
          </div>
          <div className="cl-legend">
            {OUTCOMES.map((o) => <div key={o.key}><span className="cl-sw" style={{ background: o.color }} /><span className="grow">{o.label}</span><span className="num w6">{x.outcomes[o.key]}</span><span className="t-xs c-3 num" style={{ width: 38, textAlign: "right" }}>{totalOut ? Math.round((x.outcomes[o.key] / totalOut) * 100) : 0}%</span></div>)}
          </div>
          <div className="divider" />
          <div className="row wrap t-sm" style={{ gap: 18 }}>
            <div className="cl-stat"><b className={cx("num", x.lwbsRate > 5 && "c-bad")}>{Math.round(x.lwbsRate * 10) / 10}%</b><span>left without being seen</span></div>
            <div className="cl-stat"><b className="num">{x.m.boarding}</b><span>boarding now</span></div>
            <div className="cl-stat"><b className="num">{fmtH(x.m.oldestBoardMin / 60)} h</b><span>longest boarder</span></div>
          </div>
        </Panel>

        <Panel title="Arrivals by hour" subtitle="ED registrations per clock hour, last 24 h. The current hour is highlighted.">
          <Columns data={x.arrivals} height={150} highlightLast />
        </Panel>

        <Panel title="Length of stay" subtitle={`Arrival to discharge, admission or exit, ${x.closedN} completed visits`}>
          {x.closedN ? <Columns data={x.los} height={150} /> : <Empty title="No completed visits yet" />}
        </Panel>

        <Panel title="Department trend" subtitle="15-minute snapshots over the last 24 h" className="span2">
          {x.hist.length > 1 ? <LineChart height={200} labels={[D.fmtClock(x.hist[0].t), D.fmtClock(x.hist[x.hist.length - 1].t)]} series={[
            { name: "ED census", color: "var(--brand-2)", values: x.hist.map((p) => p.census) },
            { name: "Waiting", color: "var(--info)", values: x.hist.map((p) => p.waiting) },
            { name: "Boarding", color: "var(--bad)", values: x.hist.map((p) => p.boarding) },
          ]} /> : <Empty title="Not enough history yet">Snapshots are recorded every 15 minutes while the simulation runs.</Empty>}
        </Panel>
      </div>

      <Panel className="mt16" icon={LuTrendingDown} title="Impact of Aster" subtitle="Computed from the audit log and live records. Estimates use the assumptions listed below.">
        <div className="cl-impact">
          <div><span className="t-xs c-2">Patient-hours saved (est.)</span><b className="num c-brand">{fmtH(imp.patientHours)}</b><span className="t-xs c-3">last 24 h</span></div>
          <div><span className="t-xs c-2">Redirected to clinics</span><b className="num">{x.outcomes.diverted}</b><span className="t-xs c-3">~{fmtH(imp.divertedHours)} ED hours avoided</span></div>
          <div><span className="t-xs c-2">Boarders placed in beds</span><b className="num">{imp.placed}</b><span className="t-xs c-3">bed assignments, 24 h</span></div>
          <div><span className="t-xs c-2">Tasks created by agents</span><b className="num">{imp.agentTasks}</b><span className="t-xs c-3">{imp.agentActions} agent actions logged, 24 h</span></div>
          <div><span className="t-xs c-2">Notes drafted by the scribe</span><b className="num">{imp.drafted}</b><span className="t-xs c-3">{imp.signedScribe} signed · ~{fmtH(imp.clinicianHours)} clinician hours saved</span></div>
          <div><span className="t-xs c-2">Sign-offs completed</span><b className="num">{imp.signoffs}</b><span className="t-xs c-3">{imp.refDone} referrals routed</span></div>
        </div>
        <div className="mt16">
          <div className="t-xs w6 c-2" style={{ marginBottom: 6 }}>Assumptions</div>
          <ul className="cl-assume">
            <li>A redirected low-acuity patient avoids the median ED stay of discharged CTAS 4–5 patients today: <span className="w6">{fmtH(x.lowAcuityLos)} h</span>{x.lowAcuityLos === A.defaultLowAcuityLos ? " (default; fewer than 3 such visits today)" : ""}.</li>
            <li>An asynchronous physician sign-off replaces an in-person visit: <span className="w6">{A.signoffHours} h</span> of travel and waiting per patient.</li>
            <li>A bed assigned from Aster's recommendation shortens boarding by <span className="w6">{A.placementHours} h</span> compared with phone-based bed finding.</li>
            <li>Clinician time: <span className="w6">{A.scribeMin} min</span> of typing per scribe note and <span className="w6">{A.referralMin} min</span> of manual data entry per faxed referral ({imp.refExtracted} extracted).</li>
            <li>Data is fictional (Hôpital St-Laurent demo). Patient-hours = redirected × ED stay + sign-offs × {A.signoffHours} h + beds × {A.placementHours} h.</li>
          </ul>
        </div>
      </Panel>
    </div>
  );
}
