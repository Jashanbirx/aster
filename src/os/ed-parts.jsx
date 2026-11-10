// Shared React pieces for the ED board, triage and chart (owned by the ED module).
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LuArrowRightLeft, LuCheck, LuBuilding2, LuVideo, LuPill, LuStethoscope } from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import { Button, Modal, Field, Select, Badge, toast, cx } from "../ui/index.jsx";
import "./ed.css";

/* ------------------------- popover menu ---------------------------- */
/** Small accessible popover menu rendered in a portal so columns never clip it. */
export function Menu({ label = "Move to…", icon = LuArrowRightLeft, items, align = "right", buttonClass, title }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null), box = useRef(null);
  const place = () => {
    const r = btn.current?.getBoundingClientRect(); if (!r) return;
    const w = 220, h = Math.min(320, 40 + items.length * 34);
    let left = align === "right" ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 4; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
    setPos({ left, top, width: w });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const close = (ev) => { if (box.current?.contains(ev.target) || btn.current?.contains(ev.target)) return; setOpen(false); };
    const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); setOpen(false); btn.current?.focus(); } };
    const shut = () => setOpen(false);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", shut);
    document.addEventListener("scroll", shut, true);
    setTimeout(() => box.current?.querySelector("button:not(:disabled)")?.focus(), 0);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", key, true); window.removeEventListener("resize", shut); document.removeEventListener("scroll", shut, true); };
  }, [open]);
  const Icon = icon;
  const onKeyList = (ev) => {
    const btns = [...(box.current?.querySelectorAll("button:not(:disabled)") || [])];
    const i = btns.indexOf(document.activeElement);
    if (ev.key === "ArrowDown") { ev.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (ev.key === "ArrowUp") { ev.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  };
  return (
    <>
      <button ref={btn} type="button" className={cx("ed-menu-btn", buttonClass)} aria-haspopup="menu" aria-expanded={open} title={title || label} aria-label={title || label}
        onClick={(ev) => { ev.stopPropagation(); setOpen((v) => !v); }} onKeyDown={(ev) => ev.stopPropagation()} draggable={false}>
        <Icon />{label && !icon ? label : null}
      </button>
      {open && pos ? createPortal(
        <div ref={box} className="ed-menu" role="menu" style={{ left: pos.left, top: pos.top, width: pos.width }} onKeyDown={onKeyList} onClick={(ev) => ev.stopPropagation()}>
          {label ? <div className="ed-menu-head">{label}</div> : null}
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" disabled={it.disabled} className={cx("ed-menu-item", it.current && "on")}
              onClick={() => { setOpen(false); it.run(); }}>
              <span className="grow ellipsis">{it.label}</span>{it.current ? <LuCheck /> : it.hint ? <span className="t-2xs c-3">{it.hint}</span> : null}
            </button>
          ))}
        </div>, document.body) : null}
    </>
  );
}

/* ------------------------- admission modal ------------------------- */
export function AdmitModal({ encounterId, onClose, onDone }) {
  const e = S.useDoc("encounters", encounterId);
  const p = S.useDoc("patients", e?.patientId);
  const [service, setService] = useState("Medicine");
  useEffect(() => { if (e) setService(e.service || suggestService(e)); }, [encounterId]); // eslint-disable-line react-hooks/exhaustive-deps
  const beds = S.useCollection("beds");
  const unit = D.SERVICE_UNIT[service];
  const free = beds.filter((b) => b.area === "IP" && b.unit === unit && b.state === "free").length;
  const submit = () => {
    D.requestAdmission(encounterId, service, "user");
    toast(`Admission requested: ${D.fullName(p)} to ${service}. Bed manager notified.`);
    onDone && onDone(); onClose();
  };
  return (
    <Modal open={!!encounterId} onClose={onClose} title={`Admit ${p ? D.fullName(p) : "patient"}`}
      subtitle="The patient moves to Boarding and the bed manager gets a task to find a bed."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Request admission</Button></>}>
      <Field label="Admitting service">
        <Select value={service} onChange={(ev) => setService(ev.target.value)} options={D.SERVICES.map((s) => ({ value: s, label: `${s} (${D.UNITS[D.SERVICE_UNIT[s]]})` }))} />
      </Field>
      <div className="t-sm c-2 mt12">{free ? <><b className="c-ok">{free}</b> free bed{free > 1 ? "s" : ""} on {D.UNITS[unit]} right now.</> : <>No free beds on {D.UNITS[unit]} right now. The patient will board in the ED.</>}</div>
    </Modal>
  );
}
export function suggestService(e) {
  const t = `${e.cc} ${e.dx || ""}`.toLowerCase();
  if (/chest|cardi|palpit|nstemi|afib|heart/.test(t)) return "Cardiology";
  if (/hip|fractur|ankle|knee|wrist|ortho/.test(t)) return "Orthopedics";
  if (/appendic|right lower|rlq|bowel|gallbl|cholecyst|abdominal/.test(t)) return "Surgery";
  if (e.ctas === 1) return "ICU";
  return "Medicine";
}

/* --------------------------- slot picker --------------------------- */
const clinicIcon = (kind = "") => (/video/i.test(kind) ? LuVideo : /pharmac/i.test(kind) ? LuPill : /nurse/i.test(kind) ? LuStethoscope : LuBuilding2);
export function SlotList({ slots, value, onChange, compact }) {
  if (!slots.length) return <div className="t-sm c-3 ed-slot-empty">No open clinic slots in the next few hours. Keep the patient in the ED queue.</div>;
  return (
    <div className={cx("ed-slots", compact && "compact")} role="radiogroup" aria-label="Open clinic slots">
      {slots.map((s) => {
        const Icon = clinicIcon(s.clinicKind);
        const on = value === s.id + "|" + s.clinicId;
        return (
          <button key={s.clinicId + s.id} type="button" role="radio" aria-checked={on} className={cx("ed-slot", on && "on")} onClick={() => onChange(s.id + "|" + s.clinicId, s)}>
            <span className="ed-slot-time num">{D.fmtClock(s.t)}</span>
            <Icon className="ed-slot-ic" />
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="w5 ellipsis" style={{ display: "block" }}>{s.clinicName}</span>
              <span className="t-xs c-3 ellipsis" style={{ display: "block" }}>{s.clinicKind}{s.distanceKm ? ` · ${s.distanceKm} km` : ""} · in {D.fmtDur(Math.max(0, s.t - Date.now()))}</span>
            </span>
            {on ? <Badge tone="brand" icon={LuCheck}>Selected</Badge> : null}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------- vitals ------------------------------- */
export const VITAL_FIELDS = [
  { k: "hr", label: "Heart rate", short: "HR", unit: "bpm", min: 20, max: 250 },
  { k: "sbp", label: "BP systolic", short: "BP sys", unit: "mmHg", min: 40, max: 300 },
  { k: "dbp", label: "BP diastolic", short: "BP dia", unit: "mmHg", min: 20, max: 200 },
  { k: "rr", label: "Resp. rate", short: "RR", unit: "/min", min: 4, max: 70 },
  { k: "spo2", label: "SpO₂", short: "SpO₂", unit: "%", min: 50, max: 100 },
  { k: "temp", label: "Temperature", short: "Temp", unit: "°C", min: 30, max: 44, step: 0.1 },
  { k: "pain", label: "Pain", short: "Pain", unit: "/10", min: 0, max: 10 },
  { k: "gcs", label: "GCS", short: "GCS", unit: "3–15", min: 3, max: 15 },
];
/** Strings from inputs → numbers (drops blanks). Returns {vitals, errors}. */
export function parseVitals(form) {
  const vitals = {}; const errors = [];
  for (const f of VITAL_FIELDS) {
    const raw = form[f.k];
    if (raw === "" || raw == null) continue;
    const n = Number(String(raw).replace(",", "."));
    if (!Number.isFinite(n) || n < f.min || n > f.max) { errors.push(`${f.label} should be between ${f.min} and ${f.max}`); continue; }
    vitals[f.k] = n;
  }
  return { vitals, errors };
}
export function vitalsToForm(v = {}) {
  const o = {}; VITAL_FIELDS.forEach((f) => { o[f.k] = v?.[f.k] != null && v[f.k] !== "" ? String(v[f.k]) : ""; }); return o;
}
export function VitalsInputs({ form, onChange, dense }) {
  return (
    <div className={cx("ed-vitals-grid", dense && "dense")}>
      {VITAL_FIELDS.map((f) => (
        <label key={f.k} className="ed-vital">
          <span className="ed-vital-l">{f.short}</span>
          <span className="ed-vital-box">
            <input inputMode="decimal" value={form[f.k] ?? ""} aria-label={f.label} placeholder="–"
              onChange={(ev) => onChange({ ...form, [f.k]: ev.target.value.replace(/[^0-9.,]/g, "") })} />
            <span className="ed-vital-u">{f.unit}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/** Field layout for controls that are not form inputs (segmented controls): not a <label>. */
export function Group({ label, children, style }) {
  return <div className="field ed-group" role="group" aria-label={label} style={style}><span className="label">{label}</span>{children}</div>;
}
