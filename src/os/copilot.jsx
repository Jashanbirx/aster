// Aster Copilot chat panel: streams the agent's answer, shows each tool call
// as a chip and every proposed change as an approval card. Nothing changes
// until a human clicks Approve.
import React, { useEffect, useRef, useState } from "react";
import {
  LuSparkles, LuArrowUp, LuDatabase, LuSearch, LuFileText, LuBedDouble, LuListChecks, LuSquarePen,
  LuCheck, LuX, LuShieldCheck, LuTriangleAlert, LuRotateCcw, LuCornerDownRight,
} from "react-icons/lu";
import * as AI from "../lib/ai.js";
import { Button, Badge, Markdown, Typing, toast, cx } from "../ui/index.jsx";
import { useCopilot, ask, decideProposal, clearConversation } from "./copilot.js";

export const SUGGESTIONS = [
  "What's slowing the ED down right now?",
  "Give me the 3pm bed huddle brief",
  "Who is at highest risk in the waiting room?",
  "Free up beds for the boarders",
];
const TOOL_ICON = { get_hospital_snapshot: LuDatabase, search_patients: LuSearch, get_patient: LuFileText, list_free_beds: LuBedDouble, list_tasks: LuListChecks, propose_action: LuSquarePen };
const FOCUS_EVENT = "aster:copilot-focus";

/** Focus the Copilot input from anywhere (e.g. the demo guide). */
export function focusCopilot(prompt) { setTimeout(() => window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: { prompt } })), 160); }

export default function Copilot() {
  const c = useCopilot();
  const ai = AI.useAIStatus();
  const [draft, setDraft] = useState("");
  const bodyRef = useRef(null);
  const inputRef = useRef(null);
  const rootRef = useRef(null);

  useEffect(() => { const el = bodyRef.current; if (el && c.turns.length) el.scrollTop = el.scrollHeight; }, [c.turns, c.proposals]);
  useEffect(() => {
    const f = (ev) => {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (ev.detail?.prompt) setDraft(ev.detail.prompt);
      setTimeout(() => inputRef.current?.focus(), 250);
    };
    window.addEventListener(FOCUS_EVENT, f); return () => window.removeEventListener(FOCUS_EVENT, f);
  }, []);

  const send = (text) => { const q = (text ?? draft).trim(); if (!q || c.busy) return; setDraft(""); ask(q); };
  const live = ai === "live";

  return (
    <section className="panel cc-cp" ref={rootRef} aria-label="Aster Copilot">
      <header className="cc-cp-head">
        <span className="cc-cp-mark"><LuSparkles /></span>
        <div className="grow">
          <div className="t-h3">Aster Copilot</div>
          <div className="t-xs c-3">Tools on live hospital data. You approve every change.</div>
        </div>
        <span className={cx("cc-mode", live && "live")} title={live ? "Claude is reading live data through tools" : "AI is unavailable. Answers come from deterministic rules on the same live data."}>{live ? "Claude" : ai === "connecting" ? "Connecting" : "Rules mode"}</span>
        {c.turns.length ? <Button variant="ghost" size="sm" icon={LuRotateCcw} onClick={clearConversation} disabled={c.busy} aria-label="Start a new conversation" title="New conversation" /> : null}
      </header>

      <div className="cc-cp-body" ref={bodyRef} aria-live="polite">
        {!c.turns.length ? (
          <div className="cc-cp-intro">
            <p className="t-sm c-2">Ask about flow, beds or a patient. Copilot looks up the live census, explains what it found and drafts actions for you to approve.</p>
            <div>
              <div className="t-xs c-3 w5">Tools it uses on live data</div>
              <div className="cc-tools mt8">{[["get_hospital_snapshot", "Hospital snapshot"], ["search_patients", "Patient search"], ["get_patient", "Chart summary"], ["list_free_beds", "Free beds"], ["list_tasks", "Open tasks"], ["propose_action", "Propose a change"]].map(([k, l]) => { const I = TOOL_ICON[k]; return <span key={k} className="cc-tool static"><I />{l}</span>; })}</div>
            </div>
            <div className="t-xs c-3 w5">Try asking</div>
            <div className="cc-sugg-list">
              {SUGGESTIONS.map((s) => <button key={s} className="cc-sugg" onClick={() => send(s)} disabled={c.busy}><LuCornerDownRight />{s}</button>)}
            </div>
          </div>
        ) : c.turns.map((t) => t.role === "user"
          ? <div key={t.id} className="cc-msg-user"><div>{t.text}</div></div>
          : <AssistantTurn key={t.id} turn={t} proposals={c.proposals} />)}
      </div>

      {c.turns.length ? (
        <div className="cc-sugg-row" role="list" aria-label="Suggested questions">
          {SUGGESTIONS.map((s) => <button key={s} role="listitem" className="cc-chip-btn" onClick={() => send(s)} disabled={c.busy}>{s}</button>)}
        </div>
      ) : null}

      <form className="cc-cp-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <label htmlFor="cc-cp-q" className="cc-sr">Ask Aster Copilot</label>
        <textarea id="cc-cp-q" ref={inputRef} rows={1} value={draft} placeholder="Ask about flow, beds or a patient" onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <Button type="submit" variant="ai" icon={LuArrowUp} loading={c.busy} disabled={!draft.trim()} aria-label="Send" />
      </form>
    </section>
  );
}

function AssistantTurn({ turn: t, proposals }) {
  return (
    <div className="cc-msg-ai">
      <span className="cc-msg-mark" aria-hidden="true"><LuSparkles /></span>
      <div className="grow" style={{ minWidth: 0 }}>
        {t.tools?.length ? <div className="cc-tools">{t.tools.map((x) => { const I = TOOL_ICON[x.name] || LuDatabase; return <span key={x.id} className={cx("cc-tool", x.error && "err")}><I />{x.label}</span>; })}</div> : null}
        {t.text ? <Markdown text={t.text} className="cc-md t-sm" /> : t.pending ? <div className="c-ai"><Typing /></div> : null}
        {(t.proposals || []).map((id) => proposals[id] ? <ProposalCard key={id} p={proposals[id]} /> : null)}
        {!t.pending ? <div className="cc-msg-meta">{t.mode === "rules" ? <span title="AI was unavailable, so this answer was computed by deterministic rules from live data">Rules mode · live data</span> : <span className="c-ai">Aster AI · tools on live data</span>}</div> : null}
      </div>
    </div>
  );
}

function ProposalCard({ p }) {
  const approve = () => { const r = decideProposal(p.id, true); if (!r) return; if (r.status === "approved") toast(r.result || "Done"); else toast(r.error || "Couldn't apply this change", { kind: "bad" }); };
  const reject = () => { decideProposal(p.id, false); };
  return (
    <div className={cx("cc-prop", p.status)}>
      <div className="row" style={{ gap: 6 }}>
        <LuShieldCheck className="cc-prop-ic" />
        <span className="t-xs w6 c-ai">{p.status === "pending" ? "Needs your approval" : "Proposal"}</span>
        <span className="grow" />
        <Badge tone="outline">{p.title || "Action"}</Badge>
      </div>
      <div className="t-sm w6 mt4">{p.detail}</div>
      {p.reason ? <div className="t-xs c-2 mt4">{p.reason}</div> : null}
      {p.status === "pending" ? (
        <div className="row mt8">
          <Button size="sm" variant="primary" icon={LuCheck} onClick={approve}>Approve</Button>
          <Button size="sm" variant="ghost" icon={LuX} onClick={reject}>Reject</Button>
        </div>
      ) : p.status === "approved" ? (
        <div className="cc-prop-res ok"><LuCheck />Approved and applied: {p.result}</div>
      ) : p.status === "failed" ? (
        <div className="cc-prop-res bad"><LuTriangleAlert />Couldn't apply: {p.error}</div>
      ) : (
        <div className="cc-prop-res">Rejected. Nothing was changed.</div>
      )}
    </div>
  );
}
