// Referrals & fax: Québec still runs on fax. Aster reads each one, fills the
// referral form and routes it to booking or the right team.
import React, { useEffect, useMemo, useState } from "react";
import {
  LuInbox, LuPlus, LuSparkles, LuImage, LuFileText, LuChevronLeft, LuX, LuCalendarCheck, LuSend, LuTriangleAlert,
  LuCircleCheck, LuSave, LuUserCheck, LuUserPlus,
} from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import * as AI from "../lib/ai.js";
import { Button, Badge, Panel, PageHead, Field, Input, Textarea, Select, Tabs, Modal, toast, Typing, Empty, AiLabel, useNow, cx } from "../ui/index.jsx";
import { REFERRAL_FIELDS, PRIORITY, parseReferral, normaliseExtraction, missingFields, nextActionFor, findPatient, langCode, fold } from "./clinical-lib.js";
import "./clinical.css";

const STATUS = { new: { tone: "info", label: "New" }, extracted: { tone: "ai", label: "Extracted" }, booked: { tone: "ok", label: "Booked" }, declined: { tone: "", label: "Declined" } };
const SHAPE = '{"patient_name":"","dob":"YYYY-MM-DD","health_card":"ABCD •••• ••12","sex":"F|M","language":"","referral_type":"Specialist consultation|Pharmacy clarification|Home care coordination|Primary care follow-up","specialty":"","reason":"","urgency":"B: within 10 days","referring_clinician":"","contact":"","allergies":"","medications":"","missing_fields":["dob"],"next_action":""}';
const SAMPLE = {
  from: "Urgence Verdun (fax)",
  raw: "Request for follow-up visit\nPatient: Olivier Gagnon, DOB 1987-11-05, M\nRAMQ: GAGO 8711 0512\nReason: wound check and suture removal in 7 to 10 days after repair of a 4 cm forearm laceration. No family doctor.\nPriority: routine\nAllergies: none known. Meds: none.\nContact: Inf. J. Roy, 514-555-0177",
};

function extractPrompt(raw, from) {
  return `Extract the referral from this fax received by Hôpital St-Laurent (Québec). Sender: ${from || "unknown"}.
Rules: copy values exactly as written; leave a field as "" when it is not in the fax (never guess). health_card: mask it as the first 4 letters, then "•••• ••" and the last 2 digits. urgency: for specialist referrals use the Québec priority letter with its meaning (A: within 3 days, B: within 10 days, C: within 28 days, D: within 3 months, E: within 12 months); otherwise describe the timeframe. referral_type: one of Specialist consultation, Pharmacy clarification, Home care coordination, Primary care follow-up. missing_fields: required fields that are absent. next_action: one sentence saying who should do what.
Fax text:
"""
${raw}
"""`;
}

function routesFor(x, clinics) {
  const t = fold(x.referral_type || "");
  const pr = (String(x.urgency || "").match(/\b([A-E])\b/) || [])[1];
  const name = x.patient_name || "the patient";
  const out = [];
  const slotRoutes = clinics.map((c) => { const s = D.openSlots(c).sort((a, b) => a.t - b.t)[0]; return s ? { key: `slot-${c.id}`, kind: "slot", clinicId: c.id, slotId: s.id, t: s.t, clinicName: c.name, label: `Book ${c.name}, ${D.fmtClock(s.t)} (${c.kind})`, short: `book ${c.name} at ${D.fmtClock(s.t)}` } : null; }).filter(Boolean);
  const task = (role, title, priority, dueMin, short) => ({ key: `task-${role}`, kind: "task", role, title, priority, dueMin, label: `Task for ${role}: ${title}`, short });
  if (/pharm/.test(t)) out.push(task("MD", `Answer pharmacy clarification for ${name}`, "high", 60, "send to a physician"));
  else if (/home|clsc|domicile/.test(t)) out.push(task("Social work", `Coordinate CLSC home care${x.patient_name ? ` for ${name}` : ""}`, "normal", 240, "send to social work"));
  else if (/primary|follow/.test(t)) {
    const kindOf = (r) => clinics.find((c) => c.id === r.clinicId)?.kind || "";
    const score = (r) => (/nurse/i.test(kindOf(r)) ? 0 : /walk-in/i.test(kindOf(r)) ? 1 : /gmf/i.test(kindOf(r)) ? 2 : 9);
    const pref = slotRoutes.filter((r) => score(r) < 9).sort((a, b) => score(a) - score(b));
    out.push(...(pref.length ? pref : slotRoutes));
  } else out.push(task("Clerk", `Book ${x.specialty || "specialty"} consult for ${name}${pr ? ` (priority ${pr})` : ""}`, pr === "A" || pr === "B" ? "high" : "normal", pr === "A" ? 120 : pr === "B" ? 240 : 1440, `ask the clerk to book ${x.specialty || "the specialty clinic"}`));
  for (const r of [...slotRoutes, task("Clerk", `Book ${x.specialty || "follow-up"} for ${name}`, "normal", 1440, "ask the clerk to book"), task("MD", `Review referral for ${name}`, "normal", 240, "send to a physician"), task("Social work", `Follow up referral for ${name}`, "normal", 240, "send to social work")]) if (!out.some((o) => o.key === r.key)) out.push(r);
  return out;
}

export default function Referrals() {
  useNow();
  const referrals = S.useCollection("referrals");
  const [tab, setTab] = useState("open");
  const [selId, setSelId] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [adding, setAdding] = useState(false);
  const rank = { new: 0, extracted: 1, booked: 2, declined: 3 };
  const open = useMemo(() => referrals.filter((r) => r.status === "new" || r.status === "extracted").sort((a, b) => rank[a.status] - rank[b.status] || (b.receivedAt || 0) - (a.receivedAt || 0)), [referrals]);
  const closed = useMemo(() => referrals.filter((r) => r.status === "booked" || r.status === "declined").sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [referrals]);
  const list = tab === "open" ? open : closed;
  const sel = referrals.find((r) => r.id === selId) || list[0] || null;
  useEffect(() => { if (sel && selId !== sel.id && !list.some((r) => r.id === selId)) setSelId(sel.id); }, [sel?.id, selId]);

  return (
    <div>
      <PageHead title="Referrals & fax" subtitle="Referrals still arrive by fax in Québec. Aster reads each one, fills the referral form and routes it to booking or the right team."
        actions={<Button variant="primary" icon={LuPlus} onClick={() => setAdding(true)}>Add referral</Button>} />
      <div className={cx("cl-split", mobileDetail && sel && "has-detail")}>
        <Panel flush className="cl-list" title={`${open.length} to process`} subtitle={`${open.filter((r) => r.status === "new").length} unread · ${closed.length} done`}>
          <Tabs value={tab} onChange={(t) => { setTab(t); setSelId(null); }} tabs={[{ key: "open", label: "To process", count: open.length }, { key: "closed", label: "Done", count: closed.length }]} />
          <div className="cl-list-body">
            {!list.length ? <Empty icon={LuInbox} title={tab === "open" ? "Fax inbox is empty" : "Nothing processed yet"} action={tab === "open" ? <Button size="sm" icon={LuPlus} onClick={() => setAdding(true)}>Add referral</Button> : null}>{tab === "open" ? "New faxes and referral letters land here." : "Booked and declined referrals show here."}</Empty>
              : list.map((r) => (
                <button key={r.id} type="button" className={cx("cl-item", sel?.id === r.id && "on")} onClick={() => { setSelId(r.id); setMobileDetail(true); }}>
                  <div className="cl-item-top"><Badge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label || r.status}</Badge>{r.image ? <LuImage size={13} className="c-3" /> : null}<span className="grow" /><span className="t-xs c-3">{D.fmtAgo(r.receivedAt)}</span></div>
                  <div className="w6 t-sm ellipsis">{r.from}</div>
                  <div className="cl-item-title">{r.extracted?.patient_name ? `${r.extracted.patient_name} · ${r.extracted.specialty || r.extracted.referral_type}` : (r.raw || r.image || "").split("\n")[0]}</div>
                </button>
              ))}
          </div>
        </Panel>
        <div className="cl-detail">
          {sel ? <Detail key={sel.id} r={sel} onBack={() => setMobileDetail(false)} />
            : <Panel><Empty icon={LuInbox} title="Nothing selected">Pick a referral, or add one from a fax.</Empty></Panel>}
        </div>
      </div>
      <AddReferral open={adding} onClose={() => setAdding(false)} onAdded={(id) => { setTab("open"); setSelId(id); setMobileDetail(true); }} />
    </div>
  );
}

async function extractAndSave(r, raw) {
  const fallback = parseReferral(raw, r.from);
  const ai = await AI.json(extractPrompt(raw, r.from), { shape: SHAPE });
  const extracted = ai ? normaliseExtraction(ai, fallback) : fallback;
  S.patch("referrals", r.id, { raw, extracted, status: "extracted", extractedBy: ai ? "ai" : "rules", extractedAt: Date.now() });
  S.audit("agent:Referral & Fax", "Extracted referral", `${r.from}: ${extracted.patient_name || "patient not named"}, ${extracted.referral_type}${extracted.missing_fields.length ? `, missing ${extracted.missing_fields.length}` : ""}`, { referralId: r.id });
  return { extracted, ai: !!ai };
}

function Detail({ r, onBack }) {
  useNow();
  const clinics = S.useCollection("clinics");
  const patients = S.useCollection("patients");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(r.extracted || null);
  const [paste, setPaste] = useState(r.raw || "");
  const [routeKey, setRouteKey] = useState(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  useEffect(() => { if (!form && r.extracted) setForm(r.extracted); }, [r.extracted]);
  const st = STATUS[r.status] || STATUS.new;
  const done = r.status === "booked" || r.status === "declined";

  async function extract() {
    const raw = (r.raw || paste).trim();
    if (!raw) { toast("Paste the fax text first, then extract.", { kind: "bad" }); return; }
    setBusy(true);
    const { extracted, ai } = await extractAndSave(r, raw);
    setForm(extracted); setRouteKey(null); setBusy(false);
    toast(`Extracted ${REFERRAL_FIELDS.filter(([k]) => extracted[k]).length} fields${ai ? "" : " with offline rules"}${extracted.missing_fields.length ? `. ${extracted.missing_fields.length} missing` : ""}`);
  }
  const x = form || {};
  const missing = form ? missingFields(x) : [];
  const set = (k, v) => setForm({ ...x, [k]: v });
  const routes = useMemo(() => (form ? routesFor(x, clinics) : []), [form, clinics]);
  const route = routes.find((o) => o.key === routeKey) || routes[0];
  const match = form ? findPatient(patients, x.patient_name, x.dob) : null;
  const canCreate = !!(x.patient_name || "").trim();

  function save() {
    const extracted = { ...x, missing_fields: missingFields(x), next_action: nextActionFor(x) };
    S.patch("referrals", r.id, { extracted }); S.audit("user", "Edited referral fields", r.from, { referralId: r.id });
    setForm(extracted); toast("Referral fields saved");
  }

  function book() {
    if (!route) return;
    if (route.kind === "slot" && !canCreate) { toast("Add the patient's name before booking a clinic slot.", { kind: "bad" }); return; }
    let patientId = match?.id || null, created = false;
    if (!patientId && canCreate) {
      const parts = x.patient_name.trim().split(/\s+/);
      const phone = (String(x.contact).match(/\d{3}[-. ]\d{3}[-. ]\d{4}/) || [])[0] || "";
      const allergies = !x.allergies || /none|aucune/i.test(x.allergies) ? [] : x.allergies.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      const meds = !x.medications || /^none|aucun/i.test(x.medications) ? [] : x.medications.split(/[,;+]/).map((s) => s.trim()).filter(Boolean).map((m) => ({ name: m, dose: "" }));
      const p = D.createPatient({ first: parts[0], last: parts.slice(1).join(" ") || "(unknown)", sex: /^[FM]$/i.test(x.sex) ? x.sex.toUpperCase() : "", dob: x.dob || "", lang: langCode(x.language) || "fr", phone, ramq: x.health_card || "", allergies, meds, conditions: [], appUser: false, familyDoctor: null, referredBy: r.from }, "user");
      patientId = p.id; created = true;
    }
    const pr = (String(x.urgency || "").match(/\b([A-E])\b/) || [])[1];
    let booking;
    if (route.kind === "slot") {
      const appt = D.bookSlot({ clinicId: route.clinicId, slotId: route.slotId, patientId, source: "referral" }, "user");
      if (!appt) { toast("That slot was just taken. Pick another route.", { kind: "bad" }); return; }
      booking = { kind: "slot", apptId: appt.id, clinicName: route.clinicName, t: route.t, label: `${route.clinicName}, ${D.fmtDateTime(route.t)}` };
    } else {
      const detail = [`Referral from ${r.from}${x.referring_clinician ? ` (${x.referring_clinician})` : ""}.`, x.reason && `Reason: ${x.reason}`, x.urgency && `Urgency: ${x.urgency}`, x.dob && `DOB ${x.dob}`, x.health_card && `RAMQ ${x.health_card}`, x.allergies && `Allergies: ${x.allergies}`, x.medications && `Meds: ${x.medications}`, x.contact && `Contact: ${x.contact}`].filter(Boolean).join("\n");
      const t = D.createTask({ title: route.title, detail, role: route.role, priority: route.priority, dueMin: route.dueMin }, "user");
      booking = { kind: "task", taskId: t.id, role: route.role, label: route.title, due: t.due };
    }
    S.patch("referrals", r.id, { status: "booked", patientId, extracted: { ...x, missing_fields: missingFields(x) }, booking: { ...booking, at: Date.now(), by: "user", createdPatient: created, priority: pr || null } });
    S.audit("user", "Routed referral", `${r.from}: ${booking.label}`, { referralId: r.id, patientId });
    toast(`${created ? `Registered ${x.patient_name}. ` : ""}${booking.kind === "slot" ? `Booked ${booking.label}` : `Task sent to ${booking.role}`}`);
  }

  function decline() {
    S.patch("referrals", r.id, { status: "declined", declineReason: reason.trim(), declinedAt: Date.now() });
    D.createTask({ title: `Fax decline notice to ${r.from}`, detail: reason.trim(), role: "Clerk", priority: "normal" }, "user");
    S.audit("user", "Declined referral", `${r.from}: ${reason.trim()}`, { referralId: r.id });
    setDeclining(false); setReason("");
    toast("Referral declined. A clerk task was created to fax the reason back.");
  }

  return (
    <Panel>
      <div className="col" style={{ gap: 14 }}>
        <div><Button className="cl-back" size="sm" variant="ghost" icon={LuChevronLeft} onClick={onBack}>Back to inbox</Button></div>
        <div className="row top wrap" style={{ gap: 10 }}>
          <div className="grow" style={{ minWidth: 200 }}>
            <div className="row wrap" style={{ gap: 6 }}><Badge tone={st.tone}>{st.label}</Badge><span className="t-xs c-3">Received {D.fmtDateTime(r.receivedAt)} · {D.fmtAgo(r.receivedAt)}</span></div>
            <h2 className="t-h2 mt8">{r.from}</h2>
          </div>
          {!done ? <Button variant="danger" size="sm" icon={LuX} onClick={() => setDeclining(true)}>Decline</Button> : null}
        </div>

        <div className="cl-detail-grid cl-even">
          <div className="cl-section">
            {r.raw ? (
              <div className="cl-paper" aria-label="Fax text">
                <div className="cl-paper-head"><span>FAX · {r.from}</span><span>{D.fmtDateTime(r.receivedAt)} · page 1/1</span></div>
                {r.raw}
              </div>
            ) : (
              <div className="col" style={{ gap: 8 }}>
                {r.image ? <div className="well t-sm row"><LuImage size={16} className="c-3" /><span className="grow">Image received: <span className="w5">{r.image}</span>. Reading images needs Claude vision, which isn't available right now.</span></div> : null}
                <Field label="Fax text" hint="Type or paste what the fax says, then extract."><Textarea rows={10} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Patient : … DDN : … Motif : …" /></Field>
                <div><Button size="sm" icon={LuSave} disabled={!paste.trim()} onClick={() => { S.patch("referrals", r.id, { raw: paste.trim() }); S.audit("user", "Added fax text", r.from, { referralId: r.id }); toast("Fax text saved"); }}>Save text</Button></div>
              </div>
            )}
            {r.image && r.raw ? <div className="t-xs c-3 row"><LuImage size={13} /> Read from image {r.image} (the image itself isn't stored in this demo)</div> : null}
          </div>

          <div className="cl-section">
            {!form ? (
              <div className="ai-card col" style={{ gap: 10, alignItems: "flex-start" }}>
                <AiLabel>Referral & fax agent</AiLabel>
                <div className="t-sm c-2">Aster reads the fax and fills patient, reason, Québec priority (A to E), referring clinician, allergies and medications, then flags anything missing.</div>
                {busy ? <div className="row t-sm c-ai"><Typing /> Reading the fax</div> : null}
                <Button variant="ai" icon={LuSparkles} loading={busy} disabled={!(r.raw || paste).trim()} onClick={extract}>Extract with AI</Button>
              </div>
            ) : (
              <>
                <div className="row wrap">
                  <AiLabel live={false}>{r.extractedBy === "ai" ? "Extracted by AI" : "Extracted with offline rules"}</AiLabel>
                  {missing.length ? <Badge tone="warn" icon={LuTriangleAlert}>{missing.length} missing</Badge> : <Badge tone="ok" icon={LuCircleCheck}>Complete</Badge>}
                  <span className="grow" />
                  {!done ? <Button size="sm" variant="ghost" icon={LuSparkles} loading={busy} onClick={extract}>Extract again</Button> : null}
                </div>
                <div className="cl-form">
                  {REFERRAL_FIELDS.map(([k, label]) => (
                    <div key={k} className={cx(["reason", "medications"].includes(k) && "wide", missing.includes(k) && "cl-missing")}>
                      <Field label={label} hint={k === "urgency" ? urgencyHint(x.urgency) : missing.includes(k) ? "Missing: ask the sender" : null}>
                        {k === "reason" ? <Textarea rows={2} value={x[k] || ""} disabled={done} onChange={(e) => set(k, e.target.value)} style={{ minHeight: 56 }} />
                          : <Input value={x[k] || ""} disabled={done} onChange={(e) => set(k, e.target.value)} placeholder={missing.includes(k) ? "Not in the fax" : ""} />}
                      </Field>
                    </div>
                  ))}
                </div>
                {!done ? <div><Button size="sm" icon={LuSave} onClick={save}>Save changes</Button></div> : null}

                {!done ? (
                  <div className="cl-actions" style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div className="t-sm"><span className="w6">Next step: </span>{nextActionFor(x)}</div>
                    <div className="row wrap t-sm">
                      {canCreate ? (match ? <Badge tone="brand" icon={LuUserCheck}>Matches {D.fullName(match)} ({match.mrn})</Badge> : <Badge icon={LuUserPlus}>New patient: will be registered</Badge>) : <Badge tone="warn">No patient named: route without registering</Badge>}
                    </div>
                    <Field label="Route to"><Select value={route?.key || ""} onChange={(e) => setRouteKey(e.target.value)} options={routes.map((o) => ({ value: o.key, label: o.label }))} /></Field>
                    <div className="row wrap">
                      <Button variant="primary" icon={route?.kind === "slot" ? LuCalendarCheck : LuSend} disabled={!route || (route.kind === "slot" && !canCreate)} onClick={book}>
                        {canCreate && !match ? (route?.kind === "slot" ? "Create patient and book" : "Create patient and send") : route?.kind === "slot" ? "Book slot" : `Send to ${route?.role || "team"}`}
                      </Button>
                      <span className="t-xs c-3 grow">Then: {route?.short}{route?.kind === "task" ? `, due ${route.dueMin >= 1440 ? "tomorrow" : `within ${route.dueMin >= 60 ? route.dueMin / 60 + " h" : route.dueMin + " min"}`}` : ""}.</span>
                    </div>
                  </div>
                ) : null}
              </>
            )}

            {r.status === "booked" && r.booking ? (
              <div className="cl-decided">
                <div className="row wrap"><Badge tone="ok" icon={r.booking.kind === "slot" ? LuCalendarCheck : LuSend}>{r.booking.kind === "slot" ? "Booked" : `Sent to ${r.booking.role}`}</Badge><span className="t-xs c-3">{D.fmtDateTime(r.booking.at)}</span></div>
                <p className="t-sm mt8">{r.booking.label}</p>
                {r.patientId ? <p className="t-xs c-3 mt4">{r.booking.createdPatient ? "New patient registered" : "Linked to existing patient"}: {D.fullName(S.get("patients", r.patientId))} ({S.get("patients", r.patientId)?.mrn})</p> : null}
              </div>
            ) : null}
            {r.status === "declined" ? (
              <div className="cl-decided"><div className="row"><Badge>Declined</Badge><span className="t-xs c-3">{r.declinedAt ? D.fmtDateTime(r.declinedAt) : ""}</span></div><p className="t-sm mt8">{r.declineReason}</p><p className="t-xs c-3 mt4">A clerk task was created to fax the reason to the sender.</p></div>
            ) : null}
          </div>
        </div>
      </div>
      <Modal open={declining} onClose={() => setDeclining(false)} title="Decline referral" subtitle={`The reason is faxed back to ${r.from}.`}
        footer={<><Button onClick={() => setDeclining(false)}>Cancel</Button><Button variant="danger" icon={LuX} disabled={!reason.trim()} onClick={decline}>Decline and notify sender</Button></>}>
        <Field label="Reason" hint="Required. Be specific so the sender can redirect the patient."><Textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Outside our catchment area. Please refer to CISSS de la Montérégie-Centre." /></Field>
      </Modal>
    </Panel>
  );
}

function urgencyHint(u) {
  const c = (String(u || "").match(/\b([A-E])\b/) || [])[1];
  return c ? `Québec priority ${c}: ${PRIORITY[c].toLowerCase()}` : "Québec priority A (3 days) to E (12 months)";
}

function AddReferral({ open, onClose, onAdded }) {
  const [from, setFrom] = useState("");
  const [raw, setRaw] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const vision = AI.visionAvailable();
  const reset = () => { setFrom(""); setRaw(""); setFile(null); setBusy(false); };
  const close = () => { reset(); onClose(); };

  async function save() {
    const sender = from.trim() || "Unknown sender";
    if (file && vision) {
      setBusy(true);
      const v = await AI.visionJSON(`This is a photo or scan of a faxed medical referral sent to Hôpital St-Laurent (Québec). First transcribe all of its text into "raw_text" exactly as written, then extract the fields.\n${extractPrompt("(see image)", sender)}`, [file], { shape: SHAPE.replace("{", '{"raw_text":"",') });
      const text = (v?.raw_text || raw).trim();
      const id = D.addReferral({ from: sender, raw: text, image: file.name }, "user");
      if (v) {
        const extracted = normaliseExtraction(v, parseReferral(text, sender));
        S.patch("referrals", id, { extracted, status: "extracted", extractedBy: "ai", extractedAt: Date.now() });
        S.audit("agent:Referral & Fax", "Extracted referral", `${sender}: read from image ${file.name}`, { referralId: id });
        toast("Fax image read and extracted");
      } else toast(text ? "Saved. The image couldn't be read, so the pasted text was kept." : "Saved the image name. The image couldn't be read: paste the fax text to extract it.", { kind: text ? "ok" : "bad" });
      onAdded(id); close(); return;
    }
    const id = D.addReferral({ from: sender, raw: raw.trim(), image: file ? file.name : null }, "user");
    toast(raw.trim() ? "Referral added to the inbox" : "Saved the image name. Paste the fax text to extract it.");
    onAdded(id); close();
  }

  return (
    <Modal open={open} onClose={close} wide title="Add referral" subtitle="Paste the text of a fax or letter, or upload a photo of a fax."
      footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" icon={LuPlus} loading={busy} disabled={!raw.trim() && !file} onClick={save}>{file && vision ? "Read image and add" : "Add to inbox"}</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label="From"><Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Clinique médicale Rosemont (GMF)" /></Field>
        <Field label="Fax text" hint="French or English. Paste as received."><Textarea rows={8} value={raw} onChange={(e) => setRaw(e.target.value)} placeholder={"RÉFÉRENCE — Cardiologie\nPatient : …   DDN : …\nMotif : …\nPriorité : B"} /></Field>
        <div className="row wrap">
          <Button size="sm" variant="ghost" icon={LuFileText} onClick={() => { setFrom(SAMPLE.from); setRaw(SAMPLE.raw); }}>Use a sample fax</Button>
          <span className="grow" />
          <label className="btn sm" style={{ cursor: "pointer" }}><LuImage />{file ? "Change image" : "Upload fax image"}<input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => setFile(e.target.files?.[0] || null)} /></label>
        </div>
        {file ? (
          <div className={cx("cl-issue", vision ? "info" : "moderate")}>
            <LuImage /><span><span className="w5">{file.name}</span>{vision ? ": Aster will transcribe and extract it with Claude vision." : ": reading images needs Claude vision, which isn't available right now. The file name will be saved; paste the fax text above so Aster can extract it."}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
