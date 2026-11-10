// Cross-module end-to-end: patient chat -> plan -> physician signs in OS -> patient sees it live.
// Plus: app pre-registration appears in triage; command recommendation mutates data. Runs with the fake cloud runtime.
import { chromium } from "playwright";
import fs from "fs";
fs.mkdirSync(process.env.OUT || "test-results", { recursive: true });
const base = process.env.BASE || "http://localhost:8000/";
const fake = fs.readFileSync(new URL("./fake-claude.bundle.js", import.meta.url), "utf8");
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(fake);
const p = await ctx.newPage();
const errs = []; const log = (...a) => console.log("•", ...a);
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error" && !/ERR_TUNNEL|fonts\.g|Failed to load/.test(m.text())) errs.push("console: " + m.text().slice(0, 200)); });
const db = (col) => p.evaluate((col) => [...window.__fakeDb.docs.entries()].filter(([k]) => k.startsWith(col + "/")).map(([k, v]) => ({ id: k.split("/")[1], ...v })), col);

await p.goto(base + "?debug=1#patient");
await p.getByText("Continue as Jay Singh").click();
await p.waitForTimeout(600);
const before = (await db("reviews")).length;
for (const msg of ["Burning when I pee since yesterday", "No fever, no back pain, not pregnant", "No blood in urine"]) {
  await p.fill("#pa-compose", msg); await p.click('button[aria-label="Send message"]'); await p.waitForTimeout(1500);
}
const reviews = await db("reviews");
const mine = reviews.filter((r) => r.status === "pending" && r.createdAt > Date.now() - 60000);
log("reviews before/after", before, reviews.length, "new pending:", mine.map((r) => r.title));
await p.screenshot({ path: "test-results/e2e-1-chat.png" });

// physician signs in Hospital OS
await p.evaluate(() => { location.hash = "signoff"; });
await p.waitForTimeout(900);
if (mine[0]) await p.getByText(mine[0].title).first().click();
await p.waitForTimeout(400);
await p.getByRole("button", { name: "Approve and sign" }).first().click();
await p.waitForTimeout(700);
const r2 = (await db("reviews")).find((r) => r.id === mine[0]?.id);
log("review status after sign:", r2?.status, r2?.decidedBy);
await p.screenshot({ path: "test-results/e2e-2-signoff.png" });

// patient sees it live
await p.evaluate(() => { location.hash = "patient"; });
await p.waitForTimeout(1000);
const signedVisible = await p.getByText(/Signed by/).count();
log("patient app shows 'Signed by':", signedVisible > 0);
await p.screenshot({ path: "test-results/e2e-3-patient.png" });

// pre-register from app -> triage queue
const encBefore = (await db("encounters")).filter((e) => e.source === "app" && e.status === "arriving").length;
await p.evaluate(() => { const { S, D } = window.__aster; const jay = S.all("patients").find((x) => x.first === "Jay"); D.registerArrival({ patientId: jay.id, cc: "Chest pain and short of breath", source: "app", summary: "test" }, "patient"); });
await p.waitForTimeout(500);
await p.evaluate(() => { location.hash = "triage"; }); await p.waitForTimeout(900);
const inQueue = await p.getByText("Jay Singh").count();
log("app arrivals before/after:", encBefore, (await db("encounters")).filter((e) => e.source === "app" && e.status === "arriving").length, "| Jay visible in triage:", inQueue > 0);
await p.screenshot({ path: "test-results/e2e-4-triage.png" });

// command center: run top recommendation
await p.evaluate(() => { location.hash = "command"; }); await p.waitForTimeout(1000);
const tasksBefore = (await db("tasks")).length;
const runBtn = p.locator(".cc-rec button.btn.primary, [class*=cc-] button.btn.primary").first();
if (await runBtn.count()) { await runBtn.click(); await p.waitForTimeout(800); }
log("tasks before/after running a recommendation:", tasksBefore, (await db("tasks")).length);
// ED board + chart
await p.evaluate(() => { location.hash = "ed"; }); await p.waitForTimeout(900);
await p.screenshot({ path: "test-results/e2e-5-ed.png" });
const card = p.locator("[class*=ed-card]").first();
if (await card.count()) { await card.click(); await p.waitForTimeout(800); await p.screenshot({ path: "test-results/e2e-6-chart.png" }); }
console.log(errs.length ? [...new Set(errs)].join("\n") : "NO ERRORS");
await b.close();
