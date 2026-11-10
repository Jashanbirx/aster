// Full-app route sweep. FAKE=1 injects the fake claude runtime (cloud db path + fake model).
import { chromium } from "playwright";
import fs from "fs";
fs.mkdirSync(process.env.OUT || "test-results", { recursive: true });
const base = process.env.BASE || "http://localhost:8000/";
const out = process.env.OUT || "test-results";
const routes = ["command","ed","triage","beds","tasks","staffing","signoff","scribe","referrals","analytics","audit","settings","blueprint","patient"];
const fake = process.env.FAKE ? fs.readFileSync(new URL("./fake-claude.bundle.js", import.meta.url),"utf8") : null;
const b = await chromium.launch();
const errs = [];
for (const [w,h,tag] of [[1440,900,"d"],[390,844,"m"]]) {
  const ctx = await b.newContext({ viewport:{width:w,height:h} });
  if (fake) await ctx.addInitScript(fake);
  const p = await ctx.newPage();
  p.on("pageerror", e => errs.push(`${tag} pageerror: ${e.message}`));
  p.on("console", m => { if (m.type()==="error" && !/ERR_TUNNEL|fonts\.g|Failed to load resource/.test(m.text())) errs.push(`${tag} console: ${m.text().slice(0,300)}`); });
  await p.goto(base + "#command");
  await p.waitForSelector(".shell", { timeout: 90000 }).catch(()=>errs.push(tag+" shell missing"));
  for (const r of routes) {
    await p.evaluate(r => { location.hash = r; }, r);
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${out}/${fake?"f":""}${tag}-${r}.png` });
  }
  await ctx.close();
}
console.log(errs.length ? [...new Set(errs)].join("\n") : "NO ERRORS");
await b.close();
