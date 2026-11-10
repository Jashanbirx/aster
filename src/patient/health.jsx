// Health: the patient's record — editable allergies, medications, conditions,
// labs, wearable trends, language and coverage.
import React, { useState } from "react";
import { LuFlaskConical, LuSparkles, LuHeartPulse, LuMoon, LuFootprints, LuPlus, LuX, LuLanguages, LuShieldCheck, LuStethoscope, LuPill, LuTriangleAlert, LuUserRound, LuRepeat } from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import { Sparkline, toast, cx } from "../ui/index.jsx";
import { usePA, PButton, Sheet, Section, TagInput } from "./ui.jsx";

export const ALLERGY_SUGG = ["Penicillin", "Sulfa", "Codeine", "Latex", "Peanuts", "Iodine contrast"];
export const COND_SUGG = ["Asthma", "High blood pressure", "Type 2 diabetes", "Hypothyroidism", "Depression", "Migraine"];

export function setLang(p, lang) {
  D.updatePatient(p.id, { lang }, "patient");
  const th = D.threadFor(p.id); if (th) S.patch("threads", th.id, { lang });
  toast(`Language set to ${D.LANGS[lang]}`);
}

export default function Health() {
  const { patient: p, ask, openSettings } = usePA();
  const [medSheet, setMedSheet] = useState(false);
  const age = D.ageOf(p.dob);
  const upd = (partial, what) => { D.updatePatient(p.id, partial, "patient"); toast(`${what} updated`); };
  const w = p.wearable;
  const avg = (a) => (a && a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

  return <div className="pa-scroll">
    <div className="pa-card pa-id">
      <span className="pa-id-av" aria-hidden="true">{D.initials(D.fullName(p))}</span>
      <div className="grow">
        <div className="pa-h2">{D.fullName(p)}</div>
        <div className="pa-sub">{age != null ? `${age} years` : "Age not set"} · {p.sex === "F" ? "Female" : p.sex === "M" ? "Male" : "Sex not set"} · {D.LANGS[p.lang] || "English"}</div>
      </div>
      <button type="button" className="pa-iconbtn" onClick={openSettings} aria-label="Settings and switch profile"><LuRepeat /></button>
    </div>
    <div className="pa-cover mt12">
      <div className="pa-cover-item"><LuShieldCheck aria-hidden="true" /><div><div className="pa-stat-l">RAMQ</div><div className="pa-stat-v num">{p.ramq || "Not added"}</div></div></div>
      <div className="pa-cover-item"><LuStethoscope aria-hidden="true" /><div><div className="pa-stat-l">Family doctor</div><div className="pa-stat-v">{p.familyDoctor || "On the GAP waitlist"}</div></div></div>
    </div>
    {!p.familyDoctor ? <p className="pa-fine mt8">Québec's GAP (Guichet d'accès à la première ligne) matches you with a family doctor. Until then, Aster and its physicians are here for you.</p> : null}

    <Section title="Allergies">
      <div className="pa-card"><TagInput hideLabel id="pa-h-allergies" label="Allergies" values={p.allergies || []} onChange={(v) => upd({ allergies: v }, "Allergies")} placeholder="Add an allergy" suggestions={ALLERGY_SUGG} />
        {!(p.allergies || []).length ? <p className="pa-fine mt8">No known allergies. Add any drug or food allergy so Aster never suggests it.</p> : null}</div>
    </Section>

    <Section title="Medications" action={<PButton variant="ghost" className="sm" icon={LuPlus} onClick={() => setMedSheet(true)}>Add</PButton>}>
      <div className="pa-card flush">
        {(p.meds || []).length ? (p.meds || []).map((m, i) => <div key={m.name + i} className="pa-med">
          <span className="pa-tile sm warm"><LuPill aria-hidden="true" /></span>
          <div className="grow"><div className="w6">{m.name}</div>{m.dose ? <div className="pa-sub">{m.dose}</div> : null}</div>
          <button type="button" className="pa-iconbtn" aria-label={`Remove ${m.name}`} onClick={() => upd({ meds: p.meds.filter((_, j) => j !== i) }, "Medications")}><LuX /></button>
        </div>) : <div className="pa-pad pa-sub">No medications listed. Add what you take, including vitamins.</div>}
      </div>
    </Section>

    <Section title="Conditions">
      <div className="pa-card"><TagInput hideLabel id="pa-h-cond" label="Conditions" values={p.conditions || []} onChange={(v) => upd({ conditions: v }, "Conditions")} placeholder="Add a condition" suggestions={COND_SUGG} /></div>
    </Section>

    <Section title="Lab results" action={(p.labs || []).length ? <PButton variant="ai" className="sm" icon={LuSparkles} onClick={() => ask("Explain my blood test results")}>Explain my labs</PButton> : null}>
      <div className="pa-card flush">
        {(p.labs || []).length ? p.labs.map((l) => <div key={l.name} className="pa-lab">
          <span className={cx("pa-lab-flag", l.ok ? "ok" : "hi")} aria-hidden="true" />
          <div className="grow"><div className="w6">{l.name}</div><div className="pa-sub">Normal range {l.ref}{l.t ? ` · ${D.fmtDate(l.t)}` : ""}</div></div>
          <div className="pa-lab-v"><b className="num">{l.value}</b><span className={l.ok ? "pa-ok" : "pa-hi"}>{l.ok ? "Normal" : <><LuTriangleAlert aria-hidden="true" />Out of range</>}</span></div>
        </div>) : <div className="pa-pad pa-sub"><LuFlaskConical aria-hidden="true" className="pa-inline-ic" />No lab results yet. When a clinic or the hospital sends results, they appear here.</div>}
      </div>
    </Section>

    {w ? <Section title="Last 7 days">
      <div className="pa-wear">
        <Wear icon={LuHeartPulse} label="Resting heart rate" value={`${Math.round(avg(w.hr))}`} unit="bpm avg" data={w.hr} color="#C2410C" />
        <Wear icon={LuMoon} label="Sleep" value={avg(w.sleep).toFixed(1)} unit="h a night" data={w.sleep} color="#4338CA" />
        <Wear icon={LuFootprints} label="Steps" value={Math.round(avg(w.steps)).toLocaleString("en-CA")} unit="a day" data={w.steps} color="#0E6B5C" />
      </div>
      <p className="pa-fine mt8">From your connected watch. Aster can use these trends when you ask about sleep, energy or your heart.</p>
    </Section> : null}

    <Section title="Language">
      <div className="pa-card"><label className="pa-field"><span className="pa-label"><LuLanguages aria-hidden="true" className="pa-inline-ic" />Aster replies in</span>
        <select className="pa-input" value={p.lang || "en"} onChange={(e) => setLang(p, e.target.value)}>{Object.entries(D.LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <p className="pa-fine mt8">You can also just write in your language. Aster answers in the language you use.</p></div>
    </Section>
    <div className="pa-center mt16"><PButton variant="ghost" icon={LuUserRound} onClick={openSettings}>Switch profile</PButton></div>

    <MedSheet open={medSheet} onClose={() => setMedSheet(false)} onAdd={(m) => { upd({ meds: [...(p.meds || []), m] }, "Medications"); setMedSheet(false); }} />
  </div>;
}

function Wear({ icon: Icon, label, value, unit, data, color }) {
  return <div className="pa-card pa-wear-tile">
    <div className="pa-wear-l"><Icon aria-hidden="true" style={{ color }} />{label}</div>
    <div className="pa-wear-v"><b className="num">{value}</b><span>{unit}</span></div>
    <Sparkline data={data} color={color} height={30} />
  </div>;
}

function MedSheet({ open, onClose, onAdd }) {
  const [name, setName] = useState(""); const [dose, setDose] = useState("");
  const add = () => { if (!name.trim()) return; onAdd({ name: name.trim(), dose: dose.trim() }); setName(""); setDose(""); };
  return <Sheet open={open} onClose={onClose} title="Add a medication" footer={<><PButton variant="ghost" onClick={onClose}>Cancel</PButton><PButton variant="primary" disabled={!name.trim()} onClick={add}>Add medication</PButton></>}>
    <label className="pa-field"><span className="pa-label">Name and strength</span><input className="pa-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Ramipril 5 mg" /></label>
    <label className="pa-field mt12"><span className="pa-label">How you take it</span><input className="pa-input" value={dose} onChange={(e) => setDose(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="For example: once a day" /></label>
  </Sheet>;
}
