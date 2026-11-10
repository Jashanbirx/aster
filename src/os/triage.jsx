// Triage: queue, intake, live rules engine, AI second opinion, nurse decision.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LuUserPlus, LuSmartphone, LuAmbulance, LuFootprints, LuSparkles, LuCheck, LuTriangleAlert, LuShieldCheck, LuSearch,
  LuLogIn, LuBuilding2, LuPencil, LuStethoscope, LuCircleCheck, LuLanguages, LuInfo, LuClipboardList, LuUser,
} from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import * as AI from "../lib/ai.js";
import { openChart } from "../lib/ui-state.js";
import { Button, Badge, Avatar, PageHead, Seg, Field, Input, Textarea, Select, Modal, Empty, AiLabel, Typing, toast, useNow, cx } from "../ui/index.jsx";
import { PatientLine, WaitTime, RedFlags, Ctas, CtasLegend } from "../ui/clinical.jsx";
import { Group, SlotList, VitalsInputs, parseVitals, vitalsToForm } from "./ed-parts.jsx";
import { takeTriageFocus, isNew, nextSlots, langPlain, vitalsText } from "./ed-lib.js";
import "./ed.css";

const SOURCE = {
  app: { label: "App pre-registered", icon: LuSmartphone, tone: "brand" },
  ambulance: { label: "Ambulance", icon: LuAmbulance, tone: "bad" },
  "walk-in": { label: "Walk-in", icon: LuFootprints, tone: "" },
  referral: { label: "Referral", icon: LuClipboardList, tone: "info" },
};
const uniq = (a) => [...new Set(a.filter(Boolean))];

/* =================================================================== */
export default function Triage() {
  useNow();
  const encounters = S.useCollection("encounters");
  const patients = S.useCollection("patients");
  const pById = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const queue = useMemo(() => encounters.filter((e) => e.kind === "ED" && ["waiting_triage", "arriving"].includes(e.status)).sort((a, b) => a.arrivalAt - b.arrivalAt), [encounters]);
  const waiting = queue.filter((e) => e.status === "waiting_triage");
  const enroute = queue.filter((e) => e.status === "arriving");
  const recent = useMemo(() => encounters.filter((e) => e.triagedAt && Date.now() - e.triagedAt < 90 * D.MIN && e.kind === "ED").sort((a, b) => b.triagedAt - a.triagedAt).slice(0, 5), [encounters]);
  const [sel, setSel] = useState(() => takeTriageFocus());
  const [reg, setReg] = useState(false);
  const pane = useRef(null);
  const selected = queue.find((e) => e.id === sel) || waiting[0] || enroute[0] || null;

  const choose = (id) => {
    setSel(id);
    if (window.innerWidth < 900) setTimeout(() => pane.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };
  const done = (id) => {
    const order = [...waiting, ...enroute];
    const i = order.findIndex((e) => e.id === id);
    const next = order[i + 1] || order[i - 1];
    setSel(next && next.id !== id ? next.id : null);
  };

  return (
    <div className="ed-tri-page">
      <PageHead title="Triage" subtitle="Rules engine and AI second opinion side by side. The nurse makes the final call; the more urgent level is always preselected."
        actions={<Button variant="primary" icon={LuUserPlus} onClick={() => setReg(true)}>Register walk-in</Button>} />
      <div className="ed-tri">
        <aside className="ed-q panel" aria-label="Triage queue">
          <div className="ed-q-head">
            <div className="grow"><div className="t-h3">Queue</div><div className="t-xs c-3">{waiting.length} waiting · {enroute.length} en route</div></div>
            <Button size="sm" icon={LuUserPlus} onClick={() => setReg(true)}>Walk-in</Button>
          </div>
          {queue.length ? (
            <div className="ed-q-list">
              {waiting.length ? <div className="ed-q-sec">Waiting for triage</div> : null}
              {waiting.map((e) => <QueueItem key={e.id} e={e} p={pById.get(e.patientId)} on={selected?.id === e.id} onClick={() => choose(e.id)} />)}
              {enroute.length ? <div className="ed-q-sec">En route from the app</div> : null}
              {enroute.map((e) => <QueueItem key={e.id} e={e} p={pById.get(e.patientId)} on={selected?.id === e.id} onClick={() => choose(e.id)} />)}
            </div>
          ) : (
            <Empty icon={LuCircleCheck} title="No one is waiting for triage" action={<Button variant="primary" icon={LuUserPlus} onClick={() => setReg(true)}>Register walk-in</Button>}>New arrivals and app pre-registrations appear here automatically.</Empty>
          )}
          {recent.length ? (
            <div className="ed-q-recent">
              <div className="ed-q-sec">Recently triaged</div>
              {recent.map((e) => (
                <button key={e.id} type="button" className="ed-q-mini" onClick={() => openChart(e.id)}>
                  <Ctas level={e.ctas} /><span className="grow ellipsis t-sm">{D.fullName(pById.get(e.patientId))}</span><span className="t-2xs c-3">{D.fmtAgo(e.triagedAt)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </aside>
        <div ref={pane} className="ed-tri-main">
          {selected ? <TriagePane key={selected.id} e={selected} p={pById.get(selected.patientId)} onDone={done} />
            : <div className="panel"><Empty icon={LuStethoscope} title="Queue is clear" action={<Button variant="primary" icon={LuUserPlus} onClick={() => setReg(true)}>Register walk-in</Button>}>Register a walk-in to start a triage, or wait for the next arrival.</Empty></div>}
        </div>
      </div>
      <RegisterModal open={reg} onClose={() => setReg(false)} onRegistered={(id) => { setSel(id); setReg(false); }} encounters={encounters} patients={patients} />
    </div>
  );
}

function QueueItem({ e, p, on, onClick }) {
  const src = SOURCE[e.source] || SOURCE["walk-in"];
  const est = useMemo(() => D.assessCtas({ cc: e.cc, vitals: e.pendingVitals || {}, age: D.ageOf(p?.dob) ?? 40 }), [e.cc, e.pendingVitals, p?.dob]);
  const wait = D.minsSince(e.arrivalAt);
  return (
    <button type="button" className={cx("ed-q-item", on && "on", isNew(e) && "new-flash", est.level <= 2 && "hot")} onClick={onClick} aria-current={on ? "true" : undefined}>
      <span className="row" style={{ gap: 6 }}>
        <span className="grow" style={{ minWidth: 0 }}><PatientLine encounter={e} patient={p} compact /></span>
        <span className={cx("num t-sm w6", wait > 15 ? "c-bad" : wait > 10 ? "c-warn" : "")}>{e.status === "arriving" ? "En route" : D.fmtDur(Date.now() - e.arrivalAt)}</span>
      </span>
      <span className="t-sm c-2 ed-q-cc">{e.cc}</span>
      <span className="row wrap" style={{ gap: 4 }}>
        <Badge tone={src.tone} icon={src.icon}>{src.label}</Badge>
        {est.level <= 3 ? <Badge tone={est.level <= 2 ? "bad" : "warn"} title="Quick estimate from the complaint and any recorded vitals. Not a triage level.">Est. CTAS {est.level}</Badge> : null}
        {e.status === "arriving" ? <span className="t-2xs c-3">registered {D.fmtAgo(e.arrivalAt)}</span> : null}
      </span>
      {e.preSummary ? <span className="t-xs c-3 ed-q-pre">{e.preSummary}</span> : null}
    </button>
  );
}

/* ------------------------------ intake ----------------------------- */
function historyFrom(p) {
  if (!p) return "";
  const parts = [];
  if ((p.conditions || []).length) parts.push(`History: ${p.conditions.join(", ")}`);
  if ((p.meds || []).length) parts.push(`Meds: ${p.meds.map((m) => m.name).join(", ")}`);
  return parts.join(". ");
}

function TriagePane({ e, p, onDone }) {
  const age = D.ageOf(p?.dob);
  const [cc, setCc] = useState(e.cc || "");
  const [form, setForm] = useState(() => vitalsToForm(e.pendingVitals || e.vitals));
  const [history, setHistory] = useState("");
  const onFile = historyFrom(p);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(null);
  const [checked, setChecked] = useState({});
  const [ai, setAi] = useState(null); // {ctas,...,key} | {offline:true}
  const [aiBusy, setAiBusy] = useState(false);
  const [slot, setSlot] = useState(null);
  const [errs, setErrs] = useState([]);
  const clinics = S.useCollection("clinics");

  const { vitals, errors: vErr } = useMemo(() => parseVitals(form), [form]);
  const rules = useMemo(() => D.assessCtas({ cc, vitals, age: age ?? 40, history }), [cc, vitals, age, history]);
  const inputsKey = JSON.stringify([cc, vitals, history]);
  const aiLevel = ai && !ai.offline ? ai.ctas : null;
  const aiStale = aiLevel && ai.key !== inputsKey;
  const suggested = aiLevel ? Math.min(rules.level, aiLevel) : rules.level;
  const final = override ?? suggested;
  const redFlags = uniq([...rules.redFlags, ...(aiLevel ? ai.red_flags : [])]);
  const protocols = uniq([...rules.protocols, ...(aiLevel ? ai.protocols : [])]);
  const isOn = (pr) => checked[pr] ?? rules.protocols.includes(pr);
  const chosen = protocols.filter(isOn);
  const divertible = final >= 4 && !redFlags.length && rules.divertible;
  const slots = useMemo(() => (divertible ? nextSlots(clinics, { limit: 4, withinH: 6 }) : []), [divertible, clinics]);
  const hasVitals = Object.keys(vitals).length > 0;

  const askAi = async () => {
    setAiBusy(true);
    const prompt = `You are assisting a triage nurse in a Québec emergency department. Give an independent CTAS (Canadian Triage and Acuity Scale, 2016 guidelines) assessment.
Patient: ${D.fullName(p)}, ${age ?? "unknown age"} ${p?.sex || ""}, preferred language ${langPlain(p?.lang)}.
Allergies: ${(p?.allergies || []).join(", ") || "none known"}.
Arrival: ${e.source || "walk-in"}.${e.preSummary ? ` Pre-arrival summary from the patient app: ${e.preSummary}` : ""}
Chief complaint in the patient's words (may not be English): "${cc}"
Vital signs: ${vitalsText(vitals) || "not yet measured"}.
History and medications noted by the nurse: ${history || "none recorded"}.

Return:
- ctas: integer 1-5.
- rationale: one or two sentences naming the complaint and the first-order modifier (vitals, pain, mechanism) that sets the level.
- red_flags: short strings, [] if none.
- protocols: nurse-initiated medical directives appropriate in a Québec ED for this presentation (e.g. "ECG within 10 min", "Troponin", "Analgesia per directive"), [] if none.
- disposition: one short sentence on where the patient should wait and how soon a physician should see them.
- divertible: true only if CTAS 4 or 5, no red flags, and safe for a same-day clinic.
- translation: English translation of the complaint if it is not in English, otherwise "".`;
    const r = await AI.json(prompt, { shape: '{"ctas":3,"rationale":"...","red_flags":["..."],"protocols":["..."],"disposition":"...","divertible":false,"translation":""}' });
    const lvl = r ? parseInt(r.ctas, 10) : NaN;
    if (!r || !(lvl >= 1 && lvl <= 5)) { setAi({ offline: true }); setAiBusy(false); return; }
    setAi({ ctas: lvl, rationale: String(r.rationale || ""), red_flags: Array.isArray(r.red_flags) ? r.red_flags.map(String) : [], protocols: Array.isArray(r.protocols) ? r.protocols.map(String) : [], disposition: String(r.disposition || ""), divertible: !!r.divertible, translation: String(r.translation || ""), key: inputsKey });
    setOverride(null);
    setAiBusy(false);
  };

  const writeNote = () => {
    const bits = [
      `${age ?? "?"}${p?.sex || ""}, ${cc.trim()}.`,
      hasVitals ? `Vitals: ${vitalsText(vitals)}.` : "Vitals not measured.",
      redFlags.length ? `Red flags: ${redFlags.join(", ")}.` : "No red flags identified.",
      `CTAS ${final} (${D.CTAS[final].label.toLowerCase()}).`,
      chosen.length ? `Started per medical directive: ${chosen.join(", ")}.` : "",
      (p?.allergies || []).length ? `Allergies: ${p.allergies.join(", ")}.` : "No known allergies.",
    ];
    setNote(bits.filter(Boolean).join(" "));
  };

  const commit = () => {
    const errsNow = [];
    if (!cc.trim()) errsNow.push("Enter the chief complaint.");
    if (vErr.length) errsNow.push(...vErr.map((x) => x + "."));
    setErrs(errsNow);
    if (errsNow.length) return false;
    if (cc.trim() !== e.cc) { S.patch("encounters", e.id, { cc: cc.trim() }); S.audit("user", "Updated chief complaint", `${D.fullName(p)}: ${cc.trim()}`, { encounterId: e.id }); }
    const noteText = [aiLevel && ai.translation ? `Complaint (English translation): ${ai.translation}` : "", note.trim(), history.trim() ? `History and meds: ${history.trim()}` : ""].filter(Boolean).join("\n");
    D.completeTriage(e.id, { ctas: final, vitals, note: noteText, redFlags, protocols: chosen, rulesCtas: rules.level, aiCtas: aiLevel || undefined, divertible }, "user");
    return true;
  };
  const complete = () => {
    if (!commit()) return;
    toast(`${D.fullName(p)} triaged CTAS ${final}${chosen.length ? `, ${chosen.length} protocol${chosen.length > 1 ? "s" : ""} started` : ""}. Now waiting for a physician.`);
    onDone(e.id);
  };
  const divert = () => {
    if (!slot) return;
    if (!commit()) return;
    const [slotId, clinicId] = slot.split("|");
    const appt = D.divertToClinic(e.id, clinicId, slotId, "user");
    if (appt) toast(`${D.fullName(p)} triaged CTAS ${final} and booked at ${appt.clinicName}, ${D.fmtClock(appt.t)}`);
    else toast("Triage saved, but that slot was just taken. Redirect from the chart.", { kind: "bad" });
    onDone(e.id);
  };

  const src = SOURCE[e.source] || SOURCE["walk-in"];
  const drivers = rules.reasons.filter((r) => r.level === rules.level);
  const others = rules.reasons.filter((r) => r.level !== rules.level);

  return (
    <div className="col gap-16">
      {/* patient header */}
      <div className="panel ed-tp-head">
        <div className="row wrap" style={{ gap: 10 }}>
          <Avatar name={D.fullName(p)} size={40} />
          <div className="grow" style={{ minWidth: 200 }}>
            <div className="t-h2">{D.fullName(p)}</div>
            <div className="t-sm c-2 ed-ch-sub"><span className="num">{age ?? "?"} {p?.sex}</span><span>MRN {p?.mrn}</span><span className="row gap-4">{p?.lang && !["en", "fr"].includes(p.lang) ? <LuLanguages className="c-ai" /> : null}{langPlain(p?.lang)}</span></div>
            <div className={cx("t-sm ed-ch-allergy", (p?.allergies || []).length ? "c-bad w6" : "c-3")}>{(p?.allergies || []).length ? <><LuTriangleAlert />Allergies: {p.allergies.join(", ")}</> : "No known allergies"}</div>
          </div>
          <div className="col" style={{ gap: 4, alignItems: "flex-end" }}>
            <Badge tone={src.tone} icon={src.icon}>{src.label}</Badge>
            <span className="t-sm c-2">{e.status === "arriving" ? <>Registered {D.fmtAgo(e.arrivalAt)}</> : <>Waiting <WaitTime encounter={e} /></>}</span>
          </div>
        </div>
        {e.status === "arriving" ? (
          <div className="ed-callout mt12"><LuSmartphone className="c-brand" /><div className="grow t-sm"><div className="w6">En route, pre-registered in the Aster app</div><div className="c-2">Mark the patient as arrived when they reach the triage desk. You can triage now if they are here.</div></div>
            <Button size="sm" icon={LuLogIn} onClick={() => { D.setEdStatus(e.id, "waiting_triage", "user"); toast(`${D.fullName(p)} marked as arrived`); }}>Mark arrived</Button></div>
        ) : null}
        {e.preSummary ? <div className="ed-pre mt12"><div className="row t-xs w6 c-brand"><LuSmartphone />Pre-arrival summary</div><div className="t-sm mt4">{e.preSummary}</div></div> : null}
      </div>

      <div className="ed-tp-grid">
        {/* intake */}
        <section className="panel">
          <header className="panel-head"><span className="t-h3">Intake</span><span className="grow" />{e.pendingVitals ? <Badge tone="info">Vitals from the waiting-room kiosk</Badge> : null}</header>
          <div className="panel-body col gap-16">
            <Field label="Chief complaint" hint="Any language. Use the AI second opinion for an English translation.">
              <Textarea rows={2} value={cc} onChange={(ev) => setCc(ev.target.value)} dir="auto" />
            </Field>
            <div>
              <div className="label">Vital signs</div>
              <div className="mt8"><VitalsInputs form={form} onChange={setForm} /></div>
              {vErr.length ? <div className="t-xs c-bad mt8">{vErr.join(". ")}.</div> : null}
            </div>
            <Field label="History and medications" hint="Relevant to today's complaint. Text here is read by the rules engine.">
              <Textarea rows={2} value={history} onChange={(ev) => setHistory(ev.target.value)} placeholder="Relevant history, current medications, anticoagulants, pregnancy" />
            </Field>
            {onFile ? <div className="ed-calm" style={{ marginTop: -8 }}><LuClipboardList /><div className="grow t-xs c-2"><span className="w6">On file:</span> {onFile}</div>{!history.includes(onFile) ? <Button size="sm" variant="ghost" onClick={() => setHistory((h) => (h ? h + ". " : "") + onFile)}>Add to history</Button> : null}</div> : null}
          </div>
        </section>

        {/* engines */}
        <div className="col gap-16">
          <section className="panel ed-rules" aria-live="polite">
            <header className="panel-head"><LuShieldCheck className="c-brand" style={{ width: 16, height: 16 }} /><span className="t-h3">Rules engine</span><Badge tone="ok">Live</Badge><span className="grow" /><span className="t-xs c-3">CTAS first-order modifiers</span></header>
            <div className="panel-body">
              <div className="row" style={{ gap: 12 }}>
                <Ctas level={rules.level} size="lg" />
                <div className="grow"><div className="t-h3">{rules.label}</div><div className="t-xs c-2">{rules.level === 1 ? "Immediate physician assessment" : `Physician within ${D.CTAS[rules.level].target} min · reassess every ${D.CTAS[rules.level].reassess} min`}</div></div>
              </div>
              <ul className="ed-reasons mt12">
                {drivers.map((r, i) => <li key={"d" + i} className="drv"><Ctas level={r.level} /><span className="grow">{r.why}</span><span className="t-2xs w6 c-brand">Sets level</span></li>)}
                {others.map((r, i) => <li key={"o" + i}><Ctas level={r.level} /><span className="grow c-2">{r.why}</span></li>)}
              </ul>
              {rules.redFlags.length ? <div className="mt12"><RedFlags flags={rules.redFlags} /></div> : null}
              {rules.protocols.length ? <div className="t-xs c-2 mt12"><span className="w6">Suggested protocols:</span> {rules.protocols.join(" · ")}</div> : null}
            </div>
          </section>

          <section className="panel ed-ai">
            <header className="panel-head"><AiLabel>AI second opinion</AiLabel><span className="grow" />
              <Button size="sm" variant="ai" icon={LuSparkles} loading={aiBusy} onClick={askAi} disabled={!cc.trim()}>{aiLevel ? (aiStale ? "Ask again" : "Refresh") : "Get AI second opinion"}</Button>
            </header>
            <div className="panel-body">
              {aiBusy ? <div className="c-ai row"><Typing /><span className="t-sm">Reviewing complaint, vitals and history…</span></div>
                : ai?.offline ? <div className="ed-calm"><LuInfo /><div className="t-sm"><div className="w5">AI is unavailable right now.</div><div className="c-2">The rules engine is active and applies the CTAS first-order modifiers. Complete triage with it; nothing is blocked.</div></div></div>
                  : aiLevel ? (
                    <div className="col" style={{ gap: 10 }}>
                      <div className="row" style={{ gap: 12 }}>
                        <Ctas level={aiLevel} size="lg" />
                        <div className="grow"><div className="t-h3">{D.CTAS[aiLevel].label}</div>
                          {aiLevel === rules.level ? <Badge tone="ok" icon={LuCheck}>Agrees with rules engine</Badge> : <Badge tone="warn">{aiLevel < rules.level ? "More urgent" : "Less urgent"} than rules ({rules.level})</Badge>}
                        </div>
                      </div>
                      {aiStale ? <div className="t-xs c-warn">Intake changed since this opinion. Ask again to refresh it.</div> : null}
                      <div className="t-sm">{ai.rationale}</div>
                      {ai.translation ? <div className="ed-quote t-sm"><span className="t-xs c-3">English translation</span><div>{ai.translation}</div></div> : null}
                      {ai.red_flags.length ? <RedFlags flags={ai.red_flags} /> : null}
                      {ai.disposition ? <div className="t-sm c-2"><span className="w6">Disposition:</span> {ai.disposition}</div> : null}
                      {ai.protocols.length ? <div className="t-xs c-2"><span className="w6">Protocols:</span> {ai.protocols.join(" · ")}</div> : null}
                    </div>
                  ) : <div className="t-sm c-2">An independent CTAS read of the full intake, with rationale, red flags, protocols and a translation if the complaint is not in English. It never overrides the rules engine downward.</div>}
            </div>
          </section>
          <div className="ed-legend"><CtasLegend /></div>
        </div>
      </div>

      {/* decision */}
      <section className="panel ed-decide">
        <header className="panel-head"><span className="t-h3">Nurse decision</span><span className="grow" /><span className="t-xs c-3">Recorded as Triage RN</span></header>
        <div className="panel-body col gap-16">
          <div>
            <div className="label">Final CTAS</div>
            <div className="mt8 ed-lvls" role="radiogroup" aria-label="Final CTAS level">
              {[1, 2, 3, 4, 5].map((l) => (
                <button key={l} type="button" role="radio" aria-checked={final === l} className={cx("ed-lvl", `l${l}`, final === l && "on")} onClick={() => setOverride(l === suggested ? null : l)}>
                  <span className="ed-lvl-n">{l}</span><span className="ed-lvl-t">{D.CTAS[l].label}</span>
                </button>
              ))}
            </div>
            <div className="t-xs mt8">
              {override != null && override > suggested ? <span className="c-bad w5"><LuTriangleAlert className="ed-ic-inline" />Less urgent than suggested (CTAS {suggested}). Document your reasoning in the triage note.</span>
                : override != null ? <span className="c-2">Nurse override: CTAS {override}, more urgent than suggested ({suggested}).</span>
                  : aiLevel && aiLevel !== rules.level ? <span className="c-2"><LuShieldCheck className="ed-ic-inline c-brand" />Preselected CTAS {suggested}: the more urgent of the rules engine ({rules.level}) and AI ({aiLevel}).</span>
                    : <span className="c-3">Preselected from the {aiLevel ? "rules engine and AI (they agree)" : "rules engine"}.</span>}
            </div>
          </div>
          {protocols.length ? (
            <div>
              <div className="label">Protocols to start now</div>
              <div className="ed-protos mt8">
                {protocols.map((pr) => (
                  <label key={pr} className="check ed-proto"><input type="checkbox" checked={isOn(pr)} onChange={(ev) => setChecked((c) => ({ ...c, [pr]: ev.target.checked }))} /><span className="grow">{pr}</span>{!rules.protocols.includes(pr) ? <Badge tone="ai">AI</Badge> : null}</label>
                ))}
              </div>
            </div>
          ) : null}
          {redFlags.length ? <div><div className="label">Red flags recorded</div><div className="mt8"><RedFlags flags={redFlags} /></div></div> : null}
          <Field label="Triage note">
            <Textarea rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder="Assessment, observations, interventions" dir="auto" />
          </Field>
          <div className="row" style={{ marginTop: -8 }}><Button size="sm" variant="ghost" icon={LuPencil} onClick={writeNote}>Write note from intake</Button></div>

          {divertible ? (
            <div className="ed-divert">
              <div className="row"><LuBuilding2 className="c-brand" /><span className="w6 t-sm">Offer a same-day clinic instead</span><span className="grow" /><span className="t-xs c-3">CTAS {final}, no red flags</span></div>
              <div className="mt8"><SlotList slots={slots} value={slot} onChange={setSlot} compact /></div>
              {slots.length ? <div className="row mt8"><span className="t-xs c-3 grow">Triage is saved first, then the visit is redirected and the clinic receives the summary.</span><Button size="sm" icon={LuBuilding2} disabled={!slot} onClick={divert}>Triage and book clinic</Button></div> : null}
            </div>
          ) : null}

          {errs.length ? <div className="t-sm c-bad">{errs.join(" ")}</div> : null}
          <div className="row wrap ed-decide-foot">
            <span className="t-xs c-3 grow">{!hasVitals ? <span className="c-warn">No vitals entered. Measure vitals for CTAS 1 to 3.</span> : `Moves ${D.fullName(p)} to Waiting for MD${chosen.length ? ` and starts ${chosen.length} protocol order${chosen.length > 1 ? "s" : ""}` : ""}.`}</span>
            <Button variant="primary" size="lg" icon={LuCheck} onClick={complete}>Complete triage · CTAS {final}</Button>
          </div>
        </div>
      </section>
    </div>
  );
}

/* --------------------------- registration -------------------------- */
const BLANK = { first: "", last: "", dob: "", sex: "F", lang: "fr" };
function RegisterModal({ open, onClose, onRegistered, encounters, patients }) {
  const [q, setQ] = useState("");
  const [pid, setPid] = useState(null);
  const [mode, setMode] = useState("search");
  const [np, setNp] = useState(BLANK);
  const [cc, setCc] = useState("");
  const [source, setSource] = useState("walk-in");
  const [err, setErr] = useState("");
  useEffect(() => { if (open) { setQ(""); setPid(null); setMode("search"); setNp(BLANK); setCc(""); setSource("walk-in"); setErr(""); } }, [open]);
  const activeByP = useMemo(() => { const m = new Map(); encounters.filter(D.isEdActive).forEach((e) => m.set(e.patientId, e)); return m; }, [encounters]);
  const results = useMemo(() => {
    const n = q.trim().toLowerCase(); if (n.length < 2) return [];
    return patients.filter((p) => `${p.first} ${p.last} ${p.last} ${p.first} ${p.mrn}`.toLowerCase().includes(n)).slice(0, 6);
  }, [q, patients]);
  const chosen = pid ? patients.find((p) => p.id === pid) : null;
  const submit = () => {
    setErr("");
    let patientId = pid;
    if (mode === "new") {
      if (!np.first.trim() || !np.last.trim()) return setErr("Enter the patient's first and last name.");
      if (!np.dob || Number.isNaN(Date.parse(np.dob)) || Date.parse(np.dob) > Date.now()) return setErr("Enter a valid date of birth.");
    } else if (!patientId) return setErr("Search for the patient, or create a new record.");
    if (!cc.trim()) return setErr("Enter the reason for the visit.");
    if (mode === "new") patientId = D.createPatient({ first: np.first.trim(), last: np.last.trim(), dob: np.dob, sex: np.sex, lang: np.lang }, "user").id;
    const enc = D.registerArrival({ patientId, cc: cc.trim(), source }, "user");
    const p = S.get("patients", patientId);
    toast(`${D.fullName(p)} registered and added to the triage queue`);
    onRegistered(enc.id);
  };
  const langOpts = Object.entries(D.LANGS).map(([value, label]) => ({ value, label }));
  return (
    <Modal open={open} onClose={onClose} title="Register walk-in" subtitle="Find the patient or create a record, then add the reason for the visit." wide
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={LuUserPlus} onClick={submit}>Register arrival</Button></>}>
      <div className="col gap-16">
        <Seg options={[{ value: "search", label: "Existing patient" }, { value: "new", label: "New patient" }]} value={mode} onChange={(v) => { setMode(v); setErr(""); }} />
        {mode === "search" ? (
          chosen ? (
            <div className="ed-pick-row on" style={{ cursor: "default" }}>
              <Avatar name={D.fullName(chosen)} size={30} />
              <span className="grow"><span className="w6">{D.fullName(chosen)}</span> <span className="t-xs c-3 num">{D.ageOf(chosen.dob)}{chosen.sex} · {chosen.mrn} · DOB {chosen.dob}</span></span>
              <Button size="sm" variant="ghost" onClick={() => setPid(null)}>Change</Button>
            </div>
          ) : (
            <div>
              <label className="ed-search" style={{ width: "100%" }}><LuSearch /><input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Search by name or MRN" aria-label="Search patients" /></label>
              <div className="ed-pick mt8">
                {results.map((p) => {
                  const act = activeByP.get(p.id);
                  return (
                    <button key={p.id} type="button" className="ed-pick-row" disabled={!!act} onClick={() => setPid(p.id)}>
                      <Avatar name={D.fullName(p)} size={30} />
                      <span className="grow" style={{ minWidth: 0 }}><span className="w6">{D.fullName(p)}</span> <span className="t-xs c-3 num">{D.ageOf(p.dob)}{p.sex} · {p.mrn} · DOB {p.dob}</span></span>
                      {act ? <Badge tone="warn">Already in the ED: {D.STATUS_LABEL[act.status].toLowerCase()}</Badge> : <span className="t-xs c-brand w5">Select</span>}
                    </button>
                  );
                })}
                {q.trim().length >= 2 && !results.length ? <div className="t-sm c-3">No match for "{q}". <button type="button" className="ed-link" onClick={() => { const [first, ...rest] = q.trim().split(/\s+/); setNp({ ...BLANK, first: first || "", last: rest.join(" ") }); setMode("new"); }}>Create a new patient</button></div> : null}
                {q.trim().length < 2 ? <div className="t-xs c-3">Type at least 2 letters.</div> : null}
              </div>
            </div>
          )
        ) : (
          <div className="grid g2">
            <Field label="First name"><Input value={np.first} onChange={(ev) => setNp({ ...np, first: ev.target.value })} autoFocus /></Field>
            <Field label="Last name"><Input value={np.last} onChange={(ev) => setNp({ ...np, last: ev.target.value })} /></Field>
            <Field label="Date of birth"><Input type="date" value={np.dob} max={D.todayKey()} onChange={(ev) => setNp({ ...np, dob: ev.target.value })} /></Field>
            <Group label="Sex"><Seg options={[{ value: "F", label: "Female" }, { value: "M", label: "Male" }]} value={np.sex} onChange={(v) => setNp({ ...np, sex: v })} /></Group>
            <Field label="Preferred language" style={{ gridColumn: "1 / -1" }}><Select value={np.lang} onChange={(ev) => setNp({ ...np, lang: ev.target.value })} options={langOpts} /></Field>
          </div>
        )}
        <div className="divider" style={{ margin: 0 }} />
        <div className="grid g2">
          <Field label="Reason for visit" hint="In the patient's words, any language." style={{ gridColumn: "1 / -1" }}>
            <Textarea rows={2} value={cc} onChange={(ev) => setCc(ev.target.value)} placeholder="e.g. Chest pain since this morning" dir="auto" />
          </Field>
          <Group label="Arrived by"><Seg options={[{ value: "walk-in", label: "Walk-in" }, { value: "ambulance", label: "Ambulance" }]} value={source} onChange={setSource} /></Group>
        </div>
        {err ? <div className="t-sm c-bad" role="alert">{err}</div> : null}
      </div>
    </Modal>
  );
}
