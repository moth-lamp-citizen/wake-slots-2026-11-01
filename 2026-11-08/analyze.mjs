#!/usr/bin/env node
// Reproduce the five slot-witness cells for the 2026-11-07 re-run from index-2026-11-08.tsv.
// No dependencies. Local times use the IANA zone America/Chicago via Intl.
import { readFileSync } from "node:fs";

const rows = readFileSync(new URL("./index-2026-11-08.tsv", import.meta.url), "utf8")
  .split(String.fromCharCode(10)).slice(1).filter(Boolean).map(line => {
    const [start_utc, end_utc, secs, mode, exit, outcome] = line.split(String.fromCharCode(9));
    return { start_utc, end_utc, secs: Number(secs), mode, exit, outcome, t: Date.parse(start_utc) };
  }).filter(r => r.mode === "wake").sort((a, b) => a.t - b.t);

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
function local(t) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { date: p.year + "-" + p.month + "-" + p.day, h: Number(p.hour) % 24, m: Number(p.minute), s: Number(p.second) };
}
function pad(n) { return String(n).padStart(2, "0"); }
function localStr(t) { const l = local(t); return l.date + " " + pad(l.h) + ":" + pad(l.m) + ":" + pad(l.s); }
const slots = [15, 375, 735, 1095]; // 00:15, 06:15, 12:15, 18:15 local minutes
function nearestSlot(t) {
  const l = local(t), mod = l.h * 60 + l.m;
  let best = null;
  for (const s of slots) {
    let d = mod - s;
    if (d > 720) d -= 1440;
    if (d < -720) d += 1440;
    if (!best || Math.abs(d) < Math.abs(best.d)) best = { s, d };
  }
  return { ...best, key: l.date + " " + pad(Math.floor(best.s / 60)) + ":" + pad(best.s % 60) };
}

console.log("rows (mode=wake): " + rows.length);
console.log("first: " + rows[0].start_utc + "  last: " + rows.at(-1).start_utc);
console.log("");

console.log("== 1. civil-time edge (the clock fell back at 02:00 local on 2026-11-01) ==");
for (const r of rows.filter(r => r.t >= Date.parse("2026-10-31T20:00:00Z") && r.t <= Date.parse("2026-11-02T00:00:00Z"))) {
  console.log(r.start_utc + "  local " + localStr(r.t));
}
const a = rows.find(r => r.start_utc === "2026-11-01T05:15:03Z");
const b = rows.find(r => r.start_utc === "2026-11-01T12:15:03Z");
if (a && b) {
  const utcGap = (b.t - a.t) / 3600000;
  const la = local(a.t), lb = local(b.t);
  const civilGap = ((lb.h * 60 + lb.m) - (la.h * 60 + la.m)) / 60;
  console.log("UTC gap: " + utcGap.toFixed(2) + " h; civil gap: " + civilGap.toFixed(2) + " h (00:15 -> 06:15)");
}
console.log("");

console.log("== 2. rows classified against the nearest slot (offset in minutes) ==");
for (const r of rows) {
  const n = nearestSlot(r.t);
  if (Math.abs(n.d) > 5) {
    console.log(r.start_utc + "  local " + localStr(r.t) + "  nearest " + n.key + "  offset " + (n.d >= 0 ? "+" : "") + n.d + "m");
  }
}
console.log("");

console.log("== 3. slots with more than one row in [slot, slot+3h] ==");
const bySlot = new Map();
for (const r of rows) {
  const n = nearestSlot(r.t);
  if (n.d >= 0 && n.d <= 180) {
    if (!bySlot.has(n.key)) bySlot.set(n.key, []);
    bySlot.get(n.key).push(r);
  }
}
for (const [key, rs] of bySlot) if (rs.length > 1) console.log(key + ": " + rs.map(r => r.start_utc).join(", "));
console.log("");

console.log("== 4. slots with no row in [slot, slot+3h] ==");
const firstKey = nearestSlot(rows[0].t).key;
const lastKey = nearestSlot(rows.at(-1).t).key;
const startDay = Date.parse(firstKey.slice(0, 10) + "T00:00:00Z");
const endDay = Date.parse(lastKey.slice(0, 10) + "T00:00:00Z");
let missing = [], covered = 0;
for (let day = startDay; day <= endDay; day += 86400000) {
  const date = new Date(day).toISOString().slice(0, 10);
  for (const s of slots) {
    const desired = date + " " + pad(Math.floor(s / 60)) + ":" + pad(s % 60);
    if (desired < firstKey || desired > lastKey) continue;
    covered++;
    const got = rows.some(r => {
      const n = nearestSlot(r.t);
      return n.key === desired && n.d >= 0 && n.d <= 180;
    });
    if (!got) missing.push(desired);
  }
}
console.log("count: " + missing.length + " of " + covered + " slots in the covered range (" + firstKey + " .. " + lastKey + ")");
console.log(missing.join(String.fromCharCode(10)));
console.log("");

console.log("== 5. longest gap between consecutive rows ==");
let maxGap = 0, pair = null;
for (let i = 1; i < rows.length; i++) {
  const g = rows[i].t - rows[i - 1].t;
  if (g > maxGap) { maxGap = g; pair = [rows[i - 1], rows[i]]; }
}
console.log(pair[0].start_utc + " -> " + pair[1].start_utc + "  = " + (maxGap / 86400000).toFixed(4) + " d (" + (maxGap / 3600000).toFixed(2) + " h)");
console.log("the INDEX carries no cause; a missing row is not proof the dispatcher did not fire.");
