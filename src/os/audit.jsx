// Agents & audit log: what each AI agent may do, and everything anyone did.
import React, { useMemo, useState } from "react";
import {
  LuStethoscope, LuBedDouble, LuHouse, LuMic, LuHeartPulse, LuInbox, LuCalendarClock, LuMapPin, LuCopy, LuSearch,
  LuExternalLink, LuScrollText,
} from "react-icons/lu";
import * as S from "../lib/store.js";
import * as D from "../lib/domain.js";
import { openChart } from "../lib/ui-state.js";
import { Button, Badge, Panel, PageHead, Input, Seg, toast, Empty, useNow, cx } from "../ui/index.jsx";
import { AGENTS, AUTONOMY, agentKeyFor, actorType, toCsv } from "./clinical-lib.js";
import "./clinical.css";

const ICONS = { triage: LuStethoscope, flow: LuBedDouble, discharge: LuHouse, scribe: LuMic, followup: LuHeartPulse, referral: LuInbox, staffing: LuCalendarClock, divert: LuMapPin };
const AUTONOMY_HELP = { suggest: "Shows recommendations. People take every action.", approve: "Prepares the action; a person approves it with one click.", auto: "Acts on its own for low-risk work and logs it here. Clinical decisions still need a clinician." };
const ACTOR_TONE = { agent: "ai", user: "brand", system: "", patient: "info" };
const ACTOR_FILTERS = [{ value: "all", label: "All" }, { value: "agent", label: "AI agents" }, { value: "user", label: "Staff" }, { value: "system", label: "System" }, { value: "patient", label: "Patients" }];
const PAGE = 80;

function actorLabel(a = "") {
  if (a.startsWith("agent:")) return a.slice(6);
  if (a === "user") return "Staff";
  if (a === "system") return "System";
  if (a === "patient") return "Patient";
  return a;
}

export default function Audit() {
  useNow();
  const audit = S.useCollection("audit");
  const settings = S.useDoc("meta", "settings");
  const rows = useMemo(() => [...audit].sort((a, b) => (b.t || 0) - (a.t || 0)), [audit]);
  const [who, setWho] = useState("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const since = Date.now() - D.DAY;

  const stats = useMemo(() => {
    const s = Object.fromEntries(AGENTS.map((a) => [a.key, { total: 0, day: 0, last: null }]));
    for (const r of rows) { const k = agentKeyFor(r.actor); if (!k) continue; s[k].total++; if (r.t >= since) s[k].day++; if (!s[k].last) s[k].last = r; }
    return s;
  }, [rows]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter((r) => (who === "all" || actorType(r.actor) === who) && (!ql || `${r.actor} ${r.action} ${r.detail}`.toLowerCase().includes(ql)));
  }, [rows, who, q]);

  const autonomy = settings?.agentAutonomy || {};
  function setAutonomy(agent, value) {
    const cur = S.get("meta", "settings") || {};
    S.patch("meta", "settings", { ...cur, agentAutonomy: { ...(cur.agentAutonomy || {}), [agent.key]: value } });
    const label = AUTONOMY.find((x) => x.value === value)?.label;
    S.audit("user", "Changed agent autonomy", `${agent.name}: ${label}`, {});
    toast(`${agent.name} set to "${label}"`);
  }

  function copyCsv() {
    const csv = toCsv(filtered, [
      { label: "time", get: (r) => new Date(r.t).toISOString() },
      { label: "actor", get: (r) => r.actor },
      { label: "action", get: (r) => r.action },
      { label: "detail", get: (r) => r.detail },
      { label: "encounter_id", get: (r) => r.refs?.encounterId || "" },
      { label: "patient_id", get: (r) => r.refs?.patientId || "" },
    ]);
    try {
      navigator.clipboard.writeText(csv).then(
        () => toast(`Copied ${filtered.length} rows as CSV`),
        () => toast("Couldn't copy: the browser blocked clipboard access. Allow clipboard for this page and try again.", { kind: "bad" })
      );
    } catch (e) { toast("Couldn't copy: clipboard isn't available in this browser.", { kind: "bad" }); }
  }

  return (
    <div>
      <PageHead title="Agents & audit log" subtitle="Set how much each AI agent may do on its own, and review every action taken by staff, agents, the system and patients. Data is fictional." />

      <div className="cl-agents">
        {AGENTS.map((a) => {
          const Icon = ICONS[a.key] || LuScrollText; const st = stats[a.key]; const v = autonomy[a.key] || "suggest";
          return (
            <div key={a.key} className="panel cl-agent">
              <div className="row top" style={{ gap: 10 }}>
                <span className="cl-agent-icon"><Icon /></span>
                <div className="grow"><div className="t-h3">{a.name}</div><div className="t-xs c-3">{a.actor.replace("agent:", "")}</div></div>
                <div className="col" style={{ gap: 0, alignItems: "flex-end" }}><span className="num w6">{st.day}</span><span className="t-2xs c-3">actions, 24 h</span></div>
              </div>
              <div className="t-sm c-2">{a.desc}</div>
              <div className="cl-seg-full" aria-label={`${a.name} autonomy`}><Seg value={v} onChange={(nv) => setAutonomy(a, nv)} options={AUTONOMY} /></div>
              <div className="t-xs c-3">{AUTONOMY_HELP[v]} {st.last ? <>Last action {D.fmtAgo(st.last.t)}: {st.last.action.toLowerCase()}.</> : "No actions logged yet."}</div>
            </div>
          );
        })}
      </div>

      <Panel flush className="mt16" title="Audit log" subtitle={`${filtered.length} of ${rows.length} entries (latest 400 kept)`}
        actions={<Button size="sm" icon={LuCopy} disabled={!filtered.length} onClick={copyCsv}>Copy as CSV</Button>}>
        <div className="row wrap" style={{ padding: "12px 18px", gap: 10, borderBottom: "1px solid var(--line)" }}>
          <div style={{ overflowX: "auto", maxWidth: "100%" }}><Seg size="sm" value={who} onChange={(v) => { setWho(v); setLimit(PAGE); }} options={ACTOR_FILTERS} /></div>
          <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 360 }}>
            <LuSearch size={15} style={{ position: "absolute", left: 10, top: 9, color: "var(--ink-3)" }} />
            <Input className="sm" aria-label="Search the audit log" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Search actor, action or detail" style={{ paddingLeft: 32 }} />
          </div>
        </div>
        {!filtered.length ? <Empty icon={LuScrollText} title="No matching entries">{rows.length ? "Try another filter or search term." : "Actions appear here as soon as anyone, or any agent, changes something."}</Empty> : (
          <div className="scroll-x">
            <table className="table cl-audit">
              <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Detail</th><th /></tr></thead>
              <tbody>
                {filtered.slice(0, limit).map((r) => {
                  const type = actorType(r.actor);
                  return (
                    <tr key={r.id} className={cx(Date.now() - r.t < 8000 && "new-flash")}>
                      <td className="t num" title={new Date(r.t).toLocaleString("en-CA")}>{D.fmtDate(r.t)}, {D.fmtClock(r.t)}</td>
                      <td><Badge tone={ACTOR_TONE[type]}>{actorLabel(r.actor)}</Badge></td>
                      <td className="w5">{r.action}</td>
                      <td className="detail">{r.detail}</td>
                      <td style={{ textAlign: "right" }}>{r.refs?.encounterId ? <Button size="sm" variant="ghost" icon={LuExternalLink} onClick={() => openChart(r.refs.encounterId)}>Chart</Button> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > limit ? <div style={{ padding: 12, textAlign: "center" }}><Button size="sm" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</Button></div> : null}
      </Panel>
    </div>
  );
}
