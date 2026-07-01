import { test } from "node:test";
import assert from "node:assert/strict";
import { idleLabel, colorOf, keyOf, labelOf, sortComparator } from "../overlay/shared.mjs";

const S = 1000, M = 60 * S, H = 60 * M, D = 24 * H;

test("idleLabel always uses a single coarse unit (never compound)", () => {
  assert.equal(idleLabel(10 * S), "10s");
  assert.equal(idleLabel(59 * S), "59s");
  assert.equal(idleLabel(60 * S), "1m");
  assert.equal(idleLabel(2 * M + 10 * S), "2m");
  assert.equal(idleLabel(60 * M), "1h");
  assert.equal(idleLabel(23 * H), "23h");
  assert.equal(idleLabel(24 * H), "1d");
  assert.equal(idleLabel(7 * D), "1w");
  assert.equal(idleLabel(29 * D), "4w");
  assert.equal(idleLabel(30 * D), "1mo");
  assert.equal(idleLabel(364 * D), "12mo");
  assert.equal(idleLabel(365 * D), "1y");
});

test("colorOf: working=green, waiting=yellow, monitoring=split, idle=red", () => {
  assert.equal(colorOf({ status: "working" }), "green");
  assert.equal(colorOf({ status: "waiting" }), "yellow");
  assert.equal(colorOf({ status: "monitoring" }), "split");
  assert.equal(colorOf({ status: "idle" }), "red");
  assert.equal(colorOf({ status: "whatever" }), "red");
});

test("keyOf is stable on host+name; labelOf prefers name then project then host", () => {
  assert.equal(keyOf({ host: "mac", name: "api" }), "mac::api");
  assert.equal(keyOf({ host: "mac", project: "api" }), "mac::api");
  assert.equal(labelOf({ name: "n", project: "p", host: "h" }), "n");
  assert.equal(labelOf({ project: "p", host: "h" }), "p");
  assert.equal(labelOf({ host: "h" }), "h");
});

test("sortComparator: status puts working first, alpha sorts by label", () => {
  const work = { status: "working", name: "z", lastWorkingAt: 1 };
  const idle = { status: "idle", name: "a", lastWorkingAt: 2 };
  assert.ok(sortComparator("status")(work, idle) < 0); // working first
  assert.ok(sortComparator("alpha")(idle, work) < 0); // "a" before "z"
  assert.ok(sortComparator("lifetime")({ startedAt: 1 }, { startedAt: 2 }) < 0);
  assert.ok(sortComparator("recent")({ lastWorkingAt: 2 }, { lastWorkingAt: 1 }) < 0);
});
