// Aster Care UI primitives (patient app only). Everything renders inside the
// phone surface so sheets and overlays stay within the device on desktop.
import React, { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LuX, LuPlus, LuLoaderCircle } from "react-icons/lu";
import { cx } from "../ui/index.jsx";

export const PA = createContext(null);
export const usePA = () => useContext(PA);

/* ------------------------------ media -------------------------------- */
const mq = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 900px)") : null;
export function useIsDesktop() {
  return useSyncExternalStore((f) => { if (!mq) return () => {}; mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, () => (mq ? mq.matches : true), () => true);
}

/* ------------------------------ brand -------------------------------- */
export function Mark({ size = 18, color = "#fff", core = "#0E6B5C" }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" /><circle cx="12" cy="12" r="3.2" fill={core} /></svg>;
}
export function BrandTile({ size = 30 }) { return <span className="pa-brandtile" style={{ width: size, height: size, borderRadius: size * 0.32 }}><Mark size={size * 0.6} /></span>; }

/* ------------------------------ buttons ------------------------------ */
export function PButton({ variant = "soft", icon: Icon, loading, children, className, block, ...rest }) {
  return <button type="button" className={cx("pa-btn", variant, block && "block", className)} disabled={loading || rest.disabled} {...rest}>{loading ? <LuLoaderCircle className="spin" /> : Icon ? <Icon aria-hidden="true" /> : null}{children ? <span>{children}</span> : null}</button>;
}

/* ------------------------------ sheet -------------------------------- */
export function Sheet({ open, onClose, title, subtitle, children, footer, tone }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const f = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", f);
    const t = setTimeout(() => { const el = ref.current?.querySelector("input,textarea,button.pa-btn.primary"); el?.focus(); }, 60);
    return () => { window.removeEventListener("keydown", f); clearTimeout(t); };
  }, [open, onClose]);
  if (!open) return null;
  return <div className="pa-sheet-wrap">
    <div className="pa-sheet-scrim" onClick={onClose} />
    <div className={cx("pa-sheet", tone)} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined} ref={ref}>
      <div className="pa-sheet-grip" aria-hidden="true" />
      <div className="pa-sheet-head">
        <div className="grow">{title ? <div className="pa-h2">{title}</div> : null}{subtitle ? <div className="pa-sub mt4">{subtitle}</div> : null}</div>
        <button type="button" className="pa-iconbtn" onClick={onClose} aria-label="Close"><LuX /></button>
      </div>
      <div className="pa-sheet-body">{children}</div>
      {footer ? <div className="pa-sheet-foot">{footer}</div> : null}
    </div>
  </div>;
}

/* ------------------------------ tags --------------------------------- */
export function TagInput({ label, values = [], onChange, placeholder, suggestions = [], id, hideLabel }) {
  const [v, setV] = useState("");
  const add = (t) => { const x = t.trim(); if (!x) return; if (!values.some((y) => y.toLowerCase() === x.toLowerCase())) onChange([...values, x]); setV(""); };
  const sugg = suggestions.filter((s) => !values.some((y) => y.toLowerCase() === s.toLowerCase()));
  return <div className="pa-field">
    <label className={hideLabel ? "pa-sr" : "pa-label"} htmlFor={id}>{label}</label>
    <div className="pa-tags">
      {values.map((t) => <span key={t} className="pa-tag">{t}<button type="button" onClick={() => onChange(values.filter((y) => y !== t))} aria-label={`Remove ${t}`}><LuX /></button></span>)}
      <input id={id} className="pa-tag-input" value={v} placeholder={values.length ? "Add another" : placeholder} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(v); } else if (e.key === "Backspace" && !v && values.length) onChange(values.slice(0, -1)); }}
        onBlur={() => add(v)} />
    </div>
    {sugg.length ? <div className="pa-suggest">{sugg.slice(0, 5).map((s) => <button type="button" key={s} className="pa-chip sm" onClick={() => add(s)}><LuPlus />{s}</button>)}</div> : null}
  </div>;
}

/* ------------------------------ choice ------------------------------- */
export function Choice({ options, value, onChange, label, cols }) {
  return <div className="pa-choice" role="radiogroup" aria-label={label} style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` } : null}>
    {options.map((o) => <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={cx("pa-choice-btn", value === o.value && "on", o.tone)} onClick={() => onChange(o.value)}>{o.icon ? <o.icon aria-hidden="true" /> : null}{o.label}</button>)}
  </div>;
}

export function Section({ title, action, children, className }) {
  return <section className={cx("pa-section", className)}>
    {title || action ? <div className="pa-section-head"><h2 className="pa-h3">{title}</h2>{action}</div> : null}
    {children}
  </section>;
}

export function PEmpty({ icon: Icon, title, children, action }) {
  return <div className="pa-empty">{Icon ? <span className="pa-empty-ic"><Icon aria-hidden="true" /></span> : null}<div className="pa-h3">{title}</div>{children ? <p className="pa-sub">{children}</p> : null}{action}</div>;
}
