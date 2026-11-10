// Aster UI kit. Small, consistent primitives used by every module.
import React, { useEffect, useRef, useState, useSyncExternalStore, useCallback } from "react";
import { createPortal } from "react-dom";
import { LuX, LuCheck, LuTriangleAlert, LuSparkles, LuLoaderCircle } from "react-icons/lu";
import { useAIStatus } from "../lib/ai.js";

export const cx = (...a) => a.filter(Boolean).join(" ");

/* ------------------------------ clock ------------------------------ */
let nowV = Date.now();
const clockSubs = new Set();
setInterval(() => { nowV = Date.now(); clockSubs.forEach((f) => f()); }, 15000);
/** Re-render every 15 s so live durations stay current. */
export function useNow() { return useSyncExternalStore((f) => { clockSubs.add(f); return () => clockSubs.delete(f); }, () => nowV, () => nowV); }

/* ------------------------------ buttons ---------------------------- */
export function Button({ variant, size, icon: Icon, loading, children, className, ...rest }) {
  return (
    <button className={cx("btn", variant, size, !children && "icon", className)} disabled={loading || rest.disabled} {...rest}>
      {loading ? <LuLoaderCircle className="spin" /> : Icon ? <Icon /> : null}
      {children}
    </button>
  );
}
export const Kbd = ({ children }) => <span className="kbd">{children}</span>;

/* ------------------------------ badges ----------------------------- */
export const Badge = ({ tone, icon: Icon, children, className, title }) => (
  <span className={cx("badge", tone, className)} title={title}>{Icon ? <Icon /> : null}{children}</span>
);
export const Dot = ({ tone }) => <span className={cx("dot", tone)} />;
export function Ctas({ level, size, title }) {
  if (!level) return <span className="ctas l5" style={{ opacity: 0.5 }} title="Not triaged">–</span>;
  return <span className={cx("ctas", `l${level}`, size)} title={title || `CTAS ${level}`}>{level}</span>;
}
export function Avatar({ name = "", size = 30, color }) {
  const ini = name.split(/\s+/).filter((w) => /^[A-Za-zÀ-ÿ]/.test(w)).slice(0, 2).map((s) => s[0]).join("").toUpperCase();
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const AV = ["#0E6B5C", "#2257C5", "#7A4FD0", "#B5476B", "#B26A00", "#2C7A8C", "#4F6B2E", "#8A4B2D"];
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: color || AV[h % AV.length] }}>{ini || "?"}</span>;
}

/* ------------------------------ panels ----------------------------- */
export function Panel({ title, subtitle, actions, children, flush, className, bodyClass, icon: Icon, style }) {
  return (
    <section className={cx("panel", flush && "flush", className)} style={style}>
      {(title || actions) && (
        <header className="panel-head">
          {Icon ? <Icon style={{ width: 16, height: 16, color: "var(--ink-3)" }} /> : null}
          <div className="grow"><div className="t-h3">{title}</div>{subtitle ? <div className="t-xs c-3 mt4">{subtitle}</div> : null}</div>
          {actions ? <div className="right">{actions}</div> : null}
        </header>
      )}
      <div className={cx("panel-body", bodyClass)}>{children}</div>
    </section>
  );
}
export function PageHead({ title, subtitle, actions, children }) {
  return (
    <div className="page-head">
      <div><h1 className="t-h1">{title}</h1>{subtitle ? <p className="t-sm">{subtitle}</p> : null}</div>
      {actions ? <div className="actions">{actions}</div> : null}
      {children}
    </div>
  );
}
export function Kpi({ label, value, sub, tone, spark, sparkColor, onClick, title }) {
  return (
    <div className="panel kpi" onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined} style={{ cursor: onClick ? "pointer" : "default", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }} title={title}>
      <div className="t-xs c-2 w5 ellipsis">{label}</div>
      <div className="row" style={{ alignItems: "flex-end", gap: 10 }}>
        <div className="t-display num" style={{ color: tone === "bad" ? "var(--bad)" : tone === "warn" ? "var(--warn)" : tone === "ok" ? "var(--ok)" : "var(--ink)" }}>{value}</div>
        {spark && spark.length > 1 ? <div className="grow" style={{ paddingBottom: 6 }}><Sparkline data={spark} color={sparkColor || "var(--brand-2)"} height={26} /></div> : null}
      </div>
      {sub ? <div className="t-xs c-3 ellipsis">{sub}</div> : null}
    </div>
  );
}

/* ------------------------------ forms ------------------------------ */
export function Field({ label, hint, children, style }) {
  return <label className="field" style={style}>{label ? <span className="label">{label}</span> : null}{children}{hint ? <span className="hint">{hint}</span> : null}</label>;
}
export const Input = React.forwardRef(function Input({ className, ...p }, ref) { return <input ref={ref} className={cx("input", className)} {...p} />; });
export const Textarea = React.forwardRef(function Textarea({ className, ...p }, ref) { return <textarea ref={ref} className={cx("textarea", className)} {...p} />; });
export function Select({ options, className, ...p }) {
  return <select className={cx("select", className)} {...p}>{options.map((o) => typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
}
export function Seg({ options, value, onChange, size }) {
  return <div className="seg" role="radiogroup">{options.map((o) => { const v = typeof o === "string" ? o : o.value; const l = typeof o === "string" ? o : o.label; return <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)} style={size === "sm" ? { padding: "4px 9px", fontSize: 12.5 } : null}>{l}</button>; })}</div>;
}
export function Tabs({ tabs, value, onChange }) {
  return <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.key} role="tab" aria-selected={value === t.key} className={cx("tab", value === t.key && "on")} onClick={() => onChange(t.key)}>{t.label}{t.count != null ? <span className="cnt">{t.count}</span> : null}</button>)}</div>;
}

/* ------------------------------ overlays --------------------------- */
function useEscape(open, onClose) {
  useEffect(() => { if (!open) return; const f = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [open, onClose]);
}
export function Drawer({ open, onClose, title, subtitle, actions, children, width }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(<>
    <div className="scrim" onClick={onClose} />
    <aside className="drawer" role="dialog" aria-modal="true" style={width ? { width } : null}>
      <header className="drawer-head">
        <div className="grow">{typeof title === "string" ? <div className="t-h2">{title}</div> : title}{subtitle ? <div className="t-sm c-2 mt4">{subtitle}</div> : null}</div>
        {actions}
        <Button variant="ghost" icon={LuX} onClick={onClose} aria-label="Close" />
      </header>
      <div className="drawer-body">{children}</div>
    </aside>
  </>, document.body);
}
export function Modal({ open, onClose, title, subtitle, children, footer, wide }) {
  useEscape(open, onClose);
  if (!open) return null;
  return createPortal(<>
    <div className="scrim" onClick={onClose} />
    <div className="modal"><div className={cx("modal-box", wide && "wide")} role="dialog" aria-modal="true">
      <div className="modal-head"><div className="grow"><div className="t-h2">{title}</div>{subtitle ? <div className="t-sm c-2 mt4">{subtitle}</div> : null}</div><Button variant="ghost" size="sm" icon={LuX} onClick={onClose} aria-label="Close" /></div>
      <div className="modal-body">{children}</div>
      {footer ? <div className="modal-foot">{footer}</div> : null}
    </div></div>
  </>, document.body);
}

/* ------------------------------ toasts ----------------------------- */
let toastList = []; const toastSubs = new Set();
const emitToasts = () => toastSubs.forEach((f) => f());
export function toast(msg, opts = {}) {
  const id = Math.random().toString(36).slice(2);
  toastList = [...toastList, { id, msg, kind: opts.kind || "ok", action: opts.action }].slice(-4); emitToasts();
  setTimeout(() => { toastList = toastList.filter((t) => t.id !== id); emitToasts(); }, opts.ms || 3800);
}
export function Toasts() {
  const list = useSyncExternalStore((f) => { toastSubs.add(f); return () => toastSubs.delete(f); }, () => toastList, () => toastList);
  return createPortal(<div className="toasts" aria-live="polite">{list.map((t) => (
    <div key={t.id} className={cx("toast", t.kind)}>{t.kind === "bad" ? <LuTriangleAlert /> : <LuCheck />}<span>{t.msg}</span>
      {t.action ? <button className="btn sm" style={{ marginLeft: 6, background: "transparent", color: "#fff", borderColor: "rgba(255,255,255,.3)" }} onClick={t.action.run}>{t.action.label}</button> : null}</div>
  ))}</div>, document.body);
}

/* ------------------------------ misc ------------------------------- */
export const Typing = () => <span className="typing" aria-label="Working"><i /><i /><i /></span>;
export function Empty({ icon: Icon, title, children, action }) {
  return <div className="empty">{Icon ? <Icon /> : null}{title ? <div className="t-h3">{title}</div> : null}{children ? <div className="t-sm" style={{ maxWidth: 380 }}>{children}</div> : null}{action}</div>;
}
export function Skeleton({ h = 14, w = "100%", style }) { return <div className="skeleton" style={{ height: h, width: w, ...style }} />; }
export function AiLabel({ children = "Aster AI", live }) {
  const s = useAIStatus();
  return <span className="ai-label"><LuSparkles />{children}{live !== false && s !== "live" ? <span className="t-2xs c-3 w5" style={{ marginLeft: 4 }}>(offline rules)</span> : null}</span>;
}

/** Tiny safe markdown → React (headings, bullets, numbers, bold, italic, code). */
export function Markdown({ text = "", className }) {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const blocks = []; let list = null;
  const inline = (s, k) => {
    const parts = []; let rest = s; let i = 0;
    const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/;
    while (rest) { const m = rest.match(re); if (!m) { parts.push(rest); break; } if (m.index) parts.push(rest.slice(0, m.index)); const tok = m[0]; parts.push(tok.startsWith("**") ? <strong key={k + "b" + i++}>{tok.slice(2, -2)}</strong> : tok.startsWith("`") ? <code key={k + "c" + i++}>{tok.slice(1, -1)}</code> : <em key={k + "i" + i++}>{tok.slice(1, -1)}</em>); rest = rest.slice(m.index + tok.length); }
    return parts;
  };
  lines.forEach((ln, idx) => {
    const t = ln.trim();
    const bullet = t.match(/^[-*•]\s+(.*)/); const num = t.match(/^\d+[.)]\s+(.*)/);
    if (bullet || num) { const type = bullet ? "ul" : "ol"; if (!list || list.type !== type) { list = { type, items: [] }; blocks.push(list); } list.items.push(inline((bullet || num)[1], idx)); return; }
    list = null;
    if (!t) return;
    const h = t.match(/^#{1,4}\s+(.*)/);
    if (h) blocks.push({ type: "h", text: inline(h[1], idx) });
    else blocks.push({ type: "p", text: inline(t, idx) });
  });
  return <div className={cx("md", className)}>{blocks.map((b, i) => b.type === "ul" ? <ul key={i}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ul> : b.type === "ol" ? <ol key={i}>{b.items.map((x, j) => <li key={j}>{x}</li>)}</ol> : b.type === "h" ? <h4 key={i}>{b.text}</h4> : <p key={i}>{b.text}</p>)}</div>;
}

/* ------------------------------ charts ----------------------------- */
export function Sparkline({ data = [], color = "var(--brand-2)", height = 32, fill = true, strokeWidth = 1.8 }) {
  const w = 120; const vals = data.map(Number);
  if (vals.length < 2) return <svg width="100%" height={height} />;
  const max = Math.max(...vals), min = Math.min(...vals), rng = max - min || 1;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, height - 3 - ((v - min) / rng) * (height - 6)]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const id = "sg" + Math.random().toString(36).slice(2, 8);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-hidden="true">
      {fill ? <><defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={color} stopOpacity=".18" /><stop offset="1" stopColor={color} stopOpacity="0" /></linearGradient></defs><path d={`${d} L${w},${height} L0,${height} Z`} fill={`url(#${id})`} /></> : null}
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
/** Horizontal bars: data=[{label, value, color, sub}] */
export function HBars({ data, max, format = (v) => v, target }) {
  const m = max || Math.max(1, ...data.map((d) => d.value));
  return <div className="col" style={{ gap: 10 }}>{data.map((d) => (
    <div key={d.label}>
      <div className="row t-sm"><span className="grow ellipsis">{d.label}</span><span className="num w6">{format(d.value)}</span>{d.sub ? <span className="t-xs c-3">{d.sub}</span> : null}</div>
      <div style={{ height: 8, background: "var(--sunken)", borderRadius: 99, position: "relative", marginTop: 5, overflow: "hidden" }}>
        <div style={{ width: `${Math.min(100, (d.value / m) * 100)}%`, height: "100%", background: d.color || "var(--brand-2)", borderRadius: 99, transition: "width .5s var(--ease)" }} />
        {target != null ? <div style={{ position: "absolute", top: 0, bottom: 0, left: `${Math.min(100, (target / m) * 100)}%`, width: 2, background: "var(--ink)" }} /> : null}
      </div>
    </div>))}</div>;
}
/** Vertical columns over time: data=[{label, value}] */
export function Columns({ data, height = 140, color = "var(--brand-2)", highlightLast }) {
  const m = Math.max(1, ...data.map((d) => d.value));
  return <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height }}>{data.map((d, i) => (
    <div key={i} title={`${d.label}: ${d.value}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
      <div style={{ width: "100%", height: `${(d.value / m) * (height - 18)}px`, minHeight: d.value ? 2 : 0, background: highlightLast && i === data.length - 1 ? "var(--brand)" : color, borderRadius: "3px 3px 0 0", opacity: highlightLast && i !== data.length - 1 ? 0.55 : 1 }} />
      <div className="t-2xs c-3" style={{ height: 12 }}>{d.label}</div>
    </div>))}</div>;
}
/** Multi-series line chart. series=[{name,color,values:number[]}], labels: string[] */
export function LineChart({ series, labels = [], height = 180 }) {
  const w = 600, pad = 24;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1, ...all), n = Math.max(...series.map((s) => s.values.length));
  const x = (i) => pad + (i / Math.max(1, n - 1)) * (w - pad * 2);
  const y = (v) => height - pad - (v / max) * (height - pad * 2);
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} width="100%" height={height} preserveAspectRatio="none" role="img">
        {[0, 0.5, 1].map((f) => <line key={f} x1={pad} x2={w - pad} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" strokeDasharray={f ? "3 4" : null} vectorEffect="non-scaling-stroke" />)}
        {[0, 0.5, 1].map((f) => <text key={"t" + f} x={2} y={y(max * f) + 4} fontSize="10" fill="var(--ink-3)">{Math.round(max * f)}</text>)}
        {series.map((s) => <path key={s.name} d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />)}
      </svg>
      <div className="row wrap gap-12 t-xs c-2">{series.map((s) => <span key={s.name} className="row gap-4"><span style={{ width: 10, height: 3, borderRadius: 2, background: s.color, display: "inline-block" }} />{s.name}</span>)}{labels.length ? <span className="grow" /> : null}{labels.length ? <span className="c-3">{labels[0]} – {labels[labels.length - 1]}</span> : null}</div>
    </div>
  );
}

/* ------------------------------ hooks ------------------------------ */
export function useHotkey(combo, fn) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => {
    const h = (e) => {
      const tg = e.target; const typing = tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName));
      const k = combo.toLowerCase();
      if (typing && !k.includes("mod+")) return;
      const meta = k.includes("mod+");
      const key = k.replace("mod+", "");
      if (meta && !(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() === key) { e.preventDefault(); ref.current(e); }
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [combo]);
}
export function useAsync() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => { setBusy(true); try { return await fn(); } finally { setBusy(false); } }, []);
  return [busy, run];
}
