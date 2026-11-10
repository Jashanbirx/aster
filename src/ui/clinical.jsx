// Clinical display components shared across modules.
import React from "react";
import { LuSmartphone, LuAmbulance, LuTriangleAlert, LuLanguages } from "react-icons/lu";
import * as D from "../lib/domain.js";
import { useDoc } from "../lib/store.js";
import { Badge, Ctas, useNow, cx } from "./index.jsx";

export function PatientLine({ encounter: e, patient: pIn, compact, showMrn }) {
  const p = useDoc("patients", e?.patientId) || pIn;
  if (!p) return <span className="c-3">Unknown patient</span>;
  const age = D.ageOf(p.dob);
  return (
    <span className="row gap-4" style={{ minWidth: 0, gap: 6 }}>
      <span className={cx("w6 ellipsis", compact ? "t-sm" : "")}>{p.first} {p.last}</span>
      <span className="t-xs c-3 num" style={{ flex: "none" }}>{age}{p.sex}</span>
      {showMrn ? <span className="t-xs c-3" style={{ flex: "none" }}>{p.mrn}</span> : null}
      {p.lang && p.lang !== "en" && p.lang !== "fr" ? <span title={`Speaks ${D.LANGS[p.lang] || p.lang}`} className="c-ai" style={{ display: "inline-flex" }}><LuLanguages size={13} /></span> : null}
      {e?.source === "app" ? <span title="Came through the Aster app" className="c-brand" style={{ display: "inline-flex" }}><LuSmartphone size={13} /></span> : null}
      {e?.source === "ambulance" ? <span title="Arrived by ambulance" className="c-bad" style={{ display: "inline-flex" }}><LuAmbulance size={13} /></span> : null}
    </span>
  );
}

export function StatusBadge({ status }) {
  const tone = { arriving: "info", waiting_triage: "warn", waiting_md: "warn", in_treatment: "ok", awaiting_results: "info", decision: "brand", boarding: "bad", admitted: "brand", discharged: "", diverted: "info", lwbs: "bad" }[status];
  return <Badge tone={tone}>{D.STATUS_LABEL[status] || status}</Badge>;
}

/** Live time-in-ED, coloured against the CTAS target while waiting. */
export function WaitTime({ encounter: e, since }) {
  useNow();
  const t = since || e.arrivalAt;
  const over = e ? D.minutesOverTarget(e) : null;
  const mins = D.minsSince(t);
  const tone = over ? "var(--bad)" : mins > 360 ? "var(--warn)" : "var(--ink)";
  return <span className="num w6" style={{ color: tone }} title={over ? `${over} min past CTAS ${e.ctas} target` : undefined}>{D.fmtDur(Date.now() - t)}</span>;
}

export function RedFlags({ flags = [] }) {
  if (!flags.length) return null;
  return <span className="row wrap gap-4">{flags.map((f) => <Badge key={f} tone="bad" icon={LuTriangleAlert}>{f}</Badge>)}</span>;
}

export function VitalsRow({ v = {} }) {
  const item = (label, val, unit, bad) => val ? <div className="col" style={{ gap: 0, minWidth: 64 }}><span className="t-2xs c-3">{label}</span><span className="num w6" style={{ color: bad ? "var(--bad)" : "var(--ink)" }}>{val}<span className="t-2xs c-3 w5"> {unit}</span></span></div> : null;
  if (!v || !Object.keys(v).filter((k) => k !== "t").length) return <span className="t-sm c-3">No vitals recorded yet</span>;
  return (
    <div className="row wrap gap-16">
      {item("HR", v.hr, "bpm", v.hr > 120 || v.hr < 45)}
      {item("BP", v.sbp ? `${v.sbp}/${v.dbp || "–"}` : null, "mmHg", v.sbp < 90 || v.sbp >= 200)}
      {item("RR", v.rr, "/min", v.rr > 24 || v.rr < 10)}
      {item("SpO₂", v.spo2, "%", v.spo2 < 92)}
      {item("Temp", v.temp, "°C", v.temp >= 38.5)}
      {item("Pain", v.pain != null && v.pain !== "" ? v.pain : null, "/10", v.pain >= 8)}
      {item("GCS", v.gcs, "", v.gcs && v.gcs < 14)}
    </div>
  );
}

export function CtasLegend() {
  return <div className="row wrap gap-12 t-xs c-2">{[1, 2, 3, 4, 5].map((l) => <span key={l} className="row gap-4"><Ctas level={l} /> {D.CTAS[l].label} · {l === 1 ? "immediate" : `≤ ${D.CTAS[l].target} min`}</span>)}</div>;
}
export { Ctas };
