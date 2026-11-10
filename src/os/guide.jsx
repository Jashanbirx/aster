// Demo guide: a 3-minute walkthrough for a first-time viewer. Each step
// checks itself off from live data, so the guide reflects what really happened.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { LuCheck, LuArrowRight, LuCompass, LuScrollText } from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import { go, openGuide } from "../lib/ui-state.js";
import { Drawer, Button, cx } from "../ui/index.jsx";
import { useCopilot } from "./copilot.js";
import { focusCopilot } from "./copilot.jsx";
import "./command.css";

let everOpened = false;
const later = (f, ms = 140) => setTimeout(f, ms);

function useSteps() {
  const audit = S.useCollection("audit");
  const encs = S.useCollection("encounters");
  const reviews = S.useCollection("reviews");
  const cp = useCopilot();
  return useMemo(() => {
    const recRuns = audit.filter((a) => a.action === "Ran next best action");
    const nearRec = (a) => recRuns.some((r) => Math.abs((r.t || 0) - (a.t || 0)) < 3000);
    const byHuman = (a) => a.actor === "user" || /^agent:.*approved by user/.test(a.actor || "");
    const app = encs.filter((e) => e.source === "app" && e.kind === "ED");
    const arriving = app.find((e) => e.status === "arriving");
    const appName = arriving ? D.fullName(D.patientOf(arriving)) : null;
    return [
      { key: "nba", title: "Run a next best action", desc: "The command center ranks what to do next from live data. Run one and watch the flow change.",
        done: recRuns.length > 0, show: () => { go("command"); later(() => document.getElementById("cc-actions")?.scrollIntoView({ behavior: "smooth", block: "start" }), 200); } },
      { key: "triage", title: "Triage the patient who pre-registered from the app", desc: appName ? `${appName} checked in from her phone and is on her way. Confirm her CTAS level.` : "A patient checked in from the Aster app. Confirm their CTAS level.",
        done: app.some((e) => e.triagedAt) || (app.length > 0 && !arriving), show: () => go("triage") },
      { key: "ed", title: "Move a patient on the Emergency board", desc: "Drag a patient card to the next stage. Timers, beds and tasks update on every screen.",
        done: audit.some((a) => a.actor === "user" && a.action === "Moved patient" && !nearRec(a)), show: () => go("ed") },
      { key: "beds", title: "Place a boarder into an inpatient bed", desc: "Match an admitted patient waiting in the ED to a free bed on the right unit.",
        done: audit.some((a) => byHuman(a) && a.action === "Assigned inpatient bed" && !nearRec(a)), show: () => go("beds") },
      { key: "signoff", title: "Sign a care plan as the physician", desc: "Review an AI-drafted plan, then approve, modify or reject it. The patient is told right away.",
        done: reviews.some((r) => r.status && r.status !== "pending" && r.decidedAt), show: () => go("signoff") },
      { key: "app", title: "Chat with Aster in the patient app", desc: "Describe a symptom as a patient and get a care plan that goes to a physician for sign-off.",
        done: reviews.some((r) => r.threadId && !/^rv-\d{3}$/.test(r.id)), show: () => go("patient") },
      { key: "scribe", title: "Sign an ambient scribe note", desc: "Turn a recorded visit conversation into a structured note and sign it.",
        done: encs.some((e) => (e.notes || []).some((n) => n.kind === "scribe" && n.signed !== false)), show: () => go("scribe") },
      { key: "copilot", title: "Ask the Copilot a question", desc: "The agent reads live data with tools and drafts changes that only apply when you approve.",
        done: cp.asked > 0, show: () => { go("command"); focusCopilot("What's slowing the ED down right now?"); } },
    ];
  }, [audit, encs, reviews, cp.asked]);
}

export default function Guide({ open }) {
  const steps = useSteps();
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);
  if (open) everOpened = true;
  const close = () => openGuide(false);

  // flash the floating pill when a step completes while the guide is closed
  const prev = useRef(done);
  const [flash, setFlash] = useState(false);
  useEffect(() => { if (done > prev.current) { setFlash(true); const t = setTimeout(() => setFlash(false), 2400); prev.current = done; return () => clearTimeout(t); } prev.current = done; }, [done]);

  return <>
    <Drawer open={open} onClose={close} width="min(460px, 100vw)" title="Demo guide" subtitle="Eight steps, about three minutes. Each one checks itself off from live data.">
      <div className="cc-gd-progress" aria-label={`${done} of ${steps.length} steps done`}>
        <div className="row" style={{ gap: 6 }}><span className="t-h3 num">{done} of {steps.length}</span><span className="t-sm c-3">done</span></div>
        <div className="cc-gd-bar"><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
        <div className="t-xs c-3 mt8">{next ? <>Up next: <span className="c-2 w5">{next.title}</span></> : "All steps done"}</div>
      </div>
      <ol className="cc-gd-steps">
        {steps.map((s, i) => (
          <li key={s.key} className={cx("cc-gd-step", s.done && "done", next === s && "next")}>
            <span className="cc-gd-num num" aria-hidden="true">{s.done ? <LuCheck /> : i + 1}</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="cc-gd-title">{s.title}{s.done ? <span className="cc-sr"> (done)</span> : null}</div>
              <div className="t-sm c-2 mt4">{s.desc}</div>
            </div>
            <Button size="sm" variant={next === s ? "primary" : undefined} onClick={() => { close(); s.show(); }}>Show me<LuArrowRight /></Button>
          </li>
        ))}
      </ol>
      {!next ? (
        <div className="cc-gd-end">
          <div className="t-h3">That is the whole loop</div>
          <p className="t-sm c-2 mt4">Patient app, triage, flow, beds, physician sign-off and documentation, all on one live record. Every action, human or AI, is in the audit log.</p>
          <div className="row mt12"><Button icon={LuScrollText} onClick={() => { close(); go("audit"); }}>Open the audit log</Button></div>
        </div>
      ) : (
        <p className="t-xs c-3 mt16">Fictional demo hospital. Reset it any time in Settings.</p>
      )}
    </Drawer>
    {!open && everOpened ? (
      <button className={cx("cc-gd-pill", flash && "flash", !next && "all")} onClick={() => openGuide(true)} aria-label={`Open demo guide, ${done} of ${steps.length} steps done`}>
        {next ? <LuCompass /> : <LuCheck />}<span>Demo guide</span><span className="num cc-gd-pill-n">{done}/{steps.length}</span>
      </button>
    ) : null}
  </>;
}
