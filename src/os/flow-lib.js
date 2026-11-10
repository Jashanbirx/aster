// Shared helpers for Beds & flow, Tasks and Staffing (owned by the flow modules).
// Pure functions over live data; every write still goes through domain actions.
import * as D from "../lib/domain.js";

export const IP_UNITS = ["7E", "8W", "6N", "CCU", "ICU"];
export const STAFF_UNITS = ["ED", "7E", "8W", "6N", "CCU", "ICU"];
export const CHART = { discharge: "#0E9478", admit: "#2C56A6" }; // validated pair (light surface)

/** "Marie T." */
export function shortName(p) {
  if (!p) return "Unknown";
  return `${p.first} ${p.last ? p.last[0] + "." : ""}`.trim();
}
/** Day of stay, counting the admission day as day 1. */
export function dayOfStay(admittedAt, t = Date.now()) {
  if (!admittedAt) return 1;
  return Math.max(1, Math.floor((t - admittedAt) / D.DAY) + 1);
}
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
export const openBarriers = (e) => (e?.dc?.barriers || []).filter((b) => b.status !== "done");
export const openTaskFor = (tasks, barrierId) => tasks.find((t) => t.barrierId === barrierId && t.status !== "done");

/** Per-unit capacity numbers. */
export function unitStats(unit, beds, encounters) {
  const ub = beds.filter((b) => b.area === "IP" && b.unit === unit);
  const pts = encounters.filter((e) => D.isInpatient(e) && e.unit === unit);
  const occupied = ub.filter((b) => b.state === "occupied").length;
  return {
    unit, name: D.UNITS[unit], total: ub.length, occupied,
    free: ub.filter((b) => b.state === "free").length,
    cleaning: ub.filter((b) => b.state === "cleaning").length,
    blocked: ub.filter((b) => b.state === "blocked").length,
    occ: pct(occupied, ub.length),
    likely: pts.filter((e) => (e.dc?.prob || 0) >= 70).length,
    alc: pts.filter((e) => e.alc).length,
    expected: Math.round(pts.reduce((s, e) => s + (e.dc?.prob || 0) / 100, 0) * 10) / 10,
  };
}

/**
 * Best free bed for a boarder, with the reasons a bed manager would give.
 * Service unit first; otherwise the least-full non-critical-care unit.
 */
export function bestBedFor(enc, beds, encounters) {
  const want = D.SERVICE_UNIT[enc.service] || "7E";
  const free = beds.filter((b) => b.area === "IP" && b.state === "free");
  const stats = Object.fromEntries(IP_UNITS.map((u) => [u, unitStats(u, beds, encounters)]));
  const inUnit = free.filter((b) => b.unit === want).sort((a, b) => a.label.localeCompare(b.label));
  if (inUnit.length) {
    const s = stats[want];
    return { bed: inUnit[0], unit: want, match: true, reasons: [
      `${enc.service || "Medicine"} patients go to ${D.UNITS[want]}: service match`,
      `${s.free} free bed${s.free === 1 ? "" : "s"} on ${want}, ${s.occ}% occupied`,
      `${inUnit[0].label} has been ready for ${D.fmtSince(inUnit[0].since || Date.now())}`,
    ] };
  }
  if (want === "ICU" || want === "CCU") {
    return { bed: null, unit: want, match: false, reasons: [`No free ${want} bed. Critical-care patients are not placed off-service automatically.`] };
  }
  const alt = free.filter((b) => b.unit !== "ICU" && b.unit !== "CCU")
    .sort((a, b) => stats[a.unit].occ - stats[b.unit].occ || a.label.localeCompare(b.label));
  if (!alt.length) return { bed: null, unit: want, match: false, reasons: [`No free bed on ${want} or any other ward unit right now.`] };
  const b = alt[0], s = stats[b.unit];
  return { bed: b, unit: b.unit, match: false, reasons: [
    `No free bed on ${want} (${stats[want].occ}% occupied)`,
    `Off-service placement on ${D.UNITS[b.unit]}, the least-full ward at ${s.occ}%`,
    "ICU and CCU beds are kept for critical-care admissions",
  ] };
}

/* ------------------------------------------------------------------ */
/* 24-hour capacity outlook                                            */
/* ------------------------------------------------------------------ */
// Share of a day's inpatient discharges leaving in each clock hour
// (typical Canadian ward pattern: most discharges 11:00–17:00).
const DC_CURVE = [0, 0, 0, 0, 0, 0, 0, 0.5, 1, 2, 5, 9, 11, 12, 12, 11, 9, 7, 5, 3, 2, 1, 0.5, 0];
const DC_SUM = DC_CURVE.reduce((a, b) => a + b, 0);
export const ED_ADMIT_RATE = 0.18;

/** Next occurrence (within 24 h) of each clock hour. */
function nextAt(hour, t0) {
  const d = new Date(t0); d.setMinutes(0, 0, 0); d.setHours(hour);
  if (d.getTime() <= t0) d.setDate(d.getDate() + 1);
  return d.getTime();
}
/** Integrates an hourly curve between two times (fractional hours). */
function integrate(curve, from, to) {
  let s = 0;
  for (let t = from; t < to; t += D.MIN * 10) {
    const h = new Date(t).getHours();
    s += curve[h] * (Math.min(D.MIN * 10, to - t) / D.HOUR);
  }
  return s;
}
export function capacityOutlook(encounters, beds, t0 = Date.now()) {
  const inpatients = encounters.filter(D.isInpatient);
  const expectedDc = inpatients.reduce((s, e) => s + (e.dc?.prob || 0) / 100, 0);
  const boarders = encounters.filter((e) => D.isEdActive(e) && e.status === "boarding").length;
  const ip = beds.filter((b) => b.area === "IP");
  const freeNow = ip.filter((b) => b.state === "free").length;
  const cleaning = ip.filter((b) => b.state === "cleaning").length;
  // remaining discharge mass from now until the same time tomorrow, so probability mass is spread over the next 24 h
  const mass24 = integrate(DC_CURVE, t0, t0 + D.DAY) || DC_SUM;
  const points = [11, 15, 23].map((h) => ({ h, t: nextAt(h, t0) })).sort((a, b) => a.t - b.t).map(({ h, t }) => {
    const dc = expectedDc * (integrate(DC_CURVE, t0, t) / mass24);
    // ED arrivals use the same curve and scaling as D.forecastEdCensus
    const arrivals = integrate(D.ARRIVAL_CURVE, t0, t) * 1.08;
    const adm = boarders + arrivals * ED_ADMIT_RATE;
    const net = freeNow + cleaning + dc - adm;
    return { label: `${String(h).padStart(2, "0")}:00`, t, discharges: Math.round(dc), admissions: Math.round(adm), arrivals: Math.round(arrivals), free: Math.round(net) };
  });
  return { points, expectedDc: Math.round(expectedDc * 10) / 10, boarders, freeNow, cleaning };
}
export function outlookSentence(o) {
  const b = o.points[1] || o.points[0];
  const worst = [...o.points].sort((x, y) => x.free - y.free)[0];
  const lead = `By ${b.label}, expect about ${b.discharges} discharges against ${b.admissions} admissions (${o.boarders} boarding now), leaving ${b.free >= 0 ? b.free : 0} free beds.`;
  const tail = worst.free <= 2
    ? ` Capacity is tightest at ${worst.label} (${worst.free} projected free): clear discharge barriers before noon.`
    : ` Lowest point is ${worst.label} with ${worst.free} projected free beds.`;
  return lead + tail;
}

/* ------------------------------------------------------------------ */
/* Huddle brief (fallback)                                             */
/* ------------------------------------------------------------------ */
export function huddleData(encounters, beds, tasks) {
  const units = IP_UNITS.map((u) => unitStats(u, beds, encounters));
  const boarders = encounters.filter((e) => D.isEdActive(e) && e.status === "boarding")
    .sort((a, b) => (a.admitRequestAt || 0) - (b.admitRequestAt || 0))
    .map((e) => ({ name: shortName(D.patientOf(e)), service: e.service, waitingMin: D.minsSince(e.admitRequestAt || e.arrivalAt) }));
  const bars = encounters.filter(D.isInpatient).filter((e) => (e.dc?.prob || 0) >= 60)
    .flatMap((e) => openBarriers(e).map((b) => ({ patient: shortName(D.patientOf(e)), unit: e.unit, prob: e.dc.prob, barrier: b.text, owner: b.owner, hasTask: !!openTaskFor(tasks, b.id) })))
    .sort((a, b) => b.prob - a.prob).slice(0, 8);
  const o = capacityOutlook(encounters, beds);
  return { units, boarders, topBarriers: bars, outlook: o.points, expectedDischarges: o.expectedDc };
}
export function huddleFallback(d) {
  const tot = d.units.reduce((s, u) => ({ occ: s.occ + u.occupied, total: s.total + u.total, free: s.free + u.free, cleaning: s.cleaning + u.cleaning, likely: s.likely + u.likely, alc: s.alc + u.alc }), { occ: 0, total: 0, free: 0, cleaning: 0, likely: 0, alc: 0 });
  const tight = [...d.units].sort((a, b) => b.occ - a.occ)[0];
  const oldest = d.boarders[0];
  const unowned = d.topBarriers.filter((b) => !b.hasTask);
  const owners = [...new Set(unowned.map((b) => b.owner))];
  const pm = d.outlook[1] || d.outlook[0];
  const lines = [
    `**Census:** ${tot.occ} of ${tot.total} inpatient beds occupied (${pct(tot.occ, tot.total)}%). ${tot.free} free, ${tot.cleaning} in cleaning. Tightest unit: ${tight.unit} at ${tight.occ}%.`,
    d.boarders.length ? `**Boarders:** ${d.boarders.length} admitted patients are waiting in the ED. Oldest: ${oldest.name} (${oldest.service}), ${D.fmtDur(oldest.waitingMin * D.MIN)}.` : "**Boarders:** none waiting in the ED.",
    `**Discharges:** ${tot.likely} likely today (probability 70% or more), ${d.expectedDischarges} expected over 24 h.`,
    unowned.length ? `**Barriers:** ${unowned.length} open barriers on likely discharges have no owner yet (${owners.join(", ")}). Assign them now.` : "**Barriers:** every open barrier on a likely discharge has an owner.",
    tot.alc ? `**ALC:** ${tot.alc} patients are alternate level of care. Escalate CLSC and CHSLD placements with social work.` : "**ALC:** no ALC patients flagged.",
    `**Outlook:** by ${pm.label}, about ${pm.discharges} discharges vs ${pm.admissions} admissions, ${pm.free} projected free beds.`,
  ];
  return lines.map((l) => `- ${l}`).join("\n");
}

/* ------------------------------------------------------------------ */
/* Tasks                                                                */
/* ------------------------------------------------------------------ */
export const PRIORITY = { stat: { label: "Stat", tone: "bad", rank: 0 }, high: { label: "High", tone: "warn", rank: 1 }, normal: { label: "Normal", tone: "outline", rank: 2 } };
export function startOfToday(t = Date.now()) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
export function actorLabel(by = "user") {
  if (by.startsWith("agent:")) return { kind: "agent", label: by.slice(6) };
  if (by === "system") return { kind: "system", label: "System" };
  if (by === "patient") return { kind: "patient", label: "Patient" };
  return { kind: "user", label: "Staff" };
}
export function dueText(due, t = Date.now()) {
  if (!due) return { text: "No due time", over: false };
  const d = due - t;
  if (d < 0) return { text: `Overdue ${D.fmtDur(-d)}`, over: true };
  return { text: `Due in ${D.fmtDur(d)}`, over: false, soon: d < 15 * D.MIN };
}

/* ------------------------------------------------------------------ */
/* Staffing                                                             */
/* ------------------------------------------------------------------ */
export const filledOf = (s) => (s?.assigned?.length || 0) + (s?.rosterCount || 0);
export function unitCensus(encounters, beds) {
  const out = {};
  for (const u of IP_UNITS) out[u] = beds.filter((b) => b.area === "IP" && b.unit === u && b.state === "occupied").length;
  return out;
}
export const OT_MULT = 1.5;
/** Cost of one 8-hour shift for a staff member (overtime paid at time and a half). */
export function shiftCost(m, b2b = false) {
  const ot = b2b || (m.hoursThisWeek || 0) + 8 > (m.fte || 1) * 37.5;
  return Math.round((m.costPerHour || 50) * 8 * (ot && m.internal ? OT_MULT : 1));
}
export const AGENCY_SHIFT = 118 * 8;
export const otRisk = (m) => (m.hoursThisWeek || 0) > 37.5 * (m.fte || 1);

/** Nurse ids working each shift of a date, excluding one shift. */
function busyMap(shifts, date, exceptId) {
  const m = new Map();
  shifts.forEach((s) => { if (s.date === date && s.id !== exceptId) (s.assigned || []).forEach((id) => m.set(id, [...(m.get(id) || []), s])); });
  return m;
}
const ADJ = { day: ["evening"], evening: ["day", "night"], night: ["evening"] };
/**
 * D.rankCandidates plus one local rule shared by the drawer and Fill all:
 * a nurse already working today loses 30 points (second shift, 8 h rest) or
 * 40 points (back-to-back: offered only as voluntary overtime, paid at time
 * and a half), with the reason shown. Still preferred to agency when rested.
 */
export function rankForShift(shift, staff, shifts) {
  const busy = busyMap(shifts, shift.date, shift.id);
  return D.rankCandidates(shift, staff, shifts)
    .map((m) => {
      const on = busy.get(m.id); if (!on) return m;
      const label = on.map((s) => `${s.unit} ${s.shift}`).join(", ");
      const b2b = on.some((s) => ADJ[shift.shift]?.includes(s.shift));
      m = { ...m, why: m.why.map((w) => (w === "No overtime" ? "Under weekly hours" : w)) };
      return b2b
        ? { ...m, score: m.score - 40, double: true, b2b: true, why: [...m.why, `Back-to-back with ${label}: voluntary overtime`] }
        : { ...m, score: m.score - 30, double: true, why: [...m.why, `Second shift today (${label})`] };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Greedy fill: for each short shift (current shift first), take the best internal
 * candidate with score >= 20; agency only when no internal option qualifies.
 * Returns the assignments made (staffId null = could not fill).
 */
export function planFill(shifts, staff, order) {
  const plan = [];
  const work = shifts.map((s) => ({ ...s, assigned: [...(s.assigned || [])] }));
  const st = staff.map((m) => ({ ...m }));
  for (const key of order) {
    const s = work.find((x) => x.id === key); if (!s) continue;
    while (filledOf(s) < (s.required?.RN || 0)) {
      const ranked = rankForShift(s, st, work).filter((c) => c.score >= 20);
      const pick = ranked.find((c) => c.internal) || ranked.find((c) => !c.internal);
      if (!pick) { plan.push({ shiftId: s.id, unit: s.unit, shift: s.shift, staffId: null }); break; }
      const m = st.find((x) => x.id === pick.id);
      const cost = pick.internal ? shiftCost(m, pick.b2b) : (m.costPerHour || 118) * 8;
      s.assigned.push(pick.id);
      m.hoursThisWeek = (m.hoursThisWeek || 0) + 8;
      plan.push({ shiftId: s.id, unit: s.unit, shift: s.shift, staffId: pick.id, name: pick.name, score: pick.score, why: pick.why, internal: pick.internal, cost });
    }
  }
  return plan;
}

export function staffingFallback({ rows, shiftKey, edCensus }) {
  const gaps = rows.filter((r) => r.gap > 0);
  const cur = rows.filter((r) => r.shift === shiftKey);
  const curGap = cur.reduce((s, r) => s + Math.max(0, r.gap), 0);
  const above = rows.filter((r) => r.model > r.required);
  const lines = [
    `**Now (${shiftKey} shift):** ${cur.reduce((s, r) => s + r.filled, 0)} of ${cur.reduce((s, r) => s + r.required, 0)} RN positions filled${curGap ? `, ${curGap} short` : ", fully staffed"}. ED census is ${edCensus}.`,
    gaps.length ? `**Gaps today:** ${gaps.map((r) => `${r.unit} ${r.shift} (${r.gap} short)`).join(", ")}.` : "**Gaps today:** none. Every shift meets its requirement.",
    above.length ? `**Model vs plan:** the demand model asks for more RNs than planned on ${above.map((r) => `${r.unit} ${r.shift} (${r.model} vs ${r.required})`).join(", ")}. Review before the shift starts.` : "**Model vs plan:** planned requirements match or exceed the demand model.",
    "**Order of fill:** unit nurses first, then the internal float pool, then cross-trained staff without overtime. Agency only when no internal nurse qualifies.",
    "**Fairness:** suggestions avoid overtime and double shifts, and favour nurses with the fewest hours this week, in line with the collective agreement.",
  ];
  return lines.map((l) => `- ${l}`).join("\n");
}

