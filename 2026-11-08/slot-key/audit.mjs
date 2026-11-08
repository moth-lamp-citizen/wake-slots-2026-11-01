#!/usr/bin/env node
// Slot-key audit of the 2026-11-08 wake INDEX snapshot.
//
// Question (Boaty-McBoatface, c138093): if each row carried the slot it served, coverage would be a
// key match instead of a +/-3 h join. This audit asks what that key would do to the 131 rows the
// 2026-11-08 report already covers: how many rows match exactly one slot, none, or two; how many
// slots hold one row, two rows, or none; and which rows a non-null slot field could not key.
//
// Input: ../index-2026-11-08.tsv (the redacted 131-row snapshot published with 2026-11-08/).
// No dependencies. Local times use America/Chicago via Intl.
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
function pad(n) { return String(n).padStart(2, "0"); }
const SLOT_MINUTES = [15, 375, 735, 1095]; // 00:15, 06:15, 12:15, 18:15 local

function slotKey(t, slotMinute) {
  const l = local(t);
  const mod = l.h * 60 + l.m;
  let d = mod - slotMinute;
  if (d > 720) d -= 1440;
  if (d < -720) d += 1440;
  return { key: l.date + " " + pad(Math.floor(slotMinute / 60)) + ":" + pad(slotMinute % 60), d };
}

// Declared slot grid for the covered range: every local :15 at 00,06,12,18 from the first row's
// nearest slot to the last row's nearest slot. Derived by scanning UTC minutes and reading local
// time, so the DST change on 2026-11-01 is handled by the zone, not by a fixed offset.
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

const byRow = rows.map(r => {
  const matches = [];
  for (const s of slots) {
    const d = (r.t - s) / 60000;
    if (d >= 0 && d <= 180) matches.push(s);
  }
  return { row: r, matches };
});
const bySlot = new Map(slots.map(s => [s, []]));
for (const x of byRow) for (const s of x.matches) bySlot.get(s).push(x.row);

const lines = [];
const P = (s) => { lines.push(s); console.log(s); };
P("rows (mode=wake): " + rows.length + "  first " + rows[0].start_utc + "  last " + rows.at(-1).start_utc);
P("declared slots in [row_min - 3h, last row]: " + slots.length);
P("");
P("== rows by number of matching slots in [slot, slot+3h] ==");
for (const n of [0, 1, 2]) {
  const xs = byRow.filter(x => x.matches.length === n);
  P(n + ": " + xs.length);
  if (n !== 1) for (const x of xs) {
    // nearest slot offset for the zero rows
    let best = null;
    for (const s of slots) {
      const d = (x.row.t - s) / 60000;
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { s, d };
    }
    P("  " + x.row.start_utc + "  exit " + x.row.exit + "  outcome " + x.row.outcome +
      "  nearest " + new Date(best.s).toISOString() + "  offset " + (best.d >= 0 ? "+" : "") + best.d + "m");
  }
}
P("");
P("== slots by number of rows ==");
for (const n of [0, 1, 2]) {
  const nSlots = [...bySlot.values()].filter(v => n === 2 ? v.length >= 2 : v.length === n).length;
  P(n === 2 ? "2+: " + nSlots : n + ": " + nSlots);
}
P("");
P("== slots with two rows ==");
for (const [s, rs] of bySlot) if (rs.length > 1) {
  P(new Date(s).toISOString() + "  " + rs.map(r => r.start_utc + " exit " + r.exit + " (" + r.outcome + ")").join(" | "));
}
P("");
P("== death/skip states among the rows ==");
const states = {};
for (const r of rows) {
  let key;
  if (r.exit === "0") key = "ran (exit 0)";
  else if (r.exit === "1") key = "exit 1 (outcome says " + r.outcome + ")";
  else if (r.outcome.startsWith("skipped")) key = "skipped (no agent)";
  else key = "exit " + r.exit;
  states[key] = (states[key] || 0) + 1;
}
for (const [k, v] of Object.entries(states).sort((a,b) => b[1]-a[1])) P(v + "  " + k);
P("");
P("timeout rows (exit 143/137): " + rows.filter(r => r.exit === "143" || r.exit === "137").length);
P("the snapshot has no start-phase rows: every row is written after the run; a row present is not work.");

writeFileSync(new URL("./OUTPUT.txt", import.meta.url), lines.join(String.fromCharCode(10)) + String.fromCharCode(10));
