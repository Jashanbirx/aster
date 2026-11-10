// Ambient scribe: visit conversation → bilingual SOAP note, suggested orders,
// RAMQ billing guidance. The physician edits, places orders and signs.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  LuMic, LuMicOff, LuPlay, LuSquare, LuClipboardPaste, LuEraser, LuSparkles, LuSignature, LuPencil, LuEye,
  LuListPlus, LuReceipt, LuClock, LuExternalLink, LuSearch, LuFastForward, LuCircleCheck,
} from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import * as AI from "../lib/ai.js";
import { openChart } from "../lib/ui-state.js";
import { Button, Badge, Panel, PageHead, Field, Input, Textarea, Select, Seg, toast, Typing, Empty, AiLabel, Markdown, cx } from "../ui/index.jsx";
import { Ctas, StatusBadge } from "../ui/clinical.jsx";
import { DEMO_TRANSCRIPTS, parseTranscript, buildNote, extractOrders, billingGuidance } from "./clinical-lib.js";
import "./clinical.css";

const ORDER_TYPES = ["lab", "imaging", "med", "nursing", "consult"];
const wordCount = (s = "") => (String(s).trim().match(/\S+/g) || []).length;
const TYPE_LABEL = { lab: "Lab", imaging: "Imaging", med: "Medication", nursing: "Nursing", consult: "Consult" };

export default function Scribe() {
  const encounters = S.useCollection("encounters");
  const patients = S.useCollection("patients");
  const pById = useMemo(() => new Map(patients.map((p) => [p.id, p])), [patients]);
  const active = useMemo(() => {
    const rank = (e) => (e.status === "in_treatment" ? 0 : e.status === "awaiting_results" ? 1 : e.status === "decision" ? 2 : e.status === "waiting_md" ? 3 : e.status === "boarding" ? 4 : D.isInpatient(e) ? 6 : 5);
    return encounters.filter((e) => (D.isEdActive(e) && !["arriving", "waiting_triage"].includes(e.status)) || D.isInpatient(e))
      .sort((a, b) => rank(a) - rank(b) || (a.arrivalAt || 0) - (b.arrivalAt || 0));
  }, [encounters]);
  const [encId, setEncId] = useState(null);
  const [q, setQ] = useState("");
  const enc = encounters.find((e) => e.id === encId) || active[0] || null;
  const patient = enc ? pById.get(enc.patientId) : null;

  const label = (e) => { const p = pById.get(e.patientId); return `${p ? D.fullName(p) : "Unknown"} · ${p ? D.ageOf(p.dob) + p.sex : ""} · ${e.kind === "IP" || D.isInpatient(e) ? `Inpatient ${e.unit || ""}` : D.STATUS_LABEL[e.status]} · ${e.cc}`; };
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const res = ql ? active.filter((e) => label(e).toLowerCase().includes(ql) || (S.get("beds", e.bedId)?.label || "").toLowerCase().includes(ql)) : active;
    return enc && !res.some((e) => e.id === enc.id) ? [enc, ...res] : res;
  }, [active, q, enc, pById]);

  // transcript & playback
  const [transcript, setTranscript] = useState("");
  const [editing, setEditing] = useState(false);
  const [playing, setPlaying] = useState(null); // demo key
  const [lang, setLang] = useState("en");
  const timer = useRef(null);
  const target = useRef("");
  const linesRef = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);
  useEffect(() => { if (playing && linesRef.current) linesRef.current.scrollTop = linesRef.current.scrollHeight; }, [transcript, playing]);
  function play(key) {
    clearInterval(timer.current);
    const demo = DEMO_TRANSCRIPTS[key];
    if (!encId) { // nobody picked an encounter yet: pick a patient whose complaint fits the sample visit
      const re = key === "en" ? /abdo|right lower|rlq|appendic/i : /copd|mpoc|short(ness)? of breath|dyspn/i;
      const m = active.find((e) => D.isEdActive(e) && re.test(e.cc || ""));
      if (m) setEncId(m.id);
    }
    target.current = demo.text; setLang(demo.lang); setEditing(false); setTranscript(""); setPlaying(key); resetNote();
    let i = 0;
    timer.current = setInterval(() => {
      i = Math.min(target.current.length, i + 3);
      setTranscript(target.current.slice(0, i));
      if (i >= target.current.length) { clearInterval(timer.current); setPlaying(null); }
    }, 18);
  }
  function stopPlay(finish = true) { clearInterval(timer.current); if (finish) setTranscript(target.current); setPlaying(null); }

  // note generation
  const [gen, setGen] = useState(null); // {status:'streaming'|'done', note, orders, billing, source, encId}
  const [noteEdit, setNoteEdit] = useState(false);
  const [checked, setChecked] = useState({});
  const [placed, setPlaced] = useState({});
  const [signed, setSigned] = useState(null);
  function resetNote() { setGen(null); setNoteEdit(false); setChecked({}); setPlaced({}); setSigned(null); }
  useEffect(() => { resetNote(); }, [enc?.id]);

  async function generate() {
    if (!enc || !transcript.trim()) return;
    if (playing) stopPlay(true);
    const text = playing ? target.current : transcript;
    setNoteEdit(false); setSigned(null); setPlaced({});
    setGen({ status: "streaming", note: "", orders: null, billing: null, source: null, encId: enc.id });
    const facts = patient ? { age: D.ageOf(patient.dob), sex: patient.sex, allergies: patient.allergies || [], meds: (patient.meds || []).map((m) => m.name), conditions: patient.conditions || [] } : {};
    const fr = lang === "fr";
    const prompt = `You are the ambient clinical scribe at Hôpital St-Laurent (Québec). Write the physician's note from the visit transcript below.
Note language: ${fr ? "Québec French (standard Québec medical terms)" : "English"}.
Patient on file: ${JSON.stringify(facts)}. Encounter: ${enc.kind === "IP" || D.isInpatient(enc) ? "inpatient" : "emergency department"}, chief complaint "${enc.cc}".
Format: Markdown. Use exactly these level-2 headings, in order: ${fr ? "## Subjectif, ## Objectif, ## Évaluation, ## Plan, ## Résumé pour le patient" : "## Subjective, ## Objective, ## Assessment, ## Plan, ## Patient-friendly summary"}.
Rules: bullets under each heading. Every bullet under ${fr ? "Évaluation and Plan" : "Assessment and Plan"} must end with a short verbatim quote from the transcript in square brackets as evidence, like ["quote"]. Never invent findings, vitals, doses or history that are not in the transcript; write "${fr ? "non documenté" : "not documented"}" when something is missing. The patient-friendly summary is 2 to 4 plain sentences at a grade 6 reading level. No preamble, no closing remarks.

Transcript:
"""
${text}
"""`;
    const streamed = await AI.text(prompt, { onText: (s) => setGen((g) => (g && g.status === "streaming" ? { ...g, note: s } : g)) });
    let note, orders, billing, source;
    if (streamed) {
      note = streamed.trim(); source = "ai";
      setGen((g) => ({ ...g, note, status: "extracting" }));
      const j = await AI.json(`From this visit transcript and the signed-off draft note, list (1) the orders the clinician said they would place, and (2) RAMQ billing guidance for the physician.
Orders: only what the clinician stated or clearly committed to. "type" is one of lab, imaging, med, nursing, consult. "why" is under 8 words. "quote" is a short verbatim phrase from the transcript.
Billing: describe the likely RAMQ act categories in plain words (for example: ED examination level, evening/night/weekend supplement, consultation request, what is not separately billable). Do NOT output any billing code numbers. 2 to 5 items.
Encounter: ${enc.kind}, seen at ${D.fmtClock(Date.now())}.
Transcript:
"""
${text}
"""
Note:
"""
${note}
"""`, { shape: '{"orders":[{"name":"CT abdomen/pelvis","type":"imaging","why":"...","quote":"..."}],"billing":[{"category":"...","detail":"..."}]}' });
      orders = Array.isArray(j?.orders) ? j.orders.filter((o) => o && o.name).map((o) => ({ name: String(o.name), type: ORDER_TYPES.includes(o.type) ? o.type : undefined, why: o.why || "", quote: o.quote || "" })) : extractOrders(text, lang);
      billing = Array.isArray(j?.billing) ? j.billing.filter((b) => b && (b.category || b.detail)).map((b) => ({ category: String(b.category || "Billing"), detail: String(b.detail || "").replace(/\b\d{4,5}\b/g, "(see RAMQ manual)") })) : billingGuidance({ encounter: enc, transcript: text, orders });
    } else {
      source = "rules";
      note = buildNote(text, { lang, patient });
      orders = extractOrders(text, lang);
      billing = billingGuidance({ encounter: enc, transcript: text, orders });
      // reveal the deterministic note quickly so the change is visible
      await new Promise((resolve) => { let i = 0; const iv = setInterval(() => { i = Math.min(note.length, i + Math.ceil(note.length / 24)); setGen((g) => ({ ...g, note: note.slice(0, i) })); if (i >= note.length) { clearInterval(iv); resolve(); } }, 30); });
    }
    const existing = new Set((S.get("encounters", enc.id)?.orders || []).filter((o) => o.status !== "cancelled").map((o) => o.name.toLowerCase()));
    const ch = {}; orders.forEach((o, i) => { ch[i] = !existing.has(o.name.toLowerCase()); });
    setChecked(ch);
    setGen({ status: "done", note, orders, billing, source, encId: enc.id });
    S.audit("agent:Ambient Scribe", "Drafted note", `${patient ? D.fullName(patient) : "Patient"}: ${wordCount(note)} words, ${orders.length} suggested orders (${source === "ai" ? "AI" : "offline rules"})`, { encounterId: enc.id });
  }

  function placeOrders() {
    if (!gen || !enc) return;
    const sel = gen.orders.map((o, i) => [o, i]).filter(([, i]) => checked[i] && !placed[i]);
    sel.forEach(([o]) => D.addOrder(enc.id, { name: o.name, type: o.type }, "user"));
    const np = { ...placed }; sel.forEach(([, i]) => { np[i] = true; });
    setPlaced(np);
    toast(`Placed ${sel.length} order${sel.length === 1 ? "" : "s"} for ${patient ? D.fullName(patient) : "the patient"}`);
  }
  function sign() {
    if (!gen || !enc) return;
    const n = D.addNote(enc.id, { kind: "scribe", text: gen.note, author: enc.md || "Physician", signed: true, source: "ambient-scribe" }, "user");
    setSigned({ t: Date.now(), by: enc.md || "Physician", id: n?.id });
    setNoteEdit(false);
    toast(`Note signed and filed to ${patient ? D.fullName(patient) + "'s" : "the"} chart`);
  }

  const lines = parseTranscript(transcript);
  const twords = wordCount(transcript);
  const nwords = gen ? wordCount(gen.note) : 0;
  const savedMin = Math.max(1, Math.round(nwords / 40));
  const existingOrders = new Set((enc?.orders || []).filter((o) => o.status !== "cancelled").map((o) => o.name.toLowerCase()));
  const selCount = gen?.orders ? gen.orders.filter((o, i) => checked[i] && !placed[i] && !existingOrders.has(o.name.toLowerCase())).length : 0;
  const busy = gen && gen.status !== "done";
  const scribeNotes = (enc?.notes || []).filter((n) => n.kind === "scribe").length;

  return (
    <div>
      <PageHead title="Ambient scribe" subtitle="Turns the visit conversation into a bilingual SOAP note with evidence, suggested orders and RAMQ billing guidance. The physician edits and signs." />

      <Panel>
        <div className="row wrap" style={{ gap: 14, alignItems: "flex-end" }}>
          <Field label="Search encounters" style={{ flex: "1 1 200px", minWidth: 0 }}>
            <div style={{ position: "relative" }}>
              <LuSearch size={15} style={{ position: "absolute", left: 10, top: 11, color: "var(--ink-3)" }} />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, complaint or bed" style={{ paddingLeft: 32 }} />
            </div>
          </Field>
          <Field label={`Encounter (${filtered.length})`} style={{ flex: "3 1 320px", minWidth: 0 }}>
            <Select value={enc?.id || ""} onChange={(e) => setEncId(e.target.value)} options={filtered.length ? filtered.map((e) => ({ value: e.id, label: label(e) })) : [{ value: "", label: "No active encounters" }]} />
          </Field>
          <div className="field"><span className="label">Note language</span><Seg value={lang} onChange={setLang} options={[{ value: "en", label: "English" }, { value: "fr", label: "Français" }]} /></div>
        </div>
        {enc && patient ? (
          <div className="row wrap mt12" style={{ gap: 10 }}>
            {enc.ctas ? <Ctas level={enc.ctas} /> : null}
            <span className="w6">{D.fullName(patient)}</span><span className="t-xs c-3 num">{D.ageOf(patient.dob)}{patient.sex} · {D.LANGS[patient.lang] || patient.lang}</span>
            <StatusBadge status={enc.status} />
            <span className="t-sm c-2 ellipsis" style={{ maxWidth: 360 }}>{enc.cc}</span>
            {(patient.allergies || []).map((a) => <Badge key={a} tone="bad">Allergy: {a}</Badge>)}
            <span className="grow" />
            <span className="t-xs c-3">{enc.md || "No physician yet"}{scribeNotes ? ` · ${scribeNotes} scribe note${scribeNotes > 1 ? "s" : ""} signed` : ""}</span>
            <Button size="sm" variant="ghost" icon={LuExternalLink} onClick={() => openChart(enc.id, "notes")}>Open chart</Button>
          </div>
        ) : null}
      </Panel>

      <div className="cl-scribe mt16">
        <Panel title="Visit transcript" icon={LuMic} subtitle={twords ? `${lines.length} turns · ${twords} words` : "Play a sample visit or paste a transcript"}
          actions={playing ? <Button size="sm" icon={LuFastForward} onClick={() => stopPlay(true)}>Skip to end</Button> : <Button size="sm" variant="ghost" icon={editing ? LuEye : LuClipboardPaste} onClick={() => { stopPlay(false); setEditing(!editing); }}>{editing ? "Done" : "Paste or edit"}</Button>}>
          <div className="row wrap" style={{ gap: 8 }}>
            <Button size="sm" icon={playing === "en" ? LuSquare : LuPlay} onClick={() => (playing === "en" ? stopPlay(false) : play("en"))}>{playing === "en" ? "Stop" : "Play English ED visit"}</Button>
            <Button size="sm" icon={playing === "fr" ? LuSquare : LuPlay} onClick={() => (playing === "fr" ? stopPlay(false) : play("fr"))}>{playing === "fr" ? "Arrêter" : "Jouer la visite en français"}</Button>
            {transcript && !playing ? <Button size="sm" variant="ghost" icon={LuEraser} onClick={() => { setTranscript(""); resetNote(); }}>Clear</Button> : null}
          </div>
          <div className="cl-honest mt8"><LuMicOff />The microphone isn't used in this demo: transcripts are played back or pasted.</div>
          <div className="mt12">
            {editing ? (
              <Textarea aria-label="Transcript" rows={16} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder={"Dr: What brings you in today?\nPatient: I've had chest pain since this morning…\n\nOne turn per line, with the speaker before a colon."} />
            ) : lines.length ? (
              <div className="cl-lines" ref={linesRef} aria-live="polite">
                {lines.map((l, i) => (
                  <div key={i} className="cl-line">
                    <span className={cx("cl-spk", l.role)}>{l.speaker}</span>
                    <span>{l.text}{playing && i === lines.length - 1 ? <span className="cl-caret" /> : null}</span>
                  </div>
                ))}
              </div>
            ) : <Empty icon={LuMic} title="No transcript yet">Play one of the sample visits above, or choose "Paste or edit" to bring your own.</Empty>}
          </div>
          <div className="row wrap mt16" style={{ borderTop: "1px solid var(--line)", paddingTop: 12 }}>
            <span className="t-xs c-3 grow">The note is written in {lang === "fr" ? "French" : "English"} whatever language the visit was in.</span>
            <Button variant="ai" icon={LuSparkles} loading={busy} disabled={!enc || !transcript.trim()} onClick={generate}>{gen ? "Regenerate note" : "Generate note"}</Button>
          </div>
        </Panel>

        <div className="col" style={{ gap: 14, minWidth: 0 }}>
          <Panel title="Draft note" subtitle={gen ? (gen.status === "done" ? `${nwords} words · SOAP` : "Writing…") : "SOAP note with evidence from the transcript"}
            actions={gen && gen.status === "done" && !signed ? <Button size="sm" variant="ghost" icon={noteEdit ? LuEye : LuPencil} onClick={() => setNoteEdit(!noteEdit)}>{noteEdit ? "Preview" : "Edit note"}</Button> : signed ? <Badge tone="ok" icon={LuCircleCheck}>Signed</Badge> : null}>
            {!gen ? <Empty icon={LuSparkles} title="No draft yet">Generate a note from the transcript. Every assessment and plan line cites what was said.</Empty> : (
              <div className="col" style={{ gap: 12 }}>
                <div className="row"><AiLabel>Ambient scribe</AiLabel>{busy ? <Typing /> : null}<span className="grow" />{gen.status === "done" ? <span className="t-xs c-3">Review before signing</span> : null}</div>
                {noteEdit ? <Textarea aria-label="Note text" rows={22} value={gen.note} onChange={(e) => setGen({ ...gen, note: e.target.value })} />
                  : <div className="cl-note"><Markdown text={gen.note} /></div>}
                {gen.status === "done" ? (
                  <div className="cl-actions">
                    <div className="cl-saved">
                      <div className="cl-stat"><b className="num">~{savedMin} min</b><span>typing saved (at 40 wpm)</span></div>
                      <div className="cl-stat"><b className="num">{twords}</b><span>transcript words</span></div>
                    </div>
                    <span className="grow" />
                    {signed ? <span className="t-sm c-2">Signed by {signed.by} at {D.fmtClock(signed.t)}</span>
                      : <Button variant="primary" icon={LuSignature} onClick={sign} disabled={!gen.note.trim()}>Sign note</Button>}
                  </div>
                ) : null}
              </div>
            )}
          </Panel>

          {gen && gen.status === "done" ? (
            <>
              <Panel title="Suggested orders" icon={LuListPlus} subtitle="From what the physician said. Nothing is ordered until you place it."
                actions={<Button size="sm" variant="primary" disabled={!selCount} onClick={placeOrders}>Place {selCount || ""} selected order{selCount === 1 ? "" : "s"}</Button>}>
                {!gen.orders.length ? <div className="t-sm c-3">No orders were mentioned in the transcript.</div> : gen.orders.map((o, i) => {
                  const done = placed[i] || existingOrders.has(o.name.toLowerCase());
                  return (
                    <label key={i} className="cl-order">
                      <input type="checkbox" checked={done || !!checked[i]} disabled={done} onChange={(e) => setChecked({ ...checked, [i]: e.target.checked })} />
                      <span className="grow">
                        <span className="row wrap" style={{ gap: 6 }}><span className="w5 t-sm">{o.name}</span><Badge>{TYPE_LABEL[o.type] || "Order"}</Badge>{done ? <Badge tone="ok">{placed[i] ? "Placed" : "Already ordered"}</Badge> : null}</span>
                        <span className="t-xs c-3">{o.why}{o.quote ? <> · <em>“{o.quote}”</em></> : null}</span>
                      </span>
                    </label>
                  );
                })}
              </Panel>
              <Panel title="RAMQ billing guidance" icon={LuReceipt} subtitle="Act categories only. Aster never generates billing codes.">
                <div className="col" style={{ gap: 10 }}>
                  {gen.billing.map((b, i) => <div key={i}><div className="t-sm w6">{b.category}</div><div className="t-sm c-2">{b.detail}</div></div>)}
                  <div className="t-xs c-3">Confirm act codes and supplements in the current RAMQ physician manual for your agreement (FMOQ or FMSQ).</div>
                </div>
              </Panel>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
