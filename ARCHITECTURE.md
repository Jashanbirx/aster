# Aster — architecture & engineering contract

> This document was the contract used to build Aster in parallel: the lead defined the data model, actions and conventions below, and each module was implemented against it by a separate engineer (AI coding agents), then integrated and tested end to end. "Lead only" marks the shared core that module owners could not change.

Aster is an AI operating system for Canadian (Québec) hospitals plus a patient-facing AI doctor app.
Fictional demo hospital: **Hôpital St-Laurent**. It ships as a static web app (a claude.ai artifact with a realtime database, or GitHub Pages with the in-browser database).

## Stack
- React 19 (function components + hooks), bundled by esbuild (`./build.sh` → `dist/`). No other UI libs.
- Icons: `react-icons/lu` (Lucide). Import named icons only: `import { LuBed } from "react-icons/lu"`.
- Styling: `src/styles.css` holds the design system. A module may add its own CSS file next to it
  (e.g. `src/os/ed.css`, imported from the module with `import "./ed.css"`). **Prefix every class in a
  module CSS file with the module name** (`.ed-…`, `.beds-…`, `.pa-…`) so modules never collide.
- Backend: the artifact's realtime document DB (`claude.use("db")`), wrapped by `src/lib/store.js`. In local
  dev/tests it transparently uses an in-browser MemoryDB with the same interface. **Never call the db directly.**
- AI: Claude via `claude.use("sample")`, wrapped by `src/lib/ai.js`. Every AI call returns `null` when AI is
  unavailable → every AI feature MUST have a deterministic fallback so the demo never breaks.

## Files & ownership
```
src/lib/store.js      data layer (hooks + writes)            — lead only
src/lib/domain.js     clinical rules, actions, metrics, recs  — lead only (read it fully!)
src/lib/ai.js         AI wrapper                             — lead only
src/lib/seed.js       demo data                              — lead only
src/lib/sim.js        live simulation                        — lead only
src/lib/ui-state.js   routing, chart drawer, palette         — lead only
src/ui/index.jsx      UI kit (Button, Panel, Drawer, Modal, toast, charts, Markdown…) — lead only
src/ui/clinical.jsx   PatientLine, StatusBadge, WaitTime, VitalsRow, RedFlags, Ctas — lead only
src/app.jsx           shell, nav, palette, settings          — lead only
src/os/*.jsx          hospital modules (one owner each)
src/patient/*.jsx     patient app (one owner)
```
If you need a helper that doesn't exist, put it in **your own files** (e.g. `src/os/ed-lib.js`). Do not edit
lead-owned files. If you find a real bug in a lead file, describe it precisely in your final report.

## Data model (collections → documents; every doc has `id`, `updatedAt`)
- **patients**: `{ first, last, sex:'F'|'M', dob:'YYYY-MM-DD', lang:'en'|'fr'|'pa'|'ar'|'es'|'zh'|'ht'|…, mrn, ramq (masked), phone, allergies:[str], meds:[{name,dose}], conditions:[str], appUser:bool, familyDoctor, labs?:[{name,value,ref,ok,t}], wearable?:{hr:[],sleep:[],steps:[]} }`
- **encounters** (a visit): `{ kind:'ED'|'IP', patientId, cc (chief complaint / dx), source:'walk-in'|'ambulance'|'app'|'referral', status, ctas:1-5|null, vitals:{hr,sbp,dbp,rr,spo2,temp,pain,gcs,t}, vitalsHistory:[…], redFlags:[str], divertible:bool, arrivalAt, triagedAt, seenAt, decisionAt, admitRequestAt, admittedAt, dischargedAt, closedAt, md, nurse, bedId, unit, service, orders:[{id,name,type:'lab'|'imaging'|'med'|'nursing'|'consult',status:'ordered'|'in_progress'|'resulted'|'done'|'cancelled',t,by,result,priority}], notes:[{id,kind:'triage'|'md'|'scribe'|'nursing'|'discharge',text,author,signed,t}], timeline:[{t,type,text,actor}], dc:{prob:0-100, eta, barriers:[{id,text,owner,status}]}, alc:bool, preSummary, pendingVitals, diversion, dischargeInstructions:{text,lang,t}, threadId }`
  - ED statuses: `arriving` (pre-registered from app) → `waiting_triage` → `waiting_md` → `in_treatment` → `awaiting_results` → `decision` → `boarding` (admitted, no bed) → `admitted` (inpatient). Terminal: `discharged`, `diverted`, `lwbs`.
  - Inpatients are encounters with `status:'admitted'` (`unit`, `bedId`, `dc`).
- **beds**: `{ area:'ED'|'IP', unit:'ED'|'7E'|'8W'|'6N'|'CCU'|'ICU', zone:'Resus'|'Acute'|'Fast track'|'Hallway'|<unit>, label, state:'free'|'occupied'|'cleaning'|'blocked', encounterId, since }`
- **tasks**: `{ title, detail, role, encounterId, bedId, barrierId, priority:'stat'|'high'|'normal', status:'open'|'in_progress'|'done', createdAt, due, createdBy:'user'|'system'|'agent:<Name>', assignee, doneAt }`
- **reviews** (physician sign-off queue): `{ kind:'care_plan'|'rx_renewal'|'escalation'|'lab', patientId, threadId, msgId, encounterId, title, summary, proposal:{title,assessment,plan:[str],rx}, risk:'low'|'med'|'high', status:'pending'|'approved'|'modified'|'rejected'|'video', decidedBy, decidedAt, physicianNote, createdAt }`
- **threads** (patient-app conversations): `{ patientId, lang, status, messages:[{id,role:'patient'|'ai'|'md'|'system',text,t,author,card?}], unread, updatedAt }`
  - `card` types: `{type:'plan', status, reviewId, proposal}`, `{type:'checkin', encounterId, status:'open'|'done', answers}`, `{type:'appointment', apptId}`, `{type:'discharge', encounterId}`, `{type:'emergency'}`, `{type:'queue', encounterId}`
- **referrals**: `{ from, raw, image, receivedAt, status:'new'|'extracted'|'booked'|'declined', extracted:{…}, patientId }`
- **staff**: `{ name, role:'RN'|'MD', units:[], skills:[], fte, hoursThisWeek, bilingual, internal, costPerHour }`
- **shifts**: id `${date}_${unit}_${shift}` → `{ date, unit, shift:'day'|'evening'|'night', required:{RN}, assigned:[staffId], rosterCount }` (rosterCount = staff on the roster not modelled individually; filled = assigned.length + rosterCount)
- **clinics**: `{ name, kind, distanceKm, slots:[{id, t, bookedBy:null|{patientId, apptId}}] }`
- **appointments**: `{ clinicId, clinicName, slotId, t, patientId, encounterId, source, status, threadId }`
- **meta/settings** `{hospitalName, simEnabled, agentAutonomy}`, **meta/history** `{points:[{t,census,waiting,boarding,ipOcc}]}` (15-min snapshots, 24 h)
- **audit** (latest 400, newest first): `{ t, actor, action, detail, refs }`

## Reading data (React)
```js
import * as S from "../lib/store.js";
const encounters = S.useCollection("encounters");   // live array, re-renders on any change (any device)
const patient = S.useDoc("patients", id);           // live single doc
S.get("beds", id); S.all("tasks");                  // non-hook reads (in handlers / AI tools)
const audit = S.useCollection("audit");             // newest-first not guaranteed: sort by t desc yourself
```
Derive with `useMemo(..., [encounters, beds])` — arrays are new objects when their collection changes.

## Writing data — ALWAYS via domain actions (src/lib/domain.js)
They update the cache instantly (optimistic), persist, sync to other devices and write the audit log.
Key actions (read the file for all of them and their exact signatures):
`createPatient, updatePatient, registerArrival, completeTriage, recordVitals, setEdStatus, assignEdBed, addOrder, updateOrder, addNote, requestAdmission, assignInpatientBed, dischargeEd, dischargeInpatient, markLwbs, setBedState, setDischargePlan, resolveBarrier, createTask, setTaskStatus, bookSlot, divertToClinic, threadFor, createThread, postMessage, notifyPatient, scheduleCheckin, submitCheckin, createReview, decideReview, addReferral, assignToShift, removeFromShift, recommendations, runRecommendation`.
Pass `actor` = `"user"` for clicks, `"agent:<Agent name>"` when the AI acts, `"patient"` in the patient app.
For fields with no action (e.g. referral.extracted), use `S.patch(col, id, partial)` / `S.put(col, id, data)` and `S.audit(actor, action, detail, refs)`.

Helpers in domain.js: time (`fmtDur, fmtSince, fmtClock, fmtDate, fmtDateTime, fmtAgo, minsSince, ageOf, fullName`), CTAS (`CTAS, assessCtas`), ED (`ED_STAGES, STATUS_LABEL, isEdActive, isInpatient, stageOf, waitMinutes, minutesOverTarget, patientOf`), units (`UNITS, SERVICES, SERVICE_UNIT, ROLES, LANGS`), metrics (`computeMetrics`), staffing (`SHIFTS, currentShift, forecastEdCensus, requiredStaff, rankCandidates`), clinics (`openSlots`).

## AI (src/lib/ai.js)
```js
import * as AI from "../lib/ai.js";
const t = await AI.text(prompt, { onText: (soFar) => set(soFar) });         // streaming; null if unavailable
const obj = await AI.json(prompt, { shape: '{"ctas":1,"why":"..."}' });     // parsed JSON or null
const out = await AI.agent({ messages:[{role:"user",content}], tools:[{name, description, inputSchema:{type:"object",properties:{…},required:[…]}, execute: async (input)=>smallJSON}], onText, onTool });
const v = await AI.visionJSON(prompt, [blob], { shape }); AI.visionAvailable();
const status = AI.useAIStatus(); // 'live' | 'connecting' | 'offline' | 'denied' | 'busy'
```
Rules: show the AI's reasoning/sources, never auto-apply clinical changes without a human click (approve/sign),
label AI content with `<AiLabel/>`, always have a fallback when the call returns null, keep prompts specific with
the real data, ask for JSON when you need structure, and keep tool outputs small (summaries, ids, not full docs).
The first AI call shows a consent prompt to the viewer: trigger AI from a user click, not on page load.

## UI kit (src/ui/index.jsx, src/ui/clinical.jsx)
`Button({variant:'primary'|'ai'|'danger'|'ghost', size:'sm'|'lg', icon, loading}) Badge({tone:'ok'|'warn'|'bad'|'info'|'brand'|'ai'|'outline', icon}) Dot Ctas Avatar Panel({title, subtitle, actions, flush, icon}) PageHead({title, subtitle, actions}) Kpi({label,value,sub,tone,spark}) Field Input Textarea Select({options}) Seg({options,value,onChange}) Tabs({tabs:[{key,label,count}],value,onChange}) Drawer Modal({open,onClose,title,subtitle,footer,wide}) toast(msg,{kind:'ok'|'bad'}) Toasts Typing Empty({icon,title,action}) Skeleton AiLabel Markdown({text}) Sparkline HBars Columns LineChart useNow() useHotkey useAsync cx`
Clinical: `PatientLine({encounter}) StatusBadge({status}) WaitTime({encounter}) RedFlags({flags}) VitalsRow({v}) CtasLegend Ctas`
UI state (src/lib/ui-state.js): `go(route)`, `openChart(encounterId, tab)` opens the patient chart drawer anywhere, `useUI()`.
Routes: command, ed, triage, beds, tasks, staffing, signoff, scribe, referrals, analytics, audit, settings, patient, blueprint.

## Design system (non-negotiable)
- Font IBM Plex Sans, tabular numbers. Type classes: `t-display t-h1 t-h2 t-h3 t-sm t-xs t-2xs`, colours `c-2 c-3 c-brand c-bad c-ok c-warn c-ai`, weights `w5 w6`.
- Layout helpers: `row col grow wrap grid g2 g3 g4 span2 mt4..mt24 gap-12 gap-16`.
- Colour means something: CTAS colours only for acuity; red = danger/over target; indigo (`ai`) = AI-generated; green brand = primary actions. No decorative gradients, no emoji in UI, sentence case, no ALL-CAPS labels.
- Writing: plain verbs, say exactly what a button does ("Assign bed", "Sign and send"), errors explain how to fix, empty states invite an action. No exclamation marks. Never claim fake capabilities (say "simulated" where something is simulated).
- Every list has an empty state; every async action shows progress (`loading` on Button, `Typing`); every completed action confirms with `toast()`.
- Responsive down to 390 px wide. Keyboard accessible (buttons are buttons, inputs have labels).
- Motion only to show change (drawer slide, new-row flash `.new-flash`). Respect reduced motion (already global).

## Build & test
- Compile-check your file: `./check.sh src/os/ed.jsx`
- Visual test your module in isolation: `./harness.sh ed ./src/os/ed.jsx [./src/os/chart.jsx]` then
  `cd /tmp/h-ed && python3 -m http.server <your port> &` and drive it with Playwright (Node):
  `NODE_PATH=/opt/npm-tools/node_modules node yourtest.mjs` (`import { chromium } from "playwright"`; no install needed).
  Add `?full=1` to render without the page wrapper (patient app). Local mode = MemoryDB persisted in localStorage;
  use a fresh browser context for a clean seed. AI is offline in tests → your fallbacks are what you'll see.
- Take screenshots (desktop 1440×900 and mobile 390×844), look at them with the Read tool, and fix what looks off.
- Do NOT run `./build.sh` (the lead integrates). Do not touch `dist/`.
