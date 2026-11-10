import fs from "fs";
fs.mkdirSync(process.env.OUT || "test-results", { recursive: true });
// Smoke test: load the built app in local mode, collect errors, screenshot routes.
import { chromium } from "playwright";
const base = process.env.BASE || "http://localhost:8000/";
const routes = (process.env.ROUTES || "command").split(",");
const out = process.env.OUT || "test-results";
const b = await chromium.launch();
const errs = [];
for (const [w, h, tag] of [[1440, 900, "d"], [390, 844, "m"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.on("pageerror", (e) => errs.push(`${tag} pageerror: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|fonts|Failed to load resource/.test(m.text())) errs.push(`${tag} console: ${m.text()}`); });
  await p.goto(base + "#command"); await p.waitForSelector(".shell, .phone-wrap, .pa-root", { timeout: 60000 }).catch(() => errs.push(tag + " shell did not render"));
  for (const r of routes) { await p.goto(base + "#" + r); await p.waitForTimeout(700); await p.screenshot({ path: `${out}/${tag}-${r}.png` }); }
  await p.close();
}
console.log(errs.length ? errs.join("\n") : "NO ERRORS");
await b.close();
