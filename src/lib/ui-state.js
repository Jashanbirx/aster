// Global UI state shared across modules (routing, chart drawer, palette).
import { useSyncExternalStore } from "react";

const st = { route: "command", chart: null, chartTab: "overview", palette: false, guide: false };
const subs = new Set();
const emit = () => subs.forEach((f) => f());
export function useUI() { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => st.v || (st.v = { ...st }), () => st.v || (st.v = { ...st })); }
function set(p) { Object.assign(st, p); st.v = { ...st }; emit(); }

export const ROUTES = ["command", "ed", "triage", "beds", "tasks", "staffing", "signoff", "scribe", "referrals", "analytics", "audit", "settings", "patient", "blueprint"];
function readHash() { const h = (location.hash || "").replace(/^#/, ""); return ROUTES.includes(h) ? h : "command"; }
set({ route: readHash() });
window.addEventListener("hashchange", () => set({ route: readHash() }));

/** Navigate to a route (ASCII name, see ROUTES). */
export function go(route) { if (!ROUTES.includes(route)) return; if (location.hash !== "#" + route) location.hash = route; set({ route }); }
/** Open the patient chart drawer for an encounter, optionally on a tab. */
export function openChart(encounterId, tab = "overview") { set({ chart: encounterId, chartTab: tab }); }
export function closeChart() { set({ chart: null }); }
export function setChartTab(tab) { set({ chartTab: tab }); }
export function openPalette(v = true) { set({ palette: v }); }
export function openGuide(v = true) { set({ guide: v }); }
