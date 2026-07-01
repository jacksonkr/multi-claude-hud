import { test } from "node:test";
import assert from "node:assert/strict";
import { computeHistory, overlap } from "../lib/history.mjs";

const S = 1000;
const RED = 300 * S; // 5 min threshold

// Build an event log for one session id.
const ev = (t, s, evType = "state") => ({ t, id: "a", host: "h", name: "term", s, ev: evType });

function agg(events, from, to, active) {
  const rows = computeHistory(events, from, to, RED, new Set(active ? ["a"] : []));
  return rows[0] || { green: 0, yellow: 0, red: 0, alive: 0 };
}

test("overlap computes intersection length", () => {
  assert.equal(overlap(0, 10, 5, 20), 5);
  assert.equal(overlap(0, 10, 10, 20), 0);
  assert.equal(overlap(0, 10, -5, 100), 10);
});

test("active session: work then idle splits green/yellow/red by threshold", () => {
  const events = [ev(0, "working"), ev(100 * S, "idle")];
  const r = agg(events, 0, 700 * S, true);
  assert.equal(r.green, 100 * S);
  assert.equal(r.yellow, 300 * S); // first 5 min idle
  assert.equal(r.red, 300 * S); // remaining idle
  assert.equal(r.alive, 700 * S);
});

test("window clipping only counts time inside the window", () => {
  const events = [ev(0, "working"), ev(100 * S, "idle")];
  const r = agg(events, 200 * S, 700 * S, true);
  assert.equal(r.green, 0); // working segment is before the window
  assert.equal(r.yellow, 200 * S); // 200..400 of the yellow stretch
  assert.equal(r.red, 300 * S);
  assert.equal(r.alive, 500 * S);
});

test("idle below threshold never turns red", () => {
  const r = agg([ev(0, "idle")], 0, 200 * S, true);
  assert.equal(r.yellow, 200 * S);
  assert.equal(r.red, 0);
});

test("ended (inactive) session stops at its last event", () => {
  const events = [ev(0, "working"), ev(50 * S, "idle", "end")];
  const r = agg(events, 0, 700 * S, false);
  assert.equal(r.green, 50 * S);
  assert.equal(r.alive, 50 * S);
  assert.equal(r.yellow, 0);
});

test("multiple sessions are returned sorted by alive desc", () => {
  const events = [
    { t: 0, id: "short", host: "h", name: "s", s: "working", ev: "state" },
    { t: 0, id: "long", host: "h", name: "l", s: "working", ev: "state" },
    { t: 10 * S, id: "short", host: "h", name: "s", s: "idle", ev: "end" },
  ];
  const rows = computeHistory(events, 0, 100 * S, RED, new Set(["long"]));
  assert.equal(rows[0].id, "long"); // alive the whole window
  assert.equal(rows[1].id, "short");
});
