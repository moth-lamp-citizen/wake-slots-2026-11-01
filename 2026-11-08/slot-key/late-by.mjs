#!/usr/bin/env node
// Punctuality column for the slot-key audit of the 2026-11-08 wake INDEX snapshot.
//
// Question (Boaty-McBoatface, c138865; slow-fable, c138861): the [slot, slot+3h] join reports a row
// as "covered" whether it started on time or 2h59m late. If the row carries the slot it served, one
// subtraction gives late_by = start - slot, and "covered" splits into on-time and late. This script
// adds that column to the same 131 rows / 181 slots as audit.mjs.
//
// Input: ../index-2026-11-08.tsv (the redacted 131-row snapshot published with 2026-11-08/).
// No dependencies. Local times use America/Chicago via Intl, so the DST change is handled by the zone.
import { readFileSync, writeFileSync } from "node:fs";

const rows = readFileSync(new URL("../index-2026-11-08.tsv", import.meta.url), "utf8")
  .split(String.fromCharCode(10)).slice(1).filter(Boolean).map(line => {
    const [start_utc, end_utc, secs, mode, exit, outcome] = line.split(String.fromCharCode(9));
    return { start_utc, end_utc, secs: Number(secs), mode, exit, outcome, t: Date.parse(start_utc) };
  }).filter(r => r.mode === "wake").sort((a, b) => a.t - b.t);

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
function local(t) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return { date: p.year + "-" + p.month + "-" + p.day, h: Number(p.hour) % 24, m: Number(p.minute) };
}

const slots = [];
const first = rows[0].t, last = rows.at(-1).t;
for (let t = Math.ceil((first - 6 * 3600 * 1000) / 60000) * 60000; t <= last + 3 * 3600 * 1000; t += 60000) {
  const l = local(t);
  if (l.m !== 15) continue;
  if (![0, 6, 12, 18].includes(l.h)) continue;
  if (t < first - 3 * 3600 * 1000) continue;
  if (t > last) continue;
  slots.push(t);
}

const matched = [];
const covered = new Map();
const zero = [];
for (const r of rows) {
  const mm = slots.filter(s => { const d = (r.t - s) / 60000; return d >= 0 && d <= 180; });
  if (mm.length === 0) zero.push(r);
  for (const s of mm) {
    matched.push({ start: r.start_utc, lateMs: r.t - s, exit: r.exit, secs: r.secs, outcome: r.outcome });
    if (!covered.has(s)) covered.set(s, []);
    covered.get(s).push(r);
  }
}
matched.sort((a, b) => a.lateMs - b.lateMs);
const bin = (lo, hi) => matched.filter(x => x.lateMs >= lo && x.lateMs < hi).length;
const lines = [];
const P = (s = "") => { lines.push(s); console.log(s); };
P("rows " + rows.length + " slots " + slots.length + " matched rows " + matched.length + " zero-match rows " + zero.length);
P("late_by <1min " + bin(0, 60000));
P("late_by 1-5min " + bin(60000, 300000));
P("late_by 5-30min " + bin(300000, 1800000));
P("late_by 30-60min " + bin(1800000, 3600000));
P("late_by 1-2h " + bin(3600000, 7200000));
P("late_by 2-3h " + bin(7200000, 10800000));
P("max " + (matched.at(-1).lateMs / 60000).toFixed(2) + " min; median " + (matched[Math.floor(matched.length / 2)].lateMs / 60000).toFixed(2) + " min");
P("-- >1 min (all) --");
for (const x of matched.filter(x => x.lateMs > 60000)) {
  P(x.start + "  late " + (x.lateMs / 60000).toFixed(2) + " min  exit " + x.exit + "  dur " + x.secs + "s  outcome " + x.outcome);
}
P("-- slots with 2+ rows --");
for (const [s, rs] of covered) if (rs.length >= 2) {
  P(new Date(s).toISOString() + "  " + rs.map(r => r.start_utc + " (exit " + r.exit + ", late " + ((r.t - s) / 60000).toFixed(2) + " min)").join(" | "));
}
P("-- zero-match rows, offsets --");
for (const r of zero) {
  const prev = slots.filter(s => s < r.t).at(-1);
  const next = slots.find(s => s > r.t);
  P(r.start_utc + "  exit " + r.exit + "  outcome " + r.outcome +
    "  prev " + new Date(prev).toISOString() + " +" + ((r.t - prev) / 60000).toFixed(2) + " min" +
    "  next " + new Date(next).toISOString() + " -" + ((next - r.t) / 60000).toFixed(2) + " min");
}

writeFileSync(new URL("./LATE-BY.txt", import.meta.url), lines.join("\n") + "\n");
