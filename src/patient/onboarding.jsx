// Identity: profile picker and 3-step onboarding.
import React, { useMemo, useState } from "react";
import { LuChevronRight, LuUserPlus, LuArrowLeft, LuShieldCheck, LuLock } from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import { toast, cx } from "../ui/index.jsx";
import { PButton, TagInput, Choice, Mark } from "./ui.jsx";
import { ALLERGY_SUGG, COND_SUGG } from "./health.jsx";

export function Picker({ onPick, onCreate }) {
  const patients = S.useCollection("patients");
  const users = useMemo(() => patients.filter((p) => p.appUser).sort((a, b) => (a.first === "Jay" && a.last === "Singh" ? -1 : b.first === "Jay" && b.last === "Singh" ? 1 : D.fullName(a).localeCompare(D.fullName(b)))), [patients]);
  const jay = users.find((p) => p.first === "Jay" && p.last === "Singh");
  const others = users.filter((p) => p !== jay);
  return <div className="pa-onb pa-scroll">
    <div className="pa-hero">
      <span className="pa-hero-mark"><Mark size={30} /></span>
      <h1 className="pa-display mt20">Care that's there at 2 a.m.</h1>
      <p className="pa-sub mt8">Aster Care is a free AI doctor for Québec, 24/7. A licensed Québec physician reviews and signs every plan.</p>
    </div>
    {jay ? <button type="button" className="pa-btn primary block lg mt24" onClick={() => onPick(jay.id)}><span>Continue as {D.fullName(jay)} (demo)</span><LuChevronRight aria-hidden="true" /></button> : null}
    {others.length ? <>
      <div className="pa-label mt24">Other demo profiles</div>
      <div className="pa-card flush mt8">{others.map((p) => <button key={p.id} type="button" className="pa-person" onClick={() => onPick(p.id)}>
        <span className="pa-id-av sm" aria-hidden="true" style={{ background: D.colorFor(D.fullName(p)) }}>{D.initials(D.fullName(p))}</span>
        <span className="grow"><span className="w6">{D.fullName(p)}</span><span className="pa-sub">{D.ageOf(p.dob)} · {D.LANGS[p.lang] || p.lang}{(p.conditions || []).length ? ` · ${p.conditions[0]}` : ""}</span></span>
        <LuChevronRight aria-hidden="true" />
      </button>)}</div>
    </> : null}
    <button type="button" className="pa-btn soft block lg mt16" onClick={onCreate}><LuUserPlus aria-hidden="true" /><span>Create my profile</span></button>
    <p className="pa-fine pa-center mt16">Fictional demo. Don't enter real health information.</p>
  </div>;
}

const STEPS = ["About you", "Language", "Health basics"];
export function Onboarding({ onDone, onBack }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({ first: "", last: "", dob: "", sex: "", lang: "fr", allergies: [], meds: [], conditions: [], ramq: "" });
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const ramqClean = f.ramq.replace(/\s+/g, "").toUpperCase();
  const ramqOk = !ramqClean || /^[A-Z]{4}\d{8}$/.test(ramqClean);
  const dobOk = /^\d{4}-\d{2}-\d{2}$/.test(f.dob) && new Date(f.dob) < new Date() && new Date(f.dob).getFullYear() > 1900;
  const can = [f.first.trim() && f.last.trim() && dobOk && f.sex, !!f.lang, ramqOk][step];
  const finish = () => {
    const ramq = ramqClean ? `${ramqClean.slice(0, 4)} •••• ••${ramqClean.slice(-2)}` : null;
    const p = D.createPatient({ first: f.first.trim(), last: f.last.trim(), dob: f.dob, sex: f.sex, lang: f.lang, allergies: f.allergies, meds: f.meds.map((name) => ({ name, dose: "" })), conditions: f.conditions, ramq, appUser: true, familyDoctor: null, phone: null }, "patient");
    toast(`Welcome, ${p.first}`);
    onDone(p.id);
  };
  const next = () => { if (!can) return; if (step < 2) setStep(step + 1); else finish(); };
  return <div className="pa-onb pa-onb-form">
    <div className="pa-onb-top">
      <button type="button" className="pa-iconbtn" onClick={() => (step ? setStep(step - 1) : onBack())} aria-label="Back"><LuArrowLeft /></button>
      <div className="pa-dots" aria-label={`Step ${step + 1} of 3`}>{STEPS.map((s, i) => <span key={s} className={cx(i <= step && "on")} />)}</div>
      <span className="pa-fine">{step + 1} of 3</span>
    </div>
    <div className="pa-scroll pa-onb-body">
      <h1 className="pa-h1">{["Let's set up your profile", "Which language do you prefer?", "A few health basics"][step]}</h1>
      <p className="pa-sub mt8">{["Your physician sees this when they review your care.", "Aster replies in this language. You can change it any time.", "This keeps your care safe. Add what you know; you can edit it later."][step]}</p>
      {step === 0 ? <div className="col mt20" style={{ gap: 14 }}>
        <div className="pa-two"><label className="pa-field"><span className="pa-label">First name</span><input className="pa-input" autoComplete="given-name" value={f.first} onChange={(e) => set("first")(e.target.value)} /></label>
          <label className="pa-field"><span className="pa-label">Last name</span><input className="pa-input" autoComplete="family-name" value={f.last} onChange={(e) => set("last")(e.target.value)} /></label></div>
        <label className="pa-field"><span className="pa-label">Date of birth</span><input className="pa-input" type="date" max={D.todayKey()} value={f.dob} onChange={(e) => set("dob")(e.target.value)} /></label>
        <div className="pa-field"><span className="pa-label" id="pa-sex-l">Sex assigned at birth</span><Choice label="Sex assigned at birth" value={f.sex} onChange={set("sex")} cols={2} options={[{ value: "F", label: "Female" }, { value: "M", label: "Male" }]} /><span className="pa-fine">Some medical advice depends on it.</span></div>
      </div> : null}
      {step === 1 ? <div className="pa-langs mt20" role="radiogroup" aria-label="Preferred language">{Object.entries(D.LANGS).map(([k, v]) => <button key={k} type="button" role="radio" aria-checked={f.lang === k} className={cx("pa-lang", f.lang === k && "on")} onClick={() => set("lang")(k)}><span>{v}</span><span className="pa-radio" aria-hidden="true" /></button>)}</div> : null}
      {step === 2 ? <div className="col mt20" style={{ gap: 16 }}>
        <TagInput id="pa-o-all" label="Allergies" values={f.allergies} onChange={set("allergies")} placeholder="Type and press Enter" suggestions={ALLERGY_SUGG} />
        <TagInput id="pa-o-med" label="Medications" values={f.meds} onChange={set("meds")} placeholder="For example: Ramipril 5 mg" suggestions={[]} />
        <TagInput id="pa-o-cond" label="Conditions" values={f.conditions} onChange={set("conditions")} placeholder="Type and press Enter" suggestions={COND_SUGG} />
        <label className="pa-field"><span className="pa-label"><LuShieldCheck aria-hidden="true" className="pa-inline-ic" />RAMQ number (optional)</span>
          <input className="pa-input num" value={f.ramq} maxLength={14} placeholder="ABCD 1234 5678" autoComplete="off" onChange={(e) => set("ramq")(e.target.value)} aria-invalid={!ramqOk} />
          <span className={cx("pa-fine", !ramqOk && "pa-err")}>{ramqOk ? <><LuLock aria-hidden="true" className="pa-inline-ic" />Only a masked copy is kept, like ABCD •••• ••78.</> : "A RAMQ number is 4 letters then 8 numbers. Check your card, or leave it empty."}</span></label>
      </div> : null}
    </div>
    <div className="pa-onb-foot"><PButton variant="primary" block className="lg" disabled={!can} onClick={next}>{step < 2 ? "Continue" : "Create my profile"}</PButton></div>
  </div>;
}
