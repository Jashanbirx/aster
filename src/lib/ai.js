// Aster AI layer — wraps the artifact `sample` capability (Claude).
// - text():   streaming text
// - json():   structured output with one self-repair retry
// - agent():  tool-using agent loop (tools execute real app functions)
// - vision(): image understanding (e.g. photographed faxes)
// Every function resolves null when AI is unavailable so callers can fall
// back to deterministic logic. Nothing here ever throws to the UI.
import { useSyncExternalStore } from "react";

let sample = null;
let limits = { images: false };
let status = "connecting"; // connecting | live | offline | denied | busy
const subs = new Set();
const setStatus = (s) => { if (status !== s) { status = s; subs.forEach((f) => f()); } };
export const aiStatus = () => status;
export function useAIStatus() { return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => status, () => status); }

const ready = (async () => {
  try {
    if (window.claude && typeof window.claude.use === "function") {
      sample = await Promise.race([window.claude.use("sample"), new Promise((r) => setTimeout(() => r(null), 10000))]);
      if (sample && sample.limits) { try { limits = (await sample.limits()) || limits; } catch (e) {} }
    }
  } catch (e) { sample = null; }
  setStatus(sample ? "live" : "offline");
  return !!sample;
})();
export const aiReady = () => ready;
export const visionAvailable = () => !!(sample && limits && limits.images);

export const SYSTEM = `You are Aster, the clinical and operations AI inside a Canadian (Québec) hospital and primary-care platform.
Licensed clinicians make every clinical decision; you draft, summarize, triage-suggest and explain, and a human signs off.
Conventions: CTAS 1–5 triage, SI units (mmol/L, µmol/L), generic drug names, RAMQ, CLSC, GMF, Info-Santé 811, Santé Québec, Collège des médecins du Québec.
Be concise, specific and calm. Never invent patient facts that were not provided. If information is missing, say so.`;

function handleError(e) {
  if (!e) return;
  if (e.code === "not_granted") setStatus("denied");
  else if (e.code === "rate_limited") { setStatus("busy"); setTimeout(() => setStatus(sample ? "live" : "offline"), 20000); }
  console.warn("AI error", e);
}

/** Streaming text. onText(fullTextSoFar). Returns final text or null. */
export async function text(prompt, { system = SYSTEM, onText, tier = "default", signal, history } = {}) {
  await ready; if (!sample) return null;
  const input = history ? [...history, { role: "user", content: prompt }] : [{ role: "user", content: `${system}\n\n${prompt}` }];
  if (history && history.length && system) input[0] = { ...input[0], content: `${system}\n\n${input[0].content}` };
  try {
    const r = await sample(input, { onText: onText ? ({ text }) => onText(text) : undefined, modelTier: tier, cache: false, signal });
    setStatus("live");
    return (r && r.text) || "";
  } catch (e) { handleError(e); return null; }
}

export function parseJSON(t) {
  if (!t) return null;
  let s = String(t).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(s); } catch (e) {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) {} }
  const c = s.indexOf("["), d = s.lastIndexOf("]");
  if (c >= 0 && d > c) { try { return JSON.parse(s.slice(c, d + 1)); } catch (e) {} }
  return null;
}

/** Structured output. `shape` is a short JSON description included in the prompt. */
export async function json(prompt, { system = SYSTEM, shape = "", tier = "default", signal } = {}) {
  const ask = `${prompt}\n\nRespond with ONLY valid JSON${shape ? ` in exactly this shape:\n${shape}` : ""}. No prose, no code fences.`;
  const t = await text(ask, { system, tier, signal });
  if (t === null) return null;
  const v = parseJSON(t);
  if (v) return v;
  const fix = await text(`This was supposed to be valid JSON but is not. Return the corrected JSON only.\n\n${t}`, { system: "You repair JSON.", tier: "quick" });
  return parseJSON(fix);
}

/**
 * Tool-using agent. tools: [{ name, description, inputSchema, execute(input) }]
 * onTool({name, input, output|error}) is called after each tool call.
 * messages: [{role:'user'|'assistant', content}] ending with user.
 */
export async function agent({ system = SYSTEM, messages, tools = [], onText, onTool, tier = "default", signal }) {
  await ready; if (!sample) return null;
  const wrapped = tools.map((t) => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
    execute: async (input) => {
      try { const out = await t.execute(input || {}); onTool && onTool({ name: t.name, input, output: out }); return out; }
      catch (e) { onTool && onTool({ name: t.name, input, error: String(e.message || e) }); throw e; }
    },
  }));
  const input = messages.map((m, i) => (i === 0 ? { ...m, content: `${system}\n\n${m.content}` } : m));
  try {
    const r = await sample(input, { tools: wrapped, onText: onText ? ({ text }) => onText(text) : undefined, modelTier: tier, cache: false, signal });
    setStatus("live");
    return (r && r.text) || "";
  } catch (e) { handleError(e); return null; }
}

/** Image understanding. blobs: Blob[] (images). */
export async function vision(prompt, blobs, { system = SYSTEM, onText, tier = "default" } = {}) {
  await ready; if (!sample || !visionAvailable()) return null;
  try {
    const r = await sample([{ role: "user", content: `${system}\n\n${prompt}` }], { images: blobs, onText: onText ? ({ text }) => onText(text) : undefined, modelTier: tier, cache: false });
    setStatus("live");
    return (r && r.text) || "";
  } catch (e) { handleError(e); return null; }
}
export async function visionJSON(prompt, blobs, opts = {}) {
  const t = await vision(`${prompt}\n\nRespond with ONLY valid JSON${opts.shape ? ` in this shape:\n${opts.shape}` : ""}.`, blobs, opts);
  return parseJSON(t);
}
